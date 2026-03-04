import asyncio
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Literal

from sentence_transformers import SentenceTransformer

from app.core.exceptions import EmbeddingServiceUnavailableError
from app.core.hardware import get_default_device

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class EmbeddingModelConfig:
    model_name: str
    default_dimension: int
    supported_dimensions: tuple[int, ...]
    query_prefix: str
    document_prefix: str
    device: str
    trust_remote_code: bool
    max_workers: int = 4


def _build_embedding_models() -> dict[str, EmbeddingModelConfig]:
    device = get_default_device()
    return {
        "nomic-ai/nomic-embed-text-v1.5": EmbeddingModelConfig(
            model_name="nomic-ai/nomic-embed-text-v1.5",
            default_dimension=768,
            supported_dimensions=(64, 128, 256, 512, 768),
            query_prefix="search_query: ",
            document_prefix="search_document: ",
            device=device,
            trust_remote_code=True,
        ),
        "Qwen/Qwen3-Embedding-4B": EmbeddingModelConfig(
            model_name="Qwen/Qwen3-Embedding-4B",
            default_dimension=2560,
            supported_dimensions=(768, 1024, 1536, 2048, 2560),
            query_prefix="Instruct: Retrieve relevant passages\nQuery: ",
            document_prefix="",
            device=device,
            trust_remote_code=True,
        ),
        "all-MiniLM-L6-v2": EmbeddingModelConfig(
            model_name="all-MiniLM-L6-v2",
            default_dimension=384,
            supported_dimensions=(384,),
            query_prefix="",
            document_prefix="",
            device="cpu",
            trust_remote_code=False,
        ),
    }


EMBEDDING_MODELS: dict[str, EmbeddingModelConfig] = _build_embedding_models()


def resolve_model_config(
    model_name: str,
    dimension_override: int | None = None,
    device_override: str | None = None,
) -> EmbeddingModelConfig:
    """Look up a model config and apply optional overrides."""
    base = EMBEDDING_MODELS.get(model_name)
    if base is None:
        logger.warning("Unknown embedding model '%s'; creating a default config", model_name)
        device = device_override or get_default_device()
        dim = dimension_override or 384
        return EmbeddingModelConfig(
            model_name=model_name,
            default_dimension=dim,
            supported_dimensions=(dim,),
            query_prefix="",
            document_prefix="",
            device=device,
            trust_remote_code=False,
        )

    overrides: dict = {}
    if dimension_override is not None:
        overrides["default_dimension"] = dimension_override
    if device_override:
        overrides["device"] = device_override

    if not overrides:
        return base

    return EmbeddingModelConfig(
        model_name=base.model_name,
        default_dimension=overrides.get("default_dimension", base.default_dimension),
        supported_dimensions=base.supported_dimensions,
        query_prefix=base.query_prefix,
        document_prefix=base.document_prefix,
        device=overrides.get("device", base.device),
        trust_remote_code=base.trust_remote_code,
        max_workers=base.max_workers,
    )


