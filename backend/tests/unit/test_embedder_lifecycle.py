"""Lifecycle tests for Embedder executor management."""

from unittest.mock import MagicMock, patch

import pytest

from app.core.exceptions import EmbeddingServiceUnavailableError
from app.services.ingestion.embedder import Embedder


class _FakeEmbeddings:
    def __init__(self, vectors):
        self._vectors = vectors

    def tolist(self):
        return self._vectors


@pytest.mark.asyncio
async def test_embedder_shutdown_is_idempotent():
    with patch("app.services.ingestion.embedder.SentenceTransformer") as mock_model_cls:
        model = MagicMock()
        model.encode.return_value = _FakeEmbeddings([[0.1] * 4])
        mock_model_cls.return_value = model

        embedder = Embedder("all-MiniLM-L6-v2", max_workers=1)
        embedder.shutdown()
        embedder.shutdown()


@pytest.mark.asyncio
async def test_embedder_rejects_requests_after_shutdown():
    with patch("app.services.ingestion.embedder.SentenceTransformer") as mock_model_cls:
        model = MagicMock()
        model.encode.return_value = _FakeEmbeddings([[0.1] * 4])
        mock_model_cls.return_value = model

        embedder = Embedder("all-MiniLM-L6-v2", max_workers=1)
        embedder.shutdown()

        with pytest.raises(EmbeddingServiceUnavailableError):
            await embedder.aembed_single("hello")
