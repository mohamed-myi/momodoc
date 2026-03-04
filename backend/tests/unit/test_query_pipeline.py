"""Tests for the adaptive query pipeline: classifier, HyDE, decomposition, and RRF."""

import math
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.llm.base import LLMResponse
from app.services.query_pipeline import (
    MAX_SUB_QUERIES,
    QueryType,
    _average_and_normalize,
    classify_query,
    decompose_query,
    execute_decomposed_search,
    execute_hyde_search,
    generate_hyde_document,
    plan_query,
    rrf_merge,
)


class TestClassifyQuery:
    def test_short_phrase_without_question_mark_is_simple(self):
        assert classify_query("files") == QueryType.SIMPLE
        assert classify_query("hello world") == QueryType.SIMPLE
        assert classify_query("log output") == QueryType.SIMPLE

    def test_single_word_with_question_mark_defaults_to_simple(self):
        assert classify_query("what?") == QueryType.SIMPLE

    def test_camel_case_is_keyword_lookup(self):
        assert classify_query("getUserById") == QueryType.KEYWORD_LOOKUP
        assert classify_query("where is fetchData used") == QueryType.KEYWORD_LOOKUP

    def test_snake_case_is_keyword_lookup(self):
        assert classify_query("get_user_by_id function") == QueryType.KEYWORD_LOOKUP
        assert classify_query("find chat_service") == QueryType.KEYWORD_LOOKUP

    def test_dotted_identifier_is_keyword_lookup(self):
        assert classify_query("app.services.search") == QueryType.KEYWORD_LOOKUP
        assert classify_query("os.path.join usage") == QueryType.KEYWORD_LOOKUP

    def test_multiple_question_marks_is_multi_part(self):
        result = classify_query("How does auth work? Where are rate limits?")
        assert result == QueryType.MULTI_PART

    def test_conjunction_with_question_mark_is_multi_part(self):
        result = classify_query(
            "How does authentication work and where are rate limits configured?"
        )
        assert result == QueryType.MULTI_PART

    def test_how_question_is_conceptual(self):
        assert classify_query("How does authentication work") == QueryType.CONCEPTUAL

    def test_why_question_is_conceptual(self):
        assert classify_query("Why is the ingestion slow") == QueryType.CONCEPTUAL

    def test_explain_is_conceptual(self):
        assert classify_query("Explain the ingestion pipeline") == QueryType.CONCEPTUAL

    def test_describe_is_conceptual(self):
        assert classify_query("Describe the chat architecture") == QueryType.CONCEPTUAL

    def test_what_is_is_conceptual(self):
        assert classify_query("What is the purpose of the reranker") == QueryType.CONCEPTUAL

    def test_mid_sentence_conceptual_word_detected(self):
        assert classify_query("Can you explain the data flow") == QueryType.CONCEPTUAL

    def test_long_non_matching_defaults_to_simple(self):
        assert classify_query("list all projects in the system") == QueryType.SIMPLE

    def test_empty_string_is_simple(self):
        assert classify_query("") == QueryType.SIMPLE

    def test_whitespace_only_is_simple(self):
        assert classify_query("   ") == QueryType.SIMPLE

    def test_keyword_takes_priority_over_conceptual(self):
        result = classify_query("How does getUserById work")
        assert result == QueryType.KEYWORD_LOOKUP

    def test_also_conjunction_with_question(self):
        result = classify_query("Show the config also where is the startup?")
        assert result == QueryType.MULTI_PART


