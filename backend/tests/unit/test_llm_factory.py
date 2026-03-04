"""Unit tests for LLM factory: provider selection, registry, and per-request resolution."""

from concurrent.futures import ThreadPoolExecutor
import threading
import time

import pytest
from unittest.mock import patch

from app.config import Settings
from app.llm.factory import (
    ProviderRegistry,
    create_llm_provider,
    create_provider_by_name,
)


def _make_settings(**overrides):
    """Create a Settings object with test defaults, applying overrides."""
    defaults = {
        "database_url": "sqlite+aiosqlite:///:memory:",
        "momodoc_data_dir": "/tmp/momodoc-test",
        "embedding_model": "test-model",
        "embedding_dimension": 384,
        "max_upload_size_mb": 1,
        "allowed_index_paths": ["/tmp"],
        "anthropic_api_key": "",
        "openai_api_key": "",
        "google_api_key": "",
        "llm_provider": "claude",
    }
    defaults.update(overrides)
    return Settings(**defaults)


class TestCreateLLMProvider:
    def test_claude_returns_none_when_no_api_key(self):
        """Claude provider should return None when no API key is set."""
        settings = _make_settings(llm_provider="claude", anthropic_api_key="")
        result = create_llm_provider(settings)
        assert result is None

    def test_openai_returns_none_when_no_api_key(self):
        """OpenAI provider should return None when no API key is set."""
        settings = _make_settings(llm_provider="openai", openai_api_key="")
        result = create_llm_provider(settings)
        assert result is None

    def test_gemini_returns_none_when_no_api_key(self):
        """Gemini provider should return None when no API key is set."""
        settings = _make_settings(llm_provider="gemini", google_api_key="")
        result = create_llm_provider(settings)
        assert result is None

    def test_claude_returns_provider_with_api_key(self):
        """Claude provider should return a ClaudeProvider when API key is present."""
        settings = _make_settings(llm_provider="claude", anthropic_api_key="sk-ant-test-key")
        provider = create_llm_provider(settings)
        assert provider is not None
        from app.llm.claude import ClaudeProvider

        assert isinstance(provider, ClaudeProvider)

    def test_openai_returns_provider_with_api_key(self):
        """OpenAI provider should return an OpenAIProvider when API key is present."""
        settings = _make_settings(llm_provider="openai", openai_api_key="sk-test-key")
        provider = create_llm_provider(settings)
        assert provider is not None
        from app.llm.openai_provider import OpenAIProvider

        assert isinstance(provider, OpenAIProvider)

    def test_gemini_returns_provider_with_api_key(self):
        """Gemini provider should return a GeminiProvider when API key is present."""
        settings = _make_settings(llm_provider="gemini", google_api_key="test-google-key")
        provider = create_llm_provider(settings)
        assert provider is not None
        from app.llm.gemini_provider import GeminiProvider

        assert isinstance(provider, GeminiProvider)

    def test_ollama_returns_provider_without_api_key(self):
        """Ollama provider should always return (no API key required)."""
        settings = _make_settings(llm_provider="ollama")
        provider = create_llm_provider(settings)
        assert provider is not None
        from app.llm.ollama_provider import OllamaProvider

        assert isinstance(provider, OllamaProvider)

    def test_unknown_provider_raises_value_error(self):
        """Unknown LLM provider should raise ValueError."""
        settings = _make_settings(llm_provider="nonexistent")
        with pytest.raises(ValueError, match="Unknown LLM provider: nonexistent"):
            create_llm_provider(settings)

    def test_claude_provider_uses_default_model_when_not_configured(self):
        """ClaudeProvider should use default model when no claude_model is set."""
        settings = _make_settings(
            llm_provider="claude",
            anthropic_api_key="sk-ant-test",
        )
        provider = create_llm_provider(settings)
        assert provider.get_model_name() == "claude-sonnet-4-6"

    def test_claude_provider_uses_configured_model(self):
        """ClaudeProvider should use the model name from settings."""
        settings = _make_settings(
            llm_provider="claude",
            anthropic_api_key="sk-ant-test",
            claude_model="claude-sonnet-4-6",
        )
        provider = create_llm_provider(settings)
        assert provider.get_model_name() == "claude-sonnet-4-6"

    def test_openai_provider_uses_configured_model(self):
        """OpenAIProvider should use the model name from settings."""
        settings = _make_settings(
            llm_provider="openai",
            openai_api_key="sk-test",
            openai_model="gpt-4o",
        )
        provider = create_llm_provider(settings)
        assert provider.get_model_name() == "gpt-4o"

    def test_gemini_provider_uses_default_model_when_not_configured(self):
        """GeminiProvider should use default model when no gemini_model is set."""
        settings = _make_settings(
            llm_provider="gemini",
            google_api_key="test-key",
        )
        provider = create_llm_provider(settings)
        assert provider.get_model_name() == "gemini-2.5-flash"

    def test_gemini_provider_uses_configured_model(self):
        """GeminiProvider should use the model name from settings."""
        settings = _make_settings(
            llm_provider="gemini",
            google_api_key="test-key",
            gemini_model="gemini-2.5-pro",
        )
        provider = create_llm_provider(settings)
        assert provider.get_model_name() == "gemini-2.5-pro"

    def test_ollama_provider_uses_configured_model(self):
        """OllamaProvider should use the model name from settings."""
        settings = _make_settings(
            llm_provider="ollama",
            ollama_model="qwen2.5-coder:7b",
        )
        provider = create_llm_provider(settings)
        assert provider.get_model_name() == "qwen2.5-coder:7b"


