"""Tests for SessionTokenMiddleware edge cases."""

import pytest
from httpx import ASGITransport, AsyncClient
from starlette.applications import Starlette
from starlette.responses import PlainTextResponse
from starlette.routing import Route

from app.middleware.auth import SessionTokenMiddleware


def _make_app(token: str | None = "valid-token"):
    """Build a minimal Starlette app with the middleware for testing."""

    async def api_endpoint(request):
        return PlainTextResponse("ok")

    async def health(request):
        return PlainTextResponse("healthy")

    async def token_endpoint(request):
        return PlainTextResponse("token-value")

    async def static_page(request):
        return PlainTextResponse("<html>hi</html>")

    app = Starlette(
        routes=[
            Route("/api/v1/things", api_endpoint),
            Route("/api/v1/health", health),
            Route("/api/v1/token", token_endpoint),
            Route("/page", static_page),
        ],
    )
    app.add_middleware(SessionTokenMiddleware)
    if token is not None:
        app.state.session_token = token
    return app


class TestSessionTokenMiddleware:
    """Test the authentication middleware in isolation."""

    @pytest.mark.asyncio
    async def test_valid_token_passes(self):
        app = _make_app("secret-token")
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get(
                "/api/v1/things", headers={"X-Momodoc-Token": "secret-token"}
            )
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_missing_token_returns_401(self):
        app = _make_app("secret-token")
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get("/api/v1/things")
        assert resp.status_code == 401
        assert "token" in resp.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_wrong_token_returns_401(self):
        app = _make_app("secret-token")
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get(
                "/api/v1/things", headers={"X-Momodoc-Token": "wrong-token"}
            )
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_empty_string_token_returns_401(self):
        app = _make_app("secret-token")
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get(
                "/api/v1/things", headers={"X-Momodoc-Token": ""}
            )
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_health_skips_auth(self):
        app = _make_app("secret-token")
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get("/api/v1/health")
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_token_endpoint_skips_auth(self):
        app = _make_app("secret-token")
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get("/api/v1/token")
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_non_api_path_skips_auth(self):
        """Static file paths (non /api/) should bypass token check."""
        app = _make_app("secret-token")
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get("/page")
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_options_preflight_skips_auth(self):
        """OPTIONS preflight should not fail auth with 401."""
        app = _make_app("secret-token")
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.options("/api/v1/things")
        assert resp.status_code != 401

    @pytest.mark.asyncio
    async def test_token_not_yet_set_returns_503(self):
        """Before lifespan sets the token, API requests should get 503."""
        app = _make_app(token=None)  # no token on app.state
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get(
                "/api/v1/things", headers={"X-Momodoc-Token": "anything"}
            )
        assert resp.status_code == 503
        assert "starting" in resp.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_timing_safe_comparison(self):
        """Token comparison should use constant-time hmac.compare_digest.

        We can't directly test timing, but we verify that a token which
        shares a common prefix with the real token is still rejected.
        """
        app = _make_app("abcdefghijklmnop")
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            # Same prefix, different suffix
            resp = await client.get(
                "/api/v1/things", headers={"X-Momodoc-Token": "abcdefghijklmnoX"}
            )
        assert resp.status_code == 401
