from __future__ import annotations

import asyncio
import dataclasses
import logging
import time

from app.core.async_vectordb import AsyncVectorStore
from app.llm.base import LLMMessage, LLMProvider
from app.models.chat_message import ChatMessage
from app.models.message_source import MessageSource
from app.schemas.chat import ChatSource
from app.services.ingestion.embedder import Embedder
from app.services.query_pipeline import (
    execute_decomposed_search,
    execute_hyde_search,
    plan_query,
)
from app.services.retrieval_scoring import (
    extract_common_retrieval_fields,
    extract_retrieval_score,
)

TYPE_CHECKING = False
if TYPE_CHECKING:
    from app.services.reranker import Reranker

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are a knowledge assistant for a personal project management tool called momodoc. "
    "Answer the user's question based on the provided context from their project files and notes. "
    "Always cite your sources using [Source N] notation matching the source numbers provided. "
    "If the context doesn't contain enough information to answer, say so clearly. "
    "Be concise, accurate, and helpful."
)

MAX_HISTORY_MESSAGES = 20
RECENT_CONTEXT_COUNT = 3
MAX_PINNED_CHUNKS_PER_SOURCE = 2048
MAX_CHUNKS_PER_SOURCE = 3
PINNED_SOURCE_COLUMNS = [
    "source_type",
    "source_id",
    "filename",
    "original_path",
    "chunk_text",
    "chunk_index",
    "section_header",
]


def _estimate_tokens(text: str) -> int:
    from app.services.tokenizer import estimate_tokens

    return max(1, estimate_tokens(text))


def _infer_context_window(llm: LLMProvider | None) -> int:
    if llm is None:
        return 8192

    from app.llm.models import get_context_window

    model = (llm.get_model_name() or "").lower()

    known = get_context_window(model)
    if known is not None:
        return known

    if "claude" in model:
        return 200_000
    if "gemini" in model:
        return 1_000_000
    if model.startswith(("gpt-4", "gpt-5")):
        return 128_000
    if model.startswith(("o1", "o3", "o4")):
        return 200_000
    if "qwen" in model or "llama" in model or "mistral" in model:
        return 32_000
    return 8192


