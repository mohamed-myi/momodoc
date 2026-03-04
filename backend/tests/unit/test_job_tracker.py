"""Unit tests for JobTracker crash recovery and concurrency fixes."""

import asyncio
import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.job_tracker import AsyncLockWithTimeout, JobStatus, JobTracker
from app.models.project import Project
from app.models.sync_job import SyncJob


@pytest.fixture
def job_tracker():
    """Create a fresh JobTracker instance."""
    return JobTracker()


@pytest.fixture
def project_id():
    """Generate a random project ID."""
    return str(uuid.uuid4())


async def create_project(db: AsyncSession, project_id: str) -> Project:
    """Helper to create a project record for testing."""
    project = Project(
        id=project_id,
        name=f"Test Project {project_id[:8]}",
        description="Test project for job tracker tests",
    )
    db.add(project)
    await db.commit()
    return project


class TestAsyncLockWithTimeout:
    """Test the AsyncLockWithTimeout wrapper class."""

    @pytest.mark.asyncio
    async def test_lock_normal_acquisition(self):
        """Lock should work normally when acquired quickly."""
        lock = AsyncLockWithTimeout(timeout=1.0)
        async with lock:
            # Successfully acquired
            pass

    @pytest.mark.asyncio
    async def test_lock_timeout_on_deadlock(self):
        """Lock should timeout if held for too long."""
        lock = AsyncLockWithTimeout(timeout=0.1)

        # Manually acquire without releasing
        await lock._lock.acquire()

        # Attempt to acquire again should timeout
        with pytest.raises(asyncio.TimeoutError, match="Failed to acquire lock"):
            async with lock:
                pass

        # Clean up
        lock._lock.release()


class TestJobTrackerHydration:
    """Test state hydration from database on startup."""

    @pytest.mark.asyncio
    async def test_hydrate_loads_only_active_jobs(
        self, db_session: AsyncSession, job_tracker: JobTracker, project_id: str
    ):
        """Hydration should load only PENDING and RUNNING jobs into memory."""
        # Create projects for each job
        await create_project(db_session, project_id)
        running_project_id = str(uuid.uuid4())
        await create_project(db_session, running_project_id)
        completed_project_id = str(uuid.uuid4())
        await create_project(db_session, completed_project_id)
        failed_project_id = str(uuid.uuid4())
        await create_project(db_session, failed_project_id)

        # Create jobs in various states
        pending_job = SyncJob(
            id=str(uuid.uuid4()),
            project_id=project_id,
            status=JobStatus.PENDING.value,
        )
        running_job = SyncJob(
            id=str(uuid.uuid4()),
            project_id=running_project_id,
            status=JobStatus.RUNNING.value,
        )
        completed_job = SyncJob(
            id=str(uuid.uuid4()),
            project_id=completed_project_id,
            status=JobStatus.COMPLETED.value,
            completed_at=datetime.now(timezone.utc),
        )
        failed_job = SyncJob(
            id=str(uuid.uuid4()),
            project_id=failed_project_id,
            status=JobStatus.FAILED.value,
            completed_at=datetime.now(timezone.utc),
        )

        db_session.add_all([pending_job, running_job, completed_job, failed_job])
        await db_session.commit()

        # Clear in-memory state and hydrate from DB
        job_tracker._active_projects.clear()
        count = await job_tracker.hydrate_from_db(db_session)

        # Should load only PENDING and RUNNING
        assert count == 2
        assert job_tracker._hydrated is True
        assert project_id in job_tracker._active_projects
        assert job_tracker._active_projects[project_id] == pending_job.id
        assert running_project_id in job_tracker._active_projects

        # COMPLETED and FAILED should not be loaded
        assert completed_project_id not in job_tracker._active_projects
        assert failed_project_id not in job_tracker._active_projects

    @pytest.mark.asyncio
    async def test_hydrate_clears_stale_memory_state(
        self, db_session: AsyncSession, job_tracker: JobTracker, project_id: str
    ):
        """Hydration should clear orphaned in-memory entries."""
        # Create project for the active job
        await create_project(db_session, project_id)

        # Simulate orphaned state: job in memory but not in DB
        orphan_project_id = str(uuid.uuid4())
        job_tracker._active_projects[orphan_project_id] = str(uuid.uuid4())

        # Create one real active job
        active_job = SyncJob(
            id=str(uuid.uuid4()),
            project_id=project_id,
            status=JobStatus.RUNNING.value,
        )
        db_session.add(active_job)
        await db_session.commit()

        # Hydrate should clear orphan and load real job
        count = await job_tracker.hydrate_from_db(db_session)

        assert count == 1
        assert orphan_project_id not in job_tracker._active_projects
        assert project_id in job_tracker._active_projects

    @pytest.mark.asyncio
    async def test_hydrate_after_crash_during_complete(
        self, db_session: AsyncSession, job_tracker: JobTracker, project_id: str
    ):
        """Simulate crash between db.commit() and _remove_active()."""
        # Create project first
        await create_project(db_session, project_id)

        # Create a completed job (as if commit succeeded)
        job_id = str(uuid.uuid4())
        job = SyncJob(
            id=job_id,
            project_id=project_id,
            status=JobStatus.COMPLETED.value,
            completed_at=datetime.now(timezone.utc),
        )
        db_session.add(job)
        await db_session.commit()

        # Simulate orphaned in-memory state (as if _remove_active never ran)
        job_tracker._active_projects[project_id] = job_id

        # Verify project is blocked before hydration
        with pytest.raises(ValueError, match="already active"):
            await job_tracker.create_job(db_session, project_id)

        # Create new JobTracker and hydrate (simulating restart)
        new_tracker = JobTracker()
        await new_tracker.recover_stale_jobs(db_session)  # No-op for COMPLETED jobs
        await new_tracker.hydrate_from_db(db_session)  # Clears orphan

        # Project should now be unblocked
        assert project_id not in new_tracker._active_projects
        new_job = await new_tracker.create_job(db_session, project_id)
        assert new_job.project_id == project_id


