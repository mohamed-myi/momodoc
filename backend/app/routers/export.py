"""Export endpoints for chat sessions and search results."""

import json
import logging
from datetime import datetime, timezone
from enum import Enum

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.async_vectordb import AsyncVectorStore
from app.dependencies import get_db, get_embedder, get_project, get_vectordb
from app.services import chat_service, search_service
from app.services.ingestion.embedder import Embedder

logger = logging.getLogger(__name__)

router = APIRouter()


class ExportFormat(str, Enum):
    markdown = "markdown"
    json = "json"


def _format_chat_markdown(session, messages) -> str:
    """Format a chat session as a Markdown document."""
    lines: list[str] = []
    title = session.title or "Untitled Chat"
    lines.append(f"# {title}\n")
    lines.append(f"*Exported at {datetime.now(timezone.utc).isoformat()}*\n")
    lines.append("")

    for msg in messages:
        role_label = "User" if msg.role == "user" else "Assistant"
        lines.append(f"## {role_label}\n")
        lines.append(msg.content)
        lines.append("")

        # Include sources for assistant messages
        if msg.role == "assistant" and msg.sources:
            lines.append("**Sources:**\n")
            for i, src in enumerate(msg.sources, 1):
                label = src.filename or src.original_path or "Note"
                lines.append(f"{i}. {label} (chunk {src.chunk_index})")
            lines.append("")

        lines.append("---\n")

    return "\n".join(lines)


def _format_chat_json(session, messages) -> str:
    """Serialize a chat session as a JSON document."""
    data = {
        "session_id": session.id,
        "project_id": session.project_id,
        "title": session.title,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "messages": [
            {
                "id": msg.id,
                "role": msg.role,
                "content": msg.content,
                "created_at": msg.created_at.isoformat() if msg.created_at else None,
                "sources": [
                    {
                        "source_type": src.source_type,
                        "source_id": src.source_id,
                        "filename": src.filename,
                        "original_path": src.original_path,
                        "chunk_text": src.chunk_text,
                        "chunk_index": src.chunk_index,
                        "score": src.score,
                    }
                    for src in (msg.sources or [])
                ],
            }
            for msg in messages
        ],
    }
    return json.dumps(data, indent=2, ensure_ascii=False)


def _format_search_markdown(query: str, results) -> str:
    """Format search results as a Markdown document."""
    lines: list[str] = []
    lines.append("# Search Results\n")
    lines.append(f"**Query:** {query}\n")
    lines.append(f"*Exported at {datetime.now(timezone.utc).isoformat()}*\n")
    lines.append(f"**Results:** {len(results)}\n")
    lines.append("")

    for i, result in enumerate(results, 1):
        label = result.filename or result.original_path or "Unknown"
        lines.append(f"## Result {i}: {label}\n")
        lines.append(f"- **Score:** {result.score:.4f}")
        lines.append(f"- **Source type:** {result.source_type}")
        lines.append(f"- **File type:** {result.file_type}")
        lines.append(f"- **Chunk index:** {result.chunk_index}")
        lines.append("")
        lines.append("```")
        lines.append(result.chunk_text)
        lines.append("```")
        lines.append("")
        lines.append("---\n")

    return "\n".join(lines)


def _format_search_json(query: str, results) -> str:
    """Serialize search results as a JSON document."""
    data = {
        "query": query,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "total_results": len(results),
        "results": [
            {
                "source_type": r.source_type,
                "source_id": r.source_id,
                "filename": r.filename,
                "original_path": r.original_path,
                "chunk_text": r.chunk_text,
                "chunk_index": r.chunk_index,
                "file_type": r.file_type,
                "score": r.score,
                "project_id": r.project_id,
            }
            for r in results
        ],
    }
    return json.dumps(data, indent=2, ensure_ascii=False)


def _make_download_response(content: str, filename: str, media_type: str) -> StreamingResponse:
    """Create a StreamingResponse with Content-Disposition attachment header."""

    async def _stream():
        yield content.encode("utf-8")

    return StreamingResponse(
        _stream(),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/projects/{project_id}/chat/sessions/{session_id}/export")
async def export_chat_session(
    session_id: str,
    format: ExportFormat = Query(ExportFormat.markdown),
    project=Depends(get_project),
    db: AsyncSession = Depends(get_db),
):
    """Export a chat session as a downloadable Markdown or JSON file."""
    session = await chat_service.get_session(db, project.id, session_id)
    messages = await chat_service.get_messages(db, session_id)

    safe_title = (session.title or "chat").replace(" ", "_")[:50]

    if format == ExportFormat.markdown:
        content = _format_chat_markdown(session, messages)
        return _make_download_response(content, f"{safe_title}.md", "text/markdown; charset=utf-8")
    else:
        content = _format_chat_json(session, messages)
        return _make_download_response(
            content, f"{safe_title}.json", "application/json; charset=utf-8"
        )


@router.get("/projects/{project_id}/search/export")
async def export_search_results(
    query: str = Query(..., min_length=1),
    format: ExportFormat = Query(ExportFormat.markdown),
    top_k: int = Query(10, ge=1, le=50),
    project=Depends(get_project),
    vectordb: AsyncVectorStore = Depends(get_vectordb),
    embedder: Embedder = Depends(get_embedder),
):
    """Run a search and export the results as a downloadable Markdown or JSON file."""
    results, _plan = await search_service.search(
        vectordb=vectordb,
        embedder=embedder,
        query=query,
        top_k=top_k,
        project_id=project.id,
    )

    safe_query = query.replace(" ", "_")[:50]

    if format == ExportFormat.markdown:
        content = _format_search_markdown(query, results)
        return _make_download_response(
            content, f"search_{safe_query}.md", "text/markdown; charset=utf-8"
        )
    else:
        content = _format_search_json(query, results)
        return _make_download_response(
            content, f"search_{safe_query}.json", "application/json; charset=utf-8"
        )
