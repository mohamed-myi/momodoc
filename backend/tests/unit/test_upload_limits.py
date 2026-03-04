"""Tests for upload size enforcement (Issue #15)."""

import os

import pytest
from unittest.mock import AsyncMock, MagicMock

from app.core.exceptions import ValidationError


class TestUploadSizeLimits:
    """Tests for streaming upload size validation."""

    @pytest.mark.asyncio
    async def test_oversized_upload_rejected(self, tmp_path):
        """Files exceeding max_upload_size_mb should be rejected."""
        from app.services.file_service import upload_and_ingest

        # Create a mock UploadFile that returns 2 MB of data
        data = b"x" * (2 * 1024 * 1024)
        offset = 0

        async def mock_read(size=-1):
            nonlocal offset
            if size == -1:
                chunk = data[offset:]
                offset = len(data)
            else:
                chunk = data[offset : offset + size]
                offset += size
            return chunk

        upload_file = MagicMock()
        upload_file.filename = "large.txt"
        upload_file.read = mock_read

        db = AsyncMock()
        vectordb = MagicMock()
        embedder = MagicMock()

        with pytest.raises(ValidationError, match="exceeds maximum upload size"):
            await upload_and_ingest(
                db=db,
                vectordb=vectordb,
                embedder=embedder,
                project_id="test-project",
                upload_file=upload_file,
                upload_dir=str(tmp_path),
                max_upload_size_mb=1,  # 1 MB limit
            )

        # Verify partial file was cleaned up
        files = os.listdir(str(tmp_path))
        assert len(files) == 0, f"Partial file was not cleaned up: {files}"

    @pytest.mark.asyncio
    async def test_small_upload_succeeds(self, tmp_path):
        """Files within the limit should be accepted and written to disk."""
        from app.services.file_service import upload_and_ingest
        from app.services.ingestion.pipeline import IngestionResult

        data = b"small file content"
        offset = 0

        async def mock_read(size=-1):
            nonlocal offset
            if size == -1:
                chunk = data[offset:]
                offset = len(data)
            else:
                chunk = data[offset : offset + size]
                offset += size
            return chunk

        upload_file = MagicMock()
        upload_file.filename = "small.txt"
        upload_file.read = mock_read

        # Mock the pipeline to avoid actual ingestion
        mock_result = IngestionResult(file_id="test-id", filename="small.txt", chunks_created=1)

        db = AsyncMock()
        vectordb = MagicMock()
        embedder = MagicMock()

        with pytest.MonkeyPatch.context() as mp:
            mock_pipeline = MagicMock()
            mock_pipeline.ingest_file = AsyncMock(return_value=mock_result)

            from app.services.ingestion import pipeline

            def mock_init(self, *args, **kwargs):
                self.ingest_file = mock_pipeline.ingest_file

            mp.setattr(pipeline.IngestionPipeline, "__init__", mock_init)
            mp.setattr(pipeline.IngestionPipeline, "ingest_file", mock_pipeline.ingest_file)

            await upload_and_ingest(
                db=db,
                vectordb=vectordb,
                embedder=embedder,
                project_id="test-project",
                upload_file=upload_file,
                upload_dir=str(tmp_path),
                max_upload_size_mb=1,
            )

        # File should have been written to disk
        files = os.listdir(str(tmp_path))
        assert len(files) == 1
