import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.bootstrap.exceptions import register_exception_handlers
from app.bootstrap.routes import register_routers
from app.bootstrap.startup import lifespan
from app.dependencies import get_settings
from app.middleware.auth import SessionTokenMiddleware
from app.middleware.logging import RequestLoggingMiddleware


class SPAStaticFiles(StaticFiles):
    """Serve index.html for client-side routes while preserving asset 404s."""

    async def get_response(self, path: str, scope):  # type: ignore[override]
        response = await super().get_response(path, scope)
        if response.status_code != 404:
            return response
        # Preserve 404 for missing static assets with explicit file extensions.
        if os.path.splitext(path)[1]:
            return response
        return await super().get_response("index.html", scope)


def create_app() -> FastAPI:
    app = FastAPI(title="momodoc", version="0.1.0", lifespan=lifespan)

    # Session token middleware (reads token from app.state set during lifespan)
    # RequestLoggingMiddleware added first so it wraps outermost (Starlette stack order)
    app.add_middleware(SessionTokenMiddleware)
    app.add_middleware(RequestLoggingMiddleware)
    # Allow Electron renderer (localhost during dev, file:// origin as "null" in production)
    # to call local API endpoints that require custom headers and trigger preflight.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["null"],
        allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
        allow_methods=["*"],
        allow_headers=["*"],
    )

    register_exception_handlers(app)
    register_routers(app)

    @app.get("/api/v1/health")
    async def health():
        return {
            "status": "ok",
            "service": "momodoc",
            "ready": getattr(app.state, "startup_complete", False),
        }

    @app.get("/api/v1/token")
    async def get_token(request: Request):
        """Return the session token — only accessible from localhost."""
        client_host = request.client.host if request.client else None
        if client_host not in ("127.0.0.1", "::1", "localhost"):
            return JSONResponse(status_code=403, content={"detail": "Forbidden"})
        return {"token": request.app.state.session_token}

    # Mount static frontend (if directory exists)
    settings = get_settings()
    static_dir = settings.static_dir or str(Path(__file__).resolve().parent.parent / "static")
    if os.path.isdir(static_dir):
        app.mount("/", SPAStaticFiles(directory=static_dir, html=True), name="frontend")

    return app


app = create_app()
