from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.content_entity_service_helpers import (
    create_entity_with_indexing,
    delete_entity_with_vector_cleanup,
    finalize_entity_update,
)


@pytest.fixture
def mock_db():
    db = MagicMock()
    db.flush = AsyncMock(return_value=None)
    db.commit = AsyncMock(return_value=None)
    db.refresh = AsyncMock(return_value=None)
    db.delete = AsyncMock(return_value=None)
    return db


def _entity(entity_id: str = "entity-1", chunk_count: int = 0):
    return SimpleNamespace(id=entity_id, chunk_count=chunk_count)


class TestCreateEntityWithIndexing:
    @pytest.mark.asyncio
    async def test_create_runs_flush_index_commit_and_refresh(self, mock_db):
        entity = _entity()
        index_entity = AsyncMock(return_value=3)

        result = await create_entity_with_indexing(mock_db, entity, index_entity=index_entity)

        assert result is entity
        assert entity.chunk_count == 3
        mock_db.add.assert_called_once_with(entity)
        mock_db.flush.assert_awaited_once()
        index_entity.assert_awaited_once_with(entity)
        mock_db.commit.assert_awaited_once()
        mock_db.refresh.assert_awaited_once_with(entity)


class TestFinalizeEntityUpdate:
    @pytest.mark.asyncio
    async def test_finalize_without_content_change_skips_reindex(self, mock_db):
        entity = _entity(chunk_count=7)
        delete_vectors = AsyncMock(return_value=None)
        index_entity = AsyncMock(return_value=99)
        logger = MagicMock()

        result = await finalize_entity_update(
            mock_db,
            entity,
            content_changed=False,
            entity_name="note",
            delete_vectors=delete_vectors,
            index_entity=index_entity,
            logger=logger,
        )

        assert result is entity
        assert entity.chunk_count == 7
        delete_vectors.assert_not_awaited()
        index_entity.assert_not_awaited()
        mock_db.commit.assert_awaited_once()
        mock_db.refresh.assert_awaited_once_with(entity)
        logger.critical.assert_not_called()

    @pytest.mark.asyncio
    @pytest.mark.parametrize("entity_name", ["note", "issue"])
    async def test_reindex_failure_sets_zero_commits_and_reraises(self, mock_db, entity_name):
        entity = _entity(entity_id=f"{entity_name}-123", chunk_count=5)
        delete_vectors = AsyncMock(return_value=None)
        index_entity = AsyncMock(side_effect=RuntimeError("index failed"))
        logger = MagicMock()

        with pytest.raises(RuntimeError, match="index failed"):
            await finalize_entity_update(
                mock_db,
                entity,
                content_changed=True,
                entity_name=entity_name,
                delete_vectors=delete_vectors,
                index_entity=index_entity,
                logger=logger,
            )

        delete_vectors.assert_awaited_once_with(entity.id)
        index_entity.assert_awaited_once_with(entity)
        assert entity.chunk_count == 0
        mock_db.commit.assert_awaited_once()
        mock_db.refresh.assert_not_awaited()
        logger.critical.assert_called_once()

        message, logged_entity_name, logged_id, display_name, retry_name = (
            logger.critical.call_args.args
        )
        assert "Failed to re-index %s %s after deleting old vectors." in message
        assert logged_entity_name == entity_name
        assert logged_id == entity.id
        assert display_name == entity_name.capitalize()
        assert retry_name == entity_name


class TestDeleteEntityWithVectorCleanup:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("entity_name", ["note", "issue"])
    async def test_delete_cleanup_failure_is_warning_only(self, mock_db, entity_name):
        entity = _entity(entity_id=f"{entity_name}-456")
        delete_vectors = AsyncMock(side_effect=RuntimeError("delete failed"))
        logger = MagicMock()

        await delete_entity_with_vector_cleanup(
            mock_db,
            entity,
            entity_name=entity_name,
            delete_vectors=delete_vectors,
            logger=logger,
        )

        mock_db.delete.assert_awaited_once_with(entity)
        mock_db.commit.assert_awaited_once()
        delete_vectors.assert_awaited_once_with(entity.id)
        logger.warning.assert_called_once_with(
            "Failed to delete vectors for %s %s", entity_name, entity.id
        )
