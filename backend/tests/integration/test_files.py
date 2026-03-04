"""Integration tests for file endpoints."""

import uuid
from datetime import datetime, timezone

import pytest

from app.models.file import File


@pytest.fixture
async def sample_file(db_session, project_id):
    """Insert a File record directly into the DB and return it."""
    file = File(
        id=str(uuid.uuid4()),
        project_id=project_id,
        filename="test-doc.py",
        original_path=None,
        storage_path="/tmp/momodoc-test-data/uploads/fake.py",
        file_type="py",
        file_size=1234,
        mime_type="text/x-python",
        chunk_count=3,
        checksum="abc123def456",
        is_managed=True,
        indexed_at=datetime.now(timezone.utc),
    )
    db_session.add(file)
    await db_session.commit()
    await db_session.refresh(file)
    return file


class TestFileEndpoints:
    """Tests for the /api/v1/projects/{id}/files endpoints."""

    @pytest.mark.asyncio
    async def test_list_files_empty(self, client, project_id):
        """GET /files for a project with no files should return empty list."""
        resp = await client.get(f"/api/v1/projects/{project_id}/files")
        assert resp.status_code == 200
        assert resp.json() == []

    @pytest.mark.asyncio
    async def test_list_files_returns_inserted_file(self, client, project_id, sample_file):
        """GET /files should return files inserted into the DB."""
        resp = await client.get(f"/api/v1/projects/{project_id}/files")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["id"] == sample_file.id
        assert data[0]["filename"] == "test-doc.py"
        assert data[0]["file_type"] == "py"
        assert data[0]["file_size"] == 1234
        assert data[0]["chunk_count"] == 3
        assert data[0]["project_id"] == project_id

    @pytest.mark.asyncio
    async def test_get_file(self, client, project_id, sample_file):
        """GET /files/{file_id} should return the file."""
        resp = await client.get(f"/api/v1/projects/{project_id}/files/{sample_file.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == sample_file.id
        assert data["filename"] == "test-doc.py"

    @pytest.mark.asyncio
    async def test_get_file_nonexistent_404(self, client, project_id):
        """GET /files/{file_id} for a nonexistent file should return 404."""
        fake_id = str(uuid.uuid4())
        resp = await client.get(f"/api/v1/projects/{project_id}/files/{fake_id}")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_get_file_wrong_project_404(self, client, sample_file):
        """GET /files/{file_id} with wrong project_id should return 404."""
        # Create a different project
        resp = await client.post("/api/v1/projects", json={"name": "other-project"})
        other_pid = resp.json()["id"]

        resp = await client.get(f"/api/v1/projects/{other_pid}/files/{sample_file.id}")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_file(self, client, project_id, sample_file, mock_vectordb):
        """DELETE /files/{file_id} should remove file and call vectordb.delete."""
        mock_vectordb.delete.reset_mock()

        resp = await client.delete(f"/api/v1/projects/{project_id}/files/{sample_file.id}")
        assert resp.status_code == 204

        # Verify vectordb.delete was called with the correct source_id filter
        mock_vectordb.delete.assert_called_once()
        filter_arg = mock_vectordb.delete.call_args[0][0]
        assert f"source_id = '{sample_file.id}'" == filter_arg

        # Verify the file is gone
        resp = await client.get(f"/api/v1/projects/{project_id}/files/{sample_file.id}")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_file_nonexistent_404(self, client, project_id):
        """DELETE /files/{file_id} for nonexistent file should return 404."""
        fake_id = str(uuid.uuid4())
        resp = await client.delete(f"/api/v1/projects/{project_id}/files/{fake_id}")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_file_wrong_project_404(self, client, sample_file):
        """DELETE /files/{file_id} with wrong project returns 404."""
        resp = await client.post("/api/v1/projects", json={"name": "wrong-proj"})
        other_pid = resp.json()["id"]

        resp = await client.delete(f"/api/v1/projects/{other_pid}/files/{sample_file.id}")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_list_files_nonexistent_project_404(self, client):
        """GET /files for a nonexistent project should return 404."""
        resp = await client.get("/api/v1/projects/nonexistent-id/files")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_list_files_pagination(self, client, project_id, db_session):
        """GET /files should respect offset and limit parameters."""
        # Insert 5 files
        for i in range(5):
            file = File(
                id=str(uuid.uuid4()),
                project_id=project_id,
                filename=f"file-{i}.txt",
                storage_path=f"/tmp/fake-{i}.txt",
                file_type="txt",
                file_size=100 + i,
                chunk_count=1,
                checksum=f"checksum-{i}",
                is_managed=False,
            )
            db_session.add(file)
        await db_session.commit()

        # Get first 2
        resp = await client.get(f"/api/v1/projects/{project_id}/files?limit=2&offset=0")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

        # Get next 2
        resp = await client.get(f"/api/v1/projects/{project_id}/files?limit=2&offset=2")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

        # Get remainder
        resp = await client.get(f"/api/v1/projects/{project_id}/files?limit=2&offset=4")
        assert resp.status_code == 200
        assert len(resp.json()) == 1

    @pytest.mark.asyncio
    async def test_file_response_structure(self, client, project_id, sample_file):
        """Verify FileResponse has all expected fields."""
        resp = await client.get(f"/api/v1/projects/{project_id}/files/{sample_file.id}")
        assert resp.status_code == 200
        data = resp.json()
        expected_fields = {
            "id",
            "project_id",
            "filename",
            "original_path",
            "file_type",
            "file_size",
            "chunk_count",
            "tags",
            "indexed_at",
            "created_at",
        }
        assert expected_fields == set(data.keys())
