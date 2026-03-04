"""Integration tests for note endpoints and vectorization."""

import pytest


class TestNoteEndpoints:
    @pytest.mark.asyncio
    async def test_create_note(self, client, project_id):
        resp = await client.post(
            f"/api/v1/projects/{project_id}/notes",
            json={"content": "Test note content", "tags": "test,unit"},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["content"] == "Test note content"
        assert data["tags"] == "test,unit"
        assert "id" in data

    @pytest.mark.asyncio
    async def test_create_note_empty_content_rejected(self, client, project_id):
        """Empty content should be rejected by schema validation (min_length=1)."""
        resp = await client.post(
            f"/api/v1/projects/{project_id}/notes",
            json={"content": ""},
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_list_notes(self, client, project_id):
        await client.post(
            f"/api/v1/projects/{project_id}/notes",
            json={"content": "Note A"},
        )
        await client.post(
            f"/api/v1/projects/{project_id}/notes",
            json={"content": "Note B"},
        )
        resp = await client.get(f"/api/v1/projects/{project_id}/notes")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    @pytest.mark.asyncio
    async def test_update_note_content_triggers_reindex(self, client, project_id, mock_vectordb):
        """Updating content should delete old vectors and re-index."""
        create_resp = await client.post(
            f"/api/v1/projects/{project_id}/notes",
            json={"content": "Original content"},
        )
        note_id = create_resp.json()["id"]

        # Reset mock to track re-indexing calls
        mock_vectordb.delete.reset_mock()
        mock_vectordb.add.reset_mock()

        resp = await client.patch(
            f"/api/v1/projects/{project_id}/notes/{note_id}",
            json={"content": "Updated content"},
        )
        assert resp.status_code == 200
        assert resp.json()["content"] == "Updated content"

        # Should have deleted old vectors and added new ones
        mock_vectordb.delete.assert_called()
        mock_vectordb.add.assert_called()

    @pytest.mark.asyncio
    async def test_update_note_tags_only_no_reindex(self, client, project_id, mock_vectordb):
        """Updating only tags (not content) should NOT re-index vectors."""
        create_resp = await client.post(
            f"/api/v1/projects/{project_id}/notes",
            json={"content": "Some content", "tags": "old"},
        )
        note_id = create_resp.json()["id"]

        mock_vectordb.delete.reset_mock()
        mock_vectordb.add.reset_mock()

        resp = await client.patch(
            f"/api/v1/projects/{project_id}/notes/{note_id}",
            json={"tags": "new,updated"},
        )
        assert resp.status_code == 200
        assert resp.json()["tags"] == "new,updated"

        # Should NOT have re-indexed
        mock_vectordb.delete.assert_not_called()

    @pytest.mark.asyncio
    async def test_delete_note(self, client, project_id, mock_vectordb):
        create_resp = await client.post(
            f"/api/v1/projects/{project_id}/notes",
            json={"content": "To be deleted"},
        )
        note_id = create_resp.json()["id"]

        mock_vectordb.delete.reset_mock()

        resp = await client.delete(
            f"/api/v1/projects/{project_id}/notes/{note_id}"
        )
        assert resp.status_code == 204

        # Vectors should be cleaned up
        mock_vectordb.delete.assert_called()

        # Note should be gone
        resp = await client.get(f"/api/v1/projects/{project_id}/notes")
        assert len(resp.json()) == 0

    @pytest.mark.asyncio
    async def test_delete_nonexistent_note_404(self, client, project_id):
        resp = await client.delete(
            f"/api/v1/projects/{project_id}/notes/nonexistent-id"
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_note_in_wrong_project_404(self, client, project_id):
        """A note belonging to another project should not be accessible."""
        create_resp = await client.post(
            f"/api/v1/projects/{project_id}/notes",
            json={"content": "Owned by project A"},
        )
        note_id = create_resp.json()["id"]

        # Create a second project
        resp2 = await client.post("/api/v1/projects", json={"name": "other-proj"})
        other_id = resp2.json()["id"]

        # Try to access the note via the wrong project
        resp = await client.delete(
            f"/api/v1/projects/{other_id}/notes/{note_id}"
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_create_note_without_tags(self, client, project_id):
        """Creating a note without tags should succeed with tags=None."""
        resp = await client.post(
            f"/api/v1/projects/{project_id}/notes",
            json={"content": "No tags note"},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["tags"] is None

    @pytest.mark.asyncio
    async def test_create_note_calls_vectordb_add(self, client, project_id, mock_vectordb):
        """Creating a note should trigger vectordb.add with records containing correct fields."""
        mock_vectordb.add.reset_mock()
        resp = await client.post(
            f"/api/v1/projects/{project_id}/notes",
            json={"content": "Vectorize me", "tags": "test"},
        )
        assert resp.status_code == 201
        mock_vectordb.add.assert_called_once()

        records = mock_vectordb.add.call_args[0][0]
        assert len(records) >= 1
        rec = records[0]
        assert rec["source_type"] == "note"
        assert rec["project_id"] == project_id
        assert rec["chunk_text"]  # non-empty

    @pytest.mark.asyncio
    async def test_get_single_note(self, client, project_id):
        """GET /projects/{id}/notes/{note_id} should return the specific note."""
        create_resp = await client.post(
            f"/api/v1/projects/{project_id}/notes",
            json={"content": "Single note lookup"},
        )
        note_id = create_resp.json()["id"]

        resp = await client.get(f"/api/v1/projects/{project_id}/notes/{note_id}")
        assert resp.status_code == 200
        assert resp.json()["id"] == note_id
        assert resp.json()["content"] == "Single note lookup"

    @pytest.mark.asyncio
    async def test_get_nonexistent_note_404(self, client, project_id):
        """Getting a nonexistent note should return 404."""
        resp = await client.get(
            f"/api/v1/projects/{project_id}/notes/nonexistent-id"
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_create_note_chunk_count_set(self, client, project_id):
        """Created note should have a positive chunk_count after vectorization."""
        resp = await client.post(
            f"/api/v1/projects/{project_id}/notes",
            json={"content": "Content for counting chunks"},
        )
        assert resp.status_code == 201
        assert resp.json()["chunk_count"] >= 1

    @pytest.mark.asyncio
    async def test_list_notes_pagination(self, client, project_id):
        """List notes should respect offset and limit parameters."""
        for i in range(5):
            await client.post(
                f"/api/v1/projects/{project_id}/notes",
                json={"content": f"Note {i}"},
            )

        resp = await client.get(
            f"/api/v1/projects/{project_id}/notes?offset=2&limit=2"
        )
        assert resp.status_code == 200
        assert len(resp.json()) == 2
