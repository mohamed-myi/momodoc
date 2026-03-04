import asyncio
import hashlib
import json
import logging
import os
import uuid
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.core import database as db_module
from app.core.async_vectordb import AsyncVectorStore
from app.models.file import File
from app.services.ingestion.chunking_policy import ChunkingPolicy
from app.services.ingestion.directory_walk import (
    iter_directory_paths as public_iter_directory_paths,
)
from app.services.ingestion.directory_walk import (
    next_directory_batch as public_next_directory_batch,
)
from app.services.ingestion.embedder import Embedder
from app.services.ingestion.parser_registry import ParserRegistry
from app.services.ingestion.parsers.base import FileParser
from app.services.ingestion.parsers.code_parser import EXTENSION_TO_LANGUAGE

logger = logging.getLogger(__name__)

SUPPORTED_EXTENSIONS = (
    set(EXTENSION_TO_LANGUAGE.keys())
    | {".md", ".markdown", ".rst", ".txt", ".pdf", ".docx"}
)

IGNORE_DIRS = {
    "node_modules", "__pycache__", ".git", ".venv", "venv",
    "dist", "build", ".next", ".tox", ".mypy_cache", ".pytest_cache",
    "egg-info",
}


@dataclass
class IngestionResult:
    file_id: str
    filename: str
    chunks_created: int
    skipped: bool = False
    errors: list[str] = field(default_factory=list)

_INGEST_BATCH_SIZE = 512
_INDEX_DISCOVERY_BATCH_SIZE = 256
_DEFAULT_INDEX_WORKERS = 4
_VECTOR_ID_PAGE_SIZE = 10_000


