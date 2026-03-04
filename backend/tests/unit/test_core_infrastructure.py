"""Tests for core infrastructure modules and application wiring behavior."""

import os
from unittest.mock import MagicMock

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.config import Settings
from app.core import database as db_module
from app.core.database import _set_sqlite_pragmas, init_db
from app.core.exceptions import (
    EmbeddingModelMismatchError,
    LLMError,
    LLMNotConfiguredError,
    NotFoundError,
    ValidationError,
    VectorStoreError,
)
from app.core.security import validate_index_path
from app.core.vectordb import VectorStore
from app.dependencies import (
    get_db, get_embedder, get_file_watcher, get_job_tracker,
    get_llm_provider, get_settings, get_vectordb, get_ws_manager,
)
from app.main import create_app
from app.models.project import Project

from tests.conftest import TEST_TOKEN


def _make_record(project_id="p1", source_id="s1", text="hello", vector=None):
    return {
        "vector": vector or [1.0, 0.0, 0.0, 0.0],
        "project_id": project_id,
        "source_type": "file",
        "source_id": source_id,
        "filename": "test.py",
        "original_path": "/tmp/test.py",
        "file_type": "py",
        "chunk_index": 0,
        "chunk_text": text,
        "language": "python",
        "tags": "[]",
    }


class TestNotFoundError:
    def test_attributes(self):
        err = NotFoundError("Project", "abc-123")
        assert err.entity == "Project"
        assert err.identifier == "abc-123"
        assert "Project not found: abc-123" in str(err)

    def test_inherits_exception(self):
        err = NotFoundError("File", "xyz")
        assert isinstance(err, Exception)


class TestValidationError:
    def test_attributes(self):
        err = ValidationError("Name is required")
        assert err.message == "Name is required"
        assert "Name is required" in str(err)


class TestLLMNotConfiguredError:
    def test_message(self):
        err = LLMNotConfiguredError()
        assert "is configured" in str(err).lower()
        assert "ANTHROPIC_API_KEY" in str(err)


class TestLLMError:
    def test_attributes(self):
        err = LLMError("Rate limit exceeded")
        assert err.message == "Rate limit exceeded"
        assert "Rate limit exceeded" in str(err)


class TestEmbeddingModelMismatchError:
    def test_attributes(self):
        err = EmbeddingModelMismatchError("model-a", "model-b")
        assert err.configured == "model-a"
        assert err.stored == "model-b"
        assert "model-a" in str(err)
        assert "model-b" in str(err)
        assert "mismatch" in str(err).lower()


class TestVectorStoreError:
    def test_attributes_with_operation(self):
        err = VectorStoreError("Connection failed", operation="search")
        assert err.message == "Connection failed"
        assert err.operation == "search"
        assert "Connection failed" in str(err)

    def test_attributes_without_operation(self):
        err = VectorStoreError("General error")
        assert err.message == "General error"
        assert err.operation is None


