import logging
from functools import lru_cache

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.core import database as db_module
from app.core.exceptions import LLMNotConfiguredError
from app.core.async_vectordb import AsyncVectorStore
from app.core.job_tracker import JobTracker
from app.core.rate_limiter import ChatRateLimiter
from app.core.settings_store import SettingsStore
from app.core.ws_manager import WSManager
from app.llm.base import LLMProvider
from app.llm.factory import ProviderRegistry
from app.services.ingestion.embedder import Embedder
from app.services.reranker import Reranker

logger = logging.getLogger(__name__)


@lru_cache
def get_settings() -> Settings:
    return Settings()


async def get_db():
    if db_module.async_session_factory is None:
        raise RuntimeError("Database not initialized — is the server still starting up?")
    async with db_module.async_session_factory() as session:
        yield session


def _get_app_state_attr(
    request: Request,
    attr_name: str,
    *,
    display_name: str | None = None,
    error_message: str | None = None,
    exception_factory=None,
):
    value = getattr(request.app.state, attr_name, None)
    if value is not None:
        return value
    if exception_factory is not None:
        raise exception_factory()
    if error_message is None:
        label = display_name or attr_name
        error_message = f"{label} not initialized — is the server still starting up?"
    raise RuntimeError(error_message)


def get_embedder(request: Request) -> Embedder:
    return _get_app_state_attr(
        request,
        "embedder",
        error_message="Embedder is still loading. Please wait a moment and try again.",
    )


def get_llm_provider(request: Request) -> LLMProvider:
    return _get_app_state_attr(
        request,
        "llm_provider",
        exception_factory=LLMNotConfiguredError,
    )


def get_provider_registry(request: Request) -> ProviderRegistry:
    return _get_app_state_attr(
        request,
        "provider_registry",
        display_name="ProviderRegistry",
    )


def get_settings_store(request: Request) -> SettingsStore:
    return _get_app_state_attr(
        request,
        "settings_store",
        display_name="SettingsStore",
    )


def resolve_llm_provider(
    llm_mode: str | None, registry: ProviderRegistry, fallback: LLMProvider | None
) -> LLMProvider:
    """Resolve an LLM provider from the per-request llm_mode or fall back to default.

    Raises LLMNotConfiguredError if no provider can be resolved.
    """
    if llm_mode:
        provider = registry.get(llm_mode)
        if provider is None:
            raise LLMNotConfiguredError()
        return provider
    if fallback is None:
        raise LLMNotConfiguredError()
    return fallback


def get_job_tracker(request: Request) -> JobTracker:
    return _get_app_state_attr(
        request,
        "job_tracker",
        display_name="JobTracker",
    )


def get_ws_manager(request: Request) -> WSManager:
    return _get_app_state_attr(
        request,
        "ws_manager",
        display_name="WSManager",
    )


def get_file_watcher(request: Request):
    return _get_app_state_attr(
        request,
        "file_watcher",
        display_name="FileWatcher",
    )


def get_reranker(request: Request) -> Reranker | None:
    """Return the reranker if loaded, or None if disabled / still loading."""
    return getattr(request.app.state, "reranker", None)


async def get_query_llm(
    request: Request,
    settings: Settings = Depends(get_settings),
) -> LLMProvider | None:
    """Resolve an LLM for query-time transformations (HyDE, decomposition).

    Returns None when no provider is available, which disables query
    transformations and falls back to plain retrieval.
    """
    registry = getattr(request.app.state, "provider_registry", None)
    if registry is None:
        return None

    from app.services.query_llm_resolver import resolve_query_llm

    return await resolve_query_llm(registry, settings)


def get_vectordb(request: Request) -> AsyncVectorStore:
    return _get_app_state_attr(
        request,
        "vectordb",
        display_name="VectorStore",
    )


def get_chat_rate_limiter(
    request: Request,
    settings: Settings = Depends(get_settings),
) -> ChatRateLimiter:
    limiter = getattr(request.app.state, "chat_rate_limiter", None)
    if limiter is None:
        limiter = ChatRateLimiter(settings)
        request.app.state.chat_rate_limiter = limiter
    return limiter


async def enforce_chat_message_rate_limit(
    request: Request,
    limiter: ChatRateLimiter = Depends(get_chat_rate_limiter),
) -> None:
    await limiter.enforce_message(request)


async def enforce_chat_stream_rate_limit(
    request: Request,
    limiter: ChatRateLimiter = Depends(get_chat_rate_limiter),
) -> None:
    await limiter.enforce_stream(request)


async def get_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Reusable dependency: resolves project_id (UUID or name) or raises 404."""
    from app.services.project_service import resolve_project_or_404

    return await resolve_project_or_404(db, project_id)
