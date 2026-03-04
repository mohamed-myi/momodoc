"""Tests for file upload cleanup on errors (not just ValidationError)."""

import os

import pytest
from unittest.mock import AsyncMock, MagicMock

from app.core.exceptions import ValidationError


class TestUploadCleanupOnError:
    """Verify that partial files are cleaned up on ANY exception, not just ValidationError."""

    @pytest.mark.asyncio
    async def test_oversized_file_cleaned_up(self, tmp_path):
        """ValidationError from size limit should clean up the partial file."""
        from app.services.file_service import upload_and_ingest

        data = b"x" * (2 * 1024 * 1024)  # 2 MB
        offset = 0

        async def mock_read(size=-1):
            nonlocal offset
            if size == -1:
                chunk = data[offset:]
                offset = len(data)
            else:
                chunk = data[offset:offset + size]
                offset += size
            return chunk

        upload_file = MagicMock()
        upload_file.filename = "big.txt"
        upload_file.read = mock_read

        with pytest.raises(ValidationError, match="exceeds maximum upload size"):
            await upload_and_ingest(
                db=AsyncMock(),
                vectordb=MagicMock(),
                embedder=MagicMock(),
                project_id="test",
                upload_file=upload_file,
                upload_dir=str(tmp_path),
                max_upload_size_mb=1,
            )

        assert os.listdir(str(tmp_path)) == []

    @pytest.mark.asyncio
    async def test_ioerror_during_write_cleaned_up(self, tmp_path):
        """An IOError mid-write should also clean up the partial file."""
        from app.services.file_service import upload_and_ingest

        call_count = 0

        async def mock_read(size=-1):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return b"some data"
            # Simulate an IO error on second read
            raise IOError("disk full")

        upload_file = MagicMock()
        upload_file.filename = "fail.txt"
        upload_file.read = mock_read

        with pytest.raises(IOError, match="disk full"):
            await upload_and_ingest(
                db=AsyncMock(),
                vectordb=MagicMock(),
                embedder=MagicMock(),
                project_id="test",
                upload_file=upload_file,
                upload_dir=str(tmp_path),
                max_upload_size_mb=100,
            )

        # Partial file should be cleaned up
        assert os.listdir(str(tmp_path)) == []

    @pytest.mark.asyncio
    async def test_keyboard_interrupt_cleaned_up(self, tmp_path):
        """Even KeyboardInterrupt (BaseException) should clean up."""
        from app.services.file_service import upload_and_ingest

        call_count = 0

        async def mock_read(size=-1):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return b"partial"
            raise KeyboardInterrupt()

        upload_file = MagicMock()
        upload_file.filename = "interrupted.txt"
        upload_file.read = mock_read

        with pytest.raises(KeyboardInterrupt):
            await upload_and_ingest(
                db=AsyncMock(),
                vectordb=MagicMock(),
                embedder=MagicMock(),
                project_id="test",
                upload_file=upload_file,
                upload_dir=str(tmp_path),
                max_upload_size_mb=100,
            )

        assert os.listdir(str(tmp_path)) == []
