"""Integration tests for project deletion cascading behavior."""

import pytest


@pytest.fixture
async def project_with_data(client, mock_vectordb):
    """Create a project with notes and return (project_id, note_ids)."""
    resp = await client.post("/api/v1/projects", json={"name": "cascade-proj"})
    project_id = resp.json()["id"]

    note_ids = []
    for content in ["Note one", "Note two"]:
        resp = await client.post(
            f"/api/v1/projects/{project_id}/notes",
            json={"content": content},
        )
        note_ids.append(resp.json()["id"])

    return project_id, note_ids


class TestProjectCascadeDelete:
    @pytest.mark.asyncio
    async def test_delete_project_cleans_up_vectors(self, client, project_with_data, mock_vectordb):
        """Deleting a project should call vectordb.delete with the project filter."""
        project_id, _ = project_with_data
        mock_vectordb.delete.reset_mock()

        resp = await client.delete(f"/api/v1/projects/{project_id}")
        assert resp.status_code == 204

        # Should have deleted vectors for this project
        mock_vectordb.delete.assert_called_once()
        filter_arg = mock_vectordb.delete.call_args[0][0]
        assert f"project_id = '{project_id}'" == filter_arg

    @pytest.mark.asyncio
    async def test_delete_project_cascades_notes(self, client, project_with_data):
        """After project deletion, its notes should be gone too (SQL cascade)."""
        project_id, _ = project_with_data

        await client.delete(f"/api/v1/projects/{project_id}")

        # Trying to list notes for the deleted project should 404 (project gone)
        resp = await client.get(f"/api/v1/projects/{project_id}/notes")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_project_cascades_chat_sessions(self, client):
        """Chat sessions belonging to a deleted project should be gone."""
        resp = await client.post("/api/v1/projects", json={"name": "chat-cascade"})
        project_id = resp.json()["id"]

        # Create a chat session
        await client.post(f"/api/v1/projects/{project_id}/chat/sessions")

        # Delete the project
        await client.delete(f"/api/v1/projects/{project_id}")

        # Project is gone — sessions are unreachable
        resp = await client.get(f"/api/v1/projects/{project_id}/chat/sessions")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_project_cascades_issues(self, client):
        """Issues belonging to a deleted project should be gone (SQL cascade)."""
        resp = await client.post("/api/v1/projects", json={"name": "issue-cascade"})
        project_id = resp.json()["id"]

        # Create some issues
        for title in ["Issue A", "Issue B", "Issue C"]:
            await client.post(
                f"/api/v1/projects/{project_id}/issues",
                json={"title": title},
            )

        # Verify they exist
        resp = await client.get(f"/api/v1/projects/{project_id}/issues")
        assert resp.status_code == 200
        assert len(resp.json()) == 3

        # Delete the project
        resp = await client.delete(f"/api/v1/projects/{project_id}")
        assert resp.status_code == 204

        # Trying to list issues for the deleted project should 404 (project gone)
        resp = await client.get(f"/api/v1/projects/{project_id}/issues")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_project_cascades_files(self, client, db_session):
        """Files belonging to a deleted project should be gone (SQL cascade)."""
        import uuid
        from app.models.file import File

        resp = await client.post("/api/v1/projects", json={"name": "file-cascade"})
        project_id = resp.json()["id"]

        # Insert a file record directly (no real ingestion)
        file = File(
            id=str(uuid.uuid4()),
            project_id=project_id,
            filename="cascade-test.txt",
            storage_path="/tmp/cascade-test.txt",
            file_type="txt",
            file_size=100,
            chunk_count=1,
            checksum="cascade-check",
            is_managed=False,
        )
        db_session.add(file)
        await db_session.commit()

        # Verify file exists
        resp = await client.get(f"/api/v1/projects/{project_id}/files")
        assert resp.status_code == 200
        assert len(resp.json()) == 1

        # Delete project
        resp = await client.delete(f"/api/v1/projects/{project_id}")
        assert resp.status_code == 204

        # Files should be gone (project 404)
        resp = await client.get(f"/api/v1/projects/{project_id}/files")
        assert resp.status_code == 404
