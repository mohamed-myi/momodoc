"""Session token authentication middleware.

On startup the backend generates a transient token and writes it to the
user data directory.  All ``/api/`` requests (except health and token
endpoints) must include this token in the ``X-Momodoc-Token`` header.

The middleware reads the expected token from ``request.app.state.session_token``
so it can be added to the app before the lifespan sets the token value.
"""

import hmac

from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

# Paths that bypass token validation
_SKIP_PATHS = frozenset({"/api/v1/health", "/api/v1/token"})


class SessionTokenMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        method = (scope.get("method") or "").upper()
        if method == "OPTIONS":
            # CORS preflight must not require auth headers.
            await self.app(scope, receive, send)
            return

        path = (scope.get("path") or "").rstrip("/") or "/"

        # Skip non-API routes (static files, etc.), exempt endpoints, and WebSocket.
        # (WS auth is handled in the endpoint itself via query param.)
        if not path.startswith("/api/") or path in _SKIP_PATHS or path == "/ws":
            await self.app(scope, receive, send)
            return

        app = scope["app"]
        expected = getattr(app.state, "session_token", None)
        if expected is None:
            response = JSONResponse(
                status_code=503,
                content={"detail": "Server is starting up"},
            )
            await response(scope, receive, send)
            return

        headers = Headers(scope=scope)
        provided = headers.get("x-momodoc-token")
        if provided is None or not hmac.compare_digest(provided, expected):
            response = JSONResponse(
                status_code=401,
                content={"detail": "Invalid or missing session token"},
            )
            await response(scope, receive, send)
            return

        await self.app(scope, receive, send)
