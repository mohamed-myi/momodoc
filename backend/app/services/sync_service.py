import asyncio
import logging
import os
import time
from collections.abc import Iterator
from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.core import database as db_module
from app.core.async_vectordb import AsyncVectorStore
from app.core.job_tracker import JobTracker
from app.core.ws_manager import WSManager
from app.models.file import File
from app.models.project import Project
from app.services.ingestion.directory_walk import (
    iter_directory_paths as public_iter_directory_paths,
)
from app.services.ingestion.directory_walk import (
    next_directory_batch as public_next_directory_batch,
)
from app.services.ingestion.embedder import Embedder
from app.services.ingestion.pipeline import IGNORE_DIRS, SUPPORTED_EXTENSIONS, IngestionPipeline

logger = logging.getLogger(__name__)

# Default sync worker count if settings are not provided.
_DEFAULT_SYNC_WORKERS = 4
_DEFAULT_DISCOVERY_BATCH_SIZE = 256

# Track background sync tasks to prevent garbage collection and capture exceptions.
# Without storing task references, fire-and-forget tasks can be GC'd and exceptions
# become silent "Task exception was never retrieved" warnings.
_background_tasks: set[asyncio.Task] = set()


class _SyncProgress:
    """Shared progress state for queue workers."""

    def __init__(self, total_files: int = 0) -> None:
        self._total_files = total_files
        self._processed_files = 0
        self._lock = asyncio.Lock()

    @property
    def total_files(self) -> int:
        return self._total_files

    async def add_discovered(self, count: int) -> tuple[int, int]:
        async with self._lock:
            self._total_files += count
            return self._processed_files, self._total_files

    async def mark_processed(self) -> tuple[int, int]:
        async with self._lock:
            self._processed_files += 1
            return self._processed_files, self._total_files


def _task_done_callback(task: asyncio.Task) -> None:
    """Remove completed task from background set and log any unhandled exceptions.

    This callback ensures:
    1. Completed tasks are removed from the tracking set (prevents memory leak)
    2. Any unhandled exceptions are logged with full traceback
    3. Expected cancellations are handled gracefully
    """
    _background_tasks.discard(task)

    try:
        # Check if task raised an exception. Note: calling exception() on a
        # successfully completed task returns None.
        exc = task.exception()
        if exc is not None:
            logger.error(
                "Background sync task failed with unhandled exception: %s",
                exc,
                exc_info=(type(exc), exc, exc.__traceback__),
            )
    except asyncio.CancelledError:
        # Task was cancelled (e.g., during shutdown). This is expected and
        # should not be treated as an error.
        logger.debug("Background sync task was cancelled")
    except Exception as e:
        # Extremely rare edge case: exception() itself raised an exception.
        # This could happen if the task's result is corrupted or during
        # interpreter shutdown. Log defensively.
        logger.error("Failed to retrieve task exception: %s", e)


async def _process_single_file(
    full_path: str,
    project_id: str,
    job_id: str,
    vectordb: AsyncVectorStore,
    embedder: Embedder,
    job_tracker: JobTracker,
    progress: _SyncProgress,
    settings: Settings | None = None,
    ws_manager: WSManager | None = None,
) -> str | None:
    """Ingest a single file with its own DB session and update job progress atomically.

    Returns the original path on success (for seen-path tracking), or None on failure.
    """
    async with db_module.async_session_factory() as db:
        pipeline = IngestionPipeline(db, vectordb, embedder, settings=settings)

        try:
            result = await pipeline.ingest_file(
                project_id=project_id,
                file_path=full_path,
                storage_path=full_path,
                original_path=os.path.realpath(full_path),
                is_managed=False,
            )
        except Exception as e:
            logger.error("Error ingesting %s: %s", full_path, e)
            async with db_module.async_session_factory() as err_db:
                # ``processed_files`` is a completion counter (success + skip + failure).
                await job_tracker.atomic_increment(
                    err_db, job_id, failed_files=1, processed_files=1
                )
                await job_tracker.add_error(
                    err_db, job_id, os.path.basename(full_path), str(e)
                )
            processed_files, total_files = await progress.mark_processed()
            if ws_manager is not None:
                await ws_manager.broadcast({
                    "type": "sync_progress",
                    "job_id": job_id,
                    "project_id": project_id,
                    "processed_files": processed_files,
                    "completed_files": processed_files,
                    "total_files": total_files,
                    "current_file": os.path.basename(full_path),
                })
            return None

    logger.info(
        "Ingested %s: %d chunks (skipped=%s)",
        os.path.basename(full_path),
        result.chunks_created,
        result.skipped,
    )

    # Update progress atomically using a fresh session (the pipeline session
    # is closed after ingest_file commits/rolls back).
    async with db_module.async_session_factory() as db:
        await job_tracker.atomic_increment(db, job_id, processed_files=1)

        if result.skipped:
            await job_tracker.atomic_increment(db, job_id, skipped_files=1)
        elif result.chunks_created:
            await job_tracker.atomic_increment(
                db, job_id, total_chunks=result.chunks_created
            )

        if result.errors:
            await job_tracker.atomic_increment(db, job_id, failed_files=1)
            for err in result.errors:
                await job_tracker.add_error(db, job_id, result.filename, err)

    processed_files, total_files = await progress.mark_processed()

    # Broadcast progress via WebSocket
    if ws_manager is not None:
        await ws_manager.broadcast({
            "type": "sync_progress",
            "job_id": job_id,
            "project_id": project_id,
            "processed_files": processed_files,
            "completed_files": processed_files,
            "total_files": total_files,
            "current_file": os.path.basename(full_path),
        })

    return full_path


