"""Tests for embedding model safety check (Issue #13).

The primary check_embedding_model function returns a status object instead
of raising on mismatch. The legacy verify_embedding_model wrapper still
raises for backward compatibility.
"""

import pytest

from app.core.exceptions import EmbeddingModelMismatchError
from app.models.system_config import SystemConfig
from app.services.system_config_service import (
    EMBEDDING_MODEL_KEY,
    EmbeddingModelStatus,
    check_embedding_model,
    record_embedding_model,
    verify_embedding_model,
)


class TestEmbeddingSafety:
    """Tests for the embedding model invariant guard."""

    @pytest.mark.asyncio
    async def test_first_run_records_model(self, db_session):
        """On first run, the model should be recorded without error."""
        status = await check_embedding_model(db_session, "all-MiniLM-L6-v2")

        assert isinstance(status, EmbeddingModelStatus)
        assert status.model_changed is False

        from sqlalchemy import select

        result = await db_session.execute(
            select(SystemConfig).where(SystemConfig.key == EMBEDDING_MODEL_KEY)
        )
        config = result.scalar_one_or_none()
        assert config is not None
        assert config.value == "all-MiniLM-L6-v2"

    @pytest.mark.asyncio
    async def test_same_model_passes(self, db_session):
        """Verifying the same model that was recorded should pass."""
        await record_embedding_model(db_session, "all-MiniLM-L6-v2")
        status = await check_embedding_model(db_session, "all-MiniLM-L6-v2")
        assert status.model_changed is False

    @pytest.mark.asyncio
    async def test_different_model_returns_changed_status(self, db_session):
        """A different model returns model_changed=True and updates the stored value."""
        await record_embedding_model(db_session, "all-MiniLM-L6-v2")

        status = await check_embedding_model(db_session, "nomic-ai/nomic-embed-text-v1.5")

        assert status.model_changed is True
        assert status.previous_model == "all-MiniLM-L6-v2"
        assert status.current_model == "nomic-ai/nomic-embed-text-v1.5"

    @pytest.mark.asyncio
    async def test_legacy_verify_still_raises_on_mismatch(self, db_session):
        """The legacy verify_embedding_model wrapper raises on mismatch."""
        await record_embedding_model(db_session, "all-MiniLM-L6-v2")

        with pytest.raises(EmbeddingModelMismatchError) as exc_info:
            await verify_embedding_model(db_session, "different-model")

        assert "all-MiniLM-L6-v2" in str(exc_info.value)
        assert "different-model" in str(exc_info.value)
