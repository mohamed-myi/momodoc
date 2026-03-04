from __future__ import annotations

import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import database as db_module
from app.core.async_vectordb import AsyncVectorStore
from app.llm.base import LLMMessage, LLMProvider
from app.models.chat_message import ChatMessage
from app.models.chat_session import ChatSession
from app.schemas.chat import ChatSource
from app.services.chat_context import (
    MAX_HISTORY_MESSAGES,
    RECENT_CONTEXT_COUNT,
    _build_messages,
    _create_source_objects,
    _retrieve_context,
    _select_context_sources,
)
from app.services.ingestion.embedder import Embedder

TYPE_CHECKING = False
if TYPE_CHECKING:
    from app.services.reranker import Reranker

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class PreparedUserChatTurn:
    history: list[ChatMessage]
    user_message_id: str


@dataclass(slots=True)
class PreparedChatLLMInputs:
    context_sources: list[ChatSource]
    messages: list[LLMMessage]
    retrieval_metadata: dict | None = None


LoadSessionFn = Callable[
    [AsyncSession, str | None, str],
    Awaitable[ChatSession],
]


async def prepare_user_chat_turn(
    project_id: str | None,
    session_id: str,
    user_query: str,
    include_history: bool,
    load_session: LoadSessionFn,
) -> PreparedUserChatTurn:
    async with db_module.async_session_factory() as db:
        session = await load_session(db, project_id, session_id)

        if session.title is None:
            session.title = user_query[:100]

        history_limit = MAX_HISTORY_MESSAGES if include_history else RECENT_CONTEXT_COUNT
        history = await _get_history(db, session_id, limit=history_limit)

        user_msg = ChatMessage(session_id=session_id, role="user", content=user_query)
        db.add(user_msg)
        await db.commit()

        return PreparedUserChatTurn(
            history=history,
            user_message_id=user_msg.id,
        )


async def prepare_chat_llm_inputs(
    vectordb: AsyncVectorStore,
    embedder: Embedder,
    llm: LLMProvider,
    project_id: str | None,
    session_id: str,
    user_query: str,
    history: list[ChatMessage],
    top_k: int,
    pinned_source_ids: list[str] | None = None,
    reranker: Reranker | None = None,
    candidate_k: int | None = None,
    query_llm: LLMProvider | None = None,
) -> PreparedChatLLMInputs:
    retrieval_start = time.monotonic()
    sources, retrieval_metadata = await _retrieve_context(
        vectordb,
        embedder,
        project_id,
        user_query,
        top_k,
        pinned_source_ids=pinned_source_ids,
        reranker=reranker,
        candidate_k=candidate_k,
        query_llm=query_llm,
    )
    retrieval_ms = (time.monotonic() - retrieval_start) * 1000
    logger.info(
        "Chat retrieval: session=%s sources=%d duration=%.1fms",
        session_id,
        len(sources),
        retrieval_ms,
    )

    context_sources = _select_context_sources(history, sources, user_query, llm)
    messages = _build_messages(history, context_sources, user_query)
    return PreparedChatLLMInputs(
        context_sources=context_sources,
        messages=messages,
        retrieval_metadata=retrieval_metadata,
    )


async def save_assistant_chat_turn(
    session_id: str,
    content: str,
    context_sources: list[ChatSource],
) -> str:
    async with db_module.async_session_factory() as db:
        assistant_msg = ChatMessage(
            session_id=session_id,
            role="assistant",
            content=content,
            sources=_create_source_objects(context_sources),
        )
        db.add(assistant_msg)
        await db.commit()
        return assistant_msg.id


async def _get_history(
    db: AsyncSession, session_id: str, limit: int = MAX_HISTORY_MESSAGES
) -> list[ChatMessage]:
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.desc())
        .limit(limit)
    )
    messages = list(result.scalars().all())
    messages.reverse()
    return messages
