import json
import logging
import traceback

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.async_vectordb import AsyncVectorStore
from app.config import Settings
from app.dependencies import (
    enforce_chat_message_rate_limit,
    enforce_chat_stream_rate_limit,
    get_db,
    get_embedder,
    get_llm_provider,
    get_project,
    get_provider_registry,
    get_query_llm,
    get_reranker,
    get_settings,
    get_vectordb,
    resolve_llm_provider,
)
from app.llm.base import LLMProvider
from app.llm.factory import ProviderRegistry
from app.schemas.chat import (
    ChatMessageRequest,
    ChatMessageResponse,
    ChatResponse,
    ChatSessionCreate,
    ChatSessionResponse,
    ChatSessionUpdate,
    ChatSource,
)
from app.services import chat_service
from app.services.ingestion.embedder import Embedder
from app.services.reranker import Reranker

logger = logging.getLogger(__name__)

router = APIRouter()


def _format_messages(messages) -> list[ChatMessageResponse]:
    """Convert ChatMessage ORM objects to response models with sources from relationship."""
    result = []
    for msg in messages:
        sources = [
            ChatSource(
                source_type=s.source_type,
                source_id=s.source_id,
                filename=s.filename,
                original_path=s.original_path,
                chunk_text=s.chunk_text,
                chunk_index=s.chunk_index,
                score=s.score,
                section_header=getattr(s, "section_header", ""),
            )
            for s in msg.sources
        ]
        result.append(
            ChatMessageResponse(
                id=msg.id,
                session_id=msg.session_id,
                role=msg.role,
                content=msg.content,
                sources=sources,
                created_at=msg.created_at,
            )
        )
    return result


def _resolve_provider(
    data: ChatMessageRequest,
    registry: ProviderRegistry,
    default_llm: LLMProvider | None,
) -> LLMProvider:
    """Resolve the LLM provider from the request's llm_mode or fall back to default."""
    return resolve_llm_provider(data.llm_mode, registry, default_llm)


def _stream_response(
    vectordb,
    embedder,
    llm,
    project_id,
    session_id,
    data: ChatMessageRequest,
    reranker: Reranker | None = None,
    candidate_k: int | None = None,
    query_llm: LLMProvider | None = None,
):
    """Build a StreamingResponse for chat streaming."""

    async def event_generator():
        try:
            async for event in chat_service.stream_query(
                vectordb=vectordb,
                embedder=embedder,
                llm=llm,
                project_id=project_id,
                session_id=session_id,
                user_query=data.query,
                top_k=data.top_k,
                include_history=data.include_history,
                pinned_source_ids=data.pinned_source_ids,
                reranker=reranker,
                candidate_k=candidate_k,
                query_llm=query_llm,
            ):
                yield event
        except Exception as e:
            logger.error("Stream error: %s\n%s", e, traceback.format_exc())
            error_payload = json.dumps(
                {
                    "error": str(e),
                    "type": type(e).__name__,
                }
            )
            yield f"event: error\ndata: {error_payload}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


async def _create_session_impl(
    db: AsyncSession,
    project_id: str | None,
    data: ChatSessionCreate | None,
):
    title = data.title if data else None
    return await chat_service.create_session(db, project_id, title)


async def _list_sessions_impl(
    db: AsyncSession,
    project_id: str | None,
    offset: int,
    limit: int,
):
    return await chat_service.list_sessions(db, project_id, offset=offset, limit=limit)


async def _delete_session_impl(
    db: AsyncSession,
    project_id: str | None,
    session_id: str,
):
    await chat_service.delete_session(db, project_id, session_id)


async def _update_session_impl(
    db: AsyncSession,
    project_id: str | None,
    session_id: str,
    data: ChatSessionUpdate,
):
    return await chat_service.update_session(db, project_id, session_id, data)


async def _get_messages_impl(
    db: AsyncSession,
    project_id: str | None,
    session_id: str,
    offset: int,
    limit: int,
):
    await chat_service.get_session(db, project_id, session_id)
    messages = await chat_service.get_messages(db, session_id, offset=offset, limit=limit)
    return _format_messages(messages)


