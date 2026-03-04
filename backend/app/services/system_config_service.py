import logging
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import EmbeddingModelMismatchError
from app.models.system_config import SystemConfig

logger = logging.getLogger(__name__)

EMBEDDING_MODEL_KEY = "embedding_model"


@dataclass
class EmbeddingModelStatus:
    model_changed: bool
    previous_model: str | None
    current_model: str


async def record_embedding_model(db: AsyncSession, model_name: str) -> None:
    """Store the embedding model name in system_config (upsert)."""
    result = await db.execute(select(SystemConfig).where(SystemConfig.key == EMBEDDING_MODEL_KEY))
    existing = result.scalar_one_or_none()

    if existing is not None:
        existing.value = model_name
        existing.updated_at = datetime.now(timezone.utc)
    else:
        entry = SystemConfig(key=EMBEDDING_MODEL_KEY, value=model_name)
        db.add(entry)

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        result = await db.execute(
            select(SystemConfig).where(SystemConfig.key == EMBEDDING_MODEL_KEY)
        )
        existing = result.scalar_one()
        if existing.value != model_name:
            raise EmbeddingModelMismatchError(configured=model_name, stored=existing.value)


async def check_embedding_model(db: AsyncSession, configured_model: str) -> EmbeddingModelStatus:
    """Check whether the configured embedding model matches what was used for indexing.

    If no record exists, this is the first run; record the model and return unchanged.
    If a record exists and differs, update it and return model_changed=True so the
    caller can trigger a migration (vector wipe and re-index).
    """
    result = await db.execute(select(SystemConfig).where(SystemConfig.key == EMBEDDING_MODEL_KEY))
    existing = result.scalar_one_or_none()

    if existing is None:
        logger.info("No embedding model recorded yet. Storing: %s", configured_model)
        await record_embedding_model(db, configured_model)
        return EmbeddingModelStatus(
            model_changed=False, previous_model=None, current_model=configured_model
        )

    if existing.value == configured_model:
        logger.info("Embedding model verified: %s", configured_model)
        return EmbeddingModelStatus(
            model_changed=False, previous_model=configured_model, current_model=configured_model
        )

    previous = existing.value
    logger.warning(
        "Embedding model changed from '%s' to '%s'. Migration required.",
        previous,
        configured_model,
    )
    await record_embedding_model(db, configured_model)
    return EmbeddingModelStatus(
        model_changed=True, previous_model=previous, current_model=configured_model
    )


async def verify_embedding_model(db: AsyncSession, configured_model: str) -> None:
    """Legacy wrapper: raises EmbeddingModelMismatchError on mismatch.

    Kept for backward compatibility with code that expects the exception-based API.
    Prefer check_embedding_model for new code.
    """
    status = await check_embedding_model(db, configured_model)
    if status.model_changed:
        raise EmbeddingModelMismatchError(
            configured=status.current_model,
            stored=status.previous_model or "",
        )
