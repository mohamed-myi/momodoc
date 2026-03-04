import json
import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.async_vectordb import AsyncVectorStore
from app.core.exceptions import NotFoundError
from app.models.issue import Issue
from app.schemas.issue import IssueCreate, IssueUpdate
from app.services.content_entity_service_helpers import (
    create_entity_with_indexing,
    delete_entity_with_vector_cleanup,
    finalize_entity_update,
)
from app.services.ingestion.embedder import Embedder

logger = logging.getLogger(__name__)


async def create_issue(
    db: AsyncSession,
    vectordb: AsyncVectorStore,
    embedder: Embedder,
    project_id: str,
    data: IssueCreate,
) -> Issue:
    issue = Issue(
        project_id=project_id,
        title=data.title,
        description=data.description,
        priority=data.priority.value,
    )
    return await create_entity_with_indexing(
        db,
        issue,
        index_entity=lambda entity: _index_issue(vectordb, embedder, entity),
    )


async def list_issues(
    db: AsyncSession,
    project_id: str,
    status: str | None = None,
    offset: int = 0,
    limit: int = 20,
) -> list[Issue]:
    query = select(Issue).where(Issue.project_id == project_id)
    if status:
        query = query.where(Issue.status == status)
    query = query.order_by(Issue.created_at.desc()).offset(offset).limit(limit)
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_issue(db: AsyncSession, project_id: str, issue_id: str) -> Issue:
    result = await db.execute(
        select(Issue).where(Issue.id == issue_id, Issue.project_id == project_id)
    )
    issue = result.scalar_one_or_none()
    if issue is None:
        raise NotFoundError("Issue", issue_id)
    return issue


async def update_issue(
    db: AsyncSession,
    vectordb: AsyncVectorStore,
    embedder: Embedder,
    project_id: str,
    issue_id: str,
    data: IssueUpdate,
) -> Issue:
    issue = await get_issue(db, project_id, issue_id)

    update_data = data.model_dump(exclude_unset=True)
    content_changed = "title" in update_data or "description" in update_data
    for field, value in update_data.items():
        # Enum fields are stored as their string value in the DB
        if hasattr(value, "value"):
            value = value.value
        setattr(issue, field, value)

    return await finalize_entity_update(
        db,
        issue,
        content_changed=content_changed,
        entity_name="issue",
        delete_vectors=lambda entity_id: _delete_issue_vectors(vectordb, entity_id),
        index_entity=lambda entity: _index_issue(vectordb, embedder, entity),
        logger=logger,
    )


async def delete_issue(
    db: AsyncSession,
    vectordb: AsyncVectorStore,
    project_id: str,
    issue_id: str,
) -> None:
    issue = await get_issue(db, project_id, issue_id)
    await delete_entity_with_vector_cleanup(
        db,
        issue,
        entity_name="issue",
        delete_vectors=lambda entity_id: _delete_issue_vectors(vectordb, entity_id),
        logger=logger,
    )


async def _index_issue(
    vectordb: AsyncVectorStore,
    embedder: Embedder,
    issue: Issue,
) -> int:
    text = issue.title
    if issue.description:
        text = f"{issue.title}\n\n{issue.description}"

    if not text.strip():
        return 0

    vectors = await embedder.aembed_texts([text], mode="document")

    records = [
        {
            "id": str(uuid.uuid4()),
            "vector": vectors[0],
            "project_id": issue.project_id,
            "source_type": "issue",
            "source_id": issue.id,
            "filename": "",
            "original_path": "",
            "file_type": "issue",
            "chunk_index": 0,
            "chunk_text": text,
            "language": "text",
            "tags": json.dumps([]),
        }
    ]

    await vectordb.add(records)
    return 1


async def _delete_issue_vectors(vectordb: AsyncVectorStore, issue_id: str) -> None:
    await vectordb.delete(AsyncVectorStore.filter_by_source(issue_id))
