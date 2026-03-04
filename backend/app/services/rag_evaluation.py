"""RAG retrieval evaluation helpers.

This module provides lightweight, async-safe utilities for measuring retrieval
quality over a labeled dataset without calling an LLM. Metrics include:
  - Mean Recall@K
  - Mean Precision@K
  - Hit Rate@K
  - Mean Reciprocal Rank (MRR)
"""

import json
import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from app.core.async_vectordb import AsyncVectorStore
from app.schemas.search import SearchResult
from app.services import search_service
from app.services.ingestion.embedder import Embedder


@dataclass(slots=True)
class RetrievalEvalCase:
    query: str
    expected_source_ids: list[str]
    project_id: str | None = None
    mode: str = "hybrid"
    top_k: int = 10


@dataclass(slots=True)
class RetrievalEvalCaseResult:
    query: str
    project_id: str | None
    expected_source_ids: list[str]
    retrieved_source_ids: list[str]
    recall_at_k: float
    precision_at_k: float
    reciprocal_rank: float
    first_relevant_rank: int | None


@dataclass(slots=True)
class RetrievalEvalReport:
    total_cases: int
    avg_recall_at_k: float
    avg_precision_at_k: float
    hit_rate_at_k: float
    mean_reciprocal_rank: float
    case_results: list[RetrievalEvalCaseResult]


SearchCallable = Callable[
    [RetrievalEvalCase],
    Awaitable[list[SearchResult]],
]

_DEFAULT_EVAL_CONCURRENCY = 8


def load_retrieval_cases(path: str) -> list[RetrievalEvalCase]:
    """Load evaluation cases from a JSONL file.

    Expected per-line schema:
      {"query": "...", "expected_source_ids": ["id1", "id2"], "project_id": "...", "mode": "hybrid", "top_k": 10}
    Only `query` and `expected_source_ids` are required.
    """
    cases: list[RetrievalEvalCase] = []
    with open(path, encoding="utf-8") as f:
        for idx, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue
            payload = json.loads(line)
            query = payload.get("query")
            expected_source_ids = payload.get("expected_source_ids")
            if not query or not isinstance(query, str):
                raise ValueError(f"Invalid query at line {idx}")
            if not isinstance(expected_source_ids, list) or not expected_source_ids:
                raise ValueError(f"Invalid expected_source_ids at line {idx}")

            mode = payload.get("mode", "hybrid")
            top_k = payload.get("top_k", 10)
            if mode not in {"hybrid", "vector", "keyword"}:
                raise ValueError(f"Invalid mode at line {idx}: {mode}")
            if not isinstance(top_k, int) or top_k < 1:
                raise ValueError(f"Invalid top_k at line {idx}: {top_k}")

            cases.append(
                RetrievalEvalCase(
                    query=query,
                    expected_source_ids=[str(item) for item in expected_source_ids],
                    project_id=payload.get("project_id"),
                    mode=mode,
                    top_k=top_k,
                )
            )
    return cases


async def evaluate_retrieval(
    cases: list[RetrievalEvalCase],
    search_callable: SearchCallable,
    concurrency: int = _DEFAULT_EVAL_CONCURRENCY,
) -> RetrievalEvalReport:
    """Run retrieval evaluation over cases using a caller-supplied search function."""
    if not cases:
        return RetrievalEvalReport(
            total_cases=0,
            avg_recall_at_k=0.0,
            avg_precision_at_k=0.0,
            hit_rate_at_k=0.0,
            mean_reciprocal_rank=0.0,
            case_results=[],
        )
    if concurrency < 1:
        raise ValueError(f"concurrency must be >= 1, got {concurrency}")

    semaphore = asyncio.Semaphore(concurrency)
    indexed_results: list[tuple[int, RetrievalEvalCaseResult]] = []

    async def _evaluate_case(
        idx: int, case: RetrievalEvalCase
    ) -> tuple[int, RetrievalEvalCaseResult]:
        async with semaphore:
            results = await search_callable(case)

        retrieved_source_ids = [row.source_id for row in results]
        expected = set(case.expected_source_ids)
        retrieved = retrieved_source_ids[: case.top_k]
        hits = [source_id for source_id in retrieved if source_id in expected]

        recall = len(set(hits)) / len(expected) if expected else 0.0
        precision = len(hits) / len(retrieved) if retrieved else 0.0

        first_rank: int | None = None
        for rank, source_id in enumerate(retrieved, start=1):
            if source_id in expected:
                first_rank = rank
                break
        reciprocal_rank = (1.0 / first_rank) if first_rank is not None else 0.0

        return idx, RetrievalEvalCaseResult(
            query=case.query,
            project_id=case.project_id,
            expected_source_ids=case.expected_source_ids,
            retrieved_source_ids=retrieved,
            recall_at_k=recall,
            precision_at_k=precision,
            reciprocal_rank=reciprocal_rank,
            first_relevant_rank=first_rank,
        )

    indexed_results = await asyncio.gather(
        *(_evaluate_case(idx, case) for idx, case in enumerate(cases))
    )

    indexed_results.sort(key=lambda item: item[0])
    case_results = [result for _, result in indexed_results]
    recall_sum = 0.0
    precision_sum = 0.0
    rr_sum = 0.0
    hit_cases = 0

    for case_result in case_results:
        if case_result.first_relevant_rank is not None:
            hit_cases += 1

        recall_sum += case_result.recall_at_k
        precision_sum += case_result.precision_at_k
        rr_sum += case_result.reciprocal_rank

    total = len(cases)
    return RetrievalEvalReport(
        total_cases=total,
        avg_recall_at_k=recall_sum / total,
        avg_precision_at_k=precision_sum / total,
        hit_rate_at_k=hit_cases / total,
        mean_reciprocal_rank=rr_sum / total,
        case_results=case_results,
    )


async def evaluate_retrieval_with_services(
    vectordb: AsyncVectorStore,
    embedder: Embedder,
    cases: list[RetrievalEvalCase],
    concurrency: int = _DEFAULT_EVAL_CONCURRENCY,
) -> RetrievalEvalReport:
    """Evaluate retrieval by calling the built-in search service."""

    async def _search(case: RetrievalEvalCase) -> list[SearchResult]:
        results, _plan = await search_service.search(
            vectordb=vectordb,
            embedder=embedder,
            query=case.query,
            top_k=case.top_k,
            project_id=case.project_id,
            mode=case.mode,
        )
        return results

    return await evaluate_retrieval(cases, _search, concurrency=concurrency)
