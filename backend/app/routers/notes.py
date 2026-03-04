from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.async_vectordb import AsyncVectorStore
from app.dependencies import get_db, get_embedder, get_project, get_vectordb
from app.schemas.note import NoteCreate, NoteResponse, NoteUpdate
from app.services import note_service
from app.services.ingestion.embedder import Embedder

router = APIRouter()


@router.post("/projects/{project_id}/notes", response_model=NoteResponse, status_code=201)
async def create_note(
    data: NoteCreate,
    project=Depends(get_project),
    db: AsyncSession = Depends(get_db),
    vectordb: AsyncVectorStore = Depends(get_vectordb),
    embedder: Embedder = Depends(get_embedder),
):
    return await note_service.create_note(db, vectordb, embedder, project.id, data)


@router.get("/projects/{project_id}/notes", response_model=list[NoteResponse])
async def list_notes(
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    project=Depends(get_project),
    db: AsyncSession = Depends(get_db),
):
    return await note_service.list_notes(db, project.id, offset=offset, limit=limit)


@router.get("/projects/{project_id}/notes/{note_id}", response_model=NoteResponse)
async def get_note(
    note_id: str,
    project=Depends(get_project),
    db: AsyncSession = Depends(get_db),
):
    return await note_service.get_note(db, project.id, note_id)


@router.patch("/projects/{project_id}/notes/{note_id}", response_model=NoteResponse)
async def update_note(
    note_id: str,
    data: NoteUpdate,
    project=Depends(get_project),
    db: AsyncSession = Depends(get_db),
    vectordb: AsyncVectorStore = Depends(get_vectordb),
    embedder: Embedder = Depends(get_embedder),
):
    return await note_service.update_note(db, vectordb, embedder, project.id, note_id, data)


@router.delete("/projects/{project_id}/notes/{note_id}", status_code=204)
async def delete_note(
    note_id: str,
    project=Depends(get_project),
    db: AsyncSession = Depends(get_db),
    vectordb: AsyncVectorStore = Depends(get_vectordb),
):
    await note_service.delete_note(db, vectordb, project.id, note_id)