async def _send_message_impl(
    session_id: str,
    data: ChatMessageRequest,
    project_id: str | None,
    vectordb: AsyncVectorStore,
    embedder: Embedder,
    default_llm: LLMProvider,
    registry: ProviderRegistry,
    reranker: Reranker | None = None,
    candidate_k: int | None = None,
    query_llm: LLMProvider | None = None,
):
    llm = _resolve_provider(data, registry, default_llm)
    return await chat_service.query(
        vectordb=vectordb,
        embedder=embedder,
        llm=llm,
        project_id=project_id,
        session_id=session_id,
        user_query=data.query,
        top_k=data.top_k,
        include_history=data.include_history,
        pinned_source_ids=data.pinned_source_ids,
        reranker=reranker,
        candidate_k=candidate_k,
        query_llm=query_llm,
    )


async def _stream_message_impl(
    session_id: str,
    data: ChatMessageRequest,
    project_id: str | None,
    vectordb: AsyncVectorStore,
    embedder: Embedder,
    default_llm: LLMProvider,
    registry: ProviderRegistry,
    reranker: Reranker | None = None,
    candidate_k: int | None = None,
    query_llm: LLMProvider | None = None,
):
    llm = _resolve_provider(data, registry, default_llm)
    return _stream_response(
        vectordb,
        embedder,
        llm,
        project_id,
        session_id,
        data,
        reranker=reranker,
        candidate_k=candidate_k,
        query_llm=query_llm,
    )


@router.post(
    "/projects/{project_id}/chat/sessions",
    response_model=ChatSessionResponse,
    status_code=201,
)
async def create_session(
    data: ChatSessionCreate | None = None,
    project=Depends(get_project),
    db: AsyncSession = Depends(get_db),
):
    return await _create_session_impl(db=db, project_id=project.id, data=data)


@router.get(
    "/projects/{project_id}/chat/sessions",
    response_model=list[ChatSessionResponse],
)
async def list_sessions(
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    project=Depends(get_project),
    db: AsyncSession = Depends(get_db),
):
    return await _list_sessions_impl(
        db=db,
        project_id=project.id,
        offset=offset,
        limit=limit,
    )


@router.delete(
    "/projects/{project_id}/chat/sessions/{session_id}",
    status_code=204,
)
async def delete_session(
    session_id: str,
    project=Depends(get_project),
    db: AsyncSession = Depends(get_db),
):
    await _delete_session_impl(db=db, project_id=project.id, session_id=session_id)


@router.patch(
    "/projects/{project_id}/chat/sessions/{session_id}",
    response_model=ChatSessionResponse,
)
async def update_session(
    session_id: str,
    data: ChatSessionUpdate,
    project=Depends(get_project),
    db: AsyncSession = Depends(get_db),
):
    return await _update_session_impl(
        db=db,
        project_id=project.id,
        session_id=session_id,
        data=data,
    )


@router.get(
    "/projects/{project_id}/chat/sessions/{session_id}/messages",
    response_model=list[ChatMessageResponse],
)
async def get_messages(
    session_id: str,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    project=Depends(get_project),
    db: AsyncSession = Depends(get_db),
):
    return await _get_messages_impl(
        db=db,
        project_id=project.id,
        session_id=session_id,
        offset=offset,
        limit=limit,
    )


@router.post(
    "/projects/{project_id}/chat/sessions/{session_id}/messages",
    response_model=ChatResponse,
)
async def send_message(
    session_id: str,
    data: ChatMessageRequest,
    project=Depends(get_project),
    vectordb: AsyncVectorStore = Depends(get_vectordb),
    embedder: Embedder = Depends(get_embedder),
    default_llm: LLMProvider = Depends(get_llm_provider),
    registry: ProviderRegistry = Depends(get_provider_registry),
    reranker: Reranker | None = Depends(get_reranker),
    settings: Settings = Depends(get_settings),
    query_llm: LLMProvider | None = Depends(get_query_llm),
    _rate_limit: None = Depends(enforce_chat_message_rate_limit),
):
    return await _send_message_impl(
        session_id=session_id,
        data=data,
        project_id=project.id,
        vectordb=vectordb,
        embedder=embedder,
        default_llm=default_llm,
        registry=registry,
        reranker=reranker,
        candidate_k=settings.retrieval_candidate_k,
        query_llm=query_llm,
    )


