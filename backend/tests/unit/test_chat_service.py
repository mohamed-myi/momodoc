"""Tests for chat context and message-building helper behavior."""

import pytest
from unittest.mock import AsyncMock, MagicMock

from app.core.async_vectordb import AsyncVectorStore
from app.schemas.chat import ChatSource
from app.services.chat_context import (
    _cap_per_source,
    _select_context_sources,
    _build_messages,
    _retrieve_context,
    MAX_CHUNKS_PER_SOURCE,
    MAX_PINNED_CHUNKS_PER_SOURCE,
    PINNED_SOURCE_COLUMNS,
    MAX_HISTORY_MESSAGES,
    RECENT_CONTEXT_COUNT,
)
from app.services.ingestion.embedder import Embedder
from app.services.reranker import Reranker


class MockChatMessage:
    """Minimal stand-in for ChatMessage ORM object."""

    def __init__(self, role: str, content: str):
        self.role = role
        self.content = content


class TestBuildMessages:
    def test_system_prompt_always_first(self):
        """The system prompt should always be the first message."""
        messages = _build_messages([], [], "hello")
        assert messages[0].role == "system"
        assert "knowledge assistant" in messages[0].content

    def test_no_sources_states_no_context(self):
        """When there are no sources, user message should say no context found."""
        messages = _build_messages([], [], "what is momodoc?")
        user_msg = messages[-1]
        assert user_msg.role == "user"
        assert "No relevant context" in user_msg.content
        assert "what is momodoc?" in user_msg.content

    def test_sources_included_in_context(self):
        """Sources should be numbered and included in the user message."""
        sources = [
            ChatSource(
                source_type="file",
                source_id="s1",
                filename="readme.md",
                original_path="/tmp/readme.md",
                chunk_text="Momodoc is a RAG tool.",
                chunk_index=0,
                score=0.9,
            ),
            ChatSource(
                source_type="note",
                source_id="n1",
                filename=None,
                original_path=None,
                chunk_text="Some note content.",
                chunk_index=0,
                score=0.8,
            ),
        ]
        messages = _build_messages([], sources, "what is this?")
        user_msg = messages[-1].content

        assert "[Source 1: readme.md]" in user_msg
        assert "Momodoc is a RAG tool." in user_msg
        assert "[Source 2: Note]" in user_msg  # No filename → falls back to "Note"
        assert "Some note content." in user_msg

    def test_history_preserved_in_order(self):
        """Conversation history should appear between system prompt and user message."""
        history = [
            MockChatMessage("user", "first question"),
            MockChatMessage("assistant", "first answer"),
        ]
        messages = _build_messages(history, [], "follow-up")

        assert messages[0].role == "system"
        assert messages[1].role == "user"
        assert messages[1].content == "first question"
        assert messages[2].role == "assistant"
        assert messages[2].content == "first answer"
        assert messages[3].role == "user"
        assert "follow-up" in messages[3].content

    def test_source_without_filename_uses_note_label(self):
        """A source with filename=None should use 'Note' as label."""
        sources = [
            ChatSource(
                source_type="note",
                source_id="n1",
                filename=None,
                original_path=None,
                chunk_text="content",
                chunk_index=0,
                score=0.5,
            )
        ]
        messages = _build_messages([], sources, "query")
        assert "[Source 1: Note]" in messages[-1].content

    def test_history_with_sources_combined(self):
        """History and sources should both appear in the correct order."""
        history = [
            MockChatMessage("user", "earlier question"),
            MockChatMessage("assistant", "earlier answer"),
        ]
        sources = [
            ChatSource(
                source_type="file",
                source_id="f1",
                filename="doc.md",
                original_path="/tmp/doc.md",
                chunk_text="Doc content here.",
                chunk_index=0,
                score=0.9,
            ),
        ]
        messages = _build_messages(history, sources, "follow-up question")

        # system, history_user, history_assistant, user_with_context
        assert len(messages) == 4
        assert messages[0].role == "system"
        assert messages[1].content == "earlier question"
        assert messages[2].content == "earlier answer"
        assert "[Source 1: doc.md]" in messages[3].content
        assert "follow-up question" in messages[3].content

    def test_empty_history_and_empty_sources(self):
        """With no history and no sources, should produce system + user (2 messages)."""
        messages = _build_messages([], [], "lone query")
        assert len(messages) == 2
        assert messages[0].role == "system"
        assert messages[1].role == "user"
        assert "No relevant context" in messages[1].content

    def test_sources_separated_by_dividers(self):
        """Multiple sources should be separated by --- dividers."""
        sources = [
            ChatSource(
                source_type="file",
                source_id="f1",
                filename="a.py",
                original_path=None,
                chunk_text="content A",
                chunk_index=0,
                score=0.9,
            ),
            ChatSource(
                source_type="file",
                source_id="f2",
                filename="b.py",
                original_path=None,
                chunk_text="content B",
                chunk_index=0,
                score=0.8,
            ),
        ]
        messages = _build_messages([], sources, "query")
        user_content = messages[-1].content
        assert "---" in user_content
        assert "[Source 1: a.py]" in user_content
        assert "[Source 2: b.py]" in user_content


