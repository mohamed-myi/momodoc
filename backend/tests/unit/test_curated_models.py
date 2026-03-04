"""Tests for the curated model lists and helper functions."""

from app.llm.models import (
    CLAUDE_MODELS,
    CURATED_MODELS,
    GEMINI_MODELS,
    OPENAI_MODELS,
    get_context_window,
)


class TestCuratedModels:
    def test_all_providers_have_curated_entries(self):
        for provider in ("claude", "openai", "gemini"):
            assert len(CURATED_MODELS[provider]) > 0, f"{provider} has no curated models"

    def test_ollama_has_empty_curated_list(self):
        assert CURATED_MODELS["ollama"] == ()

    def test_no_retired_models_in_curated_lists(self):
        retired = {
            "claude-3-5-sonnet-20241022",
            "claude-3-5-sonnet-20240620",
            "claude-3-opus-20240229",
            "claude-3-7-sonnet-20250219",
            "claude-3-5-haiku-20241022",
            "gemini-1.5-flash",
            "gemini-1.5-flash-001",
            "gemini-1.5-flash-002",
            "gemini-1.5-pro",
            "gpt-4-turbo",
        }
        for provider, models in CURATED_MODELS.items():
            for m in models:
                assert m.id not in retired, f"Retired model {m.id} in {provider} curated list"

    def test_each_provider_has_one_recommended(self):
        for provider in ("claude", "openai", "gemini"):
            models = CURATED_MODELS[provider]
            recommended = [m for m in models if m.recommended]
            assert len(recommended) >= 1, f"{provider} has no recommended model"

    def test_context_window_lookup_known(self):
        assert get_context_window("claude-sonnet-4-6") == 200_000
        assert get_context_window("gpt-4o") == 128_000
        assert get_context_window("gemini-2.5-flash") == 1_000_000

    def test_context_window_lookup_unknown(self):
        assert get_context_window("unknown-model") is None

    def test_model_info_to_dict(self):
        model = CLAUDE_MODELS[0]
        d = model.to_dict(is_default=True)
        assert d["id"] == model.id
        assert d["name"] == model.display_name
        assert d["is_default"] is True
        assert d["context_window"] == model.context_window


class TestProviderHotReload:
    def test_registry_reload_clears_cache(self):
        from app.config import Settings
        from app.llm.factory import ProviderRegistry

        settings = Settings(
            database_url="sqlite+aiosqlite:///:memory:",
            momodoc_data_dir="/tmp/momodoc-test-reload",
            embedding_model="test-model",
            anthropic_api_key="test-key",
        )
        registry = ProviderRegistry(settings)

        provider1 = registry.get("claude")
        assert provider1 is not None

        new_settings = Settings(
            database_url="sqlite+aiosqlite:///:memory:",
            momodoc_data_dir="/tmp/momodoc-test-reload",
            embedding_model="test-model",
            anthropic_api_key="new-test-key",
        )
        registry.reload(new_settings)

        provider2 = registry.get("claude")
        assert provider2 is not provider1
