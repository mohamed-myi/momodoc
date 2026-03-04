"""Integration tests for chat endpoints."""

import pytest


@pytest.fixture
async def session_id(client, project_id):
    """Create a chat session and return its ID."""
    resp = await client.post(f"/api/v1/projects/{project_id}/chat/sessions")
    return resp.json()["id"]


class TestChatSessions:
    @pytest.mark.asyncio
    async def test_create_session_with_title(self, client, project_id):
        resp = await client.post(
            f"/api/v1/projects/{project_id}/chat/sessions",
            json={"title": "My Chat"},
        )
        assert resp.status_code == 201
        assert resp.json()["title"] == "My Chat"

    @pytest.mark.asyncio
    async def test_create_session_without_title(self, client, project_id):
        resp = await client.post(
            f"/api/v1/projects/{project_id}/chat/sessions",
        )
        assert resp.status_code == 201
        assert resp.json()["title"] is None

    @pytest.mark.asyncio
    async def test_list_sessions_empty(self, client, project_id):
        resp = await client.get(f"/api/v1/projects/{project_id}/chat/sessions")
        assert resp.status_code == 200
        assert resp.json() == []

    @pytest.mark.asyncio
    async def test_list_sessions_returns_created(self, client, project_id):
        await client.post(f"/api/v1/projects/{project_id}/chat/sessions")
        await client.post(f"/api/v1/projects/{project_id}/chat/sessions")
        resp = await client.get(f"/api/v1/projects/{project_id}/chat/sessions")
        assert len(resp.json()) == 2

    @pytest.mark.asyncio
    async def test_session_in_wrong_project_404(self, client, project_id, session_id):
        """Session created in one project should not be accessible from another."""
        resp2 = await client.post("/api/v1/projects", json={"name": "other-proj"})
        other_project = resp2.json()["id"]

        resp = await client.get(
            f"/api/v1/projects/{other_project}/chat/sessions/{session_id}/messages"
        )
        assert resp.status_code == 404


