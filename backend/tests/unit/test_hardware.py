"""Unit tests for GPU detection utilities in core.hardware."""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.core.hardware import (
    _reset_cache,
    detect_gpu,
    get_default_device,
    has_capable_gpu,
)


@pytest.fixture(autouse=True)
def clear_gpu_cache():
    """Ensure each test starts with a fresh cache."""
    _reset_cache()
    yield
    _reset_cache()


class TestDetectGpu:
    def test_cpu_fallback_when_torch_missing(self):
        with patch.dict("sys.modules", {"torch": None}):
            _reset_cache()
            info = detect_gpu()

        assert info["has_cuda"] is False
        assert info["has_mps"] is False
        assert info["device"] == "cpu"
        assert info["gpu_name"] is None
        assert info["vram_gb"] is None

    def test_cpu_fallback_when_no_gpu(self):
        mock_torch = MagicMock()
        mock_torch.cuda.is_available.return_value = False
        mock_torch.backends.mps.is_available.return_value = False

        with patch.dict("sys.modules", {"torch": mock_torch}):
            _reset_cache()
            info = detect_gpu()

        assert info["has_cuda"] is False
        assert info["has_mps"] is False
        assert info["device"] == "cpu"

    def test_mps_detected(self):
        mock_torch = MagicMock()
        mock_torch.cuda.is_available.return_value = False
        mock_torch.backends.mps.is_available.return_value = True

        with patch.dict("sys.modules", {"torch": mock_torch}):
            _reset_cache()
            info = detect_gpu()

        assert info["has_cuda"] is False
        assert info["has_mps"] is True
        assert info["device"] == "mps"

    def test_cuda_detected_with_vram(self):
        mock_torch = MagicMock()
        mock_torch.cuda.is_available.return_value = True
        mock_torch.cuda.get_device_name.return_value = "NVIDIA RTX 4090"
        mock_torch.cuda.get_device_properties.return_value = SimpleNamespace(
            total_mem=int(24 * 1024**3)
        )

        with patch.dict("sys.modules", {"torch": mock_torch}):
            _reset_cache()
            info = detect_gpu()

        assert info["has_cuda"] is True
        assert info["device"] == "cuda"
        assert info["gpu_name"] == "NVIDIA RTX 4090"
        assert info["vram_gb"] == 24.0

    def test_result_is_cached(self):
        mock_torch = MagicMock()
        mock_torch.cuda.is_available.return_value = False
        mock_torch.backends.mps.is_available.return_value = False

        with patch.dict("sys.modules", {"torch": mock_torch}):
            _reset_cache()
            first = detect_gpu()
            second = detect_gpu()

        assert first is second


class TestGetDefaultDevice:
    def test_returns_cuda_with_sufficient_vram(self):
        with patch(
            "app.core.hardware.detect_gpu",
            return_value={"has_cuda": True, "has_mps": False, "device": "cuda", "vram_gb": 8.0},
        ):
            assert get_default_device() == "cuda"

    def test_returns_cpu_when_cuda_vram_insufficient(self):
        with patch(
            "app.core.hardware.detect_gpu",
            return_value={"has_cuda": True, "has_mps": False, "device": "cuda", "vram_gb": 2.0},
        ):
            assert get_default_device() == "cpu"

    def test_returns_mps_when_no_cuda(self):
        with patch(
            "app.core.hardware.detect_gpu",
            return_value={"has_cuda": False, "has_mps": True, "device": "mps", "vram_gb": None},
        ):
            assert get_default_device() == "mps"

    def test_returns_cpu_as_last_resort(self):
        with patch(
            "app.core.hardware.detect_gpu",
            return_value={
                "has_cuda": False,
                "has_mps": False,
                "device": "cpu",
                "vram_gb": None,
            },
        ):
            assert get_default_device() == "cpu"


class TestHasCapableGpu:
    def test_true_with_enough_vram(self):
        with patch(
            "app.core.hardware.detect_gpu",
            return_value={"has_cuda": True, "vram_gb": 8.0},
        ):
            assert has_capable_gpu() is True

    def test_false_with_insufficient_vram(self):
        with patch(
            "app.core.hardware.detect_gpu",
            return_value={"has_cuda": True, "vram_gb": 4.0},
        ):
            assert has_capable_gpu() is False

    def test_false_without_cuda(self):
        with patch(
            "app.core.hardware.detect_gpu",
            return_value={"has_cuda": False, "vram_gb": None},
        ):
            assert has_capable_gpu() is False

    def test_false_when_vram_is_none(self):
        with patch(
            "app.core.hardware.detect_gpu",
            return_value={"has_cuda": True, "vram_gb": None},
        ):
            assert has_capable_gpu() is False
