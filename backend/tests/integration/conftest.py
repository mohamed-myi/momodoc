"""Shared fixtures for integration tests."""

import uuid

import pytest


@pytest.fixture
async def project_id(client):
    """Create a project and return its ID for integration endpoint tests."""
    resp = await client.post(
        "/api/v1/projects",
        json={"name": f"integration-test-project-{uuid.uuid4().hex}"},
    )
    assert resp.status_code == 201
    return resp.json()["id"]