def _iter_sync_directory_paths(directory_path: str) -> Iterator[str]:
    """Public directory discovery API used by sync jobs."""
    return public_iter_directory_paths(
        directory_path,
        supported_extensions=SUPPORTED_EXTENSIONS,
        ignore_dirs=IGNORE_DIRS,
    )


async def _sync_worker(
    *,
    queue: asyncio.Queue[str | None],
    project_id: str,
    job_id: str,
    vectordb: AsyncVectorStore,
    embedder: Embedder,
    job_tracker: JobTracker,
    progress: _SyncProgress,
    settings: Settings | None,
    ws_manager: WSManager | None,
) -> tuple[int, int]:
    worker_succeeded = 0
    worker_failed = 0
    while True:
        full_path = await queue.get()
        if full_path is None:
            queue.task_done()
            break
        try:
            result = await _process_single_file(
                full_path=full_path,
                project_id=project_id,
                job_id=job_id,
                vectordb=vectordb,
                embedder=embedder,
                job_tracker=job_tracker,
                progress=progress,
                settings=settings,
                ws_manager=ws_manager,
            )
            if result is None:
                worker_failed += 1
            else:
                worker_succeeded += 1
        except Exception as e:
            logger.error("Unexpected error processing %s: %s", full_path, e)
            worker_failed += 1
        finally:
            queue.task_done()
    return worker_succeeded, worker_failed


async def _discover_and_enqueue_files(
    *,
    directory_path: str,
    queue: asyncio.Queue[str | None],
    progress: _SyncProgress,
    job_id: str,
    job_tracker: JobTracker,
    discovery_batch_size: int,
) -> int:
    path_iterator = _iter_sync_directory_paths(directory_path)
    total_discovered = 0

    while True:
        batch = await asyncio.to_thread(
            public_next_directory_batch, path_iterator, discovery_batch_size
        )
        if not batch:
            return total_discovered

        total_discovered += len(batch)
        await progress.add_discovered(len(batch))

        async with db_module.async_session_factory() as db:
            await job_tracker.update_progress(db, job_id, total_files=total_discovered)

        for full_path in batch:
            await queue.put(full_path)


async def _complete_sync_job(
    *,
    job_id: str,
    job_tracker: JobTracker,
    vectordb: AsyncVectorStore,
    project_id: str,
    directory_path: str,
) -> None:
    async with db_module.async_session_factory() as db:
        await job_tracker.update_progress(
            db, job_id, current_file=""
        )
        await _cleanup_deleted_files(
            db, vectordb, project_id, directory_path, seen_paths=None
        )
        await job_tracker.complete_job(db, job_id)
        await db.commit()


