import json
import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.async_vectordb import AsyncVectorStore
from app.core.exceptions import NotFoundError
from app.models.note import Note
from app.schemas.note import NoteCreate, NoteUpdate
from app.services.content_entity_service_helpers import (
    create_entity_with_indexing,
    delete_entity_with_vector_cleanup,
    finalize_entity_update,
)
from app.services.ingestion.chunkers.text_chunker import TextChunker
from app.services.ingestion.embedder import Embedder

logger = logging.getLogger(__name__)


async def create_note(
    db: AsyncSession,
    vectordb: AsyncVectorStore,
    embedder: Embedder,
    project_id: str,
    data: NoteCreate,
) -> Note:
    note = Note(
        project_id=project_id,
        content=data.content,
        tags=data.tags,
    )
    return await create_entity_with_indexing(
        db,
        note,
        index_entity=lambda entity: _index_note(vectordb, embedder, entity),
    )


async def list_notes(
    db: AsyncSession, project_id: str, offset: int = 0, limit: int = 20
) -> list[Note]:
    result = await db.execute(
        select(Note)
        .where(Note.project_id == project_id)
        .order_by(Note.updated_at.desc())
        .offset(offset)
        .limit(limit)
    )
    return list(result.scalars().all())


async def get_note(db: AsyncSession, project_id: str, note_id: str) -> Note:
    result = await db.execute(select(Note).where(Note.id == note_id, Note.project_id == project_id))
    note = result.scalar_one_or_none()
    if note is None:
        raise NotFoundError("Note", note_id)
    return note


async def update_note(
    db: AsyncSession,
    vectordb: AsyncVectorStore,
    embedder: Embedder,
    project_id: str,
    note_id: str,
    data: NoteUpdate,
) -> Note:
    note = await get_note(db, project_id, note_id)

    update_data = data.model_dump(exclude_unset=True)
    content_changed = "content" in update_data
    for field, value in update_data.items():
        setattr(note, field, value)

    return await finalize_entity_update(
        db,
        note,
        content_changed=content_changed,
        entity_name="note",
        delete_vectors=lambda entity_id: _delete_note_vectors(vectordb, entity_id),
        index_entity=lambda entity: _index_note(vectordb, embedder, entity),
        logger=logger,
    )


async def delete_note(
    db: AsyncSession,
    vectordb: AsyncVectorStore,
    project_id: str,
    note_id: str,
) -> None:
    note = await get_note(db, project_id, note_id)
    await delete_entity_with_vector_cleanup(
        db,
        note,
        entity_name="note",
        delete_vectors=lambda entity_id: _delete_note_vectors(vectordb, entity_id),
        logger=logger,
    )


async def _index_note(
    vectordb: AsyncVectorStore,
    embedder: Embedder,
    note: Note,
) -> int:
    chunker = TextChunker(max_chunk_size=2000, overlap=200)
    chunks = chunker.chunk(note.content)

    if not chunks:
        return 0

    chunk_texts = [c.text for c in chunks]
    vectors = await embedder.aembed_texts(chunk_texts, mode="document")

    tags = [t.strip() for t in note.tags.split(",")] if note.tags else []

    records = []
    for i, (chunk, vector) in enumerate(zip(chunks, vectors)):
        records.append(
            {
                "id": str(uuid.uuid4()),
                "vector": vector,
                "project_id": note.project_id,
                "source_type": "note",
                "source_id": note.id,
                "filename": "",
                "original_path": "",
                "file_type": "note",
                "chunk_index": i,
                "chunk_text": chunk.text,
                "language": "text",
                "tags": json.dumps(tags),
            }
        )

    await vectordb.add(records)
    return len(chunks)


async def _delete_note_vectors(vectordb: AsyncVectorStore, note_id: str) -> None:
    await vectordb.delete(AsyncVectorStore.filter_by_source(note_id))