class TestJobTrackerLockTimeout:
    """Test lock timeout prevents deadlocks."""

    @pytest.mark.asyncio
    async def test_create_job_timeout_raises_user_friendly_error(
        self, db_session: AsyncSession, job_tracker: JobTracker, project_id: str
    ):
        """create_job should raise ValueError on lock timeout."""
        # Manually acquire lock
        await job_tracker._lock._lock.acquire()

        # Attempt to create job should timeout
        with pytest.raises(ValueError, match="system is busy"):
            await job_tracker.create_job(db_session, project_id)

        # Clean up
        job_tracker._lock._lock.release()

    @pytest.mark.asyncio
    async def test_get_active_job_timeout_raises_user_friendly_error(
        self, db_session: AsyncSession, job_tracker: JobTracker, project_id: str
    ):
        """get_active_job_for_project should raise ValueError on lock timeout."""
        # Manually acquire lock
        await job_tracker._lock._lock.acquire()

        # Attempt to check active job should timeout
        with pytest.raises(ValueError, match="system is busy"):
            await job_tracker.get_active_job_for_project(db_session, project_id)

        # Clean up
        job_tracker._lock._lock.release()


class TestJobTrackerAtomicIncrement:
    """Test atomic counter updates."""

    @pytest.mark.asyncio
    async def test_single_field_increment(
        self, db_session: AsyncSession, job_tracker: JobTracker, project_id: str
    ):
        """Single field increment should work."""
        await create_project(db_session, project_id)
        job = await job_tracker.create_job(db_session, project_id)
        await db_session.commit()

        await job_tracker.atomic_increment(db_session, job.id, processed_files=1)

        # Verify in DB
        result = await db_session.execute(select(SyncJob).where(SyncJob.id == job.id))
        updated_job = result.scalar_one()
        assert updated_job.processed_files == 1

    @pytest.mark.asyncio
    async def test_multiple_fields_increment_atomic(
        self, db_session: AsyncSession, job_tracker: JobTracker, project_id: str
    ):
        """Multiple field increments should happen in single transaction."""
        await create_project(db_session, project_id)
        job = await job_tracker.create_job(db_session, project_id)
        await db_session.commit()

        # Increment multiple fields in one call
        await job_tracker.atomic_increment(
            db_session, job.id, failed_files=1, processed_files=1, total_chunks=5
        )

        # Verify all fields updated
        result = await db_session.execute(select(SyncJob).where(SyncJob.id == job.id))
        updated_job = result.scalar_one()
        assert updated_job.failed_files == 1
        assert updated_job.processed_files == 1
        assert updated_job.total_chunks == 5

    @pytest.mark.asyncio
    async def test_increment_invalid_field_raises_error(
        self, db_session: AsyncSession, job_tracker: JobTracker, project_id: str
    ):
        """Attempting to increment invalid field should raise ValueError."""
        await create_project(db_session, project_id)
        job = await job_tracker.create_job(db_session, project_id)
        await db_session.commit()

        with pytest.raises(ValueError, match="Cannot atomically increment"):
            await job_tracker.atomic_increment(db_session, job.id, invalid_field=1)