class Embedder:
    """Thin wrapper around a pre-loaded SentenceTransformer model.

    Instantiate once during application startup and share across requests
    via dependency injection.
    """

    def __init__(
        self,
        model_name: str = "all-MiniLM-L6-v2",
        max_workers: int = 4,
        dimension: int | None = None,
        device: str | None = None,
        trust_remote_code: bool | None = None,
    ):
        self._config = resolve_model_config(model_name, dimension, device or None)

        effective_device = device if device else self._config.device
        effective_trust = (
            trust_remote_code if trust_remote_code is not None else self._config.trust_remote_code
        )

        self.model = SentenceTransformer(
            model_name, device=effective_device, trust_remote_code=effective_trust
        )
        self.model_name = model_name
        self._max_workers = max_workers
        self._query_prefix = self._config.query_prefix
        self._document_prefix = self._config.document_prefix

        base = EMBEDDING_MODELS.get(model_name)
        native_dim = base.default_dimension if base else self._config.default_dimension
        effective_dim = dimension if dimension is not None else native_dim
        if effective_dim != native_dim and effective_dim in self._config.supported_dimensions:
            self.model.truncate_dim = effective_dim
            logger.info("Matryoshka truncation enabled: %s -> %d dims", model_name, effective_dim)

        self._executor = ThreadPoolExecutor(
            max_workers=max_workers,
            thread_name_prefix="momodoc-embedder",
        )
        self._lock = threading.Lock()
        self._is_shutdown = False

    @property
    def config(self) -> EmbeddingModelConfig:
        return self._config

    @property
    def is_shutdown(self) -> bool:
        return self._is_shutdown

    async def _run_in_executor(self, fn, *args):
        with self._lock:
            if self._is_shutdown:
                raise EmbeddingServiceUnavailableError(
                    "Embedding service is unavailable during shutdown."
                )
            executor = self._executor

        loop = asyncio.get_running_loop()
        try:
            return await loop.run_in_executor(executor, fn, *args)
        except RuntimeError as e:
            if "cannot schedule new futures after shutdown" in str(e):
                raise EmbeddingServiceUnavailableError(
                    "Embedding service is unavailable during shutdown."
                ) from e
            raise

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        embeddings = self.model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
        return embeddings.tolist()

    def embed_texts_for_storage(self, texts: list[str]) -> list[list[float]]:
        """Embed texts with the document prefix (for indexing/storage)."""
        if self._document_prefix:
            texts = [self._document_prefix + t for t in texts]
        return self.embed_texts(texts)

    def embed_texts_for_query(self, texts: list[str]) -> list[list[float]]:
        """Embed texts with the query prefix (for search/retrieval)."""
        if self._query_prefix:
            texts = [self._query_prefix + t for t in texts]
        return self.embed_texts(texts)

    def embed_single_query(self, text: str) -> list[float]:
        result = self.embed_texts_for_query([text])
        if not result:
            raise ValueError("Embedding model returned empty result for single text input")
        return result[0]

    def embed_single(self, text: str) -> list[float]:
        """Backward-compatible alias for embed_single_query."""
        return self.embed_single_query(text)

    async def aembed_texts(
        self,
        texts: list[str],
        batch_size: int = 512,
        mode: Literal["query", "document"] = "document",
    ) -> list[list[float]]:
        """Embed texts asynchronously, processing in sub-batches for memory safety.

        Args:
            texts: List of text strings to embed.
            batch_size: Maximum number of texts per sub-batch. Defaults to 512.
            mode: "document" prepends the document prefix, "query" prepends the query prefix.

        Returns:
            List of embedding vectors, one per input text.
        """
        if not texts:
            return []

        embed_fn = (
            self.embed_texts_for_storage if mode == "document" else self.embed_texts_for_query
        )

        if len(texts) <= batch_size:
            return await self._run_in_executor(embed_fn, texts)

        all_vectors: list[list[float]] = []
        for start in range(0, len(texts), batch_size):
            sub_batch = texts[start : start + batch_size]
            vectors = await self._run_in_executor(embed_fn, sub_batch)
            all_vectors.extend(vectors)
        return all_vectors

    async def aembed_single(self, text: str) -> list[float]:
        """Embed a single text for query/search (always uses query prefix)."""
        return await self._run_in_executor(self.embed_single_query, text)

    def shutdown(self) -> None:
        """Release thread pool and loky process pool resources."""
        with self._lock:
            if self._is_shutdown:
                return
            self._is_shutdown = True
            executor = self._executor

        executor.shutdown(wait=True)

        try:
            from loky import get_reusable_executor

            loky_executor = get_reusable_executor()
            loky_executor.shutdown(wait=True, kill_workers=True)
            logger.debug("Loky executor shutdown complete")
        except ImportError:
            logger.debug("loky is not installed; skipping reusable executor shutdown")
        except Exception as e:
            logger.warning("Failed to shutdown loky executor cleanly: %s", e)
