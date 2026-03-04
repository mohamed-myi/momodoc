import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.core.exceptions import (
    ConflictError,
    EmbeddingModelMismatchError,
    EmbeddingServiceUnavailableError,
    LLMError,
    LLMNotConfiguredError,
    NotFoundError,
    RateLimitExceededError,
    ValidationError,
    VectorStoreError,
)

logger = logging.getLogger(__name__)


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(NotFoundError)
    async def not_found_handler(request: Request, exc: NotFoundError):
        return JSONResponse(status_code=404, content={"detail": str(exc)})

    @app.exception_handler(ValidationError)
    async def validation_handler(request: Request, exc: ValidationError):
        return JSONResponse(status_code=422, content={"detail": exc.message})

    @app.exception_handler(LLMNotConfiguredError)
    async def llm_not_configured_handler(request: Request, exc: LLMNotConfiguredError):
        return JSONResponse(status_code=503, content={"detail": str(exc)})

    @app.exception_handler(LLMError)
    async def llm_error_handler(request: Request, exc: LLMError):
        return JSONResponse(status_code=502, content={"detail": exc.message})

    @app.exception_handler(EmbeddingModelMismatchError)
    async def embedding_mismatch_handler(request: Request, exc: EmbeddingModelMismatchError):
        return JSONResponse(status_code=409, content={"detail": str(exc)})

    @app.exception_handler(EmbeddingServiceUnavailableError)
    async def embedding_unavailable_handler(
        request: Request,
        exc: EmbeddingServiceUnavailableError,
    ):
        return JSONResponse(status_code=503, content={"detail": exc.message})

    @app.exception_handler(ConflictError)
    async def conflict_handler(request: Request, exc: ConflictError):
        return JSONResponse(status_code=409, content={"detail": exc.message})

    @app.exception_handler(RateLimitExceededError)
    async def rate_limit_handler(request: Request, exc: RateLimitExceededError):
        return JSONResponse(
            status_code=429,
            content={
                "detail": exc.message,
                "scope": exc.scope,
                "limit": exc.limit,
                "retry_after_seconds": exc.retry_after_seconds,
            },
            headers={"Retry-After": str(exc.retry_after_seconds)},
        )

    @app.exception_handler(VectorStoreError)
    async def vectorstore_error_handler(request: Request, exc: VectorStoreError):
        return JSONResponse(status_code=500, content={"detail": "Internal vector storage error"})

    @app.exception_handler(Exception)
    async def exception_handler(request: Request, exc: Exception):
        logger.exception("Unhandled exception: %s", exc)
        return JSONResponse(status_code=500, content={"detail": "Internal server error"})