class TestPlanQuery:
    def test_simple_query_no_transforms(self):
        plan = plan_query("files", llm_available=True)
        assert plan.query_type == QueryType.SIMPLE
        assert plan.use_hyde is False
        assert plan.decompose is False
        assert plan.search_mode_hint == "hybrid"

    def test_conceptual_with_llm_enables_hyde(self):
        plan = plan_query("How does authentication work", llm_available=True)
        assert plan.query_type == QueryType.CONCEPTUAL
        assert plan.use_hyde is True
        assert plan.decompose is False

    def test_conceptual_without_llm_disables_hyde(self):
        plan = plan_query("How does authentication work", llm_available=False)
        assert plan.use_hyde is False

    def test_multi_part_with_llm_enables_decompose(self):
        plan = plan_query("How does auth work? Where are rate limits?", llm_available=True)
        assert plan.query_type == QueryType.MULTI_PART
        assert plan.decompose is True
        assert plan.use_hyde is False

    def test_multi_part_without_llm_disables_decompose(self):
        plan = plan_query("How does auth work? Where are rate limits?", llm_available=False)
        assert plan.decompose is False

    def test_keyword_sets_keyword_mode_hint(self):
        plan = plan_query("getUserById", llm_available=True)
        assert plan.search_mode_hint == "keyword"

    def test_to_dict_structure(self):
        plan = plan_query("Explain auth", llm_available=True)
        d = plan.to_dict()
        assert d["type"] == "CONCEPTUAL"
        assert d["hyde"] is True
        assert d["decomposed"] is False
        assert d["search_mode_hint"] == "hybrid"
        assert d["sub_queries"] is None

    def test_to_dict_includes_sub_queries_when_set(self):
        from dataclasses import replace

        plan = plan_query("How does auth work and where are limits?", llm_available=True)
        plan_with_subs = replace(plan, sub_queries=("How does auth work?", "Where are limits?"))
        d = plan_with_subs.to_dict()
        assert d["sub_queries"] == ["How does auth work?", "Where are limits?"]


class TestGenerateHydeDocument:
    @pytest.mark.asyncio
    async def test_generates_passage_from_llm(self):
        mock_llm = AsyncMock()
        mock_llm.complete.return_value = LLMResponse(
            content="Auth uses JWT tokens stored in cookies.",
            model="test",
        )
        result = await generate_hyde_document("How does auth work?", mock_llm)
        assert result == "Auth uses JWT tokens stored in cookies."
        mock_llm.complete.assert_called_once()

    @pytest.mark.asyncio
    async def test_falls_back_to_original_on_error(self):
        mock_llm = AsyncMock()
        mock_llm.complete.side_effect = RuntimeError("LLM down")
        result = await generate_hyde_document("How does auth work?", mock_llm)
        assert result == "How does auth work?"

    @pytest.mark.asyncio
    async def test_falls_back_on_empty_response(self):
        mock_llm = AsyncMock()
        mock_llm.complete.return_value = LLMResponse(content="", model="test")
        result = await generate_hyde_document("How does auth work?", mock_llm)
        assert result == "How does auth work?"


class TestAverageAndNormalize:
    def test_identical_vectors_return_normalized(self):
        v = [1.0, 0.0, 0.0]
        result = _average_and_normalize(v, v)
        assert len(result) == 3
        assert result[0] == pytest.approx(1.0)
        assert result[1] == pytest.approx(0.0)
        assert result[2] == pytest.approx(0.0)

    def test_orthogonal_vectors_normalized(self):
        a = [1.0, 0.0]
        b = [0.0, 1.0]
        result = _average_and_normalize(a, b)
        norm = math.sqrt(result[0] ** 2 + result[1] ** 2)
        assert norm == pytest.approx(1.0, abs=1e-5)
        assert result[0] == pytest.approx(result[1], abs=1e-5)

    def test_zero_vectors_return_zero(self):
        result = _average_and_normalize([0.0, 0.0], [0.0, 0.0])
        assert result == [0.0, 0.0]


class TestExecuteHydeSearch:
    @pytest.mark.asyncio
    async def test_combines_hyde_and_query_vectors(self):
        mock_llm = AsyncMock()
        mock_llm.complete.return_value = LLMResponse(content="Hypothetical passage", model="test")

        mock_embedder = MagicMock()
        mock_embedder.aembed_single = AsyncMock(
            side_effect=[
                [1.0, 0.0, 0.0],  # query vector
                [0.0, 1.0, 0.0],  # hyde vector
            ]
        )

        mock_vectordb = MagicMock()
        mock_vectordb.search = AsyncMock(return_value=[{"id": "c1", "chunk_text": "result"}])

        results = await execute_hyde_search(
            "How does auth work?", mock_llm, mock_embedder, mock_vectordb, None, 10
        )
        assert len(results) == 1
        search_call = mock_vectordb.search.call_args
        search_vector = search_call[0][0]
        norm = math.sqrt(sum(x**2 for x in search_vector))
        assert norm == pytest.approx(1.0, abs=1e-5)

    @pytest.mark.asyncio
    async def test_hyde_failure_uses_query_vector_only(self):
        mock_llm = AsyncMock()
        mock_llm.complete.side_effect = RuntimeError("fail")

        mock_embedder = MagicMock()
        mock_embedder.aembed_single = AsyncMock(
            side_effect=[
                [1.0, 0.0, 0.0],  # query
                [1.0, 0.0, 0.0],  # hyde fallback embeds original query
            ]
        )

        mock_vectordb = MagicMock()
        mock_vectordb.search = AsyncMock(return_value=[])

        results = await execute_hyde_search(
            "How does auth work?", mock_llm, mock_embedder, mock_vectordb, None, 10
        )
        assert results == []
        mock_vectordb.search.assert_called_once()


