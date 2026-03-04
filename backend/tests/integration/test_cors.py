"""Integration tests for CORS behavior used by Electron renderer requests."""

import pytest


class TestCors:
    @pytest.mark.asyncio
    async def test_preflight_allows_localhost_origin_and_token_header(self, client):
        """OPTIONS preflight should succeed for Electron/web dev origins."""
        origin = "http://localhost:5173"
        resp = await client.options(
            "/api/v1/projects",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "x-momodoc-token",
            },
        )
        assert resp.status_code == 200
        assert resp.headers.get("access-control-allow-origin") == origin
        allow_headers = resp.headers.get("access-control-allow-headers", "").lower()
        assert "x-momodoc-token" in allow_headers
