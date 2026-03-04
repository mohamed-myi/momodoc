"""HTTP request logging middleware."""

import logging
import time

from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger("momodoc.access")

# Prefixes to skip logging (health checks, static assets)
_SKIP_PREFIXES = ("/api/v1/health", "/static/", "/_next/", "/favicon")


class RequestLoggingMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path") or ""
        if any(path.startswith(prefix) for prefix in _SKIP_PREFIXES):
            await self.app(scope, receive, send)
            return

        method = scope.get("method") or "UNKNOWN"
        start = time.monotonic()
        logged = False

        async def send_wrapper(message: Message) -> None:
            nonlocal logged

            if message["type"] == "http.response.start":
                duration_ms = (time.monotonic() - start) * 1000
                logger.info(
                    "%s %s %d %.1fms",
                    method,
                    path,
                    message["status"],
                    duration_ms,
                )
                logged = True
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            if not logged:
                duration_ms = (time.monotonic() - start) * 1000
                logger.info("%s %s %d %.1fms", method, path, 500, duration_ms)
            raise
