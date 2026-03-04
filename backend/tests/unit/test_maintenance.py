"""Tests for orphaned vector cleanup maintenance tasks."""

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.file import File
from app.models.note import Note
from app.models.project import Project
from app.services.maintenance import cleanup_orphaned_vectors


class TestCleanupOrphanedVectors:
    """Tests for the startup orphan cleanup logic."""

    async def _create_project(self, db: AsyncSession, name: str) -> Project:
        project = Project(name=name)
        db.add(project)
        await db.commit()
        return project

    async def _create_file(
        self, db: AsyncSession, project_id: str, filename: str = "test.py"
    ) -> File:
        f = File(
            project_id=project_id,
            filename=filename,
            storage_path=f"/storage/{filename}",
            file_type="py",
            file_size=100,
            checksum="abc123",
            is_managed=True,
        )
        db.add(f)
        await db.commit()
        return f

    async def _create_note(self, db: AsyncSession, project_id: str) -> Note:
        note = Note(project_id=project_id, content="test content")
        db.add(note)
        await db.commit()
        return note

    @pytest.mark.asyncio
    async def test_removes_vectors_for_deleted_project(self, db_session, mock_vectordb):
        """Vectors referencing a project_id that no longer exists should be deleted."""
        # Create one project that exists
        existing = await self._create_project(db_session, "existing-project")
        deleted_project_id = str(uuid.uuid4())

        # Mock LanceDB to return both project IDs
        mock_vectordb.get_distinct_column.side_effect = lambda col: {
            "project_id": [existing.id, deleted_project_id],
            "source_id": [],
        }[col]

        await cleanup_orphaned_vectors(db_session, mock_vectordb)

        # Should have deleted vectors for the missing project
        delete_calls = mock_vectordb.delete.call_args_list
        delete_filters = [call[0][0] for call in delete_calls]
        assert any(deleted_project_id in f for f in delete_filters)
        # Should NOT have deleted vectors for the existing project
        assert not any(existing.id in f for f in delete_filters)

    @pytest.mark.asyncio
    async def test_preserves_vectors_for_existing_projects(self, db_session, mock_vectordb):
        """Vectors referencing existing projects should not be touched."""
        p1 = await self._create_project(db_session, "project-1")
        p2 = await self._create_project(db_session, "project-2")

        mock_vectordb.get_distinct_column.side_effect = lambda col: {
            "project_id": [p1.id, p2.id],
            "source_id": [],
        }[col]

        await cleanup_orphaned_vectors(db_session, mock_vectordb)

        # vectordb.delete should NOT have been called
        mock_vectordb.delete.assert_not_called()

    @pytest.mark.asyncio
    async def test_removes_vectors_for_deleted_source(self, db_session, mock_vectordb):
        """Vectors referencing a source_id that no longer exists should be deleted."""
        project = await self._create_project(db_session, "test-project")
        existing_file = await self._create_file(db_session, project.id)
        deleted_source_id = str(uuid.uuid4())

        mock_vectordb.get_distinct_column.side_effect = lambda col: {
            "project_id": [project.id],
            "source_id": [existing_file.id, deleted_source_id],
        }[col]

        await cleanup_orphaned_vectors(db_session, mock_vectordb)

        delete_calls = mock_vectordb.delete.call_args_list
        delete_filters = [call[0][0] for call in delete_calls]
        assert any(deleted_source_id in f for f in delete_filters)
        assert not any(existing_file.id in f for f in delete_filters)

    @pytest.mark.asyncio
    async def test_preserves_vectors_for_existing_sources(self, db_session, mock_vectordb):
        """Vectors referencing existing files/notes/issues should not be touched."""
        project = await self._create_project(db_session, "test-project")
        file_record = await self._create_file(db_session, project.id)
        note_record = await self._create_note(db_session, project.id)

        mock_vectordb.get_distinct_column.side_effect = lambda col: {
            "project_id": [project.id],
            "source_id": [file_record.id, note_record.id],
        }[col]

        await cleanup_orphaned_vectors(db_session, mock_vectordb)

        mock_vectordb.delete.assert_not_called()

    @pytest.mark.asyncio
    async def test_handles_empty_lancedb_gracefully(self, db_session, mock_vectordb):
        """If LanceDB has no data, cleanup should do nothing without errors."""
        mock_vectordb.get_distinct_column.return_value = []

        await cleanup_orphaned_vectors(db_session, mock_vectordb)

        mock_vectordb.delete.assert_not_called()

    @pytest.mark.asyncio
    async def test_handles_lancedb_error_gracefully(self, db_session, mock_vectordb):
        """If LanceDB raises an error, cleanup should log and continue."""
        mock_vectordb.get_distinct_column.side_effect = RuntimeError("LanceDB down")

        # Should not raise
        await cleanup_orphaned_vectors(db_session, mock_vectordb)

        mock_vectordb.delete.assert_not_called()
