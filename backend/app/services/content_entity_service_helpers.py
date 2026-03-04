import logging
from collections.abc import Awaitable, Callable
from typing import Any, TypeVar

from sqlalchemy.ext.asyncio import AsyncSession

EntityT = TypeVar("EntityT")


async def create_entity_with_indexing(
    db: AsyncSession,
    entity: EntityT,
    *,
    index_entity: Callable[[EntityT], Awaitable[int]],
) -> EntityT:
    db.add(entity)
    await db.flush()

    entity.chunk_count = await index_entity(entity)
    await db.commit()
    await db.refresh(entity)
    return entity


async def finalize_entity_update(
    db: AsyncSession,
    entity: EntityT,
    *,
    content_changed: bool,
    entity_name: str,
    delete_vectors: Callable[[str], Awaitable[None]],
    index_entity: Callable[[EntityT], Awaitable[int]],
    logger: logging.Logger,
) -> EntityT:
    if content_changed:
        entity_id = _entity_id(entity)
        await delete_vectors(entity_id)
        try:
            entity.chunk_count = await index_entity(entity)
        except Exception:
            display_name = entity_name.capitalize()
            logger.critical(
                "Failed to re-index %s %s after deleting old vectors. "
                "%s content is saved but vectors are missing - "
                "edit the %s again to retry indexing.",
                entity_name,
                entity_id,
                display_name,
                entity_name,
            )
            entity.chunk_count = 0
            await db.commit()
            raise

    await db.commit()
    await db.refresh(entity)
    return entity


async def delete_entity_with_vector_cleanup(
    db: AsyncSession,
    entity: EntityT,
    *,
    entity_name: str,
    delete_vectors: Callable[[str], Awaitable[None]],
    logger: logging.Logger,
) -> None:
    entity_id = _entity_id(entity)

    # Commit the DB deletion first so the database is the source of truth.
    await db.delete(entity)
    await db.commit()

    # Best-effort vector cleanup after the source of truth is updated.
    try:
        await delete_vectors(entity_id)
    except Exception:
        logger.warning("Failed to delete vectors for %s %s", entity_name, entity_id)


def _entity_id(entity: Any) -> str:
    return str(entity.id)
