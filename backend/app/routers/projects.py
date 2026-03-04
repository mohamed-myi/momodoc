import logging

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.core.async_vectordb import AsyncVectorStore
from app.core.job_tracker import JobTracker
from app.core.ws_manager import WSManager
from app.dependencies import (
    get_db,
    get_embedder,
    get_job_tracker,
    get_settings,
    get_vectordb,
    get_ws_manager,
)
from app.schemas.project import ProjectCreate, ProjectResponse, ProjectUpdate
from app.services import project_service, sync_service
from app.services.ingestion.embedder import Embedder

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/projects", response_model=ProjectResponse, status_code=201)
async def create_project(
    data: ProjectCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
    vectordb: AsyncVectorStore = Depends(get_vectordb),
    embedder: Embedder = Depends(get_embedder),
    job_tracker: JobTracker = Depends(get_job_tracker),
    ws_manager: WSManager = Depends(get_ws_manager),
):
    project = await project_service.create_project(db, data, settings=settings)
    resp = await project_service.get_project(db, project.id)

    # Auto-trigger sync and file watcher if source_directory is set
    if data.source_directory:
        job_id = await sync_service.trigger_project_sync(
            project_id=project.id,
            source_directory=data.source_directory,
            settings=settings,
            vectordb=vectordb,
            embedder=embedder,
            job_tracker=job_tracker,
            ws_manager=ws_manager,
        )
        if job_id:
            resp.sync_job_id = job_id

        # Start watching the directory for live changes
        _start_watcher_safe(
            request, project.id, data.source_directory, settings, vectordb, embedder
        )

    return resp


@router.get("/projects", response_model=list[ProjectResponse])
async def list_projects(
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    return await project_service.list_projects(db, offset=offset, limit=limit)


@router.get("/projects/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
):
    return await project_service.get_project(db, project_id)


@router.patch("/projects/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: str,
    data: ProjectUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
    vectordb: AsyncVectorStore = Depends(get_vectordb),
    embedder: Embedder = Depends(get_embedder),
    job_tracker: JobTracker = Depends(get_job_tracker),
    ws_manager: WSManager = Depends(get_ws_manager),
):
    # Capture old source_directory to detect changes
    old_project = await project_service.get_project(db, project_id)
    old_source_dir = old_project.source_directory

    resp = await project_service.update_project(db, project_id, data, settings=settings)

    # Auto-trigger sync if source_directory was changed
    update_data = data.model_dump(exclude_unset=True)
    new_source_dir = update_data.get("source_directory")
    if "source_directory" in update_data and new_source_dir and new_source_dir != old_source_dir:
        job_id = await sync_service.trigger_project_sync(
            project_id=project_id,
            source_directory=new_source_dir,
            settings=settings,
            vectordb=vectordb,
            embedder=embedder,
            job_tracker=job_tracker,
            ws_manager=ws_manager,
        )
        if job_id:
            resp.sync_job_id = job_id

        # Update file watcher: stop old, start new
        file_watcher = getattr(request.app.state, "file_watcher", None)
        if file_watcher:
            if old_source_dir:
                file_watcher.stop_project(project_id)
            _start_watcher_safe(
                request,
                project_id,
                new_source_dir,
                settings,
                vectordb,
                embedder,
            )

    return resp


@router.delete("/projects/{project_id}", status_code=204)
async def delete_project(
    project_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    vectordb: AsyncVectorStore = Depends(get_vectordb),
):
    # Stop file watcher before deleting
    file_watcher = getattr(request.app.state, "file_watcher", None)
    if file_watcher:
        file_watcher.stop_project(project_id)

    await project_service.delete_project(db, project_id, vectordb=vectordb)


def _start_watcher_safe(
    request: Request,
    project_id: str,
    source_directory: str,
    settings: Settings,
    vectordb: AsyncVectorStore,
    embedder: Embedder,
) -> None:
    """Start file watcher for a project, logging errors instead of raising."""
    try:
        from app.bootstrap.watcher import setup_project_watcher

        file_watcher = getattr(request.app.state, "file_watcher", None)
        if file_watcher:
            setup_project_watcher(
                file_watcher,
                project_id,
                source_directory,
                settings,
                vectordb,
                embedder,
            )
    except Exception as e:
        logger.warning("Failed to start file watcher for project %s: %s", project_id, e)
