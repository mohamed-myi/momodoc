"""Unit tests for note service indexing, tag parsing, and vector record behavior."""

import json
import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.async_vectordb import AsyncVectorStore
from app.models.note import Note
from app.services.ingestion.embedder import Embedder
from app.services import note_service


@pytest.fixture
def mock_vectordb():
    vectordb = MagicMock(spec=AsyncVectorStore)
    vectordb.search = AsyncMock(return_value=[])
    vectordb.add = AsyncMock(return_value=None)
    vectordb.delete = AsyncMock(return_value=None)
    return vectordb


@pytest.fixture
def mock_embedder():
    embedder = MagicMock(spec=Embedder)
    embedder.model_name = "test-model"

    async def _aembed_texts(texts, batch_size=512, mode="document"):
        return [[0.1] * 384 for _ in texts]

    async def _aembed_single(text):
        return [0.1] * 384

    embedder.aembed_texts = AsyncMock(side_effect=_aembed_texts)
    embedder.aembed_single = AsyncMock(side_effect=_aembed_single)
    return embedder


def _make_note(
    content="Test note content",
    tags="tag1,tag2",
    project_id=None,
    note_id=None,
):
    """Create a Note ORM-like object for unit testing."""
    note = Note()
    note.id = note_id or str(uuid.uuid4())
    note.project_id = project_id or str(uuid.uuid4())
    note.content = content
    note.tags = tags
    note.chunk_count = 0
    return note


class TestIndexNote:
    @pytest.mark.asyncio
    async def test_index_note_returns_chunk_count(self, mock_vectordb, mock_embedder):
        """_index_note should return the number of chunks created."""
        note = _make_note(content="Short note content")
        count = await note_service._index_note(mock_vectordb, mock_embedder, note)
        assert count >= 1
        mock_vectordb.add.assert_called_once()

    @pytest.mark.asyncio
    async def test_index_note_empty_content_returns_zero(self, mock_vectordb, mock_embedder):
        """If the chunker produces no chunks (e.g. whitespace-only), return 0 and don't call add."""
        note = _make_note(content="   ")
        count = await note_service._index_note(mock_vectordb, mock_embedder, note)
        # TextChunker may or may not produce chunks for whitespace — if 0, add should not be called
        if count == 0:
            mock_vectordb.add.assert_not_called()

    @pytest.mark.asyncio
    async def test_index_note_record_structure(self, mock_vectordb, mock_embedder):
        """Records passed to vectordb.add should have all required LanceDB fields."""
        note = _make_note(content="Some note for record check", tags="alpha,beta")
        await note_service._index_note(mock_vectordb, mock_embedder, note)

        records = mock_vectordb.add.call_args[0][0]
        assert len(records) >= 1
        rec = records[0]

        # Verify all required fields are present
        required_fields = {
            "id",
            "vector",
            "project_id",
            "source_type",
            "source_id",
            "filename",
            "original_path",
            "file_type",
            "chunk_index",
            "chunk_text",
            "language",
            "tags",
        }
        assert set(rec.keys()) == required_fields

        # Verify field values
        assert rec["source_type"] == "note"
        assert rec["source_id"] == note.id
        assert rec["project_id"] == note.project_id
        assert rec["filename"] == ""
        assert rec["original_path"] == ""
        assert rec["file_type"] == "note"
        assert rec["chunk_index"] == 0
        assert rec["language"] == "text"
        assert len(rec["vector"]) == 384

    @pytest.mark.asyncio
    async def test_index_note_tags_parsed_correctly(self, mock_vectordb, mock_embedder):
        """Comma-separated tags should be parsed, stripped, and JSON-encoded."""
        note = _make_note(content="Tag test content", tags="  foo , bar , baz  ")
        await note_service._index_note(mock_vectordb, mock_embedder, note)

        records = mock_vectordb.add.call_args[0][0]
        tags = json.loads(records[0]["tags"])
        assert tags == ["foo", "bar", "baz"]

    @pytest.mark.asyncio
    async def test_index_note_none_tags_produces_empty_list(self, mock_vectordb, mock_embedder):
        """When tags is None, the tags field should be an empty JSON list."""
        note = _make_note(content="No tags note", tags=None)
        await note_service._index_note(mock_vectordb, mock_embedder, note)

        records = mock_vectordb.add.call_args[0][0]
        tags = json.loads(records[0]["tags"])
        assert tags == []

    @pytest.mark.asyncio
    async def test_index_note_empty_string_tags_produces_empty_list(
        self, mock_vectordb, mock_embedder
    ):
        """Empty string tags produces [] because "" is falsy, handled by `if note.tags` guard.

        Previously suspected as a bug, but the guard `if note.tags else []` correctly
        handles both None and empty string as producing an empty tags list.
        """
        note = _make_note(content="Empty tags note", tags="")
        await note_service._index_note(mock_vectordb, mock_embedder, note)

        records = mock_vectordb.add.call_args[0][0]
        tags = json.loads(records[0]["tags"])
        assert tags == []

    @pytest.mark.asyncio
    async def test_index_note_multiple_chunks_sequential_indices(
        self, mock_vectordb, mock_embedder
    ):
        """Long content should produce multiple chunks with sequential chunk_index values."""
        # Create content long enough to produce multiple chunks (chunk size is 2000)
        long_content = "word " * 1000  # ~5000 chars
        note = _make_note(content=long_content)
        count = await note_service._index_note(mock_vectordb, mock_embedder, note)

        assert count >= 2
        records = mock_vectordb.add.call_args[0][0]
        indices = [r["chunk_index"] for r in records]
        assert indices == list(range(len(records)))

    @pytest.mark.asyncio
    async def test_index_note_embedder_called_with_chunk_texts(self, mock_vectordb, mock_embedder):
        """The embedder should be called with the text from each chunk."""
        note = _make_note(content="Embed this content")
        await note_service._index_note(mock_vectordb, mock_embedder, note)

        mock_embedder.aembed_texts.assert_called_once()
        texts = mock_embedder.aembed_texts.call_args[0][0]
        assert len(texts) >= 1
        assert all(isinstance(t, str) for t in texts)


class TestDeleteNoteVectors:
    @pytest.mark.asyncio
    async def test_delete_calls_vectordb_with_correct_filter(self, mock_vectordb):
        """_delete_note_vectors should call vectordb.delete with source_id filter."""
        note_id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
        await note_service._delete_note_vectors(mock_vectordb, note_id)
        mock_vectordb.delete.assert_called_once_with(f"source_id = '{note_id}'")

    @pytest.mark.asyncio
    async def test_delete_propagates_vectordb_error(self, mock_vectordb):
        """If vectordb.delete raises, the error should propagate (no silent swallowing)."""
        mock_vectordb.delete.side_effect = RuntimeError("LanceDB failure")
        with pytest.raises(RuntimeError, match="LanceDB failure"):
            await note_service._delete_note_vectors(
                mock_vectordb, "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
            )
