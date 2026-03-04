"""Integration tests for health endpoint."""

import pytest


class TestHealthEndpoint:
    @pytest.mark.asyncio
    async def test_health_check(self, client):
        """GET /health should return 200 with service info."""
        resp = await client.get("/api/v1/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["service"] == "momodoc"
