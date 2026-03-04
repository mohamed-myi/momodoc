"""Startup maintenance tasks for data integrity."""

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.async_vectordb import AsyncVectorStore
from app.models.file import File
from app.models.note import Note
from app.models.issue import Issue
from app.models.project import Project

logger = logging.getLogger(__name__)


async def cleanup_orphaned_vectors(db: AsyncSession, vectordb: AsyncVectorStore) -> None:
    """Remove LanceDB vectors whose project or source no longer exists in SQLite.

    This handles vectors left behind when best-effort deletion fails (e.g. after
    a project/file/note/issue delete where the LanceDB call raised an exception).
    """
    await _cleanup_orphaned_projects(db, vectordb)
    await _cleanup_orphaned_sources(db, vectordb)


async def _cleanup_orphaned_projects(
    db: AsyncSession, vectordb: AsyncVectorStore
) -> None:
    """Delete vectors for project IDs that no longer exist in SQLite."""
    try:
        vector_project_ids = await vectordb.get_distinct_column("project_id")
    except Exception as e:
        logger.warning("Failed to get project IDs from LanceDB: %s", e)
        return

    if not vector_project_ids:
        return

    result = await db.execute(select(Project.id))
    db_project_ids = {row[0] for row in result.all()}

    orphaned = set(vector_project_ids) - db_project_ids
    for project_id in orphaned:
        logger.info("Cleaning up orphaned vectors for deleted project: %s", project_id)
        try:
            await vectordb.delete(AsyncVectorStore.filter_by_project(project_id))
        except Exception as e:
            logger.warning(
                "Failed to delete orphaned vectors for project %s: %s", project_id, e
            )


async def _cleanup_orphaned_sources(
    db: AsyncSession, vectordb: AsyncVectorStore
) -> None:
    """Delete vectors for source IDs (files, notes, issues) that no longer exist."""
    try:
        vector_source_ids = await vectordb.get_distinct_column("source_id")
    except Exception as e:
        logger.warning("Failed to get source IDs from LanceDB: %s", e)
        return

    if not vector_source_ids:
        return

    # Collect all valid source IDs from SQLite
    db_source_ids: set[str] = set()
    for model in (File, Note, Issue):
        result = await db.execute(select(model.id))
        db_source_ids.update(row[0] for row in result.all())

    orphaned = set(vector_source_ids) - db_source_ids
    for source_id in orphaned:
        logger.info("Cleaning up orphaned vectors for deleted source: %s", source_id)
        try:
            await vectordb.delete(AsyncVectorStore.filter_by_source(source_id))
        except Exception as e:
            logger.warning(
                "Failed to delete orphaned vectors for source %s: %s", source_id, e
            )
