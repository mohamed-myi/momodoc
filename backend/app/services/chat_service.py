from __future__ import annotations

import json
import logging
import time
from collections.abc import AsyncIterator

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.async_vectordb import AsyncVectorStore
from app.core.exceptions import NotFoundError
from app.llm.base import LLMProvider
from app.models.chat_message import ChatMessage
from app.models.chat_session import ChatSession
from app.schemas.chat import ChatResponse, ChatSessionUpdate
from app.services.chat_workflow import (
    prepare_chat_llm_inputs,
    prepare_user_chat_turn,
    save_assistant_chat_turn,
)
from app.services.ingestion.embedder import Embedder

TYPE_CHECKING = False
if TYPE_CHECKING:
    from app.services.reranker import Reranker

logger = logging.getLogger(__name__)


async def create_session(
    db: AsyncSession, project_id: str | None, title: str | None = None
) -> ChatSession:
    session = ChatSession(project_id=project_id, title=title)
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


async def list_sessions(
    db: AsyncSession, project_id: str | None, offset: int = 0, limit: int = 20
) -> list[ChatSession]:
    stmt = select(ChatSession)
    if project_id is None:
        stmt = stmt.where(ChatSession.project_id.is_(None))
    else:
        stmt = stmt.where(ChatSession.project_id == project_id)
    stmt = stmt.order_by(ChatSession.updated_at.desc()).offset(offset).limit(limit)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_session(db: AsyncSession, project_id: str | None, session_id: str) -> ChatSession:
    stmt = select(ChatSession).where(ChatSession.id == session_id)
    if project_id is None:
        stmt = stmt.where(ChatSession.project_id.is_(None))
    else:
        stmt = stmt.where(ChatSession.project_id == project_id)
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()
    if session is None:
        raise NotFoundError("ChatSession", session_id)
    return session


async def delete_session(db: AsyncSession, project_id: str | None, session_id: str) -> None:
    session = await get_session(db, project_id, session_id)
    await db.delete(session)
    await db.commit()


async def update_session(
    db: AsyncSession,
    project_id: str | None,
    session_id: str,
    data: ChatSessionUpdate,
) -> ChatSession:
    session = await get_session(db, project_id, session_id)
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(session, field, value)
    await db.commit()
    await db.refresh(session)
    return session


async def get_messages(
    db: AsyncSession, session_id: str, offset: int = 0, limit: int = 50
) -> list[ChatMessage]:
    result = await db.execute(
        select(ChatMessage)
        .options(selectinload(ChatMessage.sources))
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.asc())
        .offset(offset)
        .limit(limit)
    )
    return list(result.scalars().all())


async def query(
    vectordb: AsyncVectorStore,
    embedder: Embedder,
    llm: LLMProvider,
    project_id: str | None,
    session_id: str,
    user_query: str,
    top_k: int = 10,
    include_history: bool = False,
    pinned_source_ids: list[str] | None = None,
    reranker: Reranker | None = None,
    candidate_k: int | None = None,
    query_llm: LLMProvider | None = None,
) -> ChatResponse:
    logger.info("Chat query: session=%s query_len=%d", session_id, len(user_query))
    logger.debug("Chat query text: %s", user_query)

    prepared_turn = await prepare_user_chat_turn(
        project_id=project_id,
        session_id=session_id,
        user_query=user_query,
        include_history=include_history,
        load_session=get_session,
    )

    llm_inputs = await prepare_chat_llm_inputs(
        vectordb=vectordb,
        embedder=embedder,
        llm=llm,
        project_id=project_id,
        session_id=session_id,
        user_query=user_query,
        history=prepared_turn.history,
        top_k=top_k,
        pinned_source_ids=pinned_source_ids,
        reranker=reranker,
        candidate_k=candidate_k,
        query_llm=query_llm,
    )

    llm_start = time.monotonic()
    response = await llm.complete(llm_inputs.messages)
    llm_ms = (time.monotonic() - llm_start) * 1000
    logger.info(
        "Chat response: session=%s len=%d usage=%s duration=%.1fms",
        session_id,
        len(response.content),
        response.usage,
        llm_ms,
    )

    assistant_msg_id = await save_assistant_chat_turn(
        session_id=session_id,
        content=response.content,
        context_sources=llm_inputs.context_sources,
    )

    return ChatResponse(
        answer=response.content,
        sources=llm_inputs.context_sources,
        model=response.model,
        user_message_id=prepared_turn.user_message_id,
        assistant_message_id=assistant_msg_id,
        retrieval_metadata=llm_inputs.retrieval_metadata,
    )


async def stream_query(
    vectordb: AsyncVectorStore,
    embedder: Embedder,
    llm: LLMProvider,
    project_id: str | None,
    session_id: str,
    user_query: str,
    top_k: int = 10,
    include_history: bool = False,
    pinned_source_ids: list[str] | None = None,
    reranker: Reranker | None = None,
    candidate_k: int | None = None,
    query_llm: LLMProvider | None = None,
) -> AsyncIterator[str]:
    logger.info("Chat stream query: session=%s query_len=%d", session_id, len(user_query))
    logger.debug("Chat stream query text: %s", user_query)

    prepared_turn = await prepare_user_chat_turn(
        project_id=project_id,
        session_id=session_id,
        user_query=user_query,
        include_history=include_history,
        load_session=get_session,
    )

    llm_inputs = await prepare_chat_llm_inputs(
        vectordb=vectordb,
        embedder=embedder,
        llm=llm,
        project_id=project_id,
        session_id=session_id,
        user_query=user_query,
        history=prepared_turn.history,
        top_k=top_k,
        pinned_source_ids=pinned_source_ids,
        reranker=reranker,
        candidate_k=candidate_k,
        query_llm=query_llm,
    )

    # Send sources event first
    sources_dicts = [s.model_dump() for s in llm_inputs.context_sources]
    yield f"event: sources\ndata: {json.dumps(sources_dicts)}\n\n"

    if llm_inputs.retrieval_metadata:
        yield f"event: retrieval_metadata\ndata: {json.dumps(llm_inputs.retrieval_metadata)}\n\n"

    full_content = ""
    try:
        async for token in llm.stream(llm_inputs.messages):
            full_content += token
            yield f"data: {json.dumps({'token': token})}\n\n"
    except Exception:
        await save_assistant_chat_turn(
            session_id=session_id,
            content=(full_content if full_content else "[Error: response generation failed]"),
            context_sources=llm_inputs.context_sources,
        )
        raise

    assistant_msg_id = await save_assistant_chat_turn(
        session_id=session_id,
        content=full_content,
        context_sources=llm_inputs.context_sources,
    )

    logger.info("Chat stream complete: session=%s response_len=%d", session_id, len(full_content))

    yield f"event: done\ndata: {json.dumps({'message_id': assistant_msg_id})}\n\n"