async def run_sync_job(
    job_id: str,
    project_id: str,
    directory_path: str,
    upload_dir: str,
    vectordb: AsyncVectorStore,
    embedder: Embedder,
    job_tracker: JobTracker,
    settings: Settings | None = None,
    ws_manager: WSManager | None = None,
) -> None:
    """Run directory sync as a background task with progress tracking."""
    job_start = time.monotonic()
    worker_tasks: list[asyncio.Task] = []
    logger.info("Sync job %s started: project=%s dir=%s", job_id, project_id, directory_path)
    try:
        async with db_module.async_session_factory() as db:
            await job_tracker.start_job(db, job_id)

        # Process files using a bounded worker queue to avoid creating one task
        # per file (which can explode memory on large codebases).
        worker_count = settings.sync_max_concurrent_files if settings else _DEFAULT_SYNC_WORKERS
        queue_size = settings.sync_queue_size if settings else max(worker_count * 4, 8)
        queue: asyncio.Queue[str | None] = asyncio.Queue(maxsize=queue_size)
        progress = _SyncProgress(total_files=0)
        discovery_batch_size = (
            settings.index_discovery_batch_size
            if settings
            else _DEFAULT_DISCOVERY_BATCH_SIZE
        )
        worker_tasks = [
            asyncio.create_task(
                _sync_worker(
                    queue=queue,
                    project_id=project_id,
                    job_id=job_id,
                    vectordb=vectordb,
                    embedder=embedder,
                    job_tracker=job_tracker,
                    progress=progress,
                    settings=settings,
                    ws_manager=ws_manager,
                )
            )
            for _ in range(worker_count)
        ]

        total_discovered = await _discover_and_enqueue_files(
            directory_path=directory_path,
            queue=queue,
            progress=progress,
            job_id=job_id,
            job_tracker=job_tracker,
            discovery_batch_size=discovery_batch_size,
        )

        logger.info("Sync job %s: discovered %d files", job_id, total_discovered)
        for _ in range(worker_count):
            await queue.put(None)

        await queue.join()
        worker_stats = await asyncio.gather(*worker_tasks, return_exceptions=False)
        succeeded = sum(item[0] for item in worker_stats)
        failed = sum(item[1] for item in worker_stats)

        # Final progress update and cleanup
        await _complete_sync_job(
            job_id=job_id,
            job_tracker=job_tracker,
            vectordb=vectordb,
            project_id=project_id,
            directory_path=directory_path,
        )

        # Update project sync status
        await _update_project_sync_status(project_id, "completed")

        duration = time.monotonic() - job_start
        logger.info(
            "Sync job %s completed: %d/%d succeeded, %d failed (%.1fs)",
            job_id, succeeded, total_discovered, failed, duration,
        )

        # Broadcast sync completion via WebSocket
        if ws_manager is not None:
            await ws_manager.broadcast({
                "type": "sync_complete",
                "job_id": job_id,
                "project_id": project_id,
            })

    except Exception as e:
        duration = time.monotonic() - job_start
        logger.error("Sync job %s failed after %.1fs: %s", job_id, duration, e)
        try:
            async with db_module.async_session_factory() as db:
                await job_tracker.fail_job(db, job_id, str(e))
        except Exception as fail_err:
            logger.error("Failed to mark job %s as failed: %s", job_id, fail_err)

        # Update project sync status
        await _update_project_sync_status(project_id, "failed")

        # Broadcast sync failure via WebSocket
        if ws_manager is not None:
            try:
                await ws_manager.broadcast({
                    "type": "sync_failed",
                    "job_id": job_id,
                    "project_id": project_id,
                    "error": str(e),
                })
            except Exception:
                logger.warning("Failed to broadcast sync failure for job %s", job_id)
    finally:
        for task in worker_tasks:
            if not task.done():
                task.cancel()
        if worker_tasks:
            await asyncio.gather(*worker_tasks, return_exceptions=True)


async def ingest_single_file(
    file_path: str,
    project_id: str,
    vectordb: AsyncVectorStore,
    embedder: Embedder,
    settings: Settings | None = None,
) -> None:
    """Ingest a single file in its own DB session (for file watcher events)."""
    async with db_module.async_session_factory() as db:
        pipeline = IngestionPipeline(db, vectordb, embedder, settings=settings)
        result = await pipeline.ingest_file(
            project_id=project_id,
            file_path=file_path,
            storage_path=file_path,
            original_path=os.path.realpath(file_path),
            is_managed=False,
        )
    if result.errors:
        logger.error("File watcher ingest failed for %s: %s", file_path, result.errors)
    else:
        logger.info(
            "File watcher ingested %s: %d chunks (skipped=%s)",
            os.path.basename(file_path), result.chunks_created, result.skipped,
        )


