"""Tests for search service edge cases and query pipeline integration."""

import pytest
from unittest.mock import AsyncMock, MagicMock

from app.core.async_vectordb import AsyncVectorStore
from app.llm.base import LLMProvider, LLMResponse
from app.services import search_service
from app.services.query_pipeline import QueryType
from app.services.reranker import Reranker


@pytest.fixture
def mock_vectordb():
    vectordb = MagicMock(spec=AsyncVectorStore)
    vectordb.search = AsyncMock(return_value=[])
    vectordb.hybrid_search = AsyncMock(return_value=[])
    vectordb.fts_search = AsyncMock(return_value=[])
    return vectordb


@pytest.fixture
def mock_embedder():
    embedder = MagicMock()

    async def _aembed_single(text):
        return [0.0] * 384

    embedder.aembed_single = AsyncMock(side_effect=_aembed_single)
    return embedder


@pytest.fixture
def mock_reranker():
    reranker = MagicMock(spec=Reranker)

    async def _arerank(query, documents, top_k=10):
        ranked = [(i, 1.0 - i * 0.1) for i in range(min(len(documents), top_k))]
        return ranked

    reranker.arerank = AsyncMock(side_effect=_arerank)
    return reranker


class TestSearchScoreConversion:
    """Tests for distance/score conversion in vector mode."""

    @pytest.mark.asyncio
    async def test_distance_zero_gives_score_one(self, mock_vectordb, mock_embedder):
        """Distance 0.0 (identical vectors) should produce score 1.0."""
        mock_vectordb.search.return_value = [
            {
                "source_type": "file",
                "source_id": "s1",
                "filename": "test.py",
                "original_path": "/tmp/test.py",
                "chunk_text": "hello",
                "chunk_index": 0,
                "file_type": "py",
                "_distance": 0.0,
                "project_id": "p1",
            }
        ]
        results, plan = await search_service.search(
            mock_vectordb, mock_embedder, "hello", mode="vector"
        )
        assert results[0].score == 1.0

    @pytest.mark.asyncio
    async def test_distance_greater_than_one_maps_to_nonzero_similarity(
        self, mock_vectordb, mock_embedder
    ):
        """Distances >1 should still map to non-zero similarity scores."""
        mock_vectordb.search.return_value = [
            {
                "source_type": "file",
                "source_id": "s1",
                "filename": "test.py",
                "original_path": "/tmp/test.py",
                "chunk_text": "unrelated",
                "chunk_index": 0,
                "file_type": "py",
                "_distance": 1.5,
                "project_id": "p1",
            }
        ]
        results, _plan = await search_service.search(
            mock_vectordb, mock_embedder, "query", mode="vector"
        )
        assert results[0].score == pytest.approx(0.4)

    @pytest.mark.asyncio
    async def test_negative_distance_clamped_to_one(
        self, mock_vectordb, mock_embedder
    ):
        """If distance is negative, similarity should remain bounded at 1.0."""
        mock_vectordb.search.return_value = [
            {
                "source_type": "file",
                "source_id": "s1",
                "filename": "test.py",
                "original_path": "/tmp/test.py",
                "chunk_text": "content",
                "chunk_index": 0,
                "file_type": "py",
                "_distance": -0.5,
                "project_id": "p1",
            }
        ]
        results, _plan = await search_service.search(
            mock_vectordb, mock_embedder, "query", mode="vector"
        )
        assert results[0].score == 1.0

    @pytest.mark.asyncio
    async def test_keyword_scores_use_monotonic_normalization(
        self, mock_vectordb, mock_embedder
    ):
        """Keyword BM25 scores should be normalized without hard clamping."""
        mock_vectordb.fts_search.return_value = [
            {
                "source_type": "file",
                "source_id": "s1",
                "filename": "test.md",
                "original_path": "/tmp/test.md",
                "chunk_text": "keyword content",
                "chunk_index": 0,
                "file_type": "md",
                "_score": 5.0,
                "project_id": "p1",
            }
        ]

        results, _plan = await search_service.search(
            mock_vectordb, mock_embedder, "keyword", mode="keyword"
        )
        assert results[0].score == pytest.approx(5.0 / 6.0)

    @pytest.mark.asyncio
    async def test_missing_distance_defaults_to_score_one(
        self, mock_vectordb, mock_embedder
    ):
        """If _distance key is missing, default 0.0 should give score 1.0."""
        mock_vectordb.search.return_value = [
            {
                "source_type": "file",
                "source_id": "s1",
                "filename": "test.py",
                "original_path": "/tmp/test.py",
                "chunk_text": "hello",
                "chunk_index": 0,
                "file_type": "py",
                "project_id": "p1",
            }
        ]
        results, _plan = await search_service.search(
            mock_vectordb, mock_embedder, "hello", mode="vector"
        )
        assert results[0].score == 1.0


