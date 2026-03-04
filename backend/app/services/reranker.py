import asyncio
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

from sentence_transformers import CrossEncoder

from app.core.hardware import get_default_device, has_capable_gpu

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RerankerModelConfig:
    model_name: str
    device: str
    max_length: int


def _build_reranker_models() -> dict[str, RerankerModelConfig]:
    device = get_default_device()
    return {
        "cross-encoder/ms-marco-MiniLM-L-6-v2": RerankerModelConfig(
            model_name="cross-encoder/ms-marco-MiniLM-L-6-v2",
            device="cpu",
            max_length=512,
        ),
        "BAAI/bge-reranker-v2-m3": RerankerModelConfig(
            model_name="BAAI/bge-reranker-v2-m3",
            device=device,
            max_length=1024,
        ),
    }


RERANKER_MODELS: dict[str, RerankerModelConfig] = _build_reranker_models()


def get_default_reranker_model() -> str:
    if has_capable_gpu():
        return "BAAI/bge-reranker-v2-m3"
    return "cross-encoder/ms-marco-MiniLM-L-6-v2"


def resolve_reranker_config(
    model_name: str,
    device_override: str | None = None,
) -> RerankerModelConfig:
    base = RERANKER_MODELS.get(model_name)
    if base is None:
        logger.warning("Unknown reranker model '%s'; creating a default config", model_name)
        device = device_override or "cpu"
        return RerankerModelConfig(model_name=model_name, device=device, max_length=512)

    if device_override:
        return RerankerModelConfig(
            model_name=base.model_name,
            device=device_override,
            max_length=base.max_length,
        )
    return base


class Reranker:
    """Cross-encoder reranker with a dedicated thread pool for async use.

    Mirrors the Embedder pattern: instantiate once at startup, share via DI.
    """

    def __init__(
        self,
        model_name: str = "",
        device: str = "",
        max_workers: int = 2,
    ):
        if not model_name:
            model_name = get_default_reranker_model()

        self._config = resolve_reranker_config(model_name, device or None)

        effective_device = device if device else self._config.device
        self.model_name = model_name

        logger.info(
            "Loading reranker model: %s (device=%s, max_length=%d)",
            model_name,
            effective_device,
            self._config.max_length,
        )
        self._model = CrossEncoder(model_name, device=effective_device)
        self._model.max_length = self._config.max_length

        self._executor = ThreadPoolExecutor(
            max_workers=max_workers,
            thread_name_prefix="momodoc-reranker",
        )
        self._lock = threading.Lock()
        self._is_shutdown = False

    @property
    def config(self) -> RerankerModelConfig:
        return self._config

    @property
    def is_shutdown(self) -> bool:
        return self._is_shutdown

    async def _run_in_executor(self, fn, *args):
        with self._lock:
            if self._is_shutdown:
                raise RuntimeError("Reranker is unavailable during shutdown.")
            executor = self._executor

        loop = asyncio.get_running_loop()
        try:
            return await loop.run_in_executor(executor, fn, *args)
        except RuntimeError as e:
            if "cannot schedule new futures after shutdown" in str(e):
                raise RuntimeError("Reranker is unavailable during shutdown.") from e
            raise

    def rerank(self, query: str, documents: list[str], top_k: int = 10) -> list[tuple[int, float]]:
        """Score query-document pairs and return top_k as (original_index, score).

        Scores are normalized to 0..1 via sigmoid-style clamping so they can
        replace vector/hybrid scores in the result set.
        """
        if not documents:
            return []

        rankings = self._model.rank(query, documents, top_k=top_k)

        results: list[tuple[int, float]] = []
        for item in rankings:
            idx = int(item["corpus_id"])
            raw_score = float(item["score"])
            normalized = _sigmoid_normalize(raw_score)
            results.append((idx, normalized))

        results.sort(key=lambda x: x[1], reverse=True)
        return results[:top_k]

    async def arerank(
        self, query: str, documents: list[str], top_k: int = 10
    ) -> list[tuple[int, float]]:
        return await self._run_in_executor(self.rerank, query, documents, top_k)

    def shutdown(self) -> None:
        with self._lock:
            if self._is_shutdown:
                return
            self._is_shutdown = True
            executor = self._executor

        executor.shutdown(wait=True)
        logger.info("Reranker executor shutdown complete")


def _sigmoid_normalize(score: float) -> float:
    """Map raw cross-encoder logit to [0, 1] via sigmoid.

    Cross-encoders output unbounded logits; sigmoid gives a stable
    probability-like score that works as a drop-in for the 0..1 scores
    used throughout the retrieval pipeline.
    """
    import math

    return 1.0 / (1.0 + math.exp(-score))
