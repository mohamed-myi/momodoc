"""Tests for sync_service data integrity fixes."""

import asyncio
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.async_vectordb import AsyncVectorStore
from app.models.file import File
from app.models.project import Project
from app.services.sync_service import (
    _background_tasks,
    _cleanup_deleted_files,
    _task_done_callback,
    run_sync_job,
    trigger_project_sync,
)


class TestCleanupDeletedFiles:
    """Tests for _cleanup_deleted_files behavior."""

    async def _create_project(self, db: AsyncSession, name: str = "test-project") -> Project:
        project = Project(name=name)
        db.add(project)
        await db.commit()
        return project

    async def _create_file(
        self,
        db: AsyncSession,
        project_id: str,
        original_path: str,
        is_managed: bool = False,
    ) -> File:
        f = File(
            project_id=project_id,
            filename=os.path.basename(original_path),
            original_path=original_path,
            storage_path=original_path,
            file_type="py",
            file_size=100,
            checksum="abc123",
            is_managed=is_managed,
        )
        db.add(f)
        await db.commit()
        return f

    @pytest.mark.asyncio
    async def test_failed_ingestion_does_not_cause_cleanup_deletion(
        self, db_session, mock_vectordb
    ):
        """A file that failed to ingest but still exists on disk must NOT be
        deleted during cleanup. The seen_paths set should include all walked
        files regardless of ingestion success."""
        project = await self._create_project(db_session)

        # Simulate a file that exists on disk and has a DB record
        file_path = "/tmp/test-sync/src/main.py"
        file_record = await self._create_file(db_session, project.id, file_path)

        # seen_paths includes the file (as _walk_directory found it on disk)
        seen_paths = {file_path}

        await _cleanup_deleted_files(
            db_session, mock_vectordb, project.id, "/tmp/test-sync", seen_paths
        )

        # File record should still exist
        result = await db_session.execute(select(File).where(File.id == file_record.id))
        assert result.scalar_one_or_none() is not None
        # vectordb.delete should NOT have been called
        mock_vectordb.delete.assert_not_called()

    @pytest.mark.asyncio
    async def test_cleanup_deletes_file_not_in_seen_paths_and_not_on_disk(
        self, db_session, mock_vectordb
    ):
        """A file that is not in seen_paths AND doesn't exist on disk should be deleted."""
        project = await self._create_project(db_session)

        file_path = "/tmp/test-sync/deleted_file.py"
        file_record = await self._create_file(db_session, project.id, file_path)
        file_id = file_record.id

        # File not in seen_paths AND not on disk
        seen_paths: set[str] = set()

        with patch("app.services.sync_service.os.path.exists", return_value=False):
            await _cleanup_deleted_files(
                db_session, mock_vectordb, project.id, "/tmp/test-sync", seen_paths
            )

        # File record should be gone
        result = await db_session.execute(select(File).where(File.id == file_id))
        assert result.scalar_one_or_none() is None
        # vectordb.delete should have been called for vector cleanup
        mock_vectordb.delete.assert_called_once()

    @pytest.mark.asyncio
    async def test_cleanup_respects_os_path_exists_safety_check(self, db_session, mock_vectordb):
        """If a file is not in seen_paths but os.path.exists() returns True,
        it should NOT be deleted (defense-in-depth)."""
        project = await self._create_project(db_session)

        file_path = "/tmp/test-sync/still_here.py"
        file_record = await self._create_file(db_session, project.id, file_path)

        # File not in seen_paths but still exists on disk
        seen_paths: set[str] = set()

        with patch("app.services.sync_service.os.path.exists", return_value=True):
            await _cleanup_deleted_files(
                db_session, mock_vectordb, project.id, "/tmp/test-sync", seen_paths
            )

        # File record should still exist (safety check prevented deletion)
        result = await db_session.execute(select(File).where(File.id == file_record.id))
        assert result.scalar_one_or_none() is not None
        mock_vectordb.delete.assert_not_called()

    @pytest.mark.asyncio
    async def test_cleanup_only_affects_files_under_synced_directory(
        self, db_session, mock_vectordb
    ):
        """Files with original_path outside the synced directory should not be touched."""
        project = await self._create_project(db_session)

        # File under synced directory
        synced_file = await self._create_file(db_session, project.id, "/tmp/test-sync/src/app.py")
        # File outside synced directory
        other_file = await self._create_file(db_session, project.id, "/other/path/lib.py")

        seen_paths: set[str] = set()

        with patch("app.services.sync_service.os.path.exists", return_value=False):
            await _cleanup_deleted_files(
                db_session, mock_vectordb, project.id, "/tmp/test-sync", seen_paths
            )

        # Only synced file should be deleted
        result = await db_session.execute(select(File).where(File.id == synced_file.id))
        assert result.scalar_one_or_none() is None

        result = await db_session.execute(select(File).where(File.id == other_file.id))
        assert result.scalar_one_or_none() is not None

    @pytest.mark.asyncio
    async def test_cleanup_ignores_managed_files(self, db_session, mock_vectordb):
        """Managed (uploaded) files should not be affected by sync cleanup."""
        project = await self._create_project(db_session)

        managed_file = await self._create_file(
            db_session, project.id, "/tmp/test-sync/uploaded.py", is_managed=True
        )

        seen_paths: set[str] = set()

        with patch("app.services.sync_service.os.path.exists", return_value=False):
            await _cleanup_deleted_files(
                db_session, mock_vectordb, project.id, "/tmp/test-sync", seen_paths
            )

        # Managed file should still exist (cleanup query filters is_managed == False)
        result = await db_session.execute(select(File).where(File.id == managed_file.id))
        assert result.scalar_one_or_none() is not None