class TestSearchResultMapping:
    @pytest.mark.asyncio
    async def test_empty_filename_becomes_none(self, mock_vectordb, mock_embedder):
        """Empty string filename from LanceDB should be mapped to None."""
        mock_vectordb.hybrid_search.return_value = [
            {
                "source_type": "note",
                "source_id": "n1",
                "filename": "",
                "original_path": "",
                "chunk_text": "note content",
                "chunk_index": 0,
                "file_type": "note",
                "_relevance_score": 0.9,
                "project_id": "p1",
            }
        ]
        results, _plan = await search_service.search(
            mock_vectordb, mock_embedder, "query"
        )
        assert results[0].filename is None
        assert results[0].original_path is None

    @pytest.mark.asyncio
    async def test_no_results_returns_empty_list(self, mock_vectordb, mock_embedder):
        """Empty search results from vectordb should produce empty list."""
        results, _plan = await search_service.search(
            mock_vectordb, mock_embedder, "query"
        )
        assert results == []

    @pytest.mark.asyncio
    async def test_project_filter_passed_to_vectordb(self, mock_vectordb, mock_embedder):
        """When project_id is given, the filter string should be passed."""
        test_uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
        await search_service.search(
            mock_vectordb, mock_embedder, "query", project_id=test_uuid
        )
        call_args = mock_vectordb.hybrid_search.call_args
        assert call_args[0][2] == f"project_id = '{test_uuid}'"

    @pytest.mark.asyncio
    async def test_no_project_passes_none_filter(self, mock_vectordb, mock_embedder):
        """When no project_id, filter should be None."""
        await search_service.search(mock_vectordb, mock_embedder, "query")
        call_args = mock_vectordb.hybrid_search.call_args
        assert call_args[0][2] is None

    @pytest.mark.asyncio
    async def test_top_k_forwarded_to_vectordb(self, mock_vectordb, mock_embedder):
        """The top_k parameter should be passed to the vectordb search."""
        await search_service.search(
            mock_vectordb, mock_embedder, "query", top_k=7
        )
        call_args = mock_vectordb.hybrid_search.call_args
        assert call_args[0][3] == 7

    @pytest.mark.asyncio
    async def test_default_top_k_is_ten(self, mock_vectordb, mock_embedder):
        """Default top_k should be 10 when not specified."""
        await search_service.search(mock_vectordb, mock_embedder, "query")
        call_args = mock_vectordb.hybrid_search.call_args
        assert call_args[0][3] == 10


class TestSearchMissingFields:
    """Test handling when vectordb returns rows with missing optional fields."""

    @pytest.fixture
    def mock_vectordb(self):
        vectordb = MagicMock(spec=AsyncVectorStore)
        vectordb.search = AsyncMock(return_value=[])
        vectordb.hybrid_search = AsyncMock(return_value=[])
        return vectordb

    @pytest.fixture
    def mock_embedder(self):
        embedder = MagicMock()

        async def _aembed_single(text):
            return [0.0] * 384

        embedder.aembed_single = AsyncMock(side_effect=_aembed_single)
        return embedder

    @pytest.mark.asyncio
    async def test_missing_source_type_defaults_to_empty(
        self, mock_vectordb, mock_embedder
    ):
        """Missing source_type should default to empty string."""
        mock_vectordb.hybrid_search.return_value = [
            {
                "source_id": "s1",
                "filename": "test.py",
                "original_path": "/tmp/test.py",
                "chunk_text": "content",
                "chunk_index": 0,
                "file_type": "py",
                "_relevance_score": 0.9,
                "project_id": "p1",
            }
        ]
        results, _plan = await search_service.search(
            mock_vectordb, mock_embedder, "query"
        )
        assert results[0].source_type == ""

    @pytest.mark.asyncio
    async def test_missing_chunk_index_defaults_to_zero(
        self, mock_vectordb, mock_embedder
    ):
        """Missing chunk_index should default to 0."""
        mock_vectordb.hybrid_search.return_value = [
            {
                "source_type": "file",
                "source_id": "s1",
                "filename": "test.py",
                "original_path": "/tmp/test.py",
                "chunk_text": "content",
                "file_type": "py",
                "_relevance_score": 0.9,
                "project_id": "p1",
            }
        ]
        results, _plan = await search_service.search(
            mock_vectordb, mock_embedder, "query"
        )
        assert results[0].chunk_index == 0

    @pytest.mark.asyncio
    async def test_missing_file_type_defaults_to_empty(
        self, mock_vectordb, mock_embedder
    ):
        """Missing file_type should default to empty string."""
        mock_vectordb.hybrid_search.return_value = [
            {
                "source_type": "note",
                "source_id": "n1",
                "filename": "",
                "original_path": "",
                "chunk_text": "note content",
                "chunk_index": 0,
                "_relevance_score": 0.9,
                "project_id": "p1",
            }
        ]
        results, _plan = await search_service.search(
            mock_vectordb, mock_embedder, "query"
        )
        assert results[0].file_type == ""

    @pytest.mark.asyncio
    async def test_missing_project_id_defaults_to_empty(
        self, mock_vectordb, mock_embedder
    ):
        """Missing project_id should default to empty string."""
        mock_vectordb.hybrid_search.return_value = [
            {
                "source_type": "file",
                "source_id": "s1",
                "filename": "test.py",
                "original_path": "/tmp/test.py",
                "chunk_text": "content",
                "chunk_index": 0,
                "file_type": "py",
                "_relevance_score": 0.9,
            }
        ]
        results, _plan = await search_service.search(
            mock_vectordb, mock_embedder, "query"
        )
        assert results[0].project_id == ""


