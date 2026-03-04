import asyncio
import logging
import os

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.core.async_vectordb import AsyncVectorStore
from app.core.exceptions import ConflictError, NotFoundError
from app.models.file import File
from app.models.issue import Issue
from app.models.note import Note
from app.models.project import Project
from app.schemas.project import ProjectCreate, ProjectResponse, ProjectUpdate

logger = logging.getLogger(__name__)


def _validate_source_directory(source_directory: str | None, settings: Settings) -> None:
    """Validate that source_directory exists and is allowed."""
    if not source_directory:
        return
    from app.core.security import validate_index_path

    validate_index_path(source_directory, settings.allowed_index_paths)


async def create_project(
    db: AsyncSession, data: ProjectCreate, settings: Settings | None = None
) -> Project:
    if settings is not None:
        _validate_source_directory(data.source_directory, settings)
    project = Project(
        name=data.name,
        description=data.description,
        source_directory=data.source_directory,
    )
    db.add(project)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ConflictError(f"A project named '{data.name}' already exists.")
    await db.refresh(project)
    return project


async def list_projects(
    db: AsyncSession, offset: int = 0, limit: int = 20
) -> list[ProjectResponse]:
    result = await db.execute(
        select(Project).order_by(Project.created_at.desc()).offset(offset).limit(limit)
    )
    projects = result.scalars().all()
    if not projects:
        return []

    counts_map = await _get_project_counts_map(db, [project.id for project in projects])
    return [
        _to_response(project, counts_map.get(project.id, _zero_counts())) for project in projects
    ]


async def get_project(db: AsyncSession, project_id: str) -> ProjectResponse:
    project = await resolve_project_or_404(db, project_id)
    counts = await _get_project_counts(db, project.id)
    return _to_response(project, counts)


async def update_project(
    db: AsyncSession,
    project_id: str,
    data: ProjectUpdate,
    settings: Settings | None = None,
) -> ProjectResponse:
    project = await resolve_project_or_404(db, project_id)

    update_data = data.model_dump(exclude_unset=True)
    if settings is not None and "source_directory" in update_data:
        _validate_source_directory(update_data["source_directory"], settings)
    for field, value in update_data.items():
        setattr(project, field, value)

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ConflictError(f"A project named '{update_data.get('name', '')}' already exists.")
    await db.refresh(project)
    counts = await _get_project_counts(db, project.id)
    return _to_response(project, counts)


async def delete_project(
    db: AsyncSession,
    project_id: str,
    vectordb: AsyncVectorStore | None = None,
) -> None:
    project = await resolve_project_or_404(db, project_id)

    # Collect managed file paths before cascade-deleting the project.
    # Select only the column we need to avoid loading full ORM objects.
    files_result = await db.execute(
        select(File.storage_path).where(
            File.project_id == project.id,
            File.is_managed == True,  # noqa: E712
        )
    )
    managed_paths = [row[0] for row in files_result.all() if row[0]]

    # Commit the DB deletion first (cascades handle files, notes, issues, sessions).
    # This makes the DB the authoritative source of truth: if commit fails, nothing
    # has changed; if vector/disk cleanup fails afterward, we only have harmless
    # orphaned data rather than a confusing desync where the user sees a project
    # but search can't find its content.
    await db.delete(project)
    await db.commit()

    # Best-effort cleanup of LanceDB vectors
    if vectordb:
        try:
            await vectordb.delete(AsyncVectorStore.filter_by_project(project.id))
        except Exception:
            logger.warning("Failed to delete vectors for project %s", project.id)

    # Best-effort cleanup of managed files on disk
    for path in managed_paths:
        try:
            if os.path.exists(path):
                await asyncio.to_thread(os.remove, path)
        except OSError:
            logger.warning("Failed to remove managed file: %s", path)


async def resolve_project_or_404(db: AsyncSession, project_id: str) -> Project:
    result = await db.execute(
        select(Project).where((Project.id == project_id) | (Project.name == project_id))
    )
    project = result.scalar_one_or_none()
    if project is None:
        raise NotFoundError("Project", project_id)
    return project


async def _get_project_counts(db: AsyncSession, project_id: str) -> dict:
    counts_map = await _get_project_counts_map(db, [project_id])
    return counts_map.get(project_id, _zero_counts())


def _zero_counts() -> dict:
    return {"file_count": 0, "note_count": 0, "issue_count": 0}


async def _get_project_counts_map(db: AsyncSession, project_ids: list[str]) -> dict[str, dict]:
    file_rows = (
        await db.execute(
            select(File.project_id, func.count(File.id))
            .where(File.project_id.in_(project_ids))
            .group_by(File.project_id)
        )
    ).all()
    note_rows = (
        await db.execute(
            select(Note.project_id, func.count(Note.id))
            .where(Note.project_id.in_(project_ids))
            .group_by(Note.project_id)
        )
    ).all()
    issue_rows = (
        await db.execute(
            select(Issue.project_id, func.count(Issue.id))
            .where(Issue.project_id.in_(project_ids))
            .group_by(Issue.project_id)
        )
    ).all()

    counts: dict[str, dict] = {project_id: _zero_counts() for project_id in project_ids}
    for project_id, count in file_rows:
        counts[project_id]["file_count"] = count or 0
    for project_id, count in note_rows:
        counts[project_id]["note_count"] = count or 0
    for project_id, count in issue_rows:
        counts[project_id]["issue_count"] = count or 0
    return counts


def _to_response(project: Project, counts: dict, sync_job_id: str | None = None) -> ProjectResponse:
    return ProjectResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        source_directory=project.source_directory,
        created_at=project.created_at,
        updated_at=project.updated_at,
        file_count=counts["file_count"],
        note_count=counts["note_count"],
        issue_count=counts["issue_count"],
        last_sync_at=getattr(project, "last_sync_at", None),
        last_sync_status=getattr(project, "last_sync_status", None),
        sync_job_id=sync_job_id,
    )
