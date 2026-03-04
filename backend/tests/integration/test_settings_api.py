"""Integration tests for the settings API endpoints."""

import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.config import Settings
from app.core.settings_store import SettingsStore
from app.dependencies import (
    get_db,
    get_embedder,
    get_job_tracker,
    get_llm_provider,
    get_provider_registry,
    get_settings,
    get_settings_store,
    get_vectordb,
    get_ws_manager,
)
from app.main import create_app

TEST_TOKEN = "test-token"


@pytest_asyncio.fixture
async def settings_client(
    db_session,
    mock_vectordb,
    mock_embedder,
    mock_llm,
    mock_provider_registry,
    mock_job_tracker,
    mock_ws_manager,
    mock_file_watcher,
    tmp_path,
):
    """Test client with a real SettingsStore backed by tmp_path."""
    from app.dependencies import get_file_watcher

    test_settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        momodoc_data_dir=str(tmp_path),
        embedding_model="test-model",
        embedding_dimension=384,
        anthropic_api_key="sk-ant-test",
        claude_model="claude-sonnet-4-6",
        llm_provider="claude",
    )
    store = SettingsStore(tmp_path / "settings.json")

    app = create_app()
    app.state.session_token = TEST_TOKEN
    app.state.file_watcher = mock_file_watcher
    app.state.settings_store = store
    app.state.settings = test_settings
    app.state.llm_provider = mock_llm
    app.state.provider_registry = mock_provider_registry

    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_vectordb] = lambda: mock_vectordb
    app.dependency_overrides[get_embedder] = lambda: mock_embedder
    app.dependency_overrides[get_llm_provider] = lambda: mock_llm
    app.dependency_overrides[get_provider_registry] = lambda: mock_provider_registry
    app.dependency_overrides[get_job_tracker] = lambda: mock_job_tracker
    app.dependency_overrides[get_ws_manager] = lambda: mock_ws_manager
    app.dependency_overrides[get_file_watcher] = lambda: mock_file_watcher
    app.dependency_overrides[get_settings] = lambda: test_settings
    app.dependency_overrides[get_settings_store] = lambda: store

    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport,
        base_url="http://test",
        headers={"X-Momodoc-Token": TEST_TOKEN},
    ) as ac:
        yield ac

    app.dependency_overrides.clear()


class TestSettingsAPI:
    async def test_get_settings_returns_masked_keys(self, settings_client):
        resp = await settings_client.get("/api/v1/settings")
        assert resp.status_code == 200
        data = resp.json()
        assert data["llm_provider"] == "claude"
        assert data["claude_model"] == "claude-sonnet-4-6"
        assert "sk-ant-test" not in data["anthropic_api_key"]
        assert "****" in data["anthropic_api_key"] or "..." in data["anthropic_api_key"]

    async def test_put_settings_updates_model(self, settings_client):
        resp = await settings_client.put(
            "/api/v1/settings",
            json={"claude_model": "claude-opus-4-6"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["claude_model"] == "claude-opus-4-6"

    async def test_put_settings_updates_provider(self, settings_client):
        resp = await settings_client.put(
            "/api/v1/settings",
            json={"llm_provider": "openai"},
        )
        assert resp.status_code == 200
        assert resp.json()["llm_provider"] == "openai"

    async def test_put_empty_body_no_change(self, settings_client):
        resp = await settings_client.put("/api/v1/settings", json={})
        assert resp.status_code == 200

    async def test_settings_persist_across_gets(self, settings_client):
        await settings_client.put(
            "/api/v1/settings",
            json={"gemini_model": "gemini-3-flash"},
        )
        resp = await settings_client.get("/api/v1/settings")
        assert resp.json()["gemini_model"] == "gemini-3-flash"


class TestModelListAPI:
    async def test_list_models_unknown_provider(self, settings_client):
        resp = await settings_client.get("/api/v1/llm/providers/unknown/models")
        assert resp.status_code == 404

    async def test_list_models_claude_fallback(self, settings_client):
        resp = await settings_client.get("/api/v1/llm/providers/claude/models")
        assert resp.status_code == 200
        models = resp.json()
        assert len(models) > 0
        ids = [m["id"] for m in models]
        assert "claude-sonnet-4-6" in ids

    async def test_list_models_openai_fallback(self, settings_client):
        resp = await settings_client.get("/api/v1/llm/providers/openai/models")
        assert resp.status_code == 200
        models = resp.json()
        ids = [m["id"] for m in models]
        assert "gpt-4o" in ids

    async def test_list_models_gemini_fallback(self, settings_client):
        resp = await settings_client.get("/api/v1/llm/providers/gemini/models")
        assert resp.status_code == 200
        models = resp.json()
        ids = [m["id"] for m in models]
        assert "gemini-2.5-flash" in ids

    async def test_list_models_ollama_empty_fallback(self, settings_client):
        resp = await settings_client.get("/api/v1/llm/providers/ollama/models")
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_model_default_flag(self, settings_client):
        resp = await settings_client.get("/api/v1/llm/providers/claude/models")
        models = resp.json()
        default_models = [m for m in models if m["is_default"]]
        assert len(default_models) == 1
        assert default_models[0]["id"] == "claude-sonnet-4-6"
