"""Tests for the Reranker service."""

import pytest
from unittest.mock import MagicMock, patch

from app.services.reranker import (
    Reranker,
    RerankerModelConfig,
    RERANKER_MODELS,
    get_default_reranker_model,
    resolve_reranker_config,
    _sigmoid_normalize,
)


class TestRerankerModelConfig:
    def test_frozen_dataclass(self):
        config = RerankerModelConfig(
            model_name="test-model", device="cpu", max_length=512
        )
        assert config.model_name == "test-model"
        assert config.device == "cpu"
        assert config.max_length == 512

    def test_registry_contains_expected_models(self):
        assert "cross-encoder/ms-marco-MiniLM-L-6-v2" in RERANKER_MODELS
        assert "BAAI/bge-reranker-v2-m3" in RERANKER_MODELS

    def test_minilm_config_uses_cpu(self):
        config = RERANKER_MODELS["cross-encoder/ms-marco-MiniLM-L-6-v2"]
        assert config.device == "cpu"
        assert config.max_length == 512

    def test_bge_config_max_length(self):
        config = RERANKER_MODELS["BAAI/bge-reranker-v2-m3"]
        assert config.max_length == 1024


class TestGetDefaultRerankerModel:
    @patch("app.services.reranker.has_capable_gpu", return_value=True)
    def test_returns_bge_with_gpu(self, _mock_gpu):
        assert get_default_reranker_model() == "BAAI/bge-reranker-v2-m3"

    @patch("app.services.reranker.has_capable_gpu", return_value=False)
    def test_returns_minilm_without_gpu(self, _mock_gpu):
        assert get_default_reranker_model() == "cross-encoder/ms-marco-MiniLM-L-6-v2"


class TestResolveRerankerConfig:
    def test_known_model_returns_config(self):
        config = resolve_reranker_config("cross-encoder/ms-marco-MiniLM-L-6-v2")
        assert config.model_name == "cross-encoder/ms-marco-MiniLM-L-6-v2"
        assert config.device == "cpu"

    def test_device_override_applied(self):
        config = resolve_reranker_config(
            "cross-encoder/ms-marco-MiniLM-L-6-v2", device_override="cuda"
        )
        assert config.device == "cuda"
        assert config.max_length == 512

    def test_unknown_model_returns_default(self):
        config = resolve_reranker_config("some/unknown-model")
        assert config.model_name == "some/unknown-model"
        assert config.device == "cpu"
        assert config.max_length == 512


class TestSigmoidNormalize:
    def test_zero_maps_to_half(self):
        assert _sigmoid_normalize(0.0) == pytest.approx(0.5)

    def test_large_positive_maps_near_one(self):
        assert _sigmoid_normalize(10.0) > 0.99

    def test_large_negative_maps_near_zero(self):
        assert _sigmoid_normalize(-10.0) < 0.01

    def test_monotonic(self):
        scores = [-5.0, -1.0, 0.0, 1.0, 5.0]
        normalized = [_sigmoid_normalize(s) for s in scores]
        assert normalized == sorted(normalized)


class TestReranker:
    @pytest.fixture
    def mock_cross_encoder(self):
        with patch("app.services.reranker.CrossEncoder") as mock_cls:
            instance = MagicMock()
            mock_cls.return_value = instance
            yield instance

    def test_rerank_returns_sorted_results(self, mock_cross_encoder):
        mock_cross_encoder.rank.return_value = [
            {"corpus_id": 1, "score": 2.5},
            {"corpus_id": 0, "score": 0.5},
            {"corpus_id": 2, "score": -1.0},
        ]

        reranker = Reranker("cross-encoder/ms-marco-MiniLM-L-6-v2")
        results = reranker.rerank(
            "what is auth?",
            ["auth doc", "unrelated doc", "another doc"],
            top_k=3,
        )

        assert len(results) == 3
        indices = [idx for idx, _ in results]
        assert indices[0] == 1
        assert indices[1] == 0

        for _, score in results:
            assert 0.0 <= score <= 1.0

    def test_rerank_top_k_truncates(self, mock_cross_encoder):
        mock_cross_encoder.rank.return_value = [
            {"corpus_id": 0, "score": 3.0},
            {"corpus_id": 1, "score": 2.0},
            {"corpus_id": 2, "score": 1.0},
        ]

        reranker = Reranker("cross-encoder/ms-marco-MiniLM-L-6-v2")
        results = reranker.rerank("query", ["a", "b", "c"], top_k=2)
        assert len(results) == 2

    def test_rerank_empty_documents(self, mock_cross_encoder):
        reranker = Reranker("cross-encoder/ms-marco-MiniLM-L-6-v2")
        results = reranker.rerank("query", [], top_k=5)
        assert results == []
        mock_cross_encoder.rank.assert_not_called()

    @pytest.mark.asyncio
    async def test_arerank_works_async(self, mock_cross_encoder):
        mock_cross_encoder.rank.return_value = [
            {"corpus_id": 0, "score": 1.5},
        ]

        reranker = Reranker("cross-encoder/ms-marco-MiniLM-L-6-v2")
        results = await reranker.arerank("query", ["doc"], top_k=1)
        assert len(results) == 1
        assert results[0][0] == 0

    def test_shutdown_releases_resources(self, mock_cross_encoder):
        reranker = Reranker("cross-encoder/ms-marco-MiniLM-L-6-v2")
        assert not reranker.is_shutdown
        reranker.shutdown()
        assert reranker.is_shutdown

    def test_double_shutdown_is_safe(self, mock_cross_encoder):
        reranker = Reranker("cross-encoder/ms-marco-MiniLM-L-6-v2")
        reranker.shutdown()
        reranker.shutdown()
        assert reranker.is_shutdown

    @pytest.mark.asyncio
    async def test_arerank_after_shutdown_raises(self, mock_cross_encoder):
        reranker = Reranker("cross-encoder/ms-marco-MiniLM-L-6-v2")
        reranker.shutdown()
        with pytest.raises(RuntimeError, match="shutdown"):
            await reranker.arerank("query", ["doc"])

    def test_auto_detect_model_when_empty(self, mock_cross_encoder):
        with patch(
            "app.services.reranker.get_default_reranker_model",
            return_value="cross-encoder/ms-marco-MiniLM-L-6-v2",
        ):
            reranker = Reranker()
            assert reranker.model_name == "cross-encoder/ms-marco-MiniLM-L-6-v2"

    def test_config_property(self, mock_cross_encoder):
        reranker = Reranker("cross-encoder/ms-marco-MiniLM-L-6-v2")
        config = reranker.config
        assert config.model_name == "cross-encoder/ms-marco-MiniLM-L-6-v2"
        assert config.device == "cpu"