class TestProviderRegistry:
    def test_registry_caches_providers(self):
        """Registry should return the same instance on repeated calls."""
        settings = _make_settings(anthropic_api_key="sk-ant-test")
        registry = ProviderRegistry(settings)
        p1 = registry.get("claude")
        p2 = registry.get("claude")
        assert p1 is p2

    def test_registry_returns_none_for_unconfigured(self):
        """Registry should return None for providers without API keys."""
        settings = _make_settings(anthropic_api_key="", google_api_key="")
        registry = ProviderRegistry(settings)
        assert registry.get("claude") is None
        assert registry.get("gemini") is None

    def test_available_providers_lists_all(self):
        """available_providers should list all 4 providers with their status."""
        settings = _make_settings(
            anthropic_api_key="sk-ant-test",
            google_api_key="test-google",
        )
        registry = ProviderRegistry(settings)
        providers = registry.available_providers()
        assert len(providers) == 4
        names = [p["name"] for p in providers]
        assert "claude" in names
        assert "openai" in names
        assert "gemini" in names
        assert "ollama" in names

        # Claude should be available (has key)
        claude_info = next(p for p in providers if p["name"] == "claude")
        assert claude_info["available"] is True

        # OpenAI should NOT be available (no key)
        openai_info = next(p for p in providers if p["name"] == "openai")
        assert openai_info["available"] is False

        # Gemini should be available (has key)
        gemini_info = next(p for p in providers if p["name"] == "gemini")
        assert gemini_info["available"] is True

        # Ollama is always available
        ollama_info = next(p for p in providers if p["name"] == "ollama")
        assert ollama_info["available"] is True

    def test_registry_config_detection_matches_settings(self):
        """_is_configured should reflect provider requirements and unknown providers."""
        settings = _make_settings(
            anthropic_api_key="sk-ant-test",
            openai_api_key="",
            google_api_key="test-google",
        )
        registry = ProviderRegistry(settings)

        assert registry._is_configured("claude") is True
        assert registry._is_configured("openai") is False
        assert registry._is_configured("gemini") is True
        assert registry._is_configured("ollama") is True
        assert registry._is_configured("unknown") is False

    def test_registry_model_lookup_matches_settings(self):
        """_get_model_name should read provider models from settings and handle unknown."""
        settings = _make_settings(
            claude_model="claude-test-model",
            openai_model="gpt-test-model",
            gemini_model="gemini-test-model",
            ollama_model="ollama-test-model",
        )
        registry = ProviderRegistry(settings)

        assert registry._get_model_name("claude") == "claude-test-model"
        assert registry._get_model_name("openai") == "gpt-test-model"
        assert registry._get_model_name("gemini") == "gemini-test-model"
        assert registry._get_model_name("ollama") == "ollama-test-model"
        assert registry._get_model_name("unknown") == ""

    def test_registry_get_is_thread_safe(self):
        """Concurrent callers should create a provider at most once per name."""
        settings = _make_settings()
        registry = ProviderRegistry(settings)

        marker = object()
        call_count = 0
        count_lock = threading.Lock()

        def slow_create(name: str, _settings: Settings):
            nonlocal call_count
            time.sleep(0.01)
            with count_lock:
                call_count += 1
            return marker

        with patch("app.llm.factory.create_provider_by_name", side_effect=slow_create):
            with ThreadPoolExecutor(max_workers=8) as pool:
                results = list(pool.map(lambda _: registry.get("claude"), range(32)))

        assert all(result is marker for result in results)
        assert call_count == 1


