import os

from fastapi import APIRouter, BackgroundTasks, Depends, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.core.async_vectordb import AsyncVectorStore
from app.core.exceptions import ConflictError, NotFoundError, ValidationError
from app.core.job_tracker import JobTracker
from app.core.security import validate_index_path
from app.core.ws_manager import WSManager
from app.dependencies import (
    get_db,
    get_embedder,
    get_job_tracker,
    get_project,
    get_vectordb,
    get_settings,
    get_ws_manager,
)
from app.models.sync_job import SyncJob
from app.schemas.file import (
    DirectoryIndexRequest,
    DirectoryIndexResponse,
    FileResponse,
    FileUpdate,
    IngestionResultResponse,
    SyncRequest,
)
from app.schemas.sync_job import SyncJobResponse
from app.services import file_service, sync_service
from app.services.ingestion.embedder import Embedder

router = APIRouter()


def _compute_succeeded_files(
    processed_files: int,
    failed_files: int,
    skipped_files: int,
) -> int:
    # ``processed_files`` is a completion counter (success + skipped + failed).
    return max(processed_files - failed_files - skipped_files, 0)


def _job_to_response(job: SyncJob) -> SyncJobResponse:
    succeeded_files = _compute_succeeded_files(
        processed_files=job.processed_files,
        failed_files=job.failed_files,
        skipped_files=job.skipped_files,
    )
    return SyncJobResponse(
        id=job.id,
        project_id=job.project_id,
        status=job.status,
        total_files=job.total_files,
        processed_files=job.processed_files,
        completed_files=job.processed_files,
        succeeded_files=succeeded_files,
        skipped_files=job.skipped_files,
        failed_files=job.failed_files,
        total_chunks=job.total_chunks,
        current_file=job.current_file,
        error=job.error,
        errors=[],  # populated via relationship when loaded with selectinload
        created_at=job.created_at,
        completed_at=job.completed_at,
    )


@router.post(
    "/projects/{project_id}/files/upload",
    response_model=FileResponse,
    status_code=201,
)
async def upload_file(
    file: UploadFile,
    project=Depends(get_project),
    db: AsyncSession = Depends(get_db),
    vectordb: AsyncVectorStore = Depends(get_vectordb),
    embedder: Embedder = Depends(get_embedder),
    settings: Settings = Depends(get_settings),
):
    result = await file_service.upload_and_ingest(
        db=db,
        vectordb=vectordb,
        embedder=embedder,
        project_id=project.id,
        upload_file=file,
        upload_dir=settings.upload_dir,
        max_upload_size_mb=settings.max_upload_size_mb,
        settings=settings,
    )
    return await file_service.get_file(db, project.id, result.file_id)


@router.post(
    "/projects/{project_id}/files/index-directory",
    response_model=DirectoryIndexResponse,
)
async def index_directory(
    data: DirectoryIndexRequest,
    project=Depends(get_project),
    db: AsyncSession = Depends(get_db),
    vectordb: AsyncVectorStore = Depends(get_vectordb),
    embedder: Embedder = Depends(get_embedder),
    settings: Settings = Depends(get_settings),
):
    results = await file_service.index_directory(
        db=db,
        vectordb=vectordb,
        embedder=embedder,
        project_id=project.id,
        directory_path=data.path,
        upload_dir=settings.upload_dir,
        allowed_index_paths=settings.allowed_index_paths,
        settings=settings,
    )
    return DirectoryIndexResponse(
        results=[
            IngestionResultResponse(
                file_id=r.file_id,
                filename=r.filename,
                chunks_created=r.chunks_created,
                skipped=r.skipped,
                errors=r.errors,
            )
            for r in results
        ],
        total_files=len(results),
        total_chunks=sum(r.chunks_created for r in results),
        skipped=sum(1 for r in results if r.skipped),
    )


@router.post(
    "/projects/{project_id}/files/sync",
    response_model=SyncJobResponse,
    status_code=202,
)
async def start_sync(
    data: SyncRequest,
    background_tasks: BackgroundTasks,
    project=Depends(get_project),
    db: AsyncSession = Depends(get_db),
    vectordb: AsyncVectorStore = Depends(get_vectordb),
    embedder: Embedder = Depends(get_embedder),
    settings: Settings = Depends(get_settings),
    job_tracker: JobTracker = Depends(get_job_tracker),
    ws_manager: WSManager = Depends(get_ws_manager),
):
    directory = data.path or project.source_directory
    if not directory:
        raise ValidationError(
            "No directory specified and project has no source_directory configured"
        )

    if not os.path.isdir(directory):
        raise ValidationError(f"Directory does not exist: {directory}")

    validate_index_path(directory, settings.allowed_index_paths)

    try:
        job = await job_tracker.create_job(db, project.id)
        await db.commit()
    except ValueError as e:
        raise ConflictError(str(e))

    background_tasks.add_task(
        sync_service.run_sync_job,
        job_id=job.id,
        project_id=project.id,
        directory_path=directory,
        upload_dir=settings.upload_dir,
        vectordb=vectordb,
        embedder=embedder,
        job_tracker=job_tracker,
        settings=settings,
        ws_manager=ws_manager,
    )

    return _job_to_response(job)


@router.get(
    "/projects/{project_id}/files/sync/status",
)
async def get_sync_status(
    project=Depends(get_project),
    db: AsyncSession = Depends(get_db),
    job_tracker: JobTracker = Depends(get_job_tracker),
):
    job = await job_tracker.get_active_job_for_project(db, project.id)
    if job is None:
        return None
    return _job_to_response(job)


@router.get(
    "/projects/{project_id}/files/jobs/{job_id}",
    response_model=SyncJobResponse,
)
async def get_job(
    job_id: str,
    project=Depends(get_project),
    db: AsyncSession = Depends(get_db),
    job_tracker: JobTracker = Depends(get_job_tracker),
):
    job = await job_tracker.get_job(db, job_id)
    if job is None or job.project_id != project.id:
        raise NotFoundError("Job", job_id)
    return _job_to_response(job)


@router.get("/projects/{project_id}/files", response_model=list[FileResponse])
async def list_files(
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    project=Depends(get_project),
    db: AsyncSession = Depends(get_db),
):
    return await file_service.list_files(db, project.id, offset=offset, limit=limit)


@router.get("/projects/{project_id}/files/{file_id}", response_model=FileResponse)
async def get_file(
    file_id: str,
    project=Depends(get_project),
    db: AsyncSession = Depends(get_db),
):
    return await file_service.get_file(db, project.id, file_id)


@router.patch("/projects/{project_id}/files/{file_id}", response_model=FileResponse)
async def update_file(
    file_id: str,
    data: FileUpdate,
    project=Depends(get_project),
    db: AsyncSession = Depends(get_db),
):
    return await file_service.update_file(db, project.id, file_id, data)


@router.delete("/projects/{project_id}/files/{file_id}", status_code=204)
async def delete_file(
    file_id: str,
    project=Depends(get_project),
    db: AsyncSession = Depends(get_db),
    vectordb: AsyncVectorStore = Depends(get_vectordb),
):
    await file_service.delete_file(db, vectordb, project.id, file_id)
