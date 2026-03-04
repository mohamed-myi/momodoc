"""Integration tests for authentication and token endpoint."""

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import create_app
from tests.conftest import TEST_TOKEN


class TestTokenAuth:
    """Test that the full app enforces token auth correctly."""

    @pytest.mark.asyncio
    async def test_request_without_token_is_rejected(self, client):
        """A real API endpoint should reject requests without the token header."""
        # Build a second client with no auth header
        app = create_app()
        app.state.session_token = TEST_TOKEN

        transport = ASGITransport(app=app)
        async with AsyncClient(
            transport=transport, base_url="http://test"
        ) as unauthed:
            resp = await unauthed.get("/api/v1/projects")
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_request_with_wrong_token_is_rejected(self, client):
        app = create_app()
        app.state.session_token = TEST_TOKEN

        transport = ASGITransport(app=app)
        async with AsyncClient(
            transport=transport,
            base_url="http://test",
            headers={"X-Momodoc-Token": "wrong-token"},
        ) as bad_client:
            resp = await bad_client.get("/api/v1/projects")
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_health_endpoint_no_auth_required(self, client):
        """GET /api/v1/health should work without any token."""
        app = create_app()
        app.state.session_token = TEST_TOKEN

        transport = ASGITransport(app=app)
        async with AsyncClient(
            transport=transport, base_url="http://test"
        ) as unauthed:
            resp = await unauthed.get("/api/v1/health")
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_valid_token_allows_request(self, client):
        """The test client fixture has the right token — requests should succeed."""
        resp = await client.get("/api/v1/projects")
        assert resp.status_code == 200


class TestTokenEndpoint:
    """Test the GET /api/v1/token endpoint."""

    @pytest.mark.asyncio
    async def test_token_endpoint_returns_token_for_localhost(self, client):
        """Localhost requests should get the token."""
        # The test client's ASGI transport reports 127.0.0.1 as client host
        resp = await client.get("/api/v1/token")
        assert resp.status_code == 200
        data = resp.json()
        assert "token" in data
        assert data["token"] == TEST_TOKEN