class TestDecomposeQuery:
    @pytest.mark.asyncio
    async def test_decomposes_into_sub_queries(self):
        mock_llm = AsyncMock()
        mock_llm.complete.return_value = LLMResponse(
            content="How does auth work?\nWhere are rate limits configured?",
            model="test",
        )
        subs = await decompose_query(
            "How does auth work and where are rate limits configured?", mock_llm
        )
        assert len(subs) == 2
        assert "auth" in subs[0].lower()
        assert "rate" in subs[1].lower()

    @pytest.mark.asyncio
    async def test_caps_at_max_sub_queries(self):
        mock_llm = AsyncMock()
        lines = "\n".join(f"Sub question {i}?" for i in range(10))
        mock_llm.complete.return_value = LLMResponse(content=lines, model="test")
        subs = await decompose_query("big question", mock_llm)
        assert len(subs) <= MAX_SUB_QUERIES

    @pytest.mark.asyncio
    async def test_single_line_returns_original(self):
        mock_llm = AsyncMock()
        mock_llm.complete.return_value = LLMResponse(content="Just one question", model="test")
        subs = await decompose_query("original question", mock_llm)
        assert subs == ["original question"]

    @pytest.mark.asyncio
    async def test_llm_failure_returns_original(self):
        mock_llm = AsyncMock()
        mock_llm.complete.side_effect = RuntimeError("LLM down")
        subs = await decompose_query("original question", mock_llm)
        assert subs == ["original question"]

    @pytest.mark.asyncio
    async def test_empty_response_returns_original(self):
        mock_llm = AsyncMock()
        mock_llm.complete.return_value = LLMResponse(content="", model="test")
        subs = await decompose_query("original question", mock_llm)
        assert subs == ["original question"]


class TestRrfMerge:
    def test_basic_merge_deduplicates(self):
        list1 = [{"id": "a"}, {"id": "b"}]
        list2 = [{"id": "b"}, {"id": "c"}]
        merged = rrf_merge([list1, list2])
        ids = [r["id"] for r in merged]
        assert len(ids) == 3
        assert "b" in ids
        assert ids.index("b") == 0  # b appears in both lists so highest RRF

    def test_single_list_preserves_order(self):
        items = [{"id": "x"}, {"id": "y"}, {"id": "z"}]
        merged = rrf_merge([items])
        assert [r["id"] for r in merged] == ["x", "y", "z"]

    def test_empty_lists(self):
        assert rrf_merge([]) == []
        assert rrf_merge([[], []]) == []

    def test_rrf_scores_are_monotonically_decreasing(self):
        list1 = [{"id": "a"}, {"id": "b"}, {"id": "c"}]
        list2 = [{"id": "d"}, {"id": "e"}, {"id": "a"}]
        merged = rrf_merge([list1, list2])
        assert merged[0]["id"] == "a"


class TestExecuteDecomposedSearch:
    @pytest.mark.asyncio
    async def test_parallel_search_and_merge(self):
        mock_embedder = MagicMock()
        mock_embedder.aembed_single = AsyncMock(return_value=[0.0] * 384)

        mock_vectordb = MagicMock()
        call_count = 0

        async def _hybrid(vec, text, filt, limit):
            nonlocal call_count
            call_count += 1
            if "auth" in text:
                return [
                    {"id": "c1", "chunk_text": "auth doc"},
                    {"id": "c2", "chunk_text": "shared doc"},
                ]
            return [
                {"id": "c3", "chunk_text": "rate limit doc"},
                {"id": "c2", "chunk_text": "shared doc"},
            ]

        mock_vectordb.hybrid_search = AsyncMock(side_effect=_hybrid)

        results = await execute_decomposed_search(
            ["How does auth work?", "Where are rate limits?"],
            mock_embedder,
            mock_vectordb,
            None,
            top_k_per_query=10,
            final_top_k=50,
        )

        assert call_count == 2
        ids = [r["id"] for r in results]
        assert "c2" in ids
        assert ids.index("c2") == 0  # shared across both, highest RRF
        assert len(set(ids)) == 3
