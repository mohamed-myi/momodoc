import asyncio
import enum
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.sync_job import SyncJob, SyncJobError

logger = logging.getLogger(__name__)


class AsyncLockWithTimeout:
    """Async lock wrapper with timeout support to prevent deadlocks.

    Wraps asyncio.Lock with asyncio.wait_for() to automatically timeout
    if lock acquisition takes too long, preventing permanent deadlocks
    from crashed tasks that never released the lock.
    """

    def __init__(self, timeout: float = 30.0) -> None:
        """Initialize lock with timeout in seconds (default: 30s)."""
        self._lock = asyncio.Lock()
        self._timeout = timeout

    async def __aenter__(self) -> None:
        """Acquire lock with timeout."""
        try:
            await asyncio.wait_for(self._lock.acquire(), timeout=self._timeout)
        except asyncio.TimeoutError:
            raise asyncio.TimeoutError(
                f"Failed to acquire lock within {self._timeout}s - "
                "this may indicate a deadlock or hung task"
            )

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """Release lock."""
        self._lock.release()


class JobStatus(str, enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class JobTracker:
    """SQLite-backed job tracker with in-memory concurrency guard.

    Active job IDs are cached in memory to prevent concurrent syncs for the
    same project without requiring a DB query. All persistent state is in SQLite.

    Crash recovery: on startup, ``recover_stale_jobs`` marks any running/pending
    jobs as FAILED. The auto-sync mechanism in ``main.py`` then re-triggers sync
    for projects with source directories, effectively retrying any work lost to
    a crash.
    """

    def __init__(self) -> None:
        self._active_projects: dict[str, str] = {}  # project_id -> job_id
        self._lock = AsyncLockWithTimeout(timeout=30.0)
        self._hydrated = False  # Track if state was hydrated from DB on startup

    async def recover_stale_jobs(self, db: AsyncSession) -> int:
        """Mark any running/pending jobs as failed (server crashed mid-sync).

        Call this on startup before creating new jobs.
        Returns the number of recovered jobs.
        """
        result = await db.execute(
            select(SyncJob).where(
                SyncJob.status.in_([JobStatus.PENDING.value, JobStatus.RUNNING.value])
            )
        )
        stale_jobs = result.scalars().all()
        count = 0
        for job in stale_jobs:
            job.status = JobStatus.FAILED.value
            job.error = "Server restarted during sync"
            job.completed_at = datetime.now(timezone.utc)
            count += 1
        if count > 0:
            await db.commit()
            logger.info("Recovered %d stale sync jobs", count)
        return count

    async def hydrate_from_db(self, db: AsyncSession) -> int:
        """Repopulate in-memory _active_projects from database state.

        Call this on startup after recover_stale_jobs() to rebuild the
        in-memory concurrency guard from the database source of truth.
        This makes crash recovery work correctly: even if the server
        crashes between db.commit() and _remove_active() in complete_job(),
        the orphaned in-memory state is cleared on restart.

        Returns the number of active jobs loaded into memory.
        """
        result = await db.execute(
            select(SyncJob).where(
                SyncJob.status.in_([JobStatus.PENDING.value, JobStatus.RUNNING.value])
            )
        )
        active_jobs = result.scalars().all()

        # Clear any stale in-memory state and rebuild from DB truth
        self._active_projects.clear()
        for job in active_jobs:
            self._active_projects[job.project_id] = job.id

        self._hydrated = True
        count = len(active_jobs)
        if count > 0:
            logger.info("Hydrated %d active jobs into memory", count)
        return count

    async def create_job(self, db: AsyncSession, project_id: str) -> SyncJob:
        try:
            async with self._lock:
                existing_job_id = self._active_projects.get(project_id)
                if existing_job_id:
                    raise ValueError("A sync job is already active for this project")

                job = SyncJob(
                    id=str(uuid.uuid4()),
                    project_id=project_id,
                    status=JobStatus.PENDING.value,
                )
                db.add(job)
                await db.flush()
                self._active_projects[project_id] = job.id
                return job
        except asyncio.TimeoutError as e:
            logger.error(
                "Lock timeout acquiring active projects for project %s (waited 30s)", project_id
            )
            raise ValueError(
                "Failed to create sync job: system is busy. Please try again in a moment."
            ) from e

    async def get_job(self, db: AsyncSession, job_id: str) -> SyncJob | None:
        result = await db.execute(select(SyncJob).where(SyncJob.id == job_id))
        return result.scalar_one_or_none()

    async def get_active_job_for_project(self, db: AsyncSession, project_id: str) -> SyncJob | None:
        try:
            async with self._lock:
                job_id = self._active_projects.get(project_id)
        except asyncio.TimeoutError as e:
            logger.error("Lock timeout checking active job for project %s (waited 30s)", project_id)
            raise ValueError(
                "Failed to check sync job status: system is busy. Please try again in a moment."
            ) from e
        if not job_id:
            return None
        return await self.get_job(db, job_id)

    async def start_job(self, db: AsyncSession, job_id: str) -> None:
        await db.execute(
            update(SyncJob).where(SyncJob.id == job_id).values(status=JobStatus.RUNNING.value)
        )
        await db.commit()

    async def update_progress(self, db: AsyncSession, job_id: str, **kwargs: object) -> None:
        valid_fields = {
            "total_files",
            "processed_files",
            "skipped_files",
            "failed_files",
            "total_chunks",
            "current_file",
        }
        values = {k: v for k, v in kwargs.items() if k in valid_fields}
        if not values:
            return
        await db.execute(update(SyncJob).where(SyncJob.id == job_id).values(**values))
        await db.commit()

    async def atomic_increment(self, db: AsyncSession, job_id: str, **kwargs: int) -> None:
        """Atomically increment integer counters on a sync job.

        Uses SQL expressions (e.g. ``processed_files = processed_files + 1``)
        so concurrent tasks don't clobber each other.

        Supports incrementing multiple fields in a single transaction for
        atomicity. For example:
            await atomic_increment(db, job_id, failed_files=1, processed_files=1)

        Only the following fields may be incremented:
        ``processed_files``, ``skipped_files``, ``failed_files``, ``total_chunks``.
        """
        allowed = {"processed_files", "skipped_files", "failed_files", "total_chunks"}
        values = {}
        for field_name, delta in kwargs.items():
            if field_name not in allowed:
                raise ValueError(f"Cannot atomically increment '{field_name}'")
            col = getattr(SyncJob, field_name)
            values[col] = col + delta
        if not values:
            return
        await db.execute(update(SyncJob).where(SyncJob.id == job_id).values(values))
        await db.commit()

    async def add_error(
        self, db: AsyncSession, job_id: str, filename: str, error_message: str
    ) -> None:
        error = SyncJobError(
            job_id=job_id,
            filename=filename,
            error_message=error_message,
        )
        db.add(error)
        await db.commit()

    async def complete_job(self, db: AsyncSession, job_id: str) -> None:
        now = datetime.now(timezone.utc)
        await db.execute(
            update(SyncJob)
            .where(SyncJob.id == job_id)
            .values(status=JobStatus.COMPLETED.value, completed_at=now)
        )
        await db.commit()
        await self._remove_active(job_id)

    async def fail_job(self, db: AsyncSession, job_id: str, error: str) -> None:
        now = datetime.now(timezone.utc)
        await db.execute(
            update(SyncJob)
            .where(SyncJob.id == job_id)
            .values(status=JobStatus.FAILED.value, error=error, completed_at=now)
        )
        await db.commit()
        await self._remove_active(job_id)

    async def _remove_active(self, job_id: str) -> None:
        async with self._lock:
            to_remove = [pid for pid, jid in self._active_projects.items() if jid == job_id]
            for pid in to_remove:
                del self._active_projects[pid]