class TestJobTrackerRecoveryIntegration:
    """Integration tests for full recovery lifecycle."""

    @pytest.mark.asyncio
    async def test_full_recovery_and_hydration_sequence(
        self, db_session: AsyncSession, project_id: str
    ):
        """Test complete startup sequence: recover then hydrate."""
        # Create projects for each job
        await create_project(db_session, project_id)
        running_project_id = str(uuid.uuid4())
        await create_project(db_session, running_project_id)
        completed_project_id = str(uuid.uuid4())
        await create_project(db_session, completed_project_id)

        # Create jobs simulating a crashed server
        stale_pending = SyncJob(
            id=str(uuid.uuid4()),
            project_id=project_id,
            status=JobStatus.PENDING.value,
        )
        stale_running = SyncJob(
            id=str(uuid.uuid4()),
            project_id=running_project_id,
            status=JobStatus.RUNNING.value,
        )
        completed = SyncJob(
            id=str(uuid.uuid4()),
            project_id=completed_project_id,
            status=JobStatus.COMPLETED.value,
            completed_at=datetime.now(timezone.utc),
        )
        db_session.add_all([stale_pending, stale_running, completed])
        await db_session.commit()

        # Simulate startup sequence
        tracker = JobTracker()
        recovered_count = await tracker.recover_stale_jobs(db_session)
        hydrated_count = await tracker.hydrate_from_db(db_session)

        # Stale jobs should be marked FAILED
        assert recovered_count == 2

        # No jobs should be hydrated (all marked as FAILED)
        assert hydrated_count == 0
        assert len(tracker._active_projects) == 0

        # Projects should be unblocked
        new_job = await tracker.create_job(db_session, project_id)
        assert new_job.status == JobStatus.PENDING.value

    @pytest.mark.asyncio
    async def test_concurrent_sync_rejection(
        self, db_session: AsyncSession, job_tracker: JobTracker, project_id: str
    ):
        """Verify concurrent syncs for same project are rejected."""
        # Create project first
        await create_project(db_session, project_id)

        # Create first job
        job1 = await job_tracker.create_job(db_session, project_id)
        await db_session.commit()

        # Attempt second job for same project
        with pytest.raises(ValueError, match="already active"):
            await job_tracker.create_job(db_session, project_id)

        # Complete first job
        await job_tracker.complete_job(db_session, job1.id)

        # Now second job should succeed
        job2 = await job_tracker.create_job(db_session, project_id)
        assert job2.id != job1.id
