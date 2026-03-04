from __future__ import annotations

import dataclasses
import logging
import time

from app.core.async_vectordb import AsyncVectorStore
from app.schemas.search import SearchResult
from app.services.ingestion.embedder import Embedder
from app.services.query_pipeline import (
    QueryPlan,
    execute_decomposed_search,
    execute_hyde_search,
    plan_query,
)
from app.services.retrieval_scoring import (
    extract_common_retrieval_fields,
    extract_retrieval_score,
)

logger = logging.getLogger(__name__)

TYPE_CHECKING = False
if TYPE_CHECKING:
    from app.llm.base import LLMProvider
    from app.services.reranker import Reranker


async def search(
    vectordb: AsyncVectorStore,
    embedder: Embedder,
    query: str,
    top_k: int = 10,
    project_id: str | None = None,
    mode: str = "hybrid",
    reranker: Reranker | None = None,
    candidate_k: int | None = None,
    query_llm: LLMProvider | None = None,
) -> tuple[list[SearchResult], QueryPlan | None]:
    plan = plan_query(query, llm_available=query_llm is not None)
    logger.info(
        "Query pipeline: type=%s hyde=%s decompose=%s mode_hint=%s",
        plan.query_type.value,
        plan.use_hyde,
        plan.decompose,
        plan.search_mode_hint,
    )

    effective_mode = mode
    if plan.search_mode_hint == "keyword" and mode == "hybrid":
        effective_mode = "keyword"

    filter_str = AsyncVectorStore.filter_by_project(project_id) if project_id else None

    use_reranker = reranker is not None and effective_mode != "keyword"
    retrieval_limit = (candidate_k or 50) if use_reranker else top_k

    retrieval_start = time.monotonic()

    if plan.use_hyde and query_llm is not None and effective_mode != "keyword":
        results = await execute_hyde_search(
            query, query_llm, embedder, vectordb, filter_str, retrieval_limit
        )
    elif plan.decompose and query_llm is not None and effective_mode != "keyword":
        from app.services.query_pipeline import decompose_query

        _decomposed_sub_queries = await decompose_query(query, query_llm)
        results = await execute_decomposed_search(
            _decomposed_sub_queries,
            embedder,
            vectordb,
            filter_str,
            top_k_per_query=retrieval_limit,
            final_top_k=retrieval_limit,
        )
        plan = dataclasses.replace(plan, sub_queries=tuple(_decomposed_sub_queries))
    elif effective_mode == "keyword":
        results = await vectordb.fts_search(query, filter_str, retrieval_limit)
    elif effective_mode == "hybrid":
        query_vector = await embedder.aembed_single(query)
        results = await vectordb.hybrid_search(query_vector, query, filter_str, retrieval_limit)
    else:  # vector
        query_vector = await embedder.aembed_single(query)
        results = await vectordb.search(query_vector, filter_str, retrieval_limit)

    retrieval_ms = (time.monotonic() - retrieval_start) * 1000

    if use_reranker and results:
        texts = [row.get("chunk_text", "") for row in results]
        ranked = await reranker.arerank(query, texts, top_k=top_k)

        reranked: list[SearchResult] = []
        for orig_idx, score in ranked:
            row = results[orig_idx]
            reranked.append(
                SearchResult(
                    **extract_common_retrieval_fields(row),
                    file_type=row.get("file_type", ""),
                    score=score,
                    project_id=row.get("project_id", ""),
                )
            )
        logger.info(
            "Search complete: candidates=%d reranked=%d duration=%.1fms",
            len(results),
            len(reranked),
            retrieval_ms,
        )
        return reranked, plan

    missing_score_default = 1.0 if effective_mode in {"vector", "hybrid"} else 0.0
    out = [
        SearchResult(
            **extract_common_retrieval_fields(row),
            file_type=row.get("file_type", ""),
            score=extract_retrieval_score(
                row,
                effective_mode,
                missing_score_default=missing_score_default,
            ),
            project_id=row.get("project_id", ""),
        )
        for row in results
    ]
    logger.info(
        "Search complete: results=%d duration=%.1fms",
        len(out),
        retrieval_ms,
    )
    return out, plan