def _context_token_budget(llm: LLMProvider | None) -> int:
    window = _infer_context_window(llm)
    reserve_for_completion = min(4096, max(1024, window // 5))
    safety_margin = max(512, window // 20)
    return max(2048, window - reserve_for_completion - safety_margin)


def _select_context_sources(
    history: list[ChatMessage],
    sources: list[ChatSource],
    user_query: str,
    llm: LLMProvider | None,
) -> list[ChatSource]:
    if not sources:
        return []

    budget = _context_token_budget(llm)
    used = _estimate_tokens(SYSTEM_PROMPT) + _estimate_tokens(user_query) + 40
    for msg in history:
        used += _estimate_tokens(msg.content) + 10

    if used >= budget:
        logger.info(
            "Prompt budget exhausted before adding sources; omitting retrieved context"
        )
        return []

    selected: list[ChatSource] = []
    for i, source in enumerate(sources, 1):
        label = source.filename or "Note"
        if source.section_header:
            label = f"{label} > {source.section_header}"
        block_header = f"[Source {i}: {label}]\n"
        block_tokens = _estimate_tokens(block_header + source.chunk_text) + 8

        if used + block_tokens <= budget:
            selected.append(source)
            used += block_tokens
            continue

        # Add a truncated tail source if there is still room.
        remaining_tokens = budget - used - _estimate_tokens(block_header)
        if remaining_tokens <= 64:
            break
        max_chars = remaining_tokens * 4
        if max_chars <= 0:
            break
        truncated_text = source.chunk_text[:max_chars].rstrip()
        if not truncated_text:
            break
        if len(truncated_text) < len(source.chunk_text):
            truncated_text = f"{truncated_text}\n...[truncated]"
        selected.append(source.model_copy(update={"chunk_text": truncated_text}))
        break

    return selected


def _create_source_objects(sources: list[ChatSource]) -> list[MessageSource]:
    """Create MessageSource ORM objects from ChatSource schema objects."""
    return [
        MessageSource(
            source_type=s.source_type,
            source_id=s.source_id,
            filename=s.filename,
            original_path=s.original_path,
            chunk_text=s.chunk_text,
            chunk_index=s.chunk_index,
            score=s.score,
            source_order=i,
            section_header=s.section_header,
        )
        for i, s in enumerate(sources)
    ]


def _cap_per_source(sources: list[ChatSource], max_per_source: int) -> list[ChatSource]:
    """Limit results to at most max_per_source chunks from any single source_id.

    Preserves the existing sort order so relevance ranking is maintained.
    """
    counts: dict[str, int] = {}
    capped: list[ChatSource] = []
    for s in sources:
        count = counts.get(s.source_id, 0)
        if count < max_per_source:
            capped.append(s)
            counts[s.source_id] = count + 1
    return capped


async def _retrieve_context(
    vectordb: AsyncVectorStore,
    embedder: Embedder,
    project_id: str | None,
    query: str,
    top_k: int,
    pinned_source_ids: list[str] | None = None,
    reranker: Reranker | None = None,
    candidate_k: int | None = None,
    query_llm: LLMProvider | None = None,
) -> tuple[list[ChatSource], dict | None]:
    plan = plan_query(query, llm_available=query_llm is not None)
    logger.info(
        "Chat query pipeline: type=%s hyde=%s decompose=%s",
        plan.query_type.value, plan.use_hyde, plan.decompose,
    )

    pinned_sources: list[ChatSource] = []
    pinned_chunk_keys: set[tuple[str, int]] = set()

    if pinned_source_ids:
        unique_pinned_source_ids = list(dict.fromkeys(pinned_source_ids))
        pinned_tasks = []
        task_source_ids: list[str] = []
        for source_id in unique_pinned_source_ids:
            try:
                filter_str = AsyncVectorStore.filter_by_source(source_id)
            except Exception:
                logger.warning("Skipping invalid pinned source id %s", source_id)
                continue
            task_source_ids.append(source_id)
            pinned_tasks.append(
                vectordb.get_by_filter(
                    filter_str,
                    columns=PINNED_SOURCE_COLUMNS,
                    limit=MAX_PINNED_CHUNKS_PER_SOURCE,
                )
            )

        pinned_results = await asyncio.gather(*pinned_tasks, return_exceptions=True)
        for source_id, result in zip(task_source_ids, pinned_results, strict=False):
            if isinstance(result, Exception):
                logger.warning("Failed to fetch pinned source %s", source_id)
                continue
            if len(result) >= MAX_PINNED_CHUNKS_PER_SOURCE:
                logger.info(
                    "Pinned source %s reached retrieval limit (%d chunks)",
                    source_id,
                    MAX_PINNED_CHUNKS_PER_SOURCE,
                )
            for row in result:
                src = ChatSource(
                    **extract_common_retrieval_fields(row),
                    score=1.0,
                )
                pinned_sources.append(src)
                pinned_chunk_keys.add((src.source_id, src.chunk_index))

    retrieval_limit = (candidate_k or 50) if reranker is not None else top_k
    filter_str = AsyncVectorStore.filter_by_project(project_id) if project_id else None

    retrieval_start = time.monotonic()

    if plan.search_mode_hint == "keyword":
        results = await vectordb.fts_search(query, filter_str, retrieval_limit)
    elif plan.use_hyde and query_llm is not None:
        results = await execute_hyde_search(
            query, query_llm, embedder, vectordb, filter_str, retrieval_limit
        )
    elif plan.decompose and query_llm is not None:
        from app.services.query_pipeline import decompose_query

        sub_queries = await decompose_query(query, query_llm)
        results = await execute_decomposed_search(
            sub_queries, embedder, vectordb, filter_str,
            top_k_per_query=retrieval_limit, final_top_k=retrieval_limit,
        )
        plan = dataclasses.replace(plan, sub_queries=tuple(sub_queries))
    else:
        query_vector = await embedder.aembed_single(query)
        results = await vectordb.hybrid_search(
            query_vector, query, filter_str, retrieval_limit
        )

    retrieval_ms = (time.monotonic() - retrieval_start) * 1000

    unpinned_rows = [
        row
        for row in results
        if (row.get("source_id", ""), row.get("chunk_index", 0)) not in pinned_chunk_keys
    ]

    if reranker is not None and unpinned_rows:
        texts = [row.get("chunk_text", "") for row in unpinned_rows]
        ranked = await reranker.arerank(query, texts, top_k=top_k)

        search_sources = [
            ChatSource(
                **extract_common_retrieval_fields(unpinned_rows[orig_idx]),
                score=score,
            )
            for orig_idx, score in ranked
        ]
    else:
        search_sources = [
            ChatSource(
                **extract_common_retrieval_fields(row),
                score=extract_retrieval_score(row, "hybrid"),
            )
            for row in unpinned_rows
        ]
        search_sources.sort(key=lambda s: (-s.score, s.source_id, s.chunk_index))

    search_sources = _cap_per_source(search_sources, MAX_CHUNKS_PER_SOURCE)

    retrieval_metadata = {
        "query_plan": plan.to_dict(),
        "candidates_fetched": len(results),
        "reranked": reranker is not None and len(unpinned_rows) > 0,
        "retrieval_ms": round(retrieval_ms, 1),
    }

    return pinned_sources + search_sources, retrieval_metadata


def _build_messages(
    history: list[ChatMessage],
    sources: list[ChatSource],
    user_query: str,
) -> list[LLMMessage]:
    messages = [LLMMessage(role="system", content=SYSTEM_PROMPT)]

    # Add conversation history (history was fetched before saving the new message,
    # so no dedup filtering is needed)
    for msg in history:
        messages.append(LLMMessage(role=msg.role, content=msg.content))

    # Build context from sources
    if sources:
        context_parts = []
        for i, source in enumerate(sources, 1):
            label = source.filename or "Note"
            if source.section_header:
                label = f"{label} > {source.section_header}"
            context_parts.append(f"[Source {i}: {label}]\n{source.chunk_text}")
        context_str = "\n\n---\n\n".join(context_parts)

        user_content = (
            f"Context from project:\n\n{context_str}\n\n"
            f"---\n\nQuestion: {user_query}"
        )
    else:
        user_content = (
            f"No relevant context was found in the project data.\n\n"
            f"Question: {user_query}"
        )

    messages.append(LLMMessage(role="user", content=user_content))
    return messages