class TestSearchWithReranker:
    """Tests for two-stage retrieve-and-rerank behavior."""

    @pytest.fixture
    def mock_vectordb(self):
        vectordb = MagicMock(spec=AsyncVectorStore)
        vectordb.search = AsyncMock(return_value=[])
        vectordb.hybrid_search = AsyncMock(return_value=[])
        vectordb.fts_search = AsyncMock(return_value=[])
        return vectordb

    @pytest.fixture
    def mock_embedder(self):
        embedder = MagicMock()

        async def _aembed_single(text):
            return [0.0] * 384

        embedder.aembed_single = AsyncMock(side_effect=_aembed_single)
        return embedder

    @pytest.fixture
    def mock_reranker(self):
        reranker = MagicMock(spec=Reranker)

        async def _arerank(query, documents, top_k=10):
            ranked = sorted(
                enumerate(documents), key=lambda x: len(x[1]), reverse=True
            )
            return [
                (idx, 1.0 - i * 0.1) for i, (idx, _) in enumerate(ranked[:top_k])
            ]

        reranker.arerank = AsyncMock(side_effect=_arerank)
        return reranker

    def _make_row(self, source_id, chunk_text, score=0.5):
        return {
            "source_type": "file",
            "source_id": source_id,
            "filename": "test.py",
            "original_path": "/tmp/test.py",
            "chunk_text": chunk_text,
            "chunk_index": 0,
            "file_type": "py",
            "_relevance_score": score,
            "project_id": "p1",
        }

    @pytest.mark.asyncio
    async def test_reranker_none_preserves_current_behavior(
        self, mock_vectordb, mock_embedder
    ):
        """When reranker is None, behavior is identical to current."""
        mock_vectordb.hybrid_search.return_value = [
            self._make_row("s1", "hello", 0.9),
        ]
        results, _plan = await search_service.search(
            mock_vectordb, mock_embedder, "hello", reranker=None
        )
        assert len(results) == 1
        assert results[0].score == pytest.approx(0.9)

    @pytest.mark.asyncio
    async def test_reranker_reorders_results(
        self, mock_vectordb, mock_embedder, mock_reranker
    ):
        """With reranker, results should be reordered by cross-encoder scores."""
        mock_vectordb.hybrid_search.return_value = [
            self._make_row("s1", "short", 0.9),
            self._make_row("s2", "much longer content here", 0.5),
        ]
        results, _plan = await search_service.search(
            mock_vectordb,
            mock_embedder,
            "query",
            reranker=mock_reranker,
            candidate_k=50,
        )
        assert len(results) == 2
        assert results[0].source_id == "s2"
        assert results[1].source_id == "s1"

    @pytest.mark.asyncio
    async def test_keyword_mode_skips_reranking(
        self, mock_vectordb, mock_embedder, mock_reranker
    ):
        """Keyword mode should not trigger reranking."""
        mock_vectordb.fts_search.return_value = [
            self._make_row("s1", "keyword content") | {"_score": 5.0},
        ]
        await search_service.search(
            mock_vectordb,
            mock_embedder,
            "keyword",
            mode="keyword",
            reranker=mock_reranker,
        )
        mock_reranker.arerank.assert_not_called()

    @pytest.mark.asyncio
    async def test_candidate_k_used_as_retrieval_limit(
        self, mock_vectordb, mock_embedder, mock_reranker
    ):
        """When reranker is present, candidate_k overrides the retrieval limit."""
        mock_vectordb.hybrid_search.return_value = []
        await search_service.search(
            mock_vectordb,
            mock_embedder,
            "query",
            top_k=10,
            reranker=mock_reranker,
            candidate_k=50,
        )
        call_args = mock_vectordb.hybrid_search.call_args
        assert call_args[0][3] == 50

    @pytest.mark.asyncio
    async def test_reranker_scores_replace_vector_scores(
        self, mock_vectordb, mock_embedder, mock_reranker
    ):
        """Reranker scores should replace original vector/hybrid scores."""
        mock_vectordb.hybrid_search.return_value = [
            self._make_row("s1", "content", 0.9),
        ]
        results, _plan = await search_service.search(
            mock_vectordb,
            mock_embedder,
            "query",
            reranker=mock_reranker,
        )
        assert results[0].score != 0.9

    @pytest.mark.asyncio
    async def test_vector_mode_uses_reranker(
        self, mock_vectordb, mock_embedder, mock_reranker
    ):
        """Reranker should also work with vector-only mode."""
        mock_vectordb.search.return_value = [
            self._make_row("s1", "content") | {"_distance": 0.1},
        ]
        results, _plan = await search_service.search(
            mock_vectordb,
            mock_embedder,
            "query",
            mode="vector",
            reranker=mock_reranker,
        )
        assert len(results) == 1
        mock_reranker.arerank.assert_called_once()