class TestRetrieveContext:
    @pytest.fixture
    def mock_vectordb(self):
        vectordb = MagicMock(spec=AsyncVectorStore)
        vectordb.search = AsyncMock(return_value=[])
        vectordb.hybrid_search = AsyncMock(return_value=[])
        vectordb.get_by_filter = AsyncMock(return_value=[])
        return vectordb

    @pytest.fixture
    def mock_embedder(self):
        embedder = MagicMock(spec=Embedder)

        async def _aembed_single(text):
            return [0.0] * 384

        embedder.aembed_single = AsyncMock(side_effect=_aembed_single)
        return embedder

    @pytest.mark.asyncio
    async def test_project_filter_applied(self, mock_vectordb, mock_embedder):
        """When project_id is provided, hybrid_search should include project filter."""
        test_uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
        await _retrieve_context(mock_vectordb, mock_embedder, test_uuid, "query", 10)
        call_args = mock_vectordb.hybrid_search.call_args
        assert call_args[0][2] == f"project_id = '{test_uuid}'"

    @pytest.mark.asyncio
    async def test_pinned_sources_fetched_with_metadata_columns_only(
        self, mock_vectordb, mock_embedder
    ):
        mock_vectordb.get_by_filter.return_value = []
        await _retrieve_context(
            mock_vectordb,
            mock_embedder,
            None,
            "query",
            10,
            pinned_source_ids=["a1b2c3d4-e5f6-7890-abcd-ef1234567890"],
        )

        call_args = mock_vectordb.get_by_filter.call_args
        assert call_args.kwargs["columns"] == PINNED_SOURCE_COLUMNS
        assert call_args.kwargs["limit"] == MAX_PINNED_CHUNKS_PER_SOURCE

    @pytest.mark.asyncio
    async def test_duplicate_pinned_source_ids_are_deduplicated(self, mock_vectordb, mock_embedder):
        source_id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
        mock_vectordb.get_by_filter.return_value = []
        await _retrieve_context(
            mock_vectordb,
            mock_embedder,
            None,
            "query",
            10,
            pinned_source_ids=[source_id, source_id],
        )
        assert mock_vectordb.get_by_filter.call_count == 1

    @pytest.mark.asyncio
    async def test_invalid_pinned_source_ids_are_skipped(self, mock_vectordb, mock_embedder):
        mock_vectordb.get_by_filter.return_value = []
        sources, _meta = await _retrieve_context(
            mock_vectordb,
            mock_embedder,
            None,
            "query",
            10,
            pinned_source_ids=["not-a-uuid"],
        )
        assert sources == []
        mock_vectordb.get_by_filter.assert_not_called()

    @pytest.mark.asyncio
    async def test_no_project_filter_when_none(self, mock_vectordb, mock_embedder):
        """When project_id is None (global), hybrid_search should have no filter."""
        await _retrieve_context(mock_vectordb, mock_embedder, None, "query", 10)
        call_args = mock_vectordb.hybrid_search.call_args
        assert call_args[0][2] is None

    @pytest.mark.asyncio
    async def test_top_k_forwarded(self, mock_vectordb, mock_embedder):
        """The top_k parameter should be forwarded to vectordb.hybrid_search."""
        await _retrieve_context(mock_vectordb, mock_embedder, None, "query", 5)
        call_args = mock_vectordb.hybrid_search.call_args
        assert call_args[0][3] == 5

    @pytest.mark.asyncio
    async def test_empty_results_returns_empty_list(self, mock_vectordb, mock_embedder):
        """Empty vectordb results should produce empty ChatSource list."""
        sources, _meta = await _retrieve_context(mock_vectordb, mock_embedder, None, "query", 10)
        assert sources == []

    @pytest.mark.asyncio
    async def test_results_mapped_to_chat_sources(self, mock_vectordb, mock_embedder):
        """Vectordb results should be correctly mapped to ChatSource objects."""
        mock_vectordb.hybrid_search.return_value = [
            {
                "source_type": "file",
                "source_id": "f1",
                "filename": "test.py",
                "original_path": "/tmp/test.py",
                "chunk_text": "Hello world",
                "chunk_index": 0,
                "_relevance_score": 0.7,
            }
        ]
        sources, _meta = await _retrieve_context(mock_vectordb, mock_embedder, None, "query", 10)
        assert len(sources) == 1
        assert sources[0].source_type == "file"
        assert sources[0].filename == "test.py"
        assert sources[0].score == pytest.approx(0.7)

    @pytest.mark.asyncio
    async def test_empty_filename_becomes_none(self, mock_vectordb, mock_embedder):
        """Empty string filename from vectordb should become None in ChatSource."""
        mock_vectordb.hybrid_search.return_value = [
            {
                "source_type": "note",
                "source_id": "n1",
                "filename": "",
                "original_path": "",
                "chunk_text": "note text",
                "chunk_index": 0,
                "_relevance_score": 0.9,
            }
        ]
        sources, _meta = await _retrieve_context(mock_vectordb, mock_embedder, None, "query", 10)
        assert sources[0].filename is None
        assert sources[0].original_path is None

    @pytest.mark.asyncio
    async def test_missing_relevance_score_defaults_to_zero(self, mock_vectordb, mock_embedder):
        """If _relevance_score is missing, score should default to 0.0."""
        mock_vectordb.hybrid_search.return_value = [
            {
                "source_type": "file",
                "source_id": "f1",
                "filename": "test.py",
                "original_path": None,
                "chunk_text": "content",
                "chunk_index": 0,
            }
        ]
        sources, _meta = await _retrieve_context(mock_vectordb, mock_embedder, None, "query", 10)
        assert sources[0].score == 0.0

    @pytest.mark.asyncio
    async def test_relevance_score_clamped_to_one(self, mock_vectordb, mock_embedder):
        """Relevance score > 1.0 is clamped to 1.0."""
        mock_vectordb.hybrid_search.return_value = [
            {
                "source_type": "file",
                "source_id": "f1",
                "filename": "test.py",
                "original_path": None,
                "chunk_text": "very relevant",
                "chunk_index": 0,
                "_relevance_score": 2.5,
            }
        ]
        sources, _meta = await _retrieve_context(mock_vectordb, mock_embedder, None, "query", 10)
        assert sources[0].score == 1.0

    @pytest.mark.asyncio
    async def test_hybrid_distance_fallback_used_when_relevance_missing(
        self, mock_vectordb, mock_embedder
    ):
        mock_vectordb.hybrid_search.return_value = [
            {
                "source_type": "file",
                "source_id": "f1",
                "filename": "test.py",
                "original_path": None,
                "chunk_text": "content",
                "chunk_index": 0,
                "_distance": 0.25,
            }
        ]
        sources, _meta = await _retrieve_context(mock_vectordb, mock_embedder, None, "query", 10)
        assert sources[0].score == pytest.approx(0.8)

    @pytest.mark.asyncio
    async def test_retrieval_metadata_returned(self, mock_vectordb, mock_embedder):
        """_retrieve_context should return retrieval_metadata with plan info."""
        _sources, meta = await _retrieve_context(mock_vectordb, mock_embedder, None, "query", 10)
        assert meta is not None
        assert "query_plan" in meta
        assert "candidates_fetched" in meta
        assert "reranked" in meta
        assert "retrieval_ms" in meta