class TestCreateProviderByName:
    def test_create_by_name_works_for_all_providers(self):
        """create_provider_by_name should support all known providers."""
        settings = _make_settings(
            anthropic_api_key="sk-test",
            openai_api_key="sk-test",
            google_api_key="test",
        )
        for name in ("claude", "openai", "gemini", "ollama"):
            provider = create_provider_by_name(name, settings)
            assert provider is not None, f"Provider {name} returned None"

    def test_create_by_name_raises_for_unknown(self):
        """create_provider_by_name should raise ValueError for unknown names."""
        settings = _make_settings()
        with pytest.raises(ValueError, match="Unknown LLM provider"):
            create_provider_by_name("bad_name", settings)


class TestLLMErrorWrapping:
    """Tests for LLM provider SDK error wrapping."""

    @pytest.mark.asyncio
    async def test_openai_complete_wraps_api_error(self):
        """OpenAI APIError should be wrapped in LLMError."""
        from unittest.mock import AsyncMock, patch, MagicMock
        from app.llm.openai_provider import OpenAIProvider
        from app.core.exceptions import LLMError
        import openai

        provider = OpenAIProvider(api_key="test-key")

        # Create a mock APIError with required attributes
        mock_request = MagicMock()
        api_error = openai.APIError("API failed", request=mock_request, body=None)

        with patch.object(
            provider.client.chat.completions, "create", new_callable=AsyncMock
        ) as mock_create:
            mock_create.side_effect = api_error

            with pytest.raises(LLMError, match="OpenAI API error"):
                await provider.complete([])

    @pytest.mark.asyncio
    async def test_openai_empty_choices_raises_llm_error(self):
        """OpenAI response with empty choices should raise LLMError."""
        from unittest.mock import AsyncMock, patch, MagicMock
        from app.llm.openai_provider import OpenAIProvider
        from app.core.exceptions import LLMError

        provider = OpenAIProvider(api_key="test-key")

        mock_response = MagicMock()
        mock_response.choices = []

        with patch.object(
            provider.client.chat.completions, "create", new_callable=AsyncMock
        ) as mock_create:
            mock_create.return_value = mock_response

            with pytest.raises(LLMError, match="no choices"):
                await provider.complete([])

    @pytest.mark.asyncio
    async def test_claude_complete_wraps_api_error(self):
        """Claude APIError should be wrapped in LLMError."""
        from unittest.mock import AsyncMock, patch, MagicMock
        from app.llm.claude import ClaudeProvider
        from app.core.exceptions import LLMError
        import anthropic

        provider = ClaudeProvider(api_key="test-key")

        # Create a mock APIError with required attributes
        mock_request = MagicMock()
        api_error = anthropic.APIError("API failed", request=mock_request, body=None)

        with patch.object(
            provider.client.messages, "create", new_callable=AsyncMock
        ) as mock_create:
            mock_create.side_effect = api_error

            with pytest.raises(LLMError, match="Claude API error"):
                await provider.complete([])