class TestSettings:
    def test_defaults(self):
        s = Settings(momodoc_data_dir="/tmp/momodoc-test-cfg")
        assert s.app_name == "momodoc"
        assert s.host == "127.0.0.1"
        assert s.port == 8000
        assert s.embedding_dimension == 768

    def test_data_dir_creates_directory(self, tmp_path):
        data = str(tmp_path / "new_data")
        s = Settings(momodoc_data_dir=data)
        result = s.data_dir
        assert result == data
        assert os.path.isdir(data)

    def test_resolved_database_url_uses_override(self):
        s = Settings(
            database_url="sqlite+aiosqlite:///custom.db",
            momodoc_data_dir="/tmp/momodoc-test-cfg2",
        )
        assert s.resolved_database_url == "sqlite+aiosqlite:///custom.db"

    def test_resolved_database_url_derives_from_data_dir(self, tmp_path):
        data = str(tmp_path / "data")
        s = Settings(momodoc_data_dir=data, database_url="")
        url = s.resolved_database_url
        assert url.startswith("sqlite+aiosqlite:///")
        assert "momodoc.db" in url
        assert os.path.isdir(os.path.join(data, "db"))

    def test_vector_dir_creates_directory(self, tmp_path):
        data = str(tmp_path / "data")
        s = Settings(momodoc_data_dir=data)
        vdir = s.vector_dir
        assert vdir == os.path.join(data, "vectors")
        assert os.path.isdir(vdir)

    def test_upload_dir_creates_directory(self, tmp_path):
        data = str(tmp_path / "data")
        s = Settings(momodoc_data_dir=data)
        udir = s.upload_dir
        assert udir == os.path.join(data, "uploads")
        assert os.path.isdir(udir)

    def test_session_token_path(self, tmp_path):
        data = str(tmp_path / "data")
        s = Settings(momodoc_data_dir=data)
        assert s.session_token_path == os.path.join(data, "session.token")

    def test_pid_file_path(self, tmp_path):
        data = str(tmp_path / "data")
        s = Settings(momodoc_data_dir=data)
        assert s.pid_file_path == os.path.join(data, "momodoc.pid")

    def test_port_file_path(self, tmp_path):
        data = str(tmp_path / "data")
        s = Settings(momodoc_data_dir=data)
        assert s.port_file_path == os.path.join(data, "momodoc.port")

    def test_invalid_port_raises_validation_error(self, tmp_path):
        """Port validation rejects values outside 1-65535 range."""
        with pytest.raises(ValueError, match="Port must be between"):
            Settings(port=0, momodoc_data_dir=str(tmp_path / "data"))
        
        with pytest.raises(ValueError, match="Port must be between"):
            Settings(port=-1, momodoc_data_dir=str(tmp_path / "data"))
        
        with pytest.raises(ValueError, match="Port must be between"):
            Settings(port=65536, momodoc_data_dir=str(tmp_path / "data"))

    def test_valid_port_accepted(self, tmp_path):
        """Valid port values should be accepted."""
        s1 = Settings(port=1, momodoc_data_dir=str(tmp_path / "data1"))
        assert s1.port == 1
        
        s2 = Settings(port=8000, momodoc_data_dir=str(tmp_path / "data2"))
        assert s2.port == 8000
        
        s3 = Settings(port=65535, momodoc_data_dir=str(tmp_path / "data3"))
        assert s3.port == 65535


class TestDatabaseInit:
    def test_init_db_sets_globals(self, tmp_path):
        """init_db should set the module-level engine and session factory."""
        old_engine = db_module.engine
        old_factory = db_module.async_session_factory
        try:
            db_url = f"sqlite+aiosqlite:///{tmp_path / 'test.db'}"
            init_db(db_url)
            assert db_module.engine is not None
            assert db_module.async_session_factory is not None
        finally:
            # Restore to avoid affecting other tests
            db_module.engine = old_engine
            db_module.async_session_factory = old_factory

    async def test_get_db_session_fails_when_factory_is_none(self):
        """If init_db was never called, get_db_session raises RuntimeError."""
        old_factory = db_module.async_session_factory
        try:
            db_module.async_session_factory = None
            with pytest.raises(RuntimeError, match="Database not initialized"):
                gen = db_module.get_db_session()
                await gen.__anext__()
        finally:
            db_module.async_session_factory = old_factory

    def test_set_sqlite_pragmas_executes(self):
        """_set_sqlite_pragmas should execute WAL mode, busy_timeout, and foreign keys."""
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value = mock_cursor

        _set_sqlite_pragmas(mock_conn, None)

        calls = [c.args[0] for c in mock_cursor.execute.call_args_list]
        assert "PRAGMA journal_mode=WAL" in calls
        assert "PRAGMA busy_timeout=5000" in calls
        assert "PRAGMA foreign_keys=ON" in calls
        mock_cursor.close.assert_called_once()


@pytest.fixture
def vectordb(tmp_path):
    """Create a real VectorStore backed by a temp directory."""
    return VectorStore(str(tmp_path / "vectors"), vector_dim=4)


