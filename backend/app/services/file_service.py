import asyncio
import inspect
import logging
import os
import uuid

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.core.async_vectordb import AsyncVectorStore
from app.core.exceptions import NotFoundError
from app.models.file import File
from app.schemas.file import FileUpdate
from app.services.ingestion.embedder import Embedder
from app.services.ingestion.pipeline import IngestionPipeline, IngestionResult

logger = logging.getLogger(__name__)


def _save_upload_stream_to_disk(
    upload_file: UploadFile,
    storage_path: str,
    max_bytes: int,
    max_upload_size_mb: int,
) -> int:
    from app.core.exceptions import ValidationError

    total_bytes = 0
    with open(storage_path, "wb") as f:
        while True:
            chunk = upload_file.file.read(65536)
            if not chunk:
                break
            total_bytes += len(chunk)
            if total_bytes > max_bytes:
                raise ValidationError(
                    f"File exceeds maximum upload size of {max_upload_size_mb} MB."
                )
            f.write(chunk)
    return total_bytes


async def _rewind_upload_file(upload_file: UploadFile) -> None:
    seek = getattr(upload_file, "seek", None)
    if callable(seek):
        result = seek(0)
        if inspect.isawaitable(result):
            await result
        return
    file_obj = getattr(upload_file, "file", None)
    if file_obj is not None and hasattr(file_obj, "seek"):
        await asyncio.to_thread(file_obj.seek, 0)


async def upload_and_ingest(
    db: AsyncSession,
    vectordb: AsyncVectorStore,
    embedder: Embedder,
    project_id: str,
    upload_file: UploadFile,
    upload_dir: str,
    max_upload_size_mb: int = 100,
    settings: Settings | None = None,
) -> IngestionResult:
    max_bytes = max_upload_size_mb * 1024 * 1024

    # Save uploaded file to disk with streaming size check
    os.makedirs(upload_dir, exist_ok=True)
    file_id = str(uuid.uuid4())
    ext = os.path.splitext(upload_file.filename or "")[1]
    storage_filename = f"{file_id}{ext}"
    storage_path = os.path.join(upload_dir, storage_filename)

    saved = False
    try:
        # Standard Starlette UploadFile path: offload sync disk I/O to thread.
        if isinstance(upload_file, UploadFile) and getattr(upload_file, "file", None) is not None:
            await _rewind_upload_file(upload_file)
            await asyncio.to_thread(
                _save_upload_stream_to_disk,
                upload_file,
                storage_path,
                max_bytes,
                max_upload_size_mb,
            )
        else:
            # Fallback for test doubles or non-standard UploadFile implementations.
            from app.core.exceptions import ValidationError

            total_bytes = 0
            with open(storage_path, "wb") as f:
                while True:
                    chunk = await upload_file.read(65536)
                    if not chunk:
                        break
                    total_bytes += len(chunk)
                    if total_bytes > max_bytes:
                        raise ValidationError(
                            f"File exceeds maximum upload size of {max_upload_size_mb} MB."
                        )
                    f.write(chunk)
        saved = True
    finally:
        if not saved and os.path.exists(storage_path):
            os.remove(storage_path)

    # Run ingestion; clean up the saved file if the pipeline fails
    ingested = False
    try:
        pipeline = IngestionPipeline(db, vectordb, embedder, settings=settings)
        result = await pipeline.ingest_file(
            project_id=project_id,
            file_path=storage_path,
            storage_path=storage_path,
            original_path=None,
            is_managed=True,
        )
        ingested = True
    finally:
        if not ingested and os.path.exists(storage_path):
            os.remove(storage_path)
    return result


async def index_directory(
    db: AsyncSession,
    vectordb: AsyncVectorStore,
    embedder: Embedder,
    project_id: str,
    directory_path: str,
    upload_dir: str,
    allowed_index_paths: list[str] | None = None,
    settings: Settings | None = None,
) -> list[IngestionResult]:
    from app.core.security import validate_index_path

    validate_index_path(directory_path, allowed_index_paths or [])

    pipeline = IngestionPipeline(db, vectordb, embedder, settings=settings)
    return await pipeline.ingest_directory(project_id, directory_path, upload_dir)


async def list_files(
    db: AsyncSession, project_id: str, offset: int = 0, limit: int = 20
) -> list[File]:
    result = await db.execute(
        select(File)
        .where(File.project_id == project_id)
        .order_by(File.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    return list(result.scalars().all())


async def get_file(db: AsyncSession, project_id: str, file_id: str) -> File:
    result = await db.execute(
        select(File).where(File.id == file_id, File.project_id == project_id)
    )
    file = result.scalar_one_or_none()
    if file is None:
        raise NotFoundError("File", file_id)
    return file


async def cleanup_file_resources(
    vectordb: AsyncVectorStore, file_id: str, is_managed: bool, storage_path: str
) -> None:
    """Best-effort cleanup of vectors and physical file after DB record deletion."""
    try:
        await vectordb.delete(AsyncVectorStore.filter_by_source(file_id))
    except Exception:
        logger.warning("Failed to delete vectors for file %s", file_id)
    if is_managed and storage_path:
        try:
            if os.path.exists(storage_path):
                await asyncio.to_thread(os.remove, storage_path)
        except OSError:
            logger.warning("Failed to remove managed file: %s", storage_path)


async def delete_file(
    db: AsyncSession,
    vectordb: AsyncVectorStore,
    project_id: str,
    file_id: str,
) -> None:
    file = await get_file(db, project_id, file_id)

    # Capture cleanup info before deleting the DB record
    is_managed = file.is_managed
    storage_path = file.storage_path

    # Commit the DB deletion first so the database is the source of truth.
    # If this fails, nothing has changed. If the subsequent vector/disk cleanup
    # fails, we only have harmless orphaned data.
    await db.delete(file)
    await db.commit()

    await cleanup_file_resources(vectordb, file_id, is_managed, storage_path)


async def update_file(
    db: AsyncSession,
    project_id: str,
    file_id: str,
    data: FileUpdate,
) -> File:
    file = await get_file(db, project_id, file_id)

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(file, field, value)

    await db.commit()
    await db.refresh(file)
    return file