class TestChatMessages:
    @pytest.mark.asyncio
    async def test_send_message_and_get_response(self, client, project_id, session_id):
        """Sending a message should return an answer from the mock LLM."""
        resp = await client.post(
            f"/api/v1/projects/{project_id}/chat/sessions/{session_id}/messages",
            json={"query": "What is momodoc?"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "answer" in data
        assert data["answer"] == "Test answer"  # From mock_llm fixture
        assert "user_message_id" in data
        assert "assistant_message_id" in data

    @pytest.mark.asyncio
    async def test_messages_persisted_after_query(self, client, project_id, session_id):
        """After sending a message, both user and assistant messages should be retrievable."""
        await client.post(
            f"/api/v1/projects/{project_id}/chat/sessions/{session_id}/messages",
            json={"query": "Tell me about the project"},
        )

        resp = await client.get(
            f"/api/v1/projects/{project_id}/chat/sessions/{session_id}/messages"
        )
        assert resp.status_code == 200
        messages = resp.json()
        assert len(messages) == 2
        assert messages[0]["role"] == "user"
        assert messages[0]["content"] == "Tell me about the project"
        assert messages[1]["role"] == "assistant"

    @pytest.mark.asyncio
    async def test_auto_title_set_from_first_message(self, client, project_id):
        """Session title should auto-set from first user query when title is None."""
        resp = await client.post(
            f"/api/v1/projects/{project_id}/chat/sessions",
        )
        sid = resp.json()["id"]
        assert resp.json()["title"] is None

        await client.post(
            f"/api/v1/projects/{project_id}/chat/sessions/{sid}/messages",
            json={"query": "How does ingestion work?"},
        )

        # Re-fetch session list to check title was set
        resp = await client.get(f"/api/v1/projects/{project_id}/chat/sessions")
        sessions = resp.json()
        session = next(s for s in sessions if s["id"] == sid)
        assert session["title"] == "How does ingestion work?"

    @pytest.mark.asyncio
    async def test_empty_query_rejected(self, client, project_id, session_id):
        """Empty query should be rejected by schema validation."""
        resp = await client.post(
            f"/api/v1/projects/{project_id}/chat/sessions/{session_id}/messages",
            json={"query": ""},
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_nonexistent_session_404(self, client, project_id):
        """Sending message to nonexistent session should 404."""
        resp = await client.post(
            f"/api/v1/projects/{project_id}/chat/sessions/nonexistent/messages",
            json={"query": "hello"},
        )
        assert resp.status_code == 404


class TestChatSessionManagement:
    @pytest.mark.asyncio
    async def test_delete_session(self, client, project_id, session_id):
        """Deleting a session should return 204 and remove it from list."""
        resp = await client.delete(
            f"/api/v1/projects/{project_id}/chat/sessions/{session_id}"
        )
        assert resp.status_code == 204

        resp = await client.get(f"/api/v1/projects/{project_id}/chat/sessions")
        assert len(resp.json()) == 0

    @pytest.mark.asyncio
    async def test_delete_nonexistent_session_404(self, client, project_id):
        """Deleting a nonexistent session should return 404."""
        resp = await client.delete(
            f"/api/v1/projects/{project_id}/chat/sessions/nonexistent-id"
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_update_session_title(self, client, project_id, session_id):
        """Updating session title should persist the change."""
        resp = await client.patch(
            f"/api/v1/projects/{project_id}/chat/sessions/{session_id}",
            json={"title": "Renamed Session"},
        )
        assert resp.status_code == 200
        assert resp.json()["title"] == "Renamed Session"

    @pytest.mark.asyncio
    async def test_update_nonexistent_session_404(self, client, project_id):
        """Updating a nonexistent session should return 404."""
        resp = await client.patch(
            f"/api/v1/projects/{project_id}/chat/sessions/nonexistent-id",
            json={"title": "New Title"},
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_session_cascades_messages(self, client, project_id, session_id):
        """Deleting a session should also delete all its messages."""
        # Create a message in the session
        await client.post(
            f"/api/v1/projects/{project_id}/chat/sessions/{session_id}/messages",
            json={"query": "Test message"},
        )

        # Verify messages exist
        resp = await client.get(
            f"/api/v1/projects/{project_id}/chat/sessions/{session_id}/messages"
        )
        assert len(resp.json()) == 2  # user + assistant

        # Delete the session
        resp = await client.delete(
            f"/api/v1/projects/{project_id}/chat/sessions/{session_id}"
        )
        assert resp.status_code == 204


class TestGlobalChatSessions:
    @pytest.mark.asyncio
    async def test_create_global_session(self, client):
        """Global session should be created with project_id=None."""
        resp = await client.post("/api/v1/chat/sessions")
        assert resp.status_code == 201
        data = resp.json()
        assert data["project_id"] is None
        assert "id" in data

    @pytest.mark.asyncio
    async def test_create_global_session_with_title(self, client):
        """Global session with explicit title."""
        resp = await client.post(
            "/api/v1/chat/sessions", json={"title": "Global Chat"}
        )
        assert resp.status_code == 201
        assert resp.json()["title"] == "Global Chat"

    @pytest.mark.asyncio
    async def test_list_global_sessions(self, client):
        """Listing global sessions should only return sessions with project_id=None."""
        await client.post("/api/v1/chat/sessions")
        await client.post("/api/v1/chat/sessions")
        resp = await client.get("/api/v1/chat/sessions")
        assert resp.status_code == 200
        assert len(resp.json()) == 2
        for s in resp.json():
            assert s["project_id"] is None

    @pytest.mark.asyncio
    async def test_global_session_isolation_from_project_sessions(
        self, client, project_id
    ):
        """Global sessions should not appear in project session lists, and vice versa."""
        # Create a project session
        await client.post(f"/api/v1/projects/{project_id}/chat/sessions")
        # Create a global session
        await client.post("/api/v1/chat/sessions")

        # Project list should only contain the project session
        resp = await client.get(f"/api/v1/projects/{project_id}/chat/sessions")
        assert len(resp.json()) == 1
        assert resp.json()[0]["project_id"] == project_id

        # Global list should only contain the global session
        resp = await client.get("/api/v1/chat/sessions")
        assert len(resp.json()) == 1
        assert resp.json()[0]["project_id"] is None

    @pytest.mark.asyncio
    async def test_global_session_send_message(self, client):
        """Sending a message to a global session should work."""
        session_resp = await client.post("/api/v1/chat/sessions")
        sid = session_resp.json()["id"]

        resp = await client.post(
            f"/api/v1/chat/sessions/{sid}/messages",
            json={"query": "Global question"},
        )
        assert resp.status_code == 200
        assert resp.json()["answer"] == "Test answer"

    @pytest.mark.asyncio
    async def test_global_session_get_messages(self, client):
        """Getting messages from a global session should work."""
        session_resp = await client.post("/api/v1/chat/sessions")
        sid = session_resp.json()["id"]

        await client.post(
            f"/api/v1/chat/sessions/{sid}/messages",
            json={"query": "Global question"},
        )

        resp = await client.get(f"/api/v1/chat/sessions/{sid}/messages")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    @pytest.mark.asyncio
    async def test_delete_global_session(self, client):
        """Deleting a global session should work."""
        session_resp = await client.post("/api/v1/chat/sessions")
        sid = session_resp.json()["id"]

        resp = await client.delete(f"/api/v1/chat/sessions/{sid}")
        assert resp.status_code == 204

    @pytest.mark.asyncio
    async def test_update_global_session_title(self, client):
        """Updating a global session title should work."""
        session_resp = await client.post("/api/v1/chat/sessions")
        sid = session_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/chat/sessions/{sid}",
            json={"title": "Renamed Global"},
        )
        assert resp.status_code == 200
        assert resp.json()["title"] == "Renamed Global"

    @pytest.mark.asyncio
    async def test_global_stream_endpoint(self, client):
        """Global streaming endpoint should return SSE events."""
        session_resp = await client.post("/api/v1/chat/sessions")
        sid = session_resp.json()["id"]

        resp = await client.post(
            f"/api/v1/chat/sessions/{sid}/messages/stream",
            json={"query": "Stream global test"},
        )
        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers["content-type"]
        assert "event: sources" in resp.text
        assert "event: done" in resp.text


class TestChatLLMNotConfigured:
    @pytest.mark.asyncio
    async def test_chat_without_llm_returns_503(self, client, project_id, session_id):
        """When LLM is not configured, sending a message should return 503."""
        from app.core.exceptions import LLMNotConfiguredError
        from app.dependencies import get_llm_provider

        def override_no_llm():
            raise LLMNotConfiguredError()

        client._transport.app.dependency_overrides[get_llm_provider] = override_no_llm

        resp = await client.post(
            f"/api/v1/projects/{project_id}/chat/sessions/{session_id}/messages",
            json={"query": "This should fail"},
        )
        assert resp.status_code == 503
        assert "is configured" in resp.json()["detail"].lower()

        # Clean up handled by client fixture teardown


class TestChatStreaming:
    @pytest.mark.asyncio
    async def test_stream_returns_sse_events(self, client, project_id, session_id):
        """Streaming endpoint should return SSE with sources, data, and done events."""
        resp = await client.post(
            f"/api/v1/projects/{project_id}/chat/sessions/{session_id}/messages/stream",
            json={"query": "Stream test"},
        )
        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers["content-type"]

        body = resp.text
        assert "event: sources" in body
        assert "event: retrieval_metadata" in body
        assert "event: done" in body

    @pytest.mark.asyncio
    async def test_stream_persists_messages(self, client, project_id, session_id):
        """After streaming, both user and assistant messages should be persisted."""
        await client.post(
            f"/api/v1/projects/{project_id}/chat/sessions/{session_id}/messages/stream",
            json={"query": "Stream persist test"},
        )

        resp = await client.get(
            f"/api/v1/projects/{project_id}/chat/sessions/{session_id}/messages"
        )
        messages = resp.json()
        assert len(messages) == 2
        assert messages[0]["role"] == "user"
        assert messages[0]["content"] == "Stream persist test"
        assert messages[1]["role"] == "assistant"

    @pytest.mark.asyncio
    async def test_stream_auto_titles_session(self, client, project_id):
        """Streaming should auto-title the session from the first query."""
        session_resp = await client.post(
            f"/api/v1/projects/{project_id}/chat/sessions"
        )
        sid = session_resp.json()["id"]
        assert session_resp.json()["title"] is None

        await client.post(
            f"/api/v1/projects/{project_id}/chat/sessions/{sid}/messages/stream",
            json={"query": "What is dependency injection?"},
        )

        resp = await client.get(f"/api/v1/projects/{project_id}/chat/sessions")
        sessions = resp.json()
        session = next(s for s in sessions if s["id"] == sid)
        assert session["title"] == "What is dependency injection?"


class TestChatStreamingConnectionPool:
    """Test that concurrent streaming requests don't exhaust connection pool."""

    @pytest.mark.asyncio
    async def test_concurrent_streams_dont_exhaust_pool(self, client, project_id):
        """Multiple concurrent streams should all succeed without pool exhaustion."""
        import asyncio

        # Create 6 sessions (pool_size=5, so this would exhaust pool with old code)
        session_ids = []
        for i in range(6):
            resp = await client.post(
                f"/api/v1/projects/{project_id}/chat/sessions",
                json={"title": f"Concurrent test {i}"},
            )
            assert resp.status_code == 201
            session_ids.append(resp.json()["id"])

        # Stream to all 6 concurrently
        async def stream_query(sid):
            resp = await client.post(
                f"/api/v1/projects/{project_id}/chat/sessions/{sid}/messages/stream",
                json={"query": f"Test concurrent stream {sid}"},
            )
            return resp.status_code

        results = await asyncio.gather(*[stream_query(sid) for sid in session_ids])

        # All should succeed (200), none should timeout/fail
        assert all(status == 200 for status in results)


class TestChatRateLimiting:
    @pytest.mark.asyncio
    async def test_chat_message_endpoint_returns_429_when_limit_exceeded(
        self, client, project_id, session_id, test_settings
    ):
        from app.core.rate_limiter import ChatRateLimiter

        limited_settings = test_settings.model_copy(
            update={
                "chat_rate_limit_window_seconds": 60,
                "chat_rate_limit_client_requests": 1,
                "chat_rate_limit_global_requests": 100,
                "chat_stream_rate_limit_client_requests": 100,
                "chat_stream_rate_limit_global_requests": 100,
            }
        )
        client._transport.app.state.chat_rate_limiter = ChatRateLimiter(limited_settings)

        first = await client.post(
            f"/api/v1/projects/{project_id}/chat/sessions/{session_id}/messages",
            json={"query": "first allowed request"},
        )
        assert first.status_code == 200

        second = await client.post(
            f"/api/v1/projects/{project_id}/chat/sessions/{session_id}/messages",
            json={"query": "second should be throttled"},
        )
        assert second.status_code == 429
        assert "Retry-After" in second.headers
        assert second.json()["scope"] == "chat_client"
