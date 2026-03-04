"""Integration tests for file-content chunk endpoints."""

import pytest

from app.models.file import File


@pytest.fixture
async def file_record(db_session, project_id):
    file = File(
        project_id=project_id,
        filename="doc.md",
        original_path="/tmp/doc.md",
        storage_path="/tmp/doc.md",
        file_type="md",
        file_size=123,
        checksum="checksum-1",
        chunk_count=123,
    )
    db_session.add(file)
    await db_session.commit()
    await db_session.refresh(file)
    return file


class TestFileChunksEndpoint:
    @pytest.mark.asyncio
    async def test_chunks_uses_range_filter_and_returns_file_chunk_count(
        self, client, mock_vectordb, project_id, file_record
    ):
        mock_vectordb.get_by_filter.return_value = [
            {"id": "c2", "chunk_index": 12, "chunk_text": "two"},
            {"id": "c1", "chunk_index": 11, "chunk_text": "one"},
        ]

        resp = await client.get(
            f"/api/v1/projects/{project_id}/files/{file_record.id}/chunks",
            params={"offset": 10, "limit": 2},
        )
        assert resp.status_code == 200

        body = resp.json()
        assert body["total"] == 123
        assert [chunk["chunk_index"] for chunk in body["chunks"]] == [11, 12]

        call_args = mock_vectordb.get_by_filter.call_args
        assert f"source_id = '{file_record.id}'" in call_args.args[0]
        assert "chunk_index >= 10" in call_args.args[0]
        assert "chunk_index < 12" in call_args.args[0]
        assert call_args.args[2] == 2

    @pytest.mark.asyncio
    async def test_chunks_unknown_file_returns_404(self, client, project_id):
        resp = await client.get(
            f"/api/v1/projects/{project_id}/files/00000000-0000-0000-0000-000000000000/chunks"
        )
        assert resp.status_code == 404