class TestBackgroundSyncTaskHandling:
    @pytest.mark.asyncio
    async def test_trigger_project_sync_tracks_background_task(
        self, db_session, tmp_path, test_settings
    ):
        source_dir = tmp_path / "src"
        source_dir.mkdir()

        job = MagicMock()
        job.id = "job-123"

        job_tracker = MagicMock()
        job_tracker.create_job = AsyncMock(return_value=job)

        started = asyncio.Event()
        finish = asyncio.Event()

        async def fake_run_sync_job(**kwargs):
            started.set()
            await finish.wait()

        _background_tasks.clear()
        with patch("app.services.sync_service.run_sync_job", side_effect=fake_run_sync_job):
            job_id = await trigger_project_sync(
                project_id="project-1",
                source_directory=str(source_dir),
                settings=test_settings,
                vectordb=MagicMock(spec=AsyncVectorStore),
                embedder=MagicMock(),
                job_tracker=job_tracker,
                ws_manager=None,
            )

        await started.wait()

        assert job_id == "job-123"
        assert len(_background_tasks) == 1

        task = next(iter(_background_tasks))
        finish.set()
        await task

        assert task not in _background_tasks
        _background_tasks.clear()

    @pytest.mark.asyncio
    async def test_task_done_callback_logs_exception_and_cleans_tracking_set(self):
        async def fail():
            raise RuntimeError("boom")

        task = asyncio.create_task(fail())
        _background_tasks.clear()
        _background_tasks.add(task)

        # Let the task run and fail before invoking the callback explicitly.
        await asyncio.sleep(0)

        with patch("app.services.sync_service.logger.error") as log_error:
            _task_done_callback(task)

        assert task not in _background_tasks
        log_error.assert_called_once()


class TestSyncWorkerQueue:
    @pytest.mark.asyncio
    async def test_run_sync_job_respects_worker_limit(self, db_session, test_settings):
        """run_sync_job should never process more files concurrently than worker count."""
        max_inflight = 0
        inflight = 0
        lock = asyncio.Lock()

        async def fake_process_single_file(**kwargs):
            nonlocal max_inflight, inflight
            async with lock:
                inflight += 1
                max_inflight = max(max_inflight, inflight)
            await asyncio.sleep(0.01)
            async with lock:
                inflight -= 1
            return kwargs["full_path"]

        job_tracker = MagicMock()
        job_tracker.start_job = AsyncMock()
        job_tracker.update_progress = AsyncMock()
        job_tracker.complete_job = AsyncMock()
        job_tracker.fail_job = AsyncMock()

        discovered_files = [f"/tmp/test-sync/file-{i}.py" for i in range(10)]

        bounded_settings = test_settings.model_copy(
            update={
                "sync_max_concurrent_files": 2,
                "sync_queue_size": 2,
            }
        )

        with (
            patch(
                "app.services.sync_service._iter_sync_directory_paths",
                return_value=iter(discovered_files),
            ),
            patch(
                "app.services.sync_service._process_single_file",
                side_effect=fake_process_single_file,
            ),
            patch("app.services.sync_service._cleanup_deleted_files", new_callable=AsyncMock),
            patch("app.services.sync_service._update_project_sync_status", new_callable=AsyncMock),
        ):
            await run_sync_job(
                job_id="job-1",
                project_id="project-1",
                directory_path="/tmp/test-sync",
                upload_dir="/tmp",
                vectordb=MagicMock(spec=AsyncVectorStore),
                embedder=MagicMock(),
                job_tracker=job_tracker,
                settings=bounded_settings,
                ws_manager=None,
            )

        assert max_inflight <= 2