class TestContextSelection:
    def test_context_selection_truncates_oversized_source(self):
        source = ChatSource(
            source_type="file",
            source_id="s1",
            filename="big.txt",
            original_path="/tmp/big.txt",
            chunk_text="x" * 60_000,
            chunk_index=0,
            score=0.9,
        )
        selected = _select_context_sources(
            history=[],
            sources=[source],
            user_query="what is this",
            llm=None,
        )
        assert len(selected) == 1
        assert selected[0].chunk_text.endswith("...[truncated]")

    def test_context_selection_returns_empty_when_history_exhausts_budget(self):
        history = [MockChatMessage("user", "a" * 70_000)]
        source = ChatSource(
            source_type="file",
            source_id="s1",
            filename="small.txt",
            original_path="/tmp/small.txt",
            chunk_text="small content",
            chunk_index=0,
            score=0.9,
        )
        selected = _select_context_sources(
            history=history,
            sources=[source],
            user_query="query",
            llm=None,
        )
        assert selected == []


class TestChatConstants:
    def test_max_history_messages_reasonable(self):
        """MAX_HISTORY_MESSAGES should be a reasonable positive number."""
        assert MAX_HISTORY_MESSAGES == 20

    def test_recent_context_count_reasonable(self):
        """RECENT_CONTEXT_COUNT should be small for basic continuity."""
        assert RECENT_CONTEXT_COUNT == 3


