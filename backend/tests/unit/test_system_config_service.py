"""Unit tests for system_config_service embedding model persistence and verification."""

import pytest
import pytest_asyncio
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.core.exceptions import EmbeddingModelMismatchError
from app.models.system_config import SystemConfig
from app.services import system_config_service
from app.services.system_config_service import EmbeddingModelStatus


@pytest_asyncio.fixture
async def db_session():
    """Provide a fresh in-memory DB session for each test."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)

    def _set_pragmas(dbapi_conn, connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    event.listen(engine.sync_engine, "connect", _set_pragmas)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


class TestRecordEmbeddingModel:
    @pytest.mark.asyncio
    async def test_inserts_new_record(self, db_session):
        """First call should insert a new system_config record."""
        await system_config_service.record_embedding_model(db_session, "all-MiniLM-L6-v2")

        result = await db_session.execute(
            select(SystemConfig).where(
                SystemConfig.key == system_config_service.EMBEDDING_MODEL_KEY
            )
        )
        entry = result.scalar_one_or_none()
        assert entry is not None
        assert entry.value == "all-MiniLM-L6-v2"

    @pytest.mark.asyncio
    async def test_updates_existing_record(self, db_session):
        """Second call with different model should update, not insert a duplicate."""
        await system_config_service.record_embedding_model(db_session, "model-v1")
        await system_config_service.record_embedding_model(db_session, "model-v2")

        result = await db_session.execute(
            select(SystemConfig).where(
                SystemConfig.key == system_config_service.EMBEDDING_MODEL_KEY
            )
        )
        entries = list(result.scalars().all())
        assert len(entries) == 1
        assert entries[0].value == "model-v2"

    @pytest.mark.asyncio
    async def test_updates_timestamp(self, db_session):
        """Updating the model should also update the timestamp."""
        await system_config_service.record_embedding_model(db_session, "model-v1")

        result = await db_session.execute(
            select(SystemConfig).where(
                SystemConfig.key == system_config_service.EMBEDDING_MODEL_KEY
            )
        )
        first_ts = result.scalar_one().updated_at

        await system_config_service.record_embedding_model(db_session, "model-v2")

        result = await db_session.execute(
            select(SystemConfig).where(
                SystemConfig.key == system_config_service.EMBEDDING_MODEL_KEY
            )
        )
        second_ts = result.scalar_one().updated_at
        assert second_ts >= first_ts


class TestCheckEmbeddingModel:
    @pytest.mark.asyncio
    async def test_first_run_records_model(self, db_session):
        """On first run (no record), check should record the model and return unchanged."""
        status = await system_config_service.check_embedding_model(db_session, "all-MiniLM-L6-v2")

        assert isinstance(status, EmbeddingModelStatus)
        assert status.model_changed is False
        assert status.previous_model is None
        assert status.current_model == "all-MiniLM-L6-v2"

        result = await db_session.execute(
            select(SystemConfig).where(
                SystemConfig.key == system_config_service.EMBEDDING_MODEL_KEY
            )
        )
        entry = result.scalar_one_or_none()
        assert entry is not None
        assert entry.value == "all-MiniLM-L6-v2"

    @pytest.mark.asyncio
    async def test_matching_model_returns_unchanged(self, db_session):
        """If configured model matches stored model, model_changed is False."""
        await system_config_service.record_embedding_model(db_session, "all-MiniLM-L6-v2")
        status = await system_config_service.check_embedding_model(db_session, "all-MiniLM-L6-v2")
        assert status.model_changed is False
        assert status.current_model == "all-MiniLM-L6-v2"

    @pytest.mark.asyncio
    async def test_mismatched_model_returns_changed(self, db_session):
        """If configured model differs from stored, model_changed is True."""
        await system_config_service.record_embedding_model(db_session, "model-v1")
        status = await system_config_service.check_embedding_model(db_session, "model-v2")

        assert status.model_changed is True
        assert status.previous_model == "model-v1"
        assert status.current_model == "model-v2"

    @pytest.mark.asyncio
    async def test_mismatched_model_updates_stored_value(self, db_session):
        """On mismatch, the stored model should be updated to the new one."""
        await system_config_service.record_embedding_model(db_session, "old-model")
        await system_config_service.check_embedding_model(db_session, "new-model")

        result = await db_session.execute(
            select(SystemConfig).where(
                SystemConfig.key == system_config_service.EMBEDDING_MODEL_KEY
            )
        )
        entry = result.scalar_one()
        assert entry.value == "new-model"


class TestVerifyEmbeddingModelLegacy:
    """Tests for the backward-compatible verify_embedding_model wrapper."""

    @pytest.mark.asyncio
    async def test_first_run_records_model(self, db_session):
        """On first run, the model should be recorded without error."""
        await system_config_service.verify_embedding_model(db_session, "all-MiniLM-L6-v2")

        result = await db_session.execute(
            select(SystemConfig).where(
                SystemConfig.key == system_config_service.EMBEDDING_MODEL_KEY
            )
        )
        entry = result.scalar_one_or_none()
        assert entry is not None

    @pytest.mark.asyncio
    async def test_same_model_passes(self, db_session):
        """Verifying the same model should not raise."""
        await system_config_service.record_embedding_model(db_session, "all-MiniLM-L6-v2")
        await system_config_service.verify_embedding_model(db_session, "all-MiniLM-L6-v2")

    @pytest.mark.asyncio
    async def test_different_model_raises(self, db_session):
        """Legacy wrapper still raises EmbeddingModelMismatchError on mismatch."""
        await system_config_service.record_embedding_model(db_session, "model-v1")

        with pytest.raises(EmbeddingModelMismatchError) as exc_info:
            await system_config_service.verify_embedding_model(db_session, "model-v2")

        assert exc_info.value.configured == "model-v2"
