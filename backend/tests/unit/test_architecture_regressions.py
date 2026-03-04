"""Regression tests for critical architecture hardening."""

import inspect
import logging
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from starlette.middleware.base import BaseHTTPMiddleware

import app.main as app_main
from app.core.logging import configure_logging
from app.bootstrap.startup import _run_migrations
from app.main import create_app
from app.middleware.auth import SessionTokenMiddleware
from app.middleware.logging import RequestLoggingMiddleware


def test_middlewares_use_raw_asgi_not_base_http() -> None:
    """Middleware classes should not use BaseHTTPMiddleware."""
    app = create_app()
    middleware_classes = {entry.cls for entry in app.user_middleware}

    assert SessionTokenMiddleware in middleware_classes
    assert RequestLoggingMiddleware in middleware_classes
    assert not issubclass(SessionTokenMiddleware, BaseHTTPMiddleware)
    assert not issubclass(RequestLoggingMiddleware, BaseHTTPMiddleware)


def test_configure_logging_uses_independent_uvicorn_handler_lists() -> None:
    """Mutating one uvicorn logger handler list must not mutate siblings."""
    configure_logging("INFO")

    uvicorn_logger = logging.getLogger("uvicorn")
    uvicorn_error_logger = logging.getLogger("uvicorn.error")
    uvicorn_access_logger = logging.getLogger("uvicorn.access")

    assert uvicorn_logger.handlers is not uvicorn_error_logger.handlers
    assert uvicorn_logger.handlers is not uvicorn_access_logger.handlers
    assert uvicorn_error_logger.handlers is not uvicorn_access_logger.handlers

    baseline_error_len = len(uvicorn_error_logger.handlers)
    baseline_access_len = len(uvicorn_access_logger.handlers)
    marker = logging.NullHandler()
    uvicorn_logger.handlers.append(marker)
    try:
        assert len(uvicorn_error_logger.handlers) == baseline_error_len
        assert len(uvicorn_access_logger.handlers) == baseline_access_len
    finally:
        uvicorn_logger.handlers.remove(marker)


def test_run_migrations_disposes_engine_on_connection_failure() -> None:
    """Migration engine should always dispose even when connect() fails."""

    class _FailingConnectionContext:
        def __enter__(self):
            raise RuntimeError("forced connect failure")

        def __exit__(self, exc_type, exc_val, exc_tb):
            return False

    fake_engine = MagicMock()
    fake_engine.connect.return_value = _FailingConnectionContext()

    with patch("sqlalchemy.create_engine", return_value=fake_engine):
        with pytest.raises(RuntimeError, match="forced connect failure"):
            _run_migrations("sqlite+aiosqlite:////tmp/momodoc-test.db")

    fake_engine.dispose.assert_called_once()


def test_main_delegates_router_and_exception_registration() -> None:
    """Bootstrap wiring should be delegated out of app.main."""
    source = inspect.getsource(app_main)

    assert "register_exception_handlers(app)" in source
    assert "register_routers(app)" in source
    assert "app.include_router(" not in source
    assert "@app.exception_handler(" not in source


def test_main_no_longer_owns_deferred_startup_and_watcher_helpers() -> None:
    """Large startup/watcher helpers should live in bootstrap modules, not app.main."""
    for helper_name in (
        "_deferred_startup",
        "_auto_sync_projects",
        "_start_file_watchers",
        "_setup_project_watcher",
    ):
        assert not hasattr(app_main, helper_name)


def test_projects_router_uses_public_watcher_bootstrap_api() -> None:
    """Routers should not import private helpers from app.main."""
    projects_router = Path(__file__).resolve().parents[2] / "app" / "routers" / "projects.py"
    source = projects_router.read_text(encoding="utf-8")

    assert "from app.main import _setup_project_watcher" not in source
    assert "from app.bootstrap.watcher import setup_project_watcher" in source