class TestRetrieveContextWithReranker:
    """Tests for _retrieve_context when a reranker is provided."""

    @pytest.fixture
    def mock_vectordb(self):
        vectordb = MagicMock(spec=AsyncVectorStore)
        vectordb.search = AsyncMock(return_value=[])
        vectordb.hybrid_search = AsyncMock(return_value=[])
        vectordb.get_by_filter = AsyncMock(return_value=[])
        return vectordb

    @pytest.fixture
    def mock_embedder(self):
        embedder = MagicMock(spec=Embedder)

        async def _aembed_single(text):
            return [0.0] * 384

        embedder.aembed_single = AsyncMock(side_effect=_aembed_single)
        return embedder

    @pytest.fixture
    def mock_reranker(self):
        reranker = MagicMock(spec=Reranker)

        async def _arerank(query, documents, top_k=10):
            ranked = sorted(enumerate(documents), key=lambda x: len(x[1]), reverse=True)
            return [(idx, 1.0 - i * 0.1) for i, (idx, _) in enumerate(ranked[:top_k])]

        reranker.arerank = AsyncMock(side_effect=_arerank)
        return reranker

    @pytest.mark.asyncio
    async def test_reranker_none_unchanged(self, mock_vectordb, mock_embedder):
        """With reranker=None, behavior should match the original."""
        mock_vectordb.hybrid_search.return_value = [
            {
                "source_type": "file",
                "source_id": "f1",
                "filename": "test.py",
                "original_path": "/tmp/test.py",
                "chunk_text": "Hello world",
                "chunk_index": 0,
                "_relevance_score": 0.8,
            }
        ]
        sources, _meta = await _retrieve_context(
            mock_vectordb, mock_embedder, None, "query", 10, reranker=None
        )
        assert len(sources) == 1
        assert sources[0].score == pytest.approx(0.8)

    @pytest.mark.asyncio
    async def test_reranker_reorders_search_sources(
        self, mock_vectordb, mock_embedder, mock_reranker
    ):
        """With reranker present, search sources should be reranked."""
        mock_vectordb.hybrid_search.return_value = [
            {
                "source_type": "file",
                "source_id": "f1",
                "filename": "short.py",
                "original_path": "/tmp/short.py",
                "chunk_text": "short",
                "chunk_index": 0,
                "_relevance_score": 0.9,
            },
            {
                "source_type": "file",
                "source_id": "f2",
                "filename": "long.py",
                "original_path": "/tmp/long.py",
                "chunk_text": "much longer content here for reranking",
                "chunk_index": 0,
                "_relevance_score": 0.5,
            },
        ]
        sources, _meta = await _retrieve_context(
            mock_vectordb,
            mock_embedder,
            None,
            "query",
            10,
            reranker=mock_reranker,
            candidate_k=50,
        )
        assert len(sources) == 2
        assert sources[0].source_id == "f2"
        assert sources[1].source_id == "f1"

    @pytest.mark.asyncio
    async def test_pinned_sources_not_reranked(self, mock_vectordb, mock_embedder, mock_reranker):
        """Pinned sources should retain score=1.0 and not be passed to reranker."""
        pinned_id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
        mock_vectordb.get_by_filter.return_value = [
            {
                "source_type": "file",
                "source_id": pinned_id,
                "filename": "pinned.md",
                "original_path": "/tmp/pinned.md",
                "chunk_text": "pinned content",
                "chunk_index": 0,
            }
        ]
        mock_vectordb.hybrid_search.return_value = [
            {
                "source_type": "file",
                "source_id": "f2",
                "filename": "other.py",
                "original_path": "/tmp/other.py",
                "chunk_text": "other content",
                "chunk_index": 0,
                "_relevance_score": 0.7,
            },
        ]

        sources, _meta = await _retrieve_context(
            mock_vectordb,
            mock_embedder,
            None,
            "query",
            10,
            pinned_source_ids=[pinned_id],
            reranker=mock_reranker,
            candidate_k=50,
        )

        pinned = [s for s in sources if s.source_id == pinned_id]
        assert len(pinned) == 1
        assert pinned[0].score == 1.0

    @pytest.mark.asyncio
    async def test_candidate_k_increases_retrieval_limit(
        self, mock_vectordb, mock_embedder, mock_reranker
    ):
        """When reranker is present, hybrid_search should be called with candidate_k."""
        mock_vectordb.hybrid_search.return_value = []
        await _retrieve_context(
            mock_vectordb,
            mock_embedder,
            None,
            "query",
            10,
            reranker=mock_reranker,
            candidate_k=50,
        )
        call_args = mock_vectordb.hybrid_search.call_args
        assert call_args[0][3] == 50