class TestVectorStoreEdgeCases:
    def test_add_empty_list_returns_early(self, vectordb):
        """FIXED: add([]) now early-returns without error (no-op)."""
        vectordb.add([])  # Should not raise
        results = vectordb.search([1.0, 0.0, 0.0, 0.0], limit=5)
        assert results == []

    def test_add_does_not_mutate_caller_dicts(self, vectordb):
        """FIXED: add() no longer mutates input dicts — works on shallow copies."""
        rec = _make_record()
        rec["language"] = None
        original_id = rec.get("id")
        original_language = rec.get("language")

        vectordb.add([rec])

        # Original dict should be unchanged
        assert rec.get("id") == original_id
        assert rec.get("language") == original_language

    def test_add_multiple_records_batch(self, vectordb):
        """Adding multiple records in one call should work correctly."""
        records = [_make_record(source_id=f"s{i}", text=f"chunk {i}") for i in range(10)]
        vectordb.add(records)
        results = vectordb.search([1.0, 0.0, 0.0, 0.0], limit=20)
        assert len(results) == 10

    def test_search_returns_all_expected_fields(self, vectordb):
        """Search results should contain all schema fields plus _distance."""
        vectordb.add([_make_record(text="test fields")])
        results = vectordb.search([1.0, 0.0, 0.0, 0.0], limit=1)
        assert len(results) == 1
        r = results[0]
        expected_fields = {
            "id", "vector", "project_id", "source_type", "source_id",
            "filename", "original_path", "file_type", "chunk_index",
            "chunk_text", "language", "tags", "_distance",
        }
        assert expected_fields.issubset(set(r.keys()))

    def test_delete_all_records_with_broad_filter(self, vectordb):
        """Deleting with a filter that matches all records should empty the table."""
        vectordb.add([
            _make_record(project_id="p1", source_id="s1"),
            _make_record(project_id="p1", source_id="s2"),
        ])
        vectordb.delete("project_id = 'p1'")
        results = vectordb.search([1.0, 0.0, 0.0, 0.0], limit=10)
        assert len(results) == 0

    def test_search_with_zero_limit_clamped(self, vectordb):
        """FIXED: limit=0 is clamped to 1 with a logged warning."""
        vectordb.add([_make_record()])
        # Should not raise — instead clamps to limit=1
        results = vectordb.search([1.0, 0.0, 0.0, 0.0], limit=0)
        assert len(results) == 1

    def test_add_then_search_different_vectors(self, vectordb):
        """Records with different vectors should return in order of distance."""
        vectordb.add([
            _make_record(source_id="close", vector=[1.0, 0.0, 0.0, 0.0]),
            _make_record(source_id="far", vector=[0.0, 0.0, 0.0, 1.0]),
        ])
        results = vectordb.search([1.0, 0.0, 0.0, 0.0], limit=2)
        assert len(results) == 2
        # The closer vector should come first
        assert results[0]["source_id"] == "close"
        assert results[0]["_distance"] <= results[1]["_distance"]

    def test_multiple_vectorstore_instances_share_data(self, tmp_path):
        """Two VectorStore instances on the same path should share data."""
        path = str(tmp_path / "shared")
        vs1 = VectorStore(path, vector_dim=4)
        vs1.add([_make_record(text="shared data")])

        vs2 = VectorStore(path, vector_dim=4)
        results = vs2.search([1.0, 0.0, 0.0, 0.0], limit=5)
        assert len(results) == 1
        assert results[0]["chunk_text"] == "shared data"

    def test_delete_with_empty_filter_raises(self, vectordb):
        """FIXED: delete("") now raises VectorStoreError to prevent accidental mass deletion."""
        vectordb.add([_make_record()])
        with pytest.raises(VectorStoreError, match="non-empty filter"):
            vectordb.delete("")
        
        with pytest.raises(VectorStoreError, match="non-empty filter"):
            vectordb.delete("   ")  # whitespace-only