@router.post(
    "/projects/{project_id}/chat/sessions/{session_id}/messages/stream",
)
async def stream_message(
    session_id: str,
    data: ChatMessageRequest,
    project=Depends(get_project),
    vectordb: AsyncVectorStore = Depends(get_vectordb),
    embedder: Embedder = Depends(get_embedder),
    default_llm: LLMProvider = Depends(get_llm_provider),
    registry: ProviderRegistry = Depends(get_provider_registry),
    reranker: Reranker | None = Depends(get_reranker),
    settings: Settings = Depends(get_settings),
    query_llm: LLMProvider | None = Depends(get_query_llm),
    _rate_limit: None = Depends(enforce_chat_stream_rate_limit),
):
    return await _stream_message_impl(
        session_id=session_id,
        data=data,
        project_id=project.id,
        vectordb=vectordb,
        embedder=embedder,
        default_llm=default_llm,
        registry=registry,
        reranker=reranker,
        candidate_k=settings.retrieval_candidate_k,
        query_llm=query_llm,
    )


@router.post(
    "/chat/sessions",
    response_model=ChatSessionResponse,
    status_code=201,
)
async def create_global_session(
    data: ChatSessionCreate | None = None,
    db: AsyncSession = Depends(get_db),
):
    return await _create_session_impl(db=db, project_id=None, data=data)


@router.get(
    "/chat/sessions",
    response_model=list[ChatSessionResponse],
)
async def list_global_sessions(
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    return await _list_sessions_impl(
        db=db,
        project_id=None,
        offset=offset,
        limit=limit,
    )


@router.delete(
    "/chat/sessions/{session_id}",
    status_code=204,
)
async def delete_global_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
):
    await _delete_session_impl(db=db, project_id=None, session_id=session_id)


@router.patch(
    "/chat/sessions/{session_id}",
    response_model=ChatSessionResponse,
)
async def update_global_session(
    session_id: str,
    data: ChatSessionUpdate,
    db: AsyncSession = Depends(get_db),
):
    return await _update_session_impl(
        db=db,
        project_id=None,
        session_id=session_id,
        data=data,
    )


@router.get(
    "/chat/sessions/{session_id}/messages",
    response_model=list[ChatMessageResponse],
)
async def get_global_messages(
    session_id: str,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    return await _get_messages_impl(
        db=db,
        project_id=None,
        session_id=session_id,
        offset=offset,
        limit=limit,
    )


@router.post(
    "/chat/sessions/{session_id}/messages",
    response_model=ChatResponse,
)
async def send_global_message(
    session_id: str,
    data: ChatMessageRequest,
    vectordb: AsyncVectorStore = Depends(get_vectordb),
    embedder: Embedder = Depends(get_embedder),
    default_llm: LLMProvider = Depends(get_llm_provider),
    registry: ProviderRegistry = Depends(get_provider_registry),
    reranker: Reranker | None = Depends(get_reranker),
    settings: Settings = Depends(get_settings),
    query_llm: LLMProvider | None = Depends(get_query_llm),
    _rate_limit: None = Depends(enforce_chat_message_rate_limit),
):
    return await _send_message_impl(
        session_id=session_id,
        data=data,
        project_id=None,
        vectordb=vectordb,
        embedder=embedder,
        default_llm=default_llm,
        registry=registry,
        reranker=reranker,
        candidate_k=settings.retrieval_candidate_k,
        query_llm=query_llm,
    )


@router.post(
    "/chat/sessions/{session_id}/messages/stream",
)
async def stream_global_message(
    session_id: str,
    data: ChatMessageRequest,
    vectordb: AsyncVectorStore = Depends(get_vectordb),
    embedder: Embedder = Depends(get_embedder),
    default_llm: LLMProvider = Depends(get_llm_provider),
    registry: ProviderRegistry = Depends(get_provider_registry),
    reranker: Reranker | None = Depends(get_reranker),
    settings: Settings = Depends(get_settings),
    query_llm: LLMProvider | None = Depends(get_query_llm),
    _rate_limit: None = Depends(enforce_chat_stream_rate_limit),
):
    return await _stream_message_impl(
        session_id=session_id,
        data=data,
        project_id=None,
        vectordb=vectordb,
        embedder=embedder,
        default_llm=default_llm,
        registry=registry,
        reranker=reranker,
        candidate_k=settings.retrieval_candidate_k,
        query_llm=query_llm,
    )
