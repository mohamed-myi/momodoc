"""Hardware detection for GPU availability and capability.

Other components (embedder, reranker) query these helpers at startup
to select the optimal device and model variant.
"""

import logging
from typing import Any

logger = logging.getLogger(__name__)

_cached_gpu_info: dict[str, Any] | None = None


def detect_gpu() -> dict[str, Any]:
    """Return a dict describing the available GPU hardware.

    Keys: has_cuda, has_mps, device, gpu_name, vram_gb.
    Results are cached at module level (hardware does not change at runtime).
    """
    global _cached_gpu_info
    if _cached_gpu_info is not None:
        return _cached_gpu_info

    info: dict[str, Any] = {
        "has_cuda": False,
        "has_mps": False,
        "device": "cpu",
        "gpu_name": None,
        "vram_gb": None,
    }

    try:
        import torch

        if torch.cuda.is_available():
            info["has_cuda"] = True
            info["device"] = "cuda"
            try:
                info["gpu_name"] = torch.cuda.get_device_name(0)
                props = torch.cuda.get_device_properties(0)
                info["vram_gb"] = round(props.total_mem / (1024**3), 2)
            except Exception:
                logger.debug("Could not read CUDA device properties", exc_info=True)

        if not info["has_cuda"]:
            try:
                if torch.backends.mps.is_available():
                    info["has_mps"] = True
                    info["device"] = "mps"
            except AttributeError:
                pass

    except ImportError:
        logger.debug("torch is not installed; defaulting to CPU")
    except Exception:
        logger.debug("Unexpected error during GPU detection", exc_info=True)

    _cached_gpu_info = info
    return info


def get_default_device() -> str:
    """Return the optimal device string for embedding models.

    Prefers CUDA (with at least 4 GB VRAM), then MPS, then CPU.
    """
    info = detect_gpu()
    if info["has_cuda"]:
        vram = info.get("vram_gb")
        if vram is not None and vram >= 4.0:
            return "cuda"
    if info["has_mps"]:
        return "mps"
    return "cpu"


def has_capable_gpu() -> bool:
    """Return True when CUDA is available with at least 6 GB VRAM.

    This threshold is sufficient for large models like
    Qwen3-Embedding-4B and BGE-reranker-v2-m3.
    """
    info = detect_gpu()
    if not info["has_cuda"]:
        return False
    vram = info.get("vram_gb")
    return vram is not None and vram >= 6.0


def _reset_cache() -> None:
    """Clear the cached GPU info (used by tests)."""
    global _cached_gpu_info
    _cached_gpu_info = None
