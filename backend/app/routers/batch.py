import logging
from collections.abc import Awaitable, Callable

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.async_vectordb import AsyncVectorStore
from app.core.exceptions import NotFoundError
from app.dependencies import get_db, get_project, get_vectordb
from app.schemas.batch import (
    BatchDeleteRequest,
    BatchDeleteResponse,
    BatchTagRequest,
    BatchTagResponse,
)
from app.schemas.file import FileUpdate
from app.services import file_service, issue_service

logger = logging.getLogger(__name__)

router = APIRouter()


async def _run_batch_operation(
    ids: list[str],
    operation: Callable[[str], Awaitable[None]],
    *,
    entity_label: str,
    action_label: str,
) -> tuple[int, list[str]]:
    succeeded = 0
    errors: list[str] = []
    entity_name = entity_label.lower()

    for item_id in ids:
        try:
            await operation(item_id)
            succeeded += 1
        except NotFoundError:
            errors.append(f"{entity_label} not found: {item_id}")
        except Exception as e:
            logger.error("Failed to %s %s %s: %s", action_label, entity_name, item_id, e)
            errors.append(f"Failed to {action_label} {entity_name} {item_id}: {str(e)}")

    return succeeded, errors


@router.post(
    "/projects/{project_id}/files/batch-delete",
    response_model=BatchDeleteResponse,
)
async def batch_delete_files(
    data: BatchDeleteRequest,
    project=Depends(get_project),
    db: AsyncSession = Depends(get_db),
    vectordb: AsyncVectorStore = Depends(get_vectordb),
):
    async def _delete_file(file_id: str) -> None:
        await file_service.delete_file(db, vectordb, project.id, file_id)

    deleted, errors = await _run_batch_operation(
        data.ids,
        _delete_file,
        entity_label="File",
        action_label="delete",
    )
    return BatchDeleteResponse(deleted=deleted, errors=errors)


@router.post(
    "/projects/{project_id}/files/batch-tag",
    response_model=BatchTagResponse,
)
async def batch_tag_files(
    data: BatchTagRequest,
    project=Depends(get_project),
    db: AsyncSession = Depends(get_db),
):
    update_data = FileUpdate(tags=data.tags)

    async def _tag_file(file_id: str) -> None:
        await file_service.update_file(db, project.id, file_id, update_data)

    updated, errors = await _run_batch_operation(
        data.ids,
        _tag_file,
        entity_label="File",
        action_label="tag",
    )
    return BatchTagResponse(updated=updated, errors=errors)


@router.post(
    "/projects/{project_id}/issues/batch-delete",
    response_model=BatchDeleteResponse,
)
async def batch_delete_issues(
    data: BatchDeleteRequest,
    project=Depends(get_project),
    db: AsyncSession = Depends(get_db),
    vectordb: AsyncVectorStore = Depends(get_vectordb),
):
    async def _delete_issue(issue_id: str) -> None:
        await issue_service.delete_issue(db, vectordb, project.id, issue_id)

    deleted, errors = await _run_batch_operation(
        data.ids,
        _delete_issue,
        entity_label="Issue",
        action_label="delete",
    )
    return BatchDeleteResponse(deleted=deleted, errors=errors)