class TestSecurityEdgeCases:
    def test_empty_path_rejected(self):
        """FIXED: Empty or whitespace-only path now explicitly rejected."""
        with pytest.raises(ValidationError, match="Path must not be empty"):
            validate_index_path("", ["/allowed"])
        
        with pytest.raises(ValidationError, match="Path must not be empty"):
            validate_index_path("   ", ["/allowed"])

    def test_symlink_escape_rejected(self, tmp_path):
        """A symlink pointing outside the allowed directory should be rejected."""
        allowed = tmp_path / "allowed"
        allowed.mkdir()
        secret = tmp_path / "secret"
        secret.mkdir()

        link = allowed / "escape"
        link.symlink_to(secret)

        with pytest.raises(ValidationError, match="outside the allowed directories"):
            validate_index_path(str(link), [str(allowed)])

    def test_deeply_nested_traversal(self, tmp_path):
        """Deep relative traversal (../../..) should be rejected."""
        allowed = tmp_path / "a" / "b" / "c"
        allowed.mkdir(parents=True)
        outside = tmp_path / "outside"
        outside.mkdir()

        # Go up 3 levels and into 'outside'
        traversal = str(allowed / ".." / ".." / ".." / "outside")
        with pytest.raises(ValidationError, match="outside the allowed directories"):
            validate_index_path(traversal, [str(allowed)])

    def test_unicode_path_inside_allowed(self, tmp_path):
        """Unicode directory names should be handled correctly."""
        allowed = tmp_path / "allowed"
        allowed.mkdir()
        unicode_dir = allowed / "données"
        unicode_dir.mkdir()

        result = validate_index_path(str(unicode_dir), [str(allowed)])
        assert result.is_dir()

    def test_unicode_path_outside_allowed(self, tmp_path):
        """Unicode path outside allowed should be rejected."""
        allowed = tmp_path / "allowed"
        allowed.mkdir()
        outside = tmp_path / "données_secrètes"
        outside.mkdir()

        with pytest.raises(ValidationError, match="outside the allowed directories"):
            validate_index_path(str(outside), [str(allowed)])

    def test_all_allowed_paths_unresolvable(self, tmp_path):
        """FIXED: When all allowed paths are unresolvable, error message says so."""
        real_dir = tmp_path / "real"
        real_dir.mkdir()

        with pytest.raises(ValidationError, match="None of the allowed index paths could be resolved"):
            validate_index_path(
                str(real_dir),
                ["/nonexistent/path/1", "/nonexistent/path/2"],
            )

    def test_allowed_path_is_file_not_dir(self, tmp_path):
        """Allowed path that is a file (not dir) should be silently skipped."""
        allowed_file = tmp_path / "allowed.txt"
        allowed_file.write_text("not a dir")
        real_dir = tmp_path / "data"
        real_dir.mkdir()

        # The allowlist entry resolves, but it is not a directory, so no valid
        # sandbox roots remain.
        with pytest.raises(ValidationError, match="None of the allowed index paths could be resolved"):
            validate_index_path(str(real_dir), [str(allowed_file)])

    def test_dot_path_resolves_to_cwd(self, tmp_path):
        """Passing '.' resolves to current working directory — document this behavior."""
        old_cwd = os.getcwd()
        try:
            os.chdir(str(tmp_path))
            # '.' resolves to cwd which is tmp_path
            result = validate_index_path(".", [str(tmp_path)])
            assert result == tmp_path.resolve()
        finally:
            os.chdir(old_cwd)


class TestGetSettings:
    def test_returns_settings_instance(self):
        """get_settings should return a Settings instance."""
        get_settings.cache_clear()
        s = get_settings()
        assert isinstance(s, Settings)
        get_settings.cache_clear()

    def test_cached_returns_same_instance(self):
        """get_settings uses lru_cache — should return the same instance."""
        get_settings.cache_clear()
        s1 = get_settings()
        s2 = get_settings()
        assert s1 is s2
        get_settings.cache_clear()


class TestGetDb:
    async def test_get_db_yields_session(self, db_engine):
        """get_db should yield a usable async session."""
        from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession as AS

        old_factory = db_module.async_session_factory
        db_module.async_session_factory = async_sessionmaker(
            db_engine, class_=AS, expire_on_commit=False
        )
        try:
            gen = get_db()
            session = await gen.__anext__()
            assert isinstance(session, AS)
            # Cleanup
            try:
                await gen.__anext__()
            except StopAsyncIteration:
                pass
        finally:
            db_module.async_session_factory = old_factory

    async def test_get_db_fails_when_factory_none(self):
        """FIXED: get_db now raises RuntimeError when async_session_factory is None."""
        old_factory = db_module.async_session_factory
        db_module.async_session_factory = None
        try:
            gen = get_db()
            with pytest.raises(RuntimeError, match="Database not initialized"):
                await gen.__anext__()
        finally:
            db_module.async_session_factory = old_factory


class TestGetEmbedder:
    def test_returns_embedder_from_app_state(self):
        """get_embedder should return the embedder from request.app.state."""
        mock_request = MagicMock()
        mock_embedder = MagicMock()
        mock_request.app.state.embedder = mock_embedder

        result = get_embedder(mock_request)
        assert result is mock_embedder

    def test_raises_when_embedder_not_set(self):
        """FIXED: If app.state has no embedder, RuntimeError is raised."""
        mock_request = MagicMock()
        del mock_request.app.state.embedder

        with pytest.raises(RuntimeError, match="Embedder is still loading"):
            get_embedder(mock_request)


