from __future__ import annotations

import asyncio
import enum
import logging
import re
from dataclasses import dataclass

import numpy as np

from app.core.async_vectordb import AsyncVectorStore
from app.services.ingestion.embedder import Embedder

TYPE_CHECKING = False
if TYPE_CHECKING:
    from app.llm.base import LLMProvider

logger = logging.getLogger(__name__)

_CAMEL_CASE_RE = re.compile(r"[a-z]+[A-Z]")
_SNAKE_CASE_RE = re.compile(r"[a-z]+_[a-z]")
_DOTTED_IDENT_RE = re.compile(r"\w\.\w")

_CONCEPTUAL_STARTS = ("how", "why", "explain", "describe")
_CONCEPTUAL_PHRASES = ("what is", "what are", "what does", "what do")

_CONJUNCTION_PATTERNS = re.compile(
    r"\b(and\b.+\?|also\b|plus\b|as well as\b)", re.IGNORECASE
)

MAX_SUB_QUERIES = 4
RRF_K = 60


class QueryType(enum.Enum):
    SIMPLE = "SIMPLE"
    KEYWORD_LOOKUP = "KEYWORD_LOOKUP"
    CONCEPTUAL = "CONCEPTUAL"
    MULTI_PART = "MULTI_PART"


@dataclass(frozen=True, slots=True)
class QueryPlan:
    query_type: QueryType
    use_hyde: bool
    decompose: bool
    search_mode_hint: str
    sub_queries: tuple[str, ...] | None = None

    def to_dict(self) -> dict:
        return {
            "type": self.query_type.value,
            "hyde": self.use_hyde,
            "decomposed": self.decompose,
            "search_mode_hint": self.search_mode_hint,
            "sub_queries": list(self.sub_queries) if self.sub_queries else None,
        }


def classify_query(query: str) -> QueryType:
    stripped = query.strip()
    words = stripped.split()

    if _CAMEL_CASE_RE.search(stripped) or _SNAKE_CASE_RE.search(stripped):
        return QueryType.KEYWORD_LOOKUP
    if _DOTTED_IDENT_RE.search(stripped):
        return QueryType.KEYWORD_LOOKUP

    question_marks = stripped.count("?")
    if question_marks >= 2:
        return QueryType.MULTI_PART
    if _CONJUNCTION_PATTERNS.search(stripped) and question_marks >= 1:
        return QueryType.MULTI_PART

    lower = stripped.lower()
    if any(lower.startswith(w) for w in _CONCEPTUAL_STARTS):
        return QueryType.CONCEPTUAL
    if any(phrase in lower for phrase in _CONCEPTUAL_PHRASES):
        return QueryType.CONCEPTUAL
    for word in _CONCEPTUAL_STARTS:
        if f" {word} " in f" {lower} ":
            return QueryType.CONCEPTUAL

    if len(words) <= 3 and "?" not in stripped:
        return QueryType.SIMPLE

    return QueryType.SIMPLE


def plan_query(query: str, llm_available: bool) -> QueryPlan:
    qt = classify_query(query)
    return QueryPlan(
        query_type=qt,
        use_hyde=qt == QueryType.CONCEPTUAL and llm_available,
        decompose=qt == QueryType.MULTI_PART and llm_available,
        search_mode_hint="keyword" if qt == QueryType.KEYWORD_LOOKUP else "hybrid",
    )


# ---------------------------------------------------------------------------
# HyDE (Hypothetical Document Embedding) -- Task C.3
# ---------------------------------------------------------------------------

_HYDE_PROMPT = (
    "Write a short, factual passage (2-3 sentences) that would directly answer "
    "this question. Do not explain that you are generating a hypothetical answer. "
    "Just write the passage.\n\nQuestion: {query}"
)


async def generate_hyde_document(query: str, llm: LLMProvider) -> str:
    from app.llm.base import LLMMessage

    try:
        response = await llm.complete(
            [LLMMessage(role="user", content=_HYDE_PROMPT.format(query=query))],
            max_tokens=256,
            temperature=0.3,
        )
        text = response.content.strip()
        return text if text else query
    except Exception:
        logger.warning("HyDE generation failed; falling back to original query", exc_info=True)
        return query


def _average_and_normalize(vec_a: list[float], vec_b: list[float]) -> list[float]:
    a = np.asarray(vec_a, dtype=np.float32)
    b = np.asarray(vec_b, dtype=np.float32)
    avg = (a + b) / 2.0
    norm = np.linalg.norm(avg)
    if norm > 0:
        avg = avg / norm
    return avg.tolist()


async def execute_hyde_search(
    query: str,
    llm: LLMProvider,
    embedder: Embedder,
    vectordb: AsyncVectorStore,
    filter_str: str | None,
    top_k: int,
) -> list[dict]:
    hyde_doc = await generate_hyde_document(query, llm)

    query_vec, hyde_vec = await asyncio.gather(
        embedder.aembed_single(query),
        embedder.aembed_single(hyde_doc),
    )

    averaged = _average_and_normalize(query_vec, hyde_vec)
    return await vectordb.search(averaged, filter_str, top_k)


# ---------------------------------------------------------------------------
# Query Decomposition -- Task C.4
# ---------------------------------------------------------------------------

_DECOMPOSE_PROMPT = (
    "Break this question into 2-4 independent sub-questions that can be answered "
    "separately. Return each sub-question on its own line. Do not number them or "
    "add prefixes.\n\nQuestion: {query}"
)


async def decompose_query(query: str, llm: LLMProvider) -> list[str]:
    from app.llm.base import LLMMessage

    try:
        response = await llm.complete(
            [LLMMessage(role="user", content=_DECOMPOSE_PROMPT.format(query=query))],
            max_tokens=256,
            temperature=0.1,
        )
        lines = [
            line.strip()
            for line in response.content.strip().splitlines()
            if line.strip()
        ]
        if len(lines) <= 1:
            return [query]
        return lines[:MAX_SUB_QUERIES]
    except Exception:
        logger.warning(
            "Query decomposition failed; falling back to original query", exc_info=True
        )
        return [query]


def rrf_merge(ranked_lists: list[list[dict]], k: int = RRF_K) -> list[dict]:
    scores: dict[str, float] = {}
    best_row: dict[str, dict] = {}

    for ranked in ranked_lists:
        for rank, row in enumerate(ranked):
            chunk_id = row.get("id", "")
            rrf_score = 1.0 / (k + rank + 1)
            scores[chunk_id] = scores.get(chunk_id, 0.0) + rrf_score
            if chunk_id not in best_row:
                best_row[chunk_id] = row

    sorted_ids = sorted(scores, key=lambda cid: scores[cid], reverse=True)
    return [best_row[cid] for cid in sorted_ids]


async def execute_decomposed_search(
    sub_queries: list[str],
    embedder: Embedder,
    vectordb: AsyncVectorStore,
    filter_str: str | None,
    top_k_per_query: int = 20,
    final_top_k: int = 50,
) -> list[dict]:
    async def _search_one(q: str) -> list[dict]:
        vec = await embedder.aembed_single(q)
        return await vectordb.hybrid_search(vec, q, filter_str, top_k_per_query)

    all_results = await asyncio.gather(*[_search_one(q) for q in sub_queries])
    merged = rrf_merge(list(all_results))
    return merged[:final_top_k]
