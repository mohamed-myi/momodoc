from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.async_vectordb import AsyncVectorStore
from app.dependencies import get_db, get_embedder, get_project, get_vectordb
from app.schemas.issue import IssueCreate, IssueResponse, IssueStatus, IssueUpdate
from app.services import issue_service
from app.services.ingestion.embedder import Embedder

router = APIRouter()


@router.post(
    "/projects/{project_id}/issues", response_model=IssueResponse, status_code=201
)
async def create_issue(
    data: IssueCreate,
    project=Depends(get_project),
    db: AsyncSession = Depends(get_db),
    vectordb: AsyncVectorStore = Depends(get_vectordb),
    embedder: Embedder = Depends(get_embedder),
):
    return await issue_service.create_issue(db, vectordb, embedder, project.id, data)


@router.get("/projects/{project_id}/issues", response_model=list[IssueResponse])
async def list_issues(
    status: IssueStatus | None = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    project=Depends(get_project),
    db: AsyncSession = Depends(get_db),
):
    return await issue_service.list_issues(
        db, project.id, status=status.value if status else None,
        offset=offset, limit=limit,
    )


@router.patch(
    "/projects/{project_id}/issues/{issue_id}", response_model=IssueResponse
)
async def update_issue(
    issue_id: str,
    data: IssueUpdate,
    project=Depends(get_project),
    db: AsyncSession = Depends(get_db),
    vectordb: AsyncVectorStore = Depends(get_vectordb),
    embedder: Embedder = Depends(get_embedder),
):
    return await issue_service.update_issue(db, vectordb, embedder, project.id, issue_id, data)


@router.delete("/projects/{project_id}/issues/{issue_id}", status_code=204)
async def delete_issue(
    issue_id: str,
    project=Depends(get_project),
    db: AsyncSession = Depends(get_db),
    vectordb: AsyncVectorStore = Depends(get_vectordb),
):
    await issue_service.delete_issue(db, vectordb, project.id, issue_id)