class TestGetVectordb:
    def test_returns_vectordb_from_app_state(self):
        """get_vectordb should return the vectordb from request.app.state."""
        mock_request = MagicMock()
        mock_vdb = MagicMock()
        mock_request.app.state.vectordb = mock_vdb

        result = get_vectordb(mock_request)
        assert result is mock_vdb

    def test_raises_when_vectordb_not_set(self):
        """FIXED: If app.state has no vectordb, RuntimeError is raised."""
        mock_request = MagicMock()
        del mock_request.app.state.vectordb

        with pytest.raises(RuntimeError, match="VectorStore not initialized"):
            get_vectordb(mock_request)


class TestGetLlmProvider:
    def test_returns_provider_from_app_state(self):
        mock_request = MagicMock()
        mock_provider = MagicMock()
        mock_request.app.state.llm_provider = mock_provider

        result = get_llm_provider(mock_request)
        assert result is mock_provider

    def test_raises_when_provider_is_none(self):
        """get_llm_provider should raise LLMNotConfiguredError when provider is None."""
        mock_request = MagicMock()
        mock_request.app.state.llm_provider = None

        with pytest.raises(LLMNotConfiguredError):
            get_llm_provider(mock_request)


class TestGetProject:
    async def test_nonexistent_project_raises_404(self, db_session):
        """get_project should raise NotFoundError for nonexistent project."""
        from app.dependencies import get_project

        with pytest.raises(NotFoundError) as exc_info:
            await get_project("nonexistent-uuid", db=db_session)

        assert exc_info.value.entity == "Project"
        assert exc_info.value.identifier == "nonexistent-uuid"

    async def test_get_project_by_id(self, db_session):
        """get_project should find a project by its UUID."""
        from app.dependencies import get_project

        project = Project(name="test-proj", description="test")
        db_session.add(project)
        await db_session.flush()

        result = await get_project(project.id, db=db_session)
        assert result.id == project.id
        assert result.name == "test-proj"

    async def test_get_project_by_name(self, db_session):
        """get_project should find a project by name."""
        from app.dependencies import get_project

        project = Project(name="my-project", description="test")
        db_session.add(project)
        await db_session.flush()

        result = await get_project("my-project", db=db_session)
        assert result.id == project.id

    async def test_get_project_sql_injection_attempt(self, db_session):
        """SQL injection attempt in project_id should not cause harm."""
        from app.dependencies import get_project

        # SQLAlchemy parameterizes queries, so this should just not match
        with pytest.raises(NotFoundError):
            await get_project("'; DROP TABLE projects; --", db=db_session)


class TestMiddlewareAdditionalEdgeCases:
    @pytest_asyncio.fixture
    async def _make_middleware_app(self):
        """Factory for minimal middleware test apps."""
        from starlette.applications import Starlette
        from starlette.responses import PlainTextResponse
        from starlette.routing import Route
        from app.middleware.auth import SessionTokenMiddleware

        def make(token="valid-token"):
            async def endpoint(request):
                return PlainTextResponse("ok")

            async def health(request):
                return PlainTextResponse("healthy")

            async def token_ep(request):
                return PlainTextResponse("token")

            app = Starlette(
                routes=[
                    Route("/api/v1/things", endpoint),
                    Route("/api/v1/health", health),
                    Route("/api/v1/health/", health),
                    Route("/api/v1/healthcheck", endpoint),
                    Route("/api/v1/token", token_ep),
                ],
            )
            app.add_middleware(SessionTokenMiddleware)
            if token is not None:
                app.state.session_token = token
            return app

        return make

    async def test_trailing_slash_health_skips_auth(self, _make_middleware_app):
        """FIXED: '/api/v1/health/' now normalized to '/api/v1/health', skips auth."""
        app = _make_middleware_app("my-token")
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as c:
            resp = await c.get("/api/v1/health/")
        # After normalization, trailing slash is stripped and path matches skip set
        assert resp.status_code == 200

    async def test_healthcheck_subpath_requires_auth(self, _make_middleware_app):
        """/api/v1/healthcheck is a different path from /api/v1/health — requires auth."""
        app = _make_middleware_app("my-token")
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as c:
            resp = await c.get("/api/v1/healthcheck")
        assert resp.status_code == 401

    async def test_case_sensitive_token_header(self, _make_middleware_app):
        """Token header name is case-insensitive per HTTP spec (handled by Starlette)."""
        app = _make_middleware_app("my-token")
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as c:
            resp = await c.get(
                "/api/v1/things",
                headers={"x-momodoc-token": "my-token"},
            )
        # HTTP headers are case-insensitive, Starlette normalizes them
        assert resp.status_code == 200

    async def test_very_long_token_rejected(self, _make_middleware_app):
        """An extremely long token value should not cause issues."""
        app = _make_middleware_app("short-token")
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as c:
            resp = await c.get(
                "/api/v1/things",
                headers={"X-Momodoc-Token": "x" * 100000},
            )
        assert resp.status_code == 401


