"""Tests for the query LLM resolver with graceful degradation and TTL caching."""

import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.config import Settings
from app.llm.base import LLMProvider
from app.services.query_llm_resolver import (
    _CACHE_TTL_SECONDS,
    _reset_cache,
    resolve_query_llm,
)


@pytest.fixture(autouse=True)
def reset_resolver_cache():
    """Ensure each test starts with a clean resolver cache."""
    _reset_cache()
    yield
    _reset_cache()


def _make_settings(**overrides) -> Settings:
    defaults = {
        "database_url": "sqlite+aiosqlite:///:memory:",
        "momodoc_data_dir": "/tmp/momodoc-test",
        "llm_provider": "claude",
        "anthropic_api_key": "",
        "openai_api_key": "",
        "google_api_key": "",
        "ollama_base_url": "http://localhost:11434/v1",
    }
    defaults.update(overrides)
    return Settings(**defaults)


def _make_registry(provider_map: dict[str, LLMProvider | None]) -> MagicMock:
    registry = MagicMock()
    registry.get.side_effect = lambda name: provider_map.get(name)
    return registry


class TestResolveQueryLlm:
    @pytest.mark.asyncio
    async def test_returns_default_provider_when_available(self):
        mock_provider = AsyncMock(spec=LLMProvider)
        registry = _make_registry({"claude": mock_provider})
        settings = _make_settings(llm_provider="claude", anthropic_api_key="sk-test")

        result = await resolve_query_llm(registry, settings)
        assert result is mock_provider

    @pytest.mark.asyncio
    async def test_skips_ollama_default_checks_other_providers(self):
        mock_openai = AsyncMock(spec=LLMProvider)
        registry = _make_registry(
            {
                "ollama": AsyncMock(spec=LLMProvider),
                "claude": None,
                "openai": mock_openai,
                "gemini": None,
            }
        )
        settings = _make_settings(llm_provider="ollama")

        result = await resolve_query_llm(registry, settings)
        assert result is mock_openai

    @pytest.mark.asyncio
    async def test_falls_back_to_non_default_provider(self):
        mock_gemini = AsyncMock(spec=LLMProvider)
        registry = _make_registry(
            {
                "claude": None,
                "openai": None,
                "gemini": mock_gemini,
                "ollama": AsyncMock(spec=LLMProvider),
            }
        )
        settings = _make_settings(llm_provider="claude")

        result = await resolve_query_llm(registry, settings)
        assert result is mock_gemini

    @pytest.mark.asyncio
    async def test_falls_back_to_ollama_when_reachable(self):
        mock_ollama = AsyncMock(spec=LLMProvider)
        registry = _make_registry(
            {
                "claude": None,
                "openai": None,
                "gemini": None,
                "ollama": mock_ollama,
            }
        )
        settings = _make_settings(llm_provider="claude")

        with patch(
            "app.services.query_llm_resolver._ping_ollama",
            new_callable=AsyncMock,
            return_value=True,
        ):
            result = await resolve_query_llm(registry, settings)
        assert result is mock_ollama

    @pytest.mark.asyncio
    async def test_returns_none_when_ollama_unreachable(self):
        registry = _make_registry(
            {
                "claude": None,
                "openai": None,
                "gemini": None,
                "ollama": AsyncMock(spec=LLMProvider),
            }
        )
        settings = _make_settings(llm_provider="claude")

        with patch(
            "app.services.query_llm_resolver._ping_ollama",
            new_callable=AsyncMock,
            return_value=False,
        ):
            result = await resolve_query_llm(registry, settings)
        assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_when_nothing_available(self):
        registry = _make_registry(
            {
                "claude": None,
                "openai": None,
                "gemini": None,
                "ollama": None,
            }
        )
        settings = _make_settings(llm_provider="claude")
        result = await resolve_query_llm(registry, settings)
        assert result is None


class TestTtlCaching:
    @pytest.mark.asyncio
    async def test_caches_result_within_ttl(self):
        mock_provider = AsyncMock(spec=LLMProvider)
        registry = _make_registry({"claude": mock_provider})
        settings = _make_settings(llm_provider="claude", anthropic_api_key="sk-test")

        result1 = await resolve_query_llm(registry, settings)
        result2 = await resolve_query_llm(registry, settings)
        assert result1 is result2
        assert registry.get.call_count == 1

    @pytest.mark.asyncio
    async def test_cache_expires_after_ttl(self):
        mock_provider = AsyncMock(spec=LLMProvider)
        registry = _make_registry({"claude": mock_provider})
        settings = _make_settings(llm_provider="claude", anthropic_api_key="sk-test")

        await resolve_query_llm(registry, settings)

        import app.services.query_llm_resolver as mod

        mod._cache_timestamp = time.monotonic() - _CACHE_TTL_SECONDS - 1

        await resolve_query_llm(registry, settings)
        assert registry.get.call_count == 2

    @pytest.mark.asyncio
    async def test_caches_none_result(self):
        registry = _make_registry(
            {
                "claude": None,
                "openai": None,
                "gemini": None,
                "ollama": None,
            }
        )
        settings = _make_settings(llm_provider="claude")

        result1 = await resolve_query_llm(registry, settings)
        result2 = await resolve_query_llm(registry, settings)
        assert result1 is None
        assert result2 is None
        assert registry.get.call_count <= 4


class TestPingOllama:
    @pytest.mark.asyncio
    async def test_ping_strips_v1_suffix(self):
        settings = _make_settings(ollama_base_url="http://localhost:11434/v1")

        with patch("app.services.query_llm_resolver.httpx") as mock_httpx:
            mock_client = AsyncMock()
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_client.get.return_value = mock_response
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_httpx.AsyncClient.return_value = mock_client

            from app.services.query_llm_resolver import _ping_ollama

            result = await _ping_ollama(settings)
            assert result is True
            mock_client.get.assert_called_once_with("http://localhost:11434/api/tags")

    @pytest.mark.asyncio
    async def test_ping_returns_false_on_connection_error(self):
        settings = _make_settings(ollama_base_url="http://localhost:11434/v1")

        with patch("app.services.query_llm_resolver.httpx") as mock_httpx:
            mock_client = AsyncMock()
            mock_client.get.side_effect = ConnectionError("refused")
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_httpx.AsyncClient.return_value = mock_client

            from app.services.query_llm_resolver import _ping_ollama

            result = await _ping_ollama(settings)
            assert result is False
