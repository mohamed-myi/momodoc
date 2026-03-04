"""Unit tests for the embedding model registry and prefix support."""

from unittest.mock import MagicMock, patch

from app.services.ingestion.embedder import (
    EMBEDDING_MODELS,
    resolve_model_config,
)


class _FakeEmbeddings:
    def __init__(self, vectors):
        self._vectors = vectors

    def tolist(self):
        return self._vectors


class TestEmbeddingModelRegistry:
    def test_nomic_model_present(self):
        assert "nomic-ai/nomic-embed-text-v1.5" in EMBEDDING_MODELS

    def test_qwen_model_present(self):
        assert "Qwen/Qwen3-Embedding-4B" in EMBEDDING_MODELS

    def test_minilm_legacy_model_present(self):
        assert "all-MiniLM-L6-v2" in EMBEDDING_MODELS

    def test_nomic_config_values(self):
        cfg = EMBEDDING_MODELS["nomic-ai/nomic-embed-text-v1.5"]
        assert cfg.default_dimension == 768
        assert cfg.query_prefix == "search_query: "
        assert cfg.document_prefix == "search_document: "
        assert cfg.trust_remote_code is True
        assert 768 in cfg.supported_dimensions

    def test_minilm_config_values(self):
        cfg = EMBEDDING_MODELS["all-MiniLM-L6-v2"]
        assert cfg.default_dimension == 384
        assert cfg.query_prefix == ""
        assert cfg.document_prefix == ""
        assert cfg.trust_remote_code is False
        assert cfg.device == "cpu"

    def test_qwen_config_values(self):
        cfg = EMBEDDING_MODELS["Qwen/Qwen3-Embedding-4B"]
        assert cfg.default_dimension == 2560
        assert "Instruct:" in cfg.query_prefix
        assert cfg.document_prefix == ""
        assert cfg.trust_remote_code is True


class TestResolveModelConfig:
    def test_known_model_returns_base_config(self):
        cfg = resolve_model_config("all-MiniLM-L6-v2")
        assert cfg.model_name == "all-MiniLM-L6-v2"
        assert cfg.default_dimension == 384

    def test_dimension_override(self):
        cfg = resolve_model_config("nomic-ai/nomic-embed-text-v1.5", dimension_override=256)
        assert cfg.default_dimension == 256
        assert cfg.query_prefix == "search_query: "

    def test_device_override(self):
        cfg = resolve_model_config("nomic-ai/nomic-embed-text-v1.5", device_override="cuda")
        assert cfg.device == "cuda"

    def test_unknown_model_creates_default_config(self):
        cfg = resolve_model_config("custom/my-model")
        assert cfg.model_name == "custom/my-model"
        assert cfg.query_prefix == ""
        assert cfg.document_prefix == ""
        assert cfg.trust_remote_code is False

    def test_unknown_model_with_overrides(self):
        cfg = resolve_model_config("custom/my-model", dimension_override=512, device_override="mps")
        assert cfg.default_dimension == 512
        assert cfg.device == "mps"


class TestEmbedderPrefixPrepending:
    """Test that embed_texts_for_storage and embed_texts_for_query prepend correctly."""

    @patch("app.services.ingestion.embedder.SentenceTransformer")
    def test_storage_prepends_document_prefix_for_nomic(self, mock_st_cls):
        from app.services.ingestion.embedder import Embedder

        model = MagicMock()
        model.encode.return_value = _FakeEmbeddings([[0.1] * 768])
        mock_st_cls.return_value = model

        embedder = Embedder("nomic-ai/nomic-embed-text-v1.5")
        embedder.embed_texts_for_storage(["hello world"])

        call_args = model.encode.call_args
        assert call_args[0][0] == ["search_document: hello world"]

    @patch("app.services.ingestion.embedder.SentenceTransformer")
    def test_query_prepends_query_prefix_for_nomic(self, mock_st_cls):
        from app.services.ingestion.embedder import Embedder

        model = MagicMock()
        model.encode.return_value = _FakeEmbeddings([[0.1] * 768])
        mock_st_cls.return_value = model

        embedder = Embedder("nomic-ai/nomic-embed-text-v1.5")
        embedder.embed_texts_for_query(["hello world"])

        call_args = model.encode.call_args
        assert call_args[0][0] == ["search_query: hello world"]

    @patch("app.services.ingestion.embedder.SentenceTransformer")
    def test_minilm_has_no_prefixes(self, mock_st_cls):
        from app.services.ingestion.embedder import Embedder

        model = MagicMock()
        model.encode.return_value = _FakeEmbeddings([[0.1] * 384])
        mock_st_cls.return_value = model

        embedder = Embedder("all-MiniLM-L6-v2")
        embedder.embed_texts_for_storage(["hello"])

        call_args = model.encode.call_args
        assert call_args[0][0] == ["hello"]

        embedder.embed_texts_for_query(["hello"])
        call_args = model.encode.call_args
        assert call_args[0][0] == ["hello"]

    @patch("app.services.ingestion.embedder.SentenceTransformer")
    def test_embed_single_query_uses_query_prefix(self, mock_st_cls):
        from app.services.ingestion.embedder import Embedder

        model = MagicMock()
        model.encode.return_value = _FakeEmbeddings([[0.1] * 768])
        mock_st_cls.return_value = model

        embedder = Embedder("nomic-ai/nomic-embed-text-v1.5")
        embedder.embed_single_query("hello")

        call_args = model.encode.call_args
        assert call_args[0][0] == ["search_query: hello"]

    @patch("app.services.ingestion.embedder.SentenceTransformer")
    def test_embed_single_backward_compat_alias(self, mock_st_cls):
        from app.services.ingestion.embedder import Embedder

        model = MagicMock()
        model.encode.return_value = _FakeEmbeddings([[0.1] * 768])
        mock_st_cls.return_value = model

        embedder = Embedder("nomic-ai/nomic-embed-text-v1.5")
        result = embedder.embed_single("hello")
        assert result == [0.1] * 768


class TestEmbedderMatryoshkaTruncation:
    @patch("app.services.ingestion.embedder.SentenceTransformer")
    def test_truncation_applied_for_supported_dimension(self, mock_st_cls):
        model = MagicMock()
        model.encode.return_value = _FakeEmbeddings([[0.1] * 256])
        mock_st_cls.return_value = model

        from app.services.ingestion.embedder import Embedder

        Embedder("nomic-ai/nomic-embed-text-v1.5", dimension=256)

        assert model.truncate_dim == 256

    @patch("app.services.ingestion.embedder.SentenceTransformer")
    def test_no_truncation_at_default_dimension(self, mock_st_cls):
        model = MagicMock()
        del model.truncate_dim
        model.encode.return_value = _FakeEmbeddings([[0.1] * 768])
        mock_st_cls.return_value = model

        from app.services.ingestion.embedder import Embedder

        Embedder("nomic-ai/nomic-embed-text-v1.5", dimension=768)

        assert not hasattr(model, "truncate_dim")
