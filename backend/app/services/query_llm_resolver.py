from __future__ import annotations

import asyncio
import logging
import time

import httpx

from app.config import Settings

TYPE_CHECKING = False
if TYPE_CHECKING:
    from app.llm.base import LLMProvider
    from app.llm.factory import ProviderRegistry

logger = logging.getLogger(__name__)

_CACHE_TTL_SECONDS = 60.0
_OLLAMA_PING_TIMEOUT = 2.0

_cache_lock = asyncio.Lock()
_cached_provider: LLMProvider | None = None
_cache_timestamp: float = 0.0


def _reset_cache() -> None:
    global _cached_provider, _cache_timestamp
    _cached_provider = None
    _cache_timestamp = 0.0


async def resolve_query_llm(
    provider_registry: ProviderRegistry,
    settings: Settings,
) -> LLMProvider | None:
    global _cached_provider, _cache_timestamp

    now = time.monotonic()
    if now - _cache_timestamp < _CACHE_TTL_SECONDS:
        return _cached_provider

    async with _cache_lock:
        if now - _cache_timestamp < _CACHE_TTL_SECONDS:
            return _cached_provider

        provider = await _resolve_uncached(provider_registry, settings)
        _cached_provider = provider
        _cache_timestamp = time.monotonic()
        return provider


async def _resolve_uncached(
    provider_registry: ProviderRegistry,
    settings: Settings,
) -> LLMProvider | None:
    from app.llm.factory import ALL_PROVIDERS, PROVIDER_OLLAMA

    default_name = settings.llm_provider
    if default_name != PROVIDER_OLLAMA:
        default = provider_registry.get(default_name)
        if default is not None:
            logger.debug("Query LLM resolved to default provider: %s", default_name)
            return default

    for name in ALL_PROVIDERS:
        if name == PROVIDER_OLLAMA:
            continue
        if name == default_name:
            continue
        candidate = provider_registry.get(name)
        if candidate is not None:
            logger.debug("Query LLM resolved to fallback provider: %s", name)
            return candidate

    ollama = provider_registry.get(PROVIDER_OLLAMA)
    if ollama is not None and await _ping_ollama(settings):
        logger.debug("Query LLM resolved to Ollama")
        return ollama

    logger.debug("No LLM available for query transformations")
    return None


async def _ping_ollama(settings: Settings) -> bool:
    if not settings.ollama_base_url.strip():
        return False
    base = settings.ollama_base_url.rstrip("/")
    if base.endswith("/v1"):
        base = base[:-3]
    url = f"{base}/api/tags"

    try:
        async with httpx.AsyncClient(timeout=_OLLAMA_PING_TIMEOUT) as client:
            resp = await client.get(url)
            return resp.status_code == 200
    except Exception:
        logger.debug("Ollama health check failed at %s", url)
        return False
