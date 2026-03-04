"""In-memory sliding-window rate limiting for chat/LLM endpoints."""

from __future__ import annotations

import asyncio
import hashlib
import time
from collections import deque
from dataclasses import dataclass

from fastapi import Request

from app.config import Settings
from app.core.exceptions import RateLimitExceededError


@dataclass(frozen=True)
class _BucketConfig:
    limit: int
    window_seconds: int
    scope: str


class _SlidingWindowLimiter:
    def __init__(self, limit: int, window_seconds: int) -> None:
        if limit < 1:
            raise ValueError("Rate-limit 'limit' must be >= 1")
        if window_seconds < 1:
            raise ValueError("Rate-limit 'window_seconds' must be >= 1")

        self._limit = limit
        self._window_seconds = window_seconds
        self._hits: dict[str, deque[float]] = {}
        self._lock = asyncio.Lock()

    async def check(self, key: str) -> tuple[bool, int]:
        now = time.monotonic()
        cutoff = now - self._window_seconds

        async with self._lock:
            bucket = self._hits.get(key)
            if bucket is None:
                bucket = deque()
                self._hits[key] = bucket

            while bucket and bucket[0] <= cutoff:
                bucket.popleft()

            if len(bucket) >= self._limit:
                retry_after = max(int(bucket[0] + self._window_seconds - now), 1)
                if not bucket:
                    self._hits.pop(key, None)
                return False, retry_after

            bucket.append(now)
            return True, 0


class ChatRateLimiter:
    """Two-tier limiter: per-client + global, with separate stream/message buckets."""

    def __init__(self, settings: Settings) -> None:
        self._enabled = settings.chat_rate_limit_enabled
        window = settings.chat_rate_limit_window_seconds

        self._message_client_cfg = _BucketConfig(
            limit=settings.chat_rate_limit_client_requests,
            window_seconds=window,
            scope="chat_client",
        )
        self._message_global_cfg = _BucketConfig(
            limit=settings.chat_rate_limit_global_requests,
            window_seconds=window,
            scope="chat_global",
        )
        self._stream_client_cfg = _BucketConfig(
            limit=settings.chat_stream_rate_limit_client_requests,
            window_seconds=window,
            scope="chat_stream_client",
        )
        self._stream_global_cfg = _BucketConfig(
            limit=settings.chat_stream_rate_limit_global_requests,
            window_seconds=window,
            scope="chat_stream_global",
        )

        self._message_client = _SlidingWindowLimiter(
            self._message_client_cfg.limit, self._message_client_cfg.window_seconds
        )
        self._message_global = _SlidingWindowLimiter(
            self._message_global_cfg.limit, self._message_global_cfg.window_seconds
        )
        self._stream_client = _SlidingWindowLimiter(
            self._stream_client_cfg.limit, self._stream_client_cfg.window_seconds
        )
        self._stream_global = _SlidingWindowLimiter(
            self._stream_global_cfg.limit, self._stream_global_cfg.window_seconds
        )

    @staticmethod
    def _client_key(request: Request) -> str:
        token = request.headers.get("x-momodoc-token")
        if token:
            token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()[:16]
            return f"token:{token_hash}"

        if request.client and request.client.host:
            return f"ip:{request.client.host}"

        return "anonymous"

    async def enforce_message(self, request: Request) -> None:
        await self._enforce(request, is_stream=False)

    async def enforce_stream(self, request: Request) -> None:
        await self._enforce(request, is_stream=True)

    async def _enforce(self, request: Request, *, is_stream: bool) -> None:
        if not self._enabled:
            return

        client_key = self._client_key(request)
        if is_stream:
            checks = (
                (self._stream_client, client_key, self._stream_client_cfg),
                (self._stream_global, "global", self._stream_global_cfg),
            )
            request_kind = "stream"
        else:
            checks = (
                (self._message_client, client_key, self._message_client_cfg),
                (self._message_global, "global", self._message_global_cfg),
            )
            request_kind = "request"

        for limiter, key, cfg in checks:
            allowed, retry_after = await limiter.check(key)
            if allowed:
                continue
            raise RateLimitExceededError(
                f"Chat {request_kind} rate limit exceeded for scope '{cfg.scope}' "
                f"({cfg.limit} per {cfg.window_seconds}s).",
                retry_after_seconds=retry_after,
                limit=cfg.limit,
                scope=cfg.scope,
            )