class IngestionPipeline:
    def __init__(
        self,
        db: AsyncSession,
        vectordb: AsyncVectorStore,
        embedder: Embedder,
        settings: Settings | None = None,
        parser_registry: ParserRegistry | None = None,
        chunking_policy: ChunkingPolicy | None = None,
    ):
        self.db = db
        self.vectordb = vectordb
        self.embedder = embedder
        self.settings = settings
        self.parser_registry = parser_registry or ParserRegistry.with_defaults()
        # Backward-compatible alias used by some tests and callers for inspection.
        self.parsers: list[FileParser] = list(self.parser_registry.parsers)
        self.chunking_policy = chunking_policy or ChunkingPolicy(
            chunk_size_default=settings.chunk_size_default if settings else 2000,
            chunk_overlap_default=settings.chunk_overlap_default if settings else 200,
            chunk_size_code=settings.chunk_size_code if settings else 2000,
            chunk_size_pdf=settings.chunk_size_pdf if settings else 3000,
            chunk_size_markdown=settings.chunk_size_markdown if settings else 2000,
        )

    def _get_chunk_size(self, ext: str) -> int:
        """Select chunk size based on file extension."""
        return self.chunking_policy.select_decision(ext).chunk_size

    async def ingest_file(
        self,
        project_id: str,
        file_path: str,
        storage_path: str,
        original_path: str | None = None,
        is_managed: bool = True,
    ) -> IngestionResult:
        filename = os.path.basename(file_path)
        ext = self._get_extension(file_path)

        # File size guard — reject files that are too large before parsing
        max_file_size_mb = self.settings.max_file_size_mb if self.settings else 200
        max_bytes = max_file_size_mb * 1024 * 1024
        try:
            file_size = await asyncio.to_thread(os.path.getsize, file_path)
        except Exception as e:
            logger.error("Failed to stat file %s: %s", file_path, e)
            return IngestionResult(
                file_id="", filename=filename, chunks_created=0,
                errors=[f"File read error: {str(e)}"],
            )
        if file_size > max_bytes:
            return IngestionResult(
                file_id="", filename=filename, chunks_created=0,
                errors=[
                    f"File too large ({file_size // (1024 * 1024)} MB, "
                    f"max {max_file_size_mb} MB)"
                ],
            )

        # Compute checksum (offloaded to thread)
        try:
            checksum = await asyncio.to_thread(self._compute_checksum, file_path)
        except Exception as e:
            logger.error("Failed to read file for checksum %s: %s", file_path, e)
            return IngestionResult(
                file_id="",
                filename=filename,
                chunks_created=0,
                errors=[f"File read error: {str(e)}"],
            )

        # Check for existing file (re-ingestion)
        existing_file = await self._find_existing_file(
            project_id, original_path or filename, is_managed=is_managed
        )
        is_reingestion = False
        old_vector_ids: list[str] = []
        if existing_file:
            if existing_file.checksum == checksum:
                return IngestionResult(
                    file_id=existing_file.id,
                    filename=filename,
                    chunks_created=existing_file.chunk_count,
                    skipped=True,
                )
            # Different checksum: collect old vector IDs for later deletion
            # (add-then-delete pattern preserves data if we crash between steps)
            is_reingestion = True
            old_vector_ids = await self._get_vector_ids_for_source(existing_file.id)
            file_record = existing_file
            file_record.checksum = checksum
            file_record.storage_path = storage_path
            file_record.file_size = file_size
        else:
            # Normalize original_path to resolve symlinks, /./, and .. segments
            normalized_path = (
                os.path.realpath(original_path) if original_path else original_path
            )
            file_record = File(
                project_id=project_id,
                filename=filename,
                original_path=normalized_path,
                storage_path=storage_path,
                file_type=ext.lstrip("."),
                file_size=file_size,
                checksum=checksum,
                is_managed=is_managed,
            )
            self.db.add(file_record)
            await self.db.flush()
            # Commit new file records immediately so they survive vectordb failures.
            # Re-ingestion skips this to preserve the old checksum on rollback.
            await self.db.commit()

        # Parse (offloaded to thread — parsers do file I/O and CPU work)
        parser = self._select_parser(ext)
        if parser is None:
            return IngestionResult(
                file_id=file_record.id,
                filename=filename,
                chunks_created=0,
                errors=[f"No parser for extension: {ext}"],
            )

        try:
            parsed = await asyncio.to_thread(parser.parse, file_path)
        except Exception as e:
            logger.error("Failed to parse %s: %s", file_path, e)
            return IngestionResult(
                file_id=file_record.id,
                filename=filename,
                chunks_created=0,
                errors=[f"Parse error: {str(e)}"],
            )

        # Chunking policy owns parser/chunker selection and sizing behavior.
        chunks = self.chunking_policy.chunk(
            filename=filename,
            ext=ext,
            parsed=parsed,
        )

        if not chunks:
            file_record.chunk_count = 0
            file_record.indexed_at = datetime.now(timezone.utc)
            await self.db.commit()
            return IngestionResult(
                file_id=file_record.id, filename=filename, chunks_created=0
            )

        # Embed + store in batches to bound memory usage.
        # Each batch: embed chunk texts → build records → write to LanceDB.
        total_stored = 0
        try:
            for batch_start in range(0, len(chunks), _INGEST_BATCH_SIZE):
                batch_chunks = chunks[batch_start : batch_start + _INGEST_BATCH_SIZE]
                batch_texts = [
                    f"{c.section_header}\n{c.text}" if c.section_header else c.text
                    for c in batch_chunks
                ]
                batch_vectors = await self.embedder.aembed_texts(batch_texts, mode="document")

                batch_records = []
                for i, (chunk, vector) in enumerate(zip(batch_chunks, batch_vectors)):
                    content_hash = hashlib.sha256(chunk.text.encode()).hexdigest()[:16]
                    batch_records.append({
                        "id": str(uuid.uuid4()),
                        "vector": vector,
                        "project_id": project_id,
                        "source_type": "file",
                        "source_id": file_record.id,
                        "filename": filename,
                        "original_path": original_path or "",
                        "file_type": ext.lstrip("."),
                        "chunk_index": batch_start + i,
                        "chunk_text": chunk.text,
                        "language": parsed.language or "",
                        "tags": json.dumps([]),
                        "content_hash": content_hash,
                        "section_header": chunk.section_header,
                    })

                await self.vectordb.add(batch_records)
                total_stored += len(batch_records)
        except Exception as e:
            file_id = file_record.id
            logger.error(
                "Vector storage failed for %s (id=%s) at batch offset %d. "
                "Error: %s",
                filename, file_id, total_stored, e,
            )
            if is_reingestion:
                # Rollback to preserve old checksum so next sync retries
                await self.db.rollback()
            # For new files, the File record is already committed and survives
            return IngestionResult(
                file_id=file_id,
                filename=filename,
                chunks_created=0,
                errors=[f"Vector storage failed: {str(e)}"],
            )

        # Delete old vectors AFTER new ones are stored (add-then-delete).
        # A crash here leaves harmless duplicates, cleaned on next sync.
        if is_reingestion and old_vector_ids:
            try:
                await self.vectordb.delete_by_ids(old_vector_ids)
            except Exception:
                logger.warning(
                    "Failed to delete old vectors during re-ingestion for %s; "
                    "duplicates will remain until next sync",
                    filename,
                )

        # Update file record
        file_record.chunk_count = len(chunks)
        file_record.indexed_at = datetime.now(timezone.utc)
        await self.db.commit()

        logger.info("Ingested %s: %d chunks", filename, len(chunks))
        return IngestionResult(
            file_id=file_record.id,
            filename=filename,
            chunks_created=len(chunks),
        )

    async def ingest_directory(
        self,
        project_id: str,
        directory_path: str,
        upload_dir: str,
    ) -> list[IngestionResult]:
        results: list[IngestionResult] = []
        max_workers = (
            self.settings.index_max_concurrent_files
            if self.settings
            else _DEFAULT_INDEX_WORKERS
        )
        batch_size = (
            self.settings.index_discovery_batch_size
            if self.settings
            else _INDEX_DISCOVERY_BATCH_SIZE
        )
        semaphore = asyncio.Semaphore(max_workers)
        path_iterator = self.iter_directory_paths(directory_path)

        async def process_path(full_path: str) -> IngestionResult:
            async with semaphore:
                return await self._ingest_directory_path(project_id, full_path)

        while True:
            batch = await asyncio.to_thread(
                self._next_directory_batch, path_iterator, batch_size
            )
            if not batch:
                break

            batch_results = await asyncio.gather(
                *(process_path(path) for path in batch),
                return_exceptions=True,
            )
            for full_path, result in zip(batch, batch_results, strict=False):
                if isinstance(result, Exception):
                    logger.error("Directory ingest failed for %s: %s", full_path, result)
                    results.append(
                        IngestionResult(
                            file_id="",
                            filename=os.path.basename(full_path),
                            chunks_created=0,
                            errors=[f"Ingestion failed: {result}"],
                        )
                    )
                    continue
                results.append(result)

        return results

    def _walk_directory(self, directory_path: str) -> list[str]:
        """Walk directory and return list of supported file paths."""
        return list(self.iter_directory_paths(directory_path))

    def iter_directory_paths(self, directory_path: str) -> Iterator[str]:
        """Public directory traversal helper used by ingestion/sync workflows."""
        return public_iter_directory_paths(
            directory_path,
            supported_extensions=SUPPORTED_EXTENSIONS,
            ignore_dirs=IGNORE_DIRS,
        )

    @staticmethod
    def next_directory_batch(path_iterator: Iterator[str], batch_size: int) -> list[str]:
        """Public batching helper for directory traversal iterators."""
        return public_next_directory_batch(path_iterator, batch_size)

    def _iter_directory_paths(self, directory_path: str):
        """Compatibility wrapper; use `iter_directory_paths()` instead."""
        return self.iter_directory_paths(directory_path)

    @staticmethod
    def _next_directory_batch(path_iterator, batch_size: int) -> list[str]:
        """Compatibility wrapper; use `next_directory_batch()` instead."""
        return IngestionPipeline.next_directory_batch(path_iterator, batch_size)

    async def _ingest_directory_path(
        self,
        project_id: str,
        full_path: str,
    ) -> IngestionResult:
        """Ingest one directory file, using an isolated DB session when available."""
        if db_module.async_session_factory is None:
            return await self.ingest_file(
                project_id=project_id,
                file_path=full_path,
                storage_path=full_path,
                original_path=full_path,
                is_managed=False,
            )

        async with db_module.async_session_factory() as db:
            pipeline = IngestionPipeline(
                db=db,
                vectordb=self.vectordb,
                embedder=self.embedder,
                settings=self.settings,
                parser_registry=self.parser_registry,
                chunking_policy=self.chunking_policy,
            )
            return await pipeline.ingest_file(
                project_id=project_id,
                file_path=full_path,
                storage_path=full_path,
                original_path=full_path,
                is_managed=False,
            )

    async def _find_existing_file(
        self, project_id: str, identifier: str, is_managed: bool = True
    ) -> File | None:
        is_path_identifier = (
            os.path.isabs(identifier)
            or os.path.sep in identifier
            or (os.path.altsep is not None and os.path.altsep in identifier)
        )

        if is_path_identifier:
            normalized = os.path.realpath(identifier)
            result = await self.db.execute(
                select(File)
                .where(
                    File.project_id == project_id,
                    File.original_path == normalized,
                )
                .order_by(File.created_at.desc())
                .limit(2)
            )
            matches = list(result.scalars().all())
            if len(matches) > 1:
                logger.warning(
                    "Multiple file records found for original_path '%s' in project %s; "
                    "using most recent record",
                    normalized,
                    project_id,
                )
            return matches[0] if matches else None

        # Filename fallback is managed-only and single-match only. If multiple
        # records share the same filename, do not guess; ingest as new.
        filename = os.path.basename(identifier)
        result = await self.db.execute(
            select(File)
            .where(
                File.project_id == project_id,
                File.filename == filename,
                File.is_managed == is_managed,
            )
            .order_by(File.created_at.desc())
            .limit(2)
        )
        matches = list(result.scalars().all())
        if len(matches) > 1:
            logger.warning(
                "Ambiguous filename fallback for '%s' in project %s (is_managed=%s); "
                "skipping fallback match",
                filename,
                project_id,
                is_managed,
            )
            return None
        return matches[0] if matches else None

    async def _get_vector_ids_for_source(self, source_id: str) -> list[str]:
        """Collect all vector IDs for a source with paginated scans."""
        filter_str = AsyncVectorStore.filter_by_source(source_id)
        ids: list[str] = []
        seen_ids: set[str] = set()
        offset = 0

        while True:
            results = await self.vectordb.get_by_filter(
                filter_str,
                columns=["id"],
                limit=_VECTOR_ID_PAGE_SIZE,
                offset=offset,
            )
            if not results:
                break

            for row in results:
                row_id = row.get("id")
                if row_id and row_id not in seen_ids:
                    ids.append(row_id)
                    seen_ids.add(row_id)

            if len(results) < _VECTOR_ID_PAGE_SIZE:
                break
            offset += _VECTOR_ID_PAGE_SIZE

        return ids

    def _select_parser(self, ext: str) -> FileParser | None:
        return self.parser_registry.select_parser(ext)

    def _get_extension(self, file_path: str) -> str:
        _, ext = os.path.splitext(file_path)
        return ext

    def _compute_checksum(self, file_path: str) -> str:
        sha256 = hashlib.sha256()
        with open(file_path, "rb") as f:
            for block in iter(lambda: f.read(8192), b""):
                sha256.update(block)
        return sha256.hexdigest()