class TestPerSourceDiversityCap:
    """Tests for _cap_per_source limiting chunks from a single document."""

    def _make_source(self, source_id, chunk_index=0, score=0.9):
        return ChatSource(
            source_type="file",
            source_id=source_id,
            filename=f"{source_id}.py",
            original_path=None,
            chunk_text=f"content from {source_id} chunk {chunk_index}",
            chunk_index=chunk_index,
            score=score,
        )

    def test_cap_limits_single_dominant_source(self):
        """7 chunks from source A and 3 from source B should yield 3 from each."""
        sources = [self._make_source("A", i, 1.0 - i * 0.01) for i in range(7)]
        sources += [self._make_source("B", i, 0.5 - i * 0.01) for i in range(3)]
        capped = _cap_per_source(sources, 3)
        a_count = sum(1 for s in capped if s.source_id == "A")
        b_count = sum(1 for s in capped if s.source_id == "B")
        assert a_count == 3
        assert b_count == 3

    def test_cap_preserves_relevance_order(self):
        """Capped results should maintain their original sort order."""
        sources = [
            self._make_source("A", 0, 0.95),
            self._make_source("A", 1, 0.90),
            self._make_source("B", 0, 0.85),
            self._make_source("A", 2, 0.80),
            self._make_source("A", 3, 0.75),
        ]
        capped = _cap_per_source(sources, 3)
        scores = [s.score for s in capped]
        assert scores == sorted(scores, reverse=True)

    def test_cap_allows_all_when_under_limit(self):
        """When each source has fewer chunks than the cap, all are kept."""
        sources = [
            self._make_source("A", 0),
            self._make_source("B", 0),
            self._make_source("C", 0),
        ]
        capped = _cap_per_source(sources, 3)
        assert len(capped) == 3

    def test_cap_with_single_source(self):
        """A single source should still be capped."""
        sources = [self._make_source("A", i) for i in range(10)]
        capped = _cap_per_source(sources, 3)
        assert len(capped) == 3

    def test_cap_empty_list(self):
        assert _cap_per_source([], 3) == []

    def test_max_chunks_per_source_constant_is_three(self):
        assert MAX_CHUNKS_PER_SOURCE == 3


