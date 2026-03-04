"""Tests for the SettingsStore JSON persistence layer."""

import json
from pathlib import Path

import pytest

from app.core.settings_store import SettingsStore


@pytest.fixture
def store_path(tmp_path: Path) -> Path:
    return tmp_path / "settings.json"


class TestSettingsStore:
    def test_empty_on_first_load(self, store_path: Path):
        store = SettingsStore(store_path)
        assert store.get_all() == {}

    def test_update_persists_to_disk(self, store_path: Path):
        store = SettingsStore(store_path)
        store.update({"llm_provider": "openai", "openai_model": "gpt-4o"})

        raw = json.loads(store_path.read_text())
        assert raw["llm_provider"] == "openai"
        assert raw["openai_model"] == "gpt-4o"

    def test_reload_reads_persisted_values(self, store_path: Path):
        store = SettingsStore(store_path)
        store.update({"claude_model": "claude-sonnet-4-6"})

        fresh = SettingsStore(store_path)
        assert fresh.get("claude_model") == "claude-sonnet-4-6"

    def test_filters_unknown_keys(self, store_path: Path):
        store = SettingsStore(store_path)
        store.update({"llm_provider": "claude", "unknown_key": "should_be_dropped"})
        assert "unknown_key" not in store.get_all()
        assert store.get("llm_provider") == "claude"

    def test_partial_update_merges(self, store_path: Path):
        store = SettingsStore(store_path)
        store.update({"llm_provider": "claude", "claude_model": "claude-sonnet-4-6"})
        store.update({"claude_model": "claude-opus-4-6"})

        data = store.get_all()
        assert data["llm_provider"] == "claude"
        assert data["claude_model"] == "claude-opus-4-6"

    def test_get_returns_default_for_missing_key(self, store_path: Path):
        store = SettingsStore(store_path)
        assert store.get("anthropic_api_key", "fallback") == "fallback"
        assert store.get("missing_key") is None

    def test_handles_corrupt_file(self, store_path: Path):
        store_path.write_text("not valid json {{{", encoding="utf-8")
        store = SettingsStore(store_path)
        assert store.get_all() == {}

    def test_atomic_write_survives_reopen(self, store_path: Path):
        store = SettingsStore(store_path)
        store.update(
            {
                "llm_provider": "gemini",
                "google_api_key": "AIzaTest1234",
                "gemini_model": "gemini-2.5-flash",
            }
        )

        store2 = SettingsStore(store_path)
        assert store2.get("llm_provider") == "gemini"
        assert store2.get("google_api_key") == "AIzaTest1234"
        assert store2.get("gemini_model") == "gemini-2.5-flash"

    def test_all_allowed_keys_accepted(self, store_path: Path):
        store = SettingsStore(store_path)
        full_update = {
            "llm_provider": "ollama",
            "anthropic_api_key": "sk-ant-test",
            "claude_model": "claude-sonnet-4-6",
            "openai_api_key": "sk-test",
            "openai_model": "gpt-4o",
            "google_api_key": "AIzaTest",
            "gemini_model": "gemini-2.5-flash",
            "ollama_base_url": "http://localhost:11434/v1",
            "ollama_model": "qwen2.5-coder:7b",
        }
        store.update(full_update)
        assert store.get_all() == full_update