async def remove_single_file(
    file_path: str,
    project_id: str,
    vectordb: AsyncVectorStore,
) -> None:
    """Remove a file record and its vectors (for file watcher delete events)."""
    real_path = os.path.realpath(file_path)
    async with db_module.async_session_factory() as db:
        result = await db.execute(
            select(File).where(
                File.project_id == project_id,
                File.original_path == real_path,
            )
        )
        file_record = result.scalar_one_or_none()
        if not file_record:
            logger.debug("File watcher delete: no DB record for %s", file_path)
            return

        file_id = file_record.id
        await db.execute(delete(File).where(File.id == file_id))
        await db.commit()

    # Best-effort vector cleanup
    try:
        await vectordb.delete(AsyncVectorStore.filter_by_source(file_id))
    except Exception:
        logger.warning("Failed to delete vectors for removed file %s", file_id)

    logger.info("File watcher removed %s (id=%s)", os.path.basename(file_path), file_id)


async def trigger_project_sync(
    project_id: str,
    source_directory: str,
    settings: Settings,
    vectordb: AsyncVectorStore,
    embedder: Embedder,
    job_tracker: JobTracker,
    ws_manager: WSManager | None = None,
) -> str | None:
    """Trigger a background sync for a project. Returns job ID or None if already syncing."""
    if not os.path.isdir(source_directory):
        logger.warning(
            "Cannot sync project %s: directory '%s' does not exist",
            project_id, source_directory,
        )
        return None

    try:
        async with db_module.async_session_factory() as db:
            job = await job_tracker.create_job(db, project_id)
            await db.commit()
    except ValueError:
        logger.warning("Sync already running for project %s", project_id)
        return None

    sync_task = asyncio.create_task(
        run_sync_job(
            job_id=job.id,
            project_id=project_id,
            directory_path=source_directory,
            upload_dir=settings.upload_dir,
            vectordb=vectordb,
            embedder=embedder,
            job_tracker=job_tracker,
            settings=settings,
            ws_manager=ws_manager,
        )
    )
    _background_tasks.add(sync_task)
    sync_task.add_done_callback(_task_done_callback)
    logger.info("Triggered sync for project %s (job %s)", project_id, job.id)
    return job.id


async def _update_project_sync_status(project_id: str, status: str) -> None:
    """Update the project's last_sync_at and last_sync_status."""
    try:
        async with db_module.async_session_factory() as db:
            result = await db.execute(
                select(Project).where(Project.id == project_id)
            )
            project = result.scalar_one_or_none()
            if project:
                project.last_sync_at = datetime.now(timezone.utc)
                project.last_sync_status = status
                await db.commit()
    except Exception as e:
        logger.warning("Failed to update sync status for project %s: %s", project_id, e)


async def _cleanup_deleted_files(
    db: AsyncSession,
    vectordb: AsyncVectorStore,
    project_id: str,
    directory_path: str,
    seen_paths: set[str] | None = None,
) -> None:
    """Remove DB records + vectors for files that are no longer on disk.

    Selects only the columns needed (id, original_path) to avoid loading full
    ORM objects for potentially large file sets.

    Note: This function does NOT commit — the caller must commit to ensure
    atomicity across all cleanup operations.
    """
    result = await db.execute(
        select(File.id, File.original_path).where(
            File.project_id == project_id,
            File.is_managed == False,  # noqa: E712
            File.original_path != None,  # noqa: E711
        )
    )
    file_rows = result.all()
    sync_root = os.path.realpath(directory_path)
    normalized_seen_paths = (
        {os.path.realpath(path) for path in seen_paths}
        if seen_paths is not None
        else None
    )

    for file_id, original_path in file_rows:
        if not original_path:
            continue
        normalized_original = os.path.realpath(original_path)
        # Only clean up files whose original_path is under the synced directory
        try:
            in_sync_root = os.path.commonpath([sync_root, normalized_original]) == sync_root
        except ValueError:
            in_sync_root = False
        if not in_sync_root:
            continue
        if normalized_seen_paths is not None and normalized_original in normalized_seen_paths:
            continue

        # Defense-in-depth: only delete if the file is truly gone from disk.
        if os.path.exists(normalized_original):
            if normalized_seen_paths is not None:
                logger.warning(
                    "File not in seen_paths but still exists on disk, skipping cleanup: %s",
                    normalized_original,
                )
            continue

        logger.info(
            "File no longer on disk, removing: %s (id=%s)",
            normalized_original,
            file_id,
        )
        await db.execute(delete(File).where(File.id == file_id))

        # Best-effort vector cleanup
        try:
            await vectordb.delete(AsyncVectorStore.filter_by_source(file_id))
        except Exception:
            logger.warning("Failed to delete vectors for removed file %s", file_id)
