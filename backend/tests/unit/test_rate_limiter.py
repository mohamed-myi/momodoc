"""Unit tests for chat endpoint rate limiting."""

from starlette.requests import Request
import pytest

from app.config import Settings
from app.core.exceptions import RateLimitExceededError
from app.core.rate_limiter import ChatRateLimiter


def _request(token: str) -> Request:
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/v1/chat/sessions/session-id/messages",
        "headers": [(b"x-momodoc-token", token.encode("utf-8"))],
        "client": ("127.0.0.1", 12345),
    }
    return Request(scope)


@pytest.mark.asyncio
async def test_message_rate_limit_enforces_per_client_quota():
    settings = Settings(
        momodoc_data_dir="/tmp/momodoc-test-rate-limit-1",
        chat_rate_limit_window_seconds=60,
        chat_rate_limit_client_requests=2,
        chat_rate_limit_global_requests=100,
        chat_stream_rate_limit_client_requests=100,
        chat_stream_rate_limit_global_requests=100,
    )
    limiter = ChatRateLimiter(settings)
    req = _request("client-a")

    await limiter.enforce_message(req)
    await limiter.enforce_message(req)

    with pytest.raises(RateLimitExceededError, match="chat_client"):
        await limiter.enforce_message(req)


@pytest.mark.asyncio
async def test_message_rate_limit_enforces_global_quota_across_clients():
    settings = Settings(
        momodoc_data_dir="/tmp/momodoc-test-rate-limit-2",
        chat_rate_limit_window_seconds=60,
        chat_rate_limit_client_requests=100,
        chat_rate_limit_global_requests=2,
        chat_stream_rate_limit_client_requests=100,
        chat_stream_rate_limit_global_requests=100,
    )
    limiter = ChatRateLimiter(settings)

    await limiter.enforce_message(_request("client-a"))
    await limiter.enforce_message(_request("client-b"))

    with pytest.raises(RateLimitExceededError, match="chat_global"):
        await limiter.enforce_message(_request("client-c"))


@pytest.mark.asyncio
async def test_stream_limits_are_independent_from_message_limits():
    settings = Settings(
        momodoc_data_dir="/tmp/momodoc-test-rate-limit-3",
        chat_rate_limit_window_seconds=60,
        chat_rate_limit_client_requests=100,
        chat_rate_limit_global_requests=100,
        chat_stream_rate_limit_client_requests=1,
        chat_stream_rate_limit_global_requests=100,
    )
    limiter = ChatRateLimiter(settings)
    req = _request("stream-client")

    await limiter.enforce_stream(req)
    with pytest.raises(RateLimitExceededError, match="chat_stream_client"):
        await limiter.enforce_stream(req)

    # Message limit should remain unaffected by stream quota.
    await limiter.enforce_message(req)