class TestSearchReturnsQueryPlan:
    """Tests verifying search returns a QueryPlan alongside results."""

    @pytest.fixture
    def mock_vectordb(self):
        vectordb = MagicMock(spec=AsyncVectorStore)
        vectordb.search = AsyncMock(return_value=[])
        vectordb.hybrid_search = AsyncMock(return_value=[])
        vectordb.fts_search = AsyncMock(return_value=[])
        return vectordb

    @pytest.fixture
    def mock_embedder(self):
        embedder = MagicMock()
        embedder.aembed_single = AsyncMock(return_value=[0.0] * 384)
        return embedder

    @pytest.mark.asyncio
    async def test_simple_query_returns_plan(self, mock_vectordb, mock_embedder):
        _results, plan = await search_service.search(
            mock_vectordb, mock_embedder, "files"
        )
        assert plan is not None
        assert plan.query_type == QueryType.SIMPLE
        assert plan.use_hyde is False
        assert plan.decompose is False

    @pytest.mark.asyncio
    async def test_keyword_query_forces_fts(self, mock_vectordb, mock_embedder):
        """KEYWORD_LOOKUP should route to keyword search when mode is hybrid."""
        await search_service.search(
            mock_vectordb, mock_embedder, "getUserById"
        )
        mock_vectordb.fts_search.assert_called_once()
        mock_vectordb.hybrid_search.assert_not_called()

    @pytest.mark.asyncio
    async def test_conceptual_without_llm_uses_hybrid(self, mock_vectordb, mock_embedder):
        """Conceptual query without LLM should fall through to normal hybrid."""
        await search_service.search(
            mock_vectordb, mock_embedder, "How does auth work", query_llm=None
        )
        mock_vectordb.hybrid_search.assert_called_once()

    @pytest.mark.asyncio
    async def test_conceptual_with_llm_triggers_hyde(self, mock_vectordb, mock_embedder):
        """Conceptual query with LLM should trigger HyDE vector search."""
        mock_query_llm = AsyncMock(spec=LLMProvider)
        mock_query_llm.complete.return_value = LLMResponse(
            content="Hypothetical passage", model="test"
        )

        await search_service.search(
            mock_vectordb, mock_embedder, "How does auth work",
            query_llm=mock_query_llm,
        )
        mock_query_llm.complete.assert_called_once()
        mock_vectordb.search.assert_called_once()

    @pytest.mark.asyncio
    async def test_explicit_keyword_mode_overrides_plan(
        self, mock_vectordb, mock_embedder
    ):
        """Explicit mode=keyword should be respected even if plan says hybrid."""
        await search_service.search(
            mock_vectordb, mock_embedder, "query", mode="keyword"
        )
        mock_vectordb.fts_search.assert_called_once()
