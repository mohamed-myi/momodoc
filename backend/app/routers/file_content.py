"""File content preview and chunk retrieval endpoints."""

import asyncio
import logging
import os

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.async_vectordb import AsyncVectorStore
from app.core.exceptions import NotFoundError, ValidationError
from app.dependencies import get_db, get_project, get_vectordb
from app.services import file_service
from app.services.ingestion.parser_registry import ParserRegistry

logger = logging.getLogger(__name__)

router = APIRouter()

_PARSER_REGISTRY = ParserRegistry.with_defaults()


class FileContentResponse(BaseModel):
    content: str
    language: str


class ChunkResponse(BaseModel):
    id: str
    chunk_index: int
    chunk_text: str
    language: str
    file_type: str
    content_hash: str


class FileChunksResponse(BaseModel):
    file_id: str
    filename: str
    chunks: list[ChunkResponse]
    total: int


@router.get(
    "/projects/{project_id}/files/{file_id}/content",
    response_model=FileContentResponse,
)
async def get_file_content(
    file_id: str,
    project=Depends(get_project),
    db: AsyncSession = Depends(get_db),
):
    """Re-parse the original file and return its full text content."""
    file = await file_service.get_file(db, project.id, file_id)

    storage_path = file.storage_path
    if not storage_path or not await asyncio.to_thread(os.path.exists, storage_path):
        raise NotFoundError(
            "FileContent",
            f"{file_id} (storage path missing or file deleted from disk)",
        )

    _, ext = os.path.splitext(storage_path)
    parser = _PARSER_REGISTRY.select_parser(ext)
    if parser is None:
        raise ValidationError(f"No parser available for file type: {ext}")

    try:
        parsed = await asyncio.to_thread(parser.parse, storage_path)
    except Exception as e:
        logger.error("Failed to parse file %s for preview: %s", file_id, e)
        raise ValidationError(f"Failed to parse file: {e}")

    return FileContentResponse(content=parsed.text, language=parsed.language)


@router.get(
    "/projects/{project_id}/files/{file_id}/chunks",
    response_model=FileChunksResponse,
)
async def get_file_chunks(
    file_id: str,
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    project=Depends(get_project),
    db: AsyncSession = Depends(get_db),
    vectordb: AsyncVectorStore = Depends(get_vectordb),
):
    """Return all LanceDB chunks for a file, sorted by chunk_index."""
    file = await file_service.get_file(db, project.id, file_id)

    filter_str = AsyncVectorStore.filter_by_source(file_id)
    # Chunk indices are assigned sequentially during ingestion.
    # Range filtering avoids scanning offset+limit rows for deep pages.
    page_filter_str = f"{filter_str} AND chunk_index >= {offset} AND chunk_index < {offset + limit}"
    rows = await vectordb.get_by_filter(
        page_filter_str,
        None,  # columns — return all
        limit,
    )
    paginated = sorted(rows, key=lambda row: row.get("chunk_index", 0))

    chunks = [
        ChunkResponse(
            id=row.get("id", ""),
            chunk_index=row.get("chunk_index", 0),
            chunk_text=row.get("chunk_text", ""),
            language=row.get("language", ""),
            file_type=row.get("file_type", ""),
            content_hash=row.get("content_hash", ""),
        )
        for row in paginated
    ]

    return FileChunksResponse(
        file_id=file.id,
        filename=file.filename,
        chunks=chunks,
        total=file.chunk_count or 0,
    )