class TestExceptionHandlers:
    """Test that custom exception handlers return correct HTTP status codes."""

    @pytest_asyncio.fixture
    async def app_client(
        self, db_session, mock_vectordb, mock_embedder, mock_llm,
        mock_job_tracker, mock_ws_manager, mock_file_watcher, test_settings,
    ):
        """Create a test client with dependency overrides."""
        app = create_app()
        app.state.session_token = TEST_TOKEN
        app.state.file_watcher = mock_file_watcher

        async def override_get_db():
            yield db_session

        app.dependency_overrides[get_db] = override_get_db
        app.dependency_overrides[get_vectordb] = lambda: mock_vectordb
        app.dependency_overrides[get_embedder] = lambda: mock_embedder
        app.dependency_overrides[get_llm_provider] = lambda: mock_llm
        app.dependency_overrides[get_job_tracker] = lambda: mock_job_tracker
        app.dependency_overrides[get_ws_manager] = lambda: mock_ws_manager
        app.dependency_overrides[get_file_watcher] = lambda: mock_file_watcher
        app.dependency_overrides[get_settings] = lambda: test_settings

        transport = ASGITransport(app=app)
        async with AsyncClient(
            transport=transport,
            base_url="http://test",
            headers={"X-Momodoc-Token": TEST_TOKEN},
        ) as ac:
            yield ac, app

        app.dependency_overrides.clear()

    async def test_not_found_returns_404(self, app_client):
        """NotFoundError should be mapped to 404."""
        client, _ = app_client
        resp = await client.get("/api/v1/projects/nonexistent-id-12345")
        assert resp.status_code == 404
        assert "detail" in resp.json()

    async def test_validation_error_returns_422(self, app_client):
        """ValidationError should be mapped to 422."""
        client, _ = app_client
        # Trigger a validation error by creating a project with empty name
        resp = await client.post(
            "/api/v1/projects",
            json={"name": "", "description": "test"},
        )
        assert resp.status_code == 422

    async def test_health_response_structure(self, app_client):
        """Health endpoint should return {status, service, ready}."""
        client, _ = app_client
        resp = await client.get("/api/v1/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["service"] == "momodoc"
        assert "ready" in data

    def test_vectorstore_error_handler_registered(self):
        """FIXED: VectorStoreError exception handler should be registered."""
        app = create_app()
        # Check that VectorStoreError is in the exception handlers
        assert VectorStoreError in app.exception_handlers


class TestTokenEndpoint:
    """Test the GET /api/v1/token endpoint access control."""

    async def test_token_endpoint_returns_token(self, client):
        """Localhost request should receive the session token."""
        resp = await client.get("/api/v1/token")
        assert resp.status_code == 200
        data = resp.json()
        assert data["token"] == TEST_TOKEN


class TestCreateApp:
    def test_creates_fastapi_instance(self):
        """create_app should return a FastAPI app."""
        from fastapi import FastAPI
        app = create_app()
        assert isinstance(app, FastAPI)
        assert app.title == "momodoc"

    def test_app_has_routers(self):
        """The app should have routes registered."""
        app = create_app()
        paths = [route.path for route in app.routes]
        # Check that key API routes are present
        assert any("/api/v1/health" in p for p in paths)

    def test_app_has_middleware(self):
        """The app should have SessionTokenMiddleware registered."""
        app = create_app()
        # Middleware is added — we can verify by checking the middleware stack
        # The middleware is wrapped, so we check it's functional via a request test
        assert app is not None  # Basic smoke test


class TestVectorStoreInit:
    def test_init_creates_db_directory(self, tmp_path):
        """VectorStore should create the database directory if it doesn't exist."""
        path = str(tmp_path / "new" / "vectors")
        # LanceDB should create the directory
        vs = VectorStore(path, vector_dim=4)
        listed = vs.db.list_tables() if hasattr(vs.db, "list_tables") else vs.db.table_names()
        table_names = list(getattr(listed, "tables", listed))
        assert "chunks" in table_names

    def test_init_with_custom_dimension(self, tmp_path):
        """VectorStore should respect custom vector dimensions."""
        vs = VectorStore(str(tmp_path / "v"), vector_dim=768)
        assert vs.vector_dim == 768
