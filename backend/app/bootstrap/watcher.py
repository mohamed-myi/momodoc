import logging
import os

from app.config import Settings
from app.core import database as db_module
from app.core.async_vectordb import AsyncVectorStore
from app.services.ingestion.embedder import Embedder

logger = logging.getLogger(__name__)


async def start_file_watchers(
    file_watcher,
    settings: Settings,
    vectordb: AsyncVectorStore,
    embedder: Embedder,
) -> None:
    """Start file watchers for all projects with a source_directory."""
    from sqlalchemy import select

    from app.models.project import Project

    try:
        async with db_module.async_session_factory() as session:
            result = await session.execute(
                select(Project).where(Project.source_directory != None)  # noqa: E711
            )
            projects = result.scalars().all()
    except Exception as e:
        logger.error("Failed to query projects for file watchers: %s", e)
        return

    for proj in projects:
        if not proj.source_directory or not os.path.isdir(proj.source_directory):
            continue

        setup_project_watcher(
            file_watcher,
            proj.id,
            proj.source_directory,
            settings,
            vectordb,
            embedder,
        )


def setup_project_watcher(
    file_watcher,
    project_id: str,
    source_directory: str,
    settings: Settings,
    vectordb: AsyncVectorStore,
    embedder: Embedder,
) -> None:
    """Set up a file watcher for a single project directory."""
    from watchdog.events import FileCreatedEvent, FileDeletedEvent, FileModifiedEvent

    from app.services import sync_service
    from app.services.ingestion.pipeline import IGNORE_DIRS, SUPPORTED_EXTENSIONS

    async def on_change(path: str, event_type: type) -> None:
        if event_type in (FileCreatedEvent, FileModifiedEvent):
            await sync_service.ingest_single_file(
                file_path=path,
                project_id=project_id,
                vectordb=vectordb,
                embedder=embedder,
                settings=settings,
            )
        elif event_type is FileDeletedEvent:
            await sync_service.remove_single_file(
                file_path=path,
                project_id=project_id,
                vectordb=vectordb,
            )

    file_watcher.watch_project(
        project_id=project_id,
        directory=source_directory,
        on_change=on_change,
        supported_extensions=SUPPORTED_EXTENSIONS,
        ignore_dirs=IGNORE_DIRS,
    )
