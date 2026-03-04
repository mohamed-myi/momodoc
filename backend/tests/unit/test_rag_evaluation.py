import json
import asyncio
from pathlib import Path

import pytest

from app.schemas.search import SearchResult
from app.services.rag_evaluation import (
    RetrievalEvalCase,
    evaluate_retrieval,
    load_retrieval_cases,
)


def _result(source_id: str) -> SearchResult:
    return SearchResult(
        source_type="file",
        source_id=source_id,
        filename=f"{source_id}.txt",
        original_path=f"/tmp/{source_id}.txt",
        chunk_text="content",
        chunk_index=0,
        file_type="txt",
        score=0.9,
        project_id="p1",
    )


class TestLoadRetrievalCases:
    def test_load_retrieval_cases_from_jsonl(self, tmp_path: Path):
        file_path = tmp_path / "cases.jsonl"
        file_path.write_text(
            "\n".join(
                [
                    json.dumps({
                        "query": "how to deploy",
                        "expected_source_ids": ["s1", "s2"],
                        "project_id": "p1",
                        "mode": "hybrid",
                        "top_k": 5,
                    }),
                    json.dumps({
                        "query": "auth middleware",
                        "expected_source_ids": ["s3"],
                    }),
                ]
            ),
            encoding="utf-8",
        )

        cases = load_retrieval_cases(str(file_path))
        assert len(cases) == 2
        assert cases[0].query == "how to deploy"
        assert cases[0].expected_source_ids == ["s1", "s2"]
        assert cases[0].project_id == "p1"
        assert cases[0].top_k == 5
        assert cases[1].mode == "hybrid"

    def test_invalid_case_raises(self, tmp_path: Path):
        file_path = tmp_path / "bad_cases.jsonl"
        file_path.write_text(json.dumps({"query": "missing expected ids"}), encoding="utf-8")
        with pytest.raises(ValueError):
            load_retrieval_cases(str(file_path))


class TestEvaluateRetrieval:
    @pytest.mark.asyncio
    async def test_evaluate_retrieval_metrics(self):
        cases = [
            RetrievalEvalCase(
                query="q1",
                expected_source_ids=["s1", "s2"],
                top_k=3,
            ),
            RetrievalEvalCase(
                query="q2",
                expected_source_ids=["s9"],
                top_k=3,
            ),
        ]

        async def fake_search(case: RetrievalEvalCase):
            if case.query == "q1":
                return [_result("s2"), _result("s7"), _result("s1")]
            return [_result("s3"), _result("s4"), _result("s5")]

        report = await evaluate_retrieval(cases, fake_search)

        assert report.total_cases == 2
        # q1 recall=1.0 (2/2), q2 recall=0.0 -> avg 0.5
        assert report.avg_recall_at_k == pytest.approx(0.5)
        # q1 precision=2/3, q2 precision=0/3
        assert report.avg_precision_at_k == pytest.approx((2 / 3) / 2)
        # one hit case out of two
        assert report.hit_rate_at_k == pytest.approx(0.5)
        # q1 first relevant at rank 1 => RR=1.0; q2 RR=0.0
        assert report.mean_reciprocal_rank == pytest.approx(0.5)
        assert report.case_results[0].first_relevant_rank == 1
        assert report.case_results[1].first_relevant_rank is None

    @pytest.mark.asyncio
    async def test_evaluate_empty_cases(self):
        async def fake_search(_: RetrievalEvalCase):
            return []

        report = await evaluate_retrieval([], fake_search)
        assert report.total_cases == 0
        assert report.avg_recall_at_k == 0.0
        assert report.avg_precision_at_k == 0.0
        assert report.hit_rate_at_k == 0.0
        assert report.mean_reciprocal_rank == 0.0
        assert report.case_results == []

    @pytest.mark.asyncio
    async def test_evaluate_retrieval_uses_bounded_concurrency(self):
        cases = [
            RetrievalEvalCase(query=f"q{i}", expected_source_ids=["s1"], top_k=1)
            for i in range(24)
        ]
        active = 0
        max_active = 0
        lock = asyncio.Lock()

        async def fake_search(_: RetrievalEvalCase):
            nonlocal active, max_active
            async with lock:
                active += 1
                max_active = max(max_active, active)
            await asyncio.sleep(0.001)
            async with lock:
                active -= 1
            return [_result("s1")]

        report = await evaluate_retrieval(cases, fake_search, concurrency=4)
        assert report.total_cases == 24
        assert max_active <= 4
        assert max_active > 1
        assert [result.query for result in report.case_results] == [f"q{i}" for i in range(24)]

    @pytest.mark.asyncio
    async def test_evaluate_retrieval_rejects_invalid_concurrency(self):
        async def fake_search(_: RetrievalEvalCase):
            return [_result("s1")]

        with pytest.raises(ValueError, match="concurrency must be >= 1"):
            await evaluate_retrieval(
                [RetrievalEvalCase(query="q", expected_source_ids=["s1"])],
                fake_search,
                concurrency=0,
            )