class TestSectionHeaderInContext:
    """Tests for section_header display in chat context building."""

    def test_source_label_includes_section_header(self):
        """When section_header is set, the source label should include the breadcrumb."""
        sources = [
            ChatSource(
                source_type="file",
                source_id="f1",
                filename="readme.md",
                original_path=None,
                chunk_text="Some content.",
                chunk_index=0,
                score=0.9,
                section_header="Architecture > Data Storage",
            ),
        ]
        messages = _build_messages([], sources, "what is this?")
        user_msg = messages[-1].content
        assert "[Source 1: readme.md > Architecture > Data Storage]" in user_msg

    def test_empty_section_header_omits_breadcrumb(self):
        """When section_header is empty, label should be just the filename."""
        sources = [
            ChatSource(
                source_type="file",
                source_id="f1",
                filename="readme.md",
                original_path=None,
                chunk_text="Some content.",
                chunk_index=0,
                score=0.9,
                section_header="",
            ),
        ]
        messages = _build_messages([], sources, "what is this?")
        user_msg = messages[-1].content
        assert "[Source 1: readme.md]" in user_msg
        assert ">" not in user_msg.split("[Source 1:")[1].split("]")[0].replace("readme.md", "")

    def test_note_with_section_header(self):
        """Note sources (no filename) should show 'Note > breadcrumb'."""
        sources = [
            ChatSource(
                source_type="note",
                source_id="n1",
                filename=None,
                original_path=None,
                chunk_text="Note content.",
                chunk_index=0,
                score=0.5,
                section_header="Setup > Config",
            ),
        ]
        messages = _build_messages([], sources, "query")
        user_msg = messages[-1].content
        assert "[Source 1: Note > Setup > Config]" in user_msg

    def test_pinned_source_columns_includes_section_header(self):
        assert "section_header" in PINNED_SOURCE_COLUMNS


class TestSectionHeaderPersistence:
    """Tests for section_header roundtrip through MessageSource ORM model."""

    def test_create_source_objects_preserves_section_header(self):
        from app.services.chat_context import _create_source_objects

        source = ChatSource(
            source_type="file",
            source_id="f1",
            filename="readme.md",
            original_path=None,
            chunk_text="Content.",
            chunk_index=0,
            score=0.9,
            section_header="Architecture > Data Storage",
        )
        orm_objects = _create_source_objects([source])
        assert len(orm_objects) == 1
        assert orm_objects[0].section_header == "Architecture > Data Storage"

    def test_create_source_objects_handles_empty_section_header(self):
        from app.services.chat_context import _create_source_objects

        source = ChatSource(
            source_type="file",
            source_id="f1",
            filename="readme.md",
            original_path=None,
            chunk_text="Content.",
            chunk_index=0,
            score=0.9,
        )
        orm_objects = _create_source_objects([source])
        assert orm_objects[0].section_header == ""

    def test_message_source_model_has_section_header(self):
        from app.models.message_source import MessageSource

        ms = MessageSource(
            source_type="file",
            source_id="f1",
            filename="test.py",
            chunk_text="content",
            section_header="Setup > Config",
        )
        assert ms.section_header == "Setup > Config"
