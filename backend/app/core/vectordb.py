"""LanceDB-backed vector store for momodoc chunk storage and retrieval."""

from collections.abc import Callable
import logging
import re
import threading
import uuid
from typing import Any, TypeVar

import lancedb
import pyarrow as pa

from app.core.exceptions import VectorStoreError

logger = logging.getLogger(__name__)

_T = TypeVar("_T")


_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE
)

_DEFAULT_SEARCH_NPROBES = 32
_DEFAULT_SEARCH_REFINE_FACTOR = 2
_DISTINCT_SCAN_PAGE_SIZE = 50_000


class VectorStore:
    """Thin wrapper around a LanceDB table for vector storage and search.

    All methods are synchronous — callers should use ``asyncio.to_thread()``
    when calling from async code to avoid blocking the event loop.
    """

    TABLE_NAME = "chunks"

    @staticmethod
    def _validate_uuid(value: str, label: str = "id") -> str:
        """Validate that a string is a valid UUID4. Raises VectorStoreError if not."""
        if not _UUID_RE.match(value):
            raise VectorStoreError(
                f"Invalid {label}: '{value}' is not a valid UUID",
                operation="filter",
            )
        return value

    @staticmethod
    def filter_by_project(project_id: str) -> str:
        """Return a LanceDB filter string for a given project_id."""
        VectorStore._validate_uuid(project_id, "project_id")
        return f"project_id = '{project_id}'"

    @staticmethod
    def filter_by_source(source_id: str) -> str:
        """Return a LanceDB filter string for a given source_id."""
        VectorStore._validate_uuid(source_id, "source_id")
        return f"source_id = '{source_id}'"

    def __init__(
        self,
        db_path: str,
        vector_dim: int = 384,
        search_nprobes: int = _DEFAULT_SEARCH_NPROBES,
        search_refine_factor: int = _DEFAULT_SEARCH_REFINE_FACTOR,
    ):
        self.db = lancedb.connect(db_path)
        self.vector_dim = vector_dim
        self.search_nprobes = max(1, int(search_nprobes))
        self.search_refine_factor = max(1, int(search_refine_factor))
        self._index_created: bool = False
        self._index_lock = threading.Lock()
        self._ensure_table()

    def _apply_search_tuning(self, query, limit: int):
        """Apply ANN query knobs for better recall on larger indexes.

        LanceDB accepts these on both vector and hybrid query builders.
        If an option is unsupported by the active query path, keep going.
        """
        target_nprobes = max(self.search_nprobes, min(64, max(8, limit * 4)))
        try:
            query = query.nprobes(target_nprobes)
        except Exception:
            logger.debug("Skipping nprobes tuning (unsupported by query path)")

        try:
            query = query.refine_factor(self.search_refine_factor)
        except Exception:
            logger.debug("Skipping refine_factor tuning (unsupported by query path)")

        return query

    @staticmethod
    def _normalize_positive_limit(
        limit: int,
        *,
        operation: str,
        warn_on_clamp: bool = True,
    ) -> int:
        """Normalize query limits to LanceDB's minimum supported value."""
        if limit < 1:
            if warn_on_clamp:
                logger.warning("%s() called with limit=%d, clamping to 1", operation, limit)
            return 1
        return limit

    @staticmethod
    def _normalize_nonnegative_offset(offset: int) -> int:
        """Normalize offsets used by metadata scans/queries."""
        return max(0, offset)

    def _open_table(self):
        """Open the configured LanceDB table."""
        return self.db.open_table(self.TABLE_NAME)

    def _run_table_operation(
        self,
        *,
        operation: str,
        callback: Callable[[Any], _T],
        error_message: str,
        log_message: str,
        log_args: tuple[object, ...] = (),
    ) -> _T:
        """Run a table operation with consistent error logging/wrapping."""
        try:
            table = self._open_table()
            return callback(table)
        except VectorStoreError:
            raise
        except Exception as e:
            logger.error(log_message, *log_args, e)
            raise VectorStoreError(
                error_message.format(error=e),
                operation=operation,
            ) from e

    def _ensure_table(self) -> None:
        table_names: list[str]
        if hasattr(self.db, "list_tables"):
            listed = self.db.list_tables()
            # LanceDB may return a response object with `tables`, not a bare list.
            if hasattr(listed, "tables"):
                table_names = list(getattr(listed, "tables") or [])
            else:
                table_names = list(listed)
        else:
            table_names = list(self.db.table_names())

        if self.TABLE_NAME not in table_names:
            schema = pa.schema([
                pa.field("id", pa.string()),
                pa.field("vector", pa.list_(pa.float32(), self.vector_dim)),
                pa.field("project_id", pa.string()),
                pa.field("source_type", pa.string()),
                pa.field("source_id", pa.string()),
                pa.field("filename", pa.string()),
                pa.field("original_path", pa.string()),
                pa.field("file_type", pa.string()),
                pa.field("chunk_index", pa.int32()),
                pa.field("chunk_text", pa.string()),
                pa.field("language", pa.string()),
                pa.field("tags", pa.string()),
                pa.field("content_hash", pa.string()),
                pa.field("section_header", pa.string()),
            ])
            try:
                self.db.create_table(self.TABLE_NAME, schema=schema)
            except Exception as e:
                # Concurrent init across workers/processes may race table creation.
                if "already exists" not in str(e).lower():
                    raise

    def reset_table(self) -> None:
        """Drop and recreate the chunks table with the current schema.

        Used during embedding model migration to wipe all vectors when
        the vector dimension changes.
        """
        try:
            self.db.drop_table(self.TABLE_NAME)
            logger.info("Dropped LanceDB table '%s' for migration", self.TABLE_NAME)
        except Exception as e:
            msg = str(e).lower()
            if "not found" not in msg and "does not exist" not in msg:
                logger.error("Failed to drop table '%s': %s", self.TABLE_NAME, e)
                raise VectorStoreError(
                    f"Failed to drop table during migration: {e}",
                    operation="reset_table",
                ) from e

        with self._index_lock:
            self._index_created = False

        self._ensure_table()
        logger.info(
            "Recreated LanceDB table '%s' with dimension=%d",
            self.TABLE_NAME,
            self.vector_dim,
        )

    def add(self, records: list[dict]) -> None:
        """Insert records into the chunks table.

        Each record must contain a ``vector`` key (list[float]) and metadata keys
        matching the table schema.  If ``id`` is missing it will be auto-generated.
        
        Note: Does not mutate the input records list or individual dicts.
        """
        if not records:
            return
        
        # Work on shallow copies to avoid mutating caller's data
        processed = []
        for r in records:
            rec = dict(r)
            rec.setdefault("id", str(uuid.uuid4()))
            # Ensure nullable string fields default to empty string for Arrow
            for field in (
                "filename", "original_path", "language", "tags",
                "content_hash", "section_header",
            ):
                if rec.get(field) is None:
                    rec[field] = ""
            processed.append(rec)
        
        self._run_table_operation(
            operation="add",
            callback=lambda table: table.add(processed),
            error_message=f"Failed to add {len(processed)} records: {{error}}",
            log_message="VectorStore.add failed: %s",
        )

        self._maybe_create_index()

    def search(
        self,
        query_vector: list[float],
        filter_str: str | None = None,
        limit: int = 10,
    ) -> list[dict]:
        """Vector similarity search with optional SQL-style filter.

        Returns a list of dicts with all table columns plus a ``_distance`` key.
        
        Note: limit is clamped to >= 1 (LanceDB requires positive limit for ANN queries).
        """
        limit = self._normalize_positive_limit(limit, operation="search")

        def _search(table):
            query = table.search(query_vector)
            query = self._apply_search_tuning(query, limit)
            query = query.limit(limit)
            if filter_str:
                query = query.where(filter_str)
            return query.to_list()

        return self._run_table_operation(
            operation="search",
            callback=_search,
            error_message=f"Failed to search with limit={limit}: {{error}}",
            log_message="VectorStore.search failed: %s",
        )

    def create_fts_index(self) -> None:
        """Create a full-text search index on the chunk_text column.

        Uses LanceDB's Tantivy-based FTS integration. Safe to call multiple
        times — ``replace=True`` rebuilds the index if one already exists.
        """
        try:
            table = self._open_table()
            table.create_fts_index("chunk_text", replace=True)
            logger.info("FTS index created on '%s.chunk_text'", self.TABLE_NAME)
        except Exception as e:
            logger.warning("Failed to create FTS index: %s", e)

    def hybrid_search(
        self,
        query_vector: list[float],
        query_text: str,
        filter_str: str | None = None,
        limit: int = 10,
    ) -> list[dict]:
        """Hybrid search combining vector similarity and full-text search.

        Uses LanceDB's native hybrid search with RRF (Reciprocal Rank Fusion)
        reranking by default. Returns a list of dicts with all table columns
        plus a ``_relevance_score`` key.

        Falls back to vector-only search if hybrid search fails (e.g. no FTS
        index exists).
        """
        limit = self._normalize_positive_limit(limit, operation="hybrid_search")

        try:
            table = self._open_table()
            query = (
                table.search(query_type="hybrid")
                .vector(query_vector)
                .text(query_text)
            )
            query = self._apply_search_tuning(query, limit).limit(limit)
            if filter_str:
                query = query.where(filter_str)
            return query.to_list()
        except Exception as e:
            logger.warning("Hybrid search failed, falling back to vector search: %s", e)
            return self.search(query_vector, filter_str, limit)

    def fts_search(
        self,
        query_text: str,
        filter_str: str | None = None,
        limit: int = 10,
    ) -> list[dict]:
        """Keyword-only full-text search via LanceDB Tantivy FTS index.

        Returns a list of dicts with all table columns plus a ``_score`` key.
        Requires a prior call to ``create_fts_index()``.
        """
        limit = self._normalize_positive_limit(limit, operation="fts_search")

        def _fts_search(table):
            query = table.search(query_text, query_type="fts").limit(limit)
            if filter_str:
                query = query.where(filter_str)
            return query.to_list()

        return self._run_table_operation(
            operation="fts_search",
            callback=_fts_search,
            error_message=f"Failed FTS search for '{query_text}': {{error}}",
            log_message="VectorStore.fts_search failed: %s",
        )

    def _compute_ivfpq_sub_vectors(self) -> int:
        """Return the number of sub-vectors for IVF-PQ based on vector dimension.

        For dims <= 512, use aggressive quantization (dim // 2, capped at 96).
        For dims > 512, use lighter quantization (dim // 8, capped at 96) to
        preserve recall with higher-dimensional embeddings.
        """
        if self.vector_dim <= 512:
            return min(self.vector_dim // 2, 96)
        return min(self.vector_dim // 8, 96)

    def _maybe_create_hnsw_index(self, table) -> bool:
        """Attempt to create an HNSW-SQ index (better recall for moderate-scale tables).

        Returns True if the index was created, False if unsupported.
        """
        try:
            table.create_index(metric="cosine", index_type="IVF_HNSW_SQ")
            return True
        except Exception:
            logger.debug("HNSW-SQ index not supported by this LanceDB version; falling back")
            return False

    def _maybe_create_index(self, threshold: int = 5000) -> None:
        """Create a vector index once the table exceeds *threshold* rows.

        Attempts HNSW-SQ first (better recall for read-heavy workloads);
        falls back to IVF-PQ if the LanceDB version does not support it.

        Called automatically after ``add()``.  The index is only created once
        per VectorStore instance (tracked by ``_index_created``).

        Uses double-checked locking since VectorStore methods are synchronous
        and may run concurrently via ``asyncio.to_thread()``.
        """
        if self._index_created:
            return

        with self._index_lock:
            if self._index_created:
                return

            try:
                table = self._open_table()
                count = table.count_rows()
                if count < threshold:
                    return

                if self._maybe_create_hnsw_index(table):
                    self._index_created = True
                    logger.info("HNSW-SQ index created: %d rows", count)
                    return

                num_partitions = min(count // 500, 256)
                num_sub_vectors = self._compute_ivfpq_sub_vectors()

                table.create_index(
                    metric="L2",
                    num_partitions=num_partitions,
                    num_sub_vectors=num_sub_vectors,
                )
                self._index_created = True
                logger.info(
                    "IVF-PQ index created: %d rows, %d partitions, %d sub-vectors",
                    count,
                    num_partitions,
                    num_sub_vectors,
                )
            except Exception as e:
                logger.warning("Failed to create vector index: %s", e)

    def get_by_filter(
        self,
        filter_str: str,
        columns: list[str] | None = None,
        limit: int = 1000,
        offset: int = 0,
    ) -> list[dict]:
        """Return records matching a SQL-style filter without a semantic query.

        Uses LanceDB's empty query builder (no vector similarity) to avoid ANN
        approximation artifacts when callers expect exact metadata filtering.
        Results are sorted by ``chunk_index`` after retrieval.

        Note: ``offset`` is applied by LanceDB before the local sort step.
        """
        if not filter_str or not filter_str.strip():
            raise VectorStoreError(
                "get_by_filter() requires a non-empty filter string",
                operation="get_by_filter",
            )
        limit = self._normalize_positive_limit(
            limit,
            operation="get_by_filter",
            warn_on_clamp=False,
        )
        offset = self._normalize_nonnegative_offset(offset)

        def _get_by_filter(table):
            query = table.search().where(filter_str).offset(offset).limit(limit)
            if columns:
                query = query.select(columns)
            rows = query.to_list()
            # Sort by chunk_index for stable ordering
            rows.sort(key=lambda r: r.get("chunk_index", 0))
            return rows

        return self._run_table_operation(
            operation="get_by_filter",
            callback=_get_by_filter,
            error_message=f"Failed to get records with filter '{filter_str}': {{error}}",
            log_message="VectorStore.get_by_filter failed with filter '%s': %s",
            log_args=(filter_str,),
        )

    def get_distinct_column(self, column: str) -> list[str]:
        """Return unique non-empty values from a column in the chunks table.

        Scans in paginated batches to avoid memory spikes on large tables.
        """
        def _get_distinct_column(table):
            unique_values: set[str] = set()
            offset = 0
            while True:
                rows = (
                    table.search()
                    .select([column])
                    .offset(offset)
                    .limit(_DISTINCT_SCAN_PAGE_SIZE)
                    .to_list()
                )
                if not rows:
                    break

                for row in rows:
                    val = row.get(column)
                    if val:
                        unique_values.add(val)

                if len(rows) < _DISTINCT_SCAN_PAGE_SIZE:
                    break
                offset += _DISTINCT_SCAN_PAGE_SIZE

            return list(unique_values)

        return self._run_table_operation(
            operation="get_distinct_column",
            callback=_get_distinct_column,
            error_message=f"Failed to get distinct values for column '{column}': {{error}}",
            log_message="VectorStore.get_distinct_column failed for '%s': %s",
            log_args=(column,),
        )

    def delete(self, filter_str: str) -> None:
        """Delete rows matching the SQL-style filter expression.

        Raises VectorStoreError if filter_str is empty (dangerous no-op).
        """
        if not filter_str or not filter_str.strip():
            raise VectorStoreError(
                "delete() requires a non-empty filter string to prevent accidental deletion of all records",
                operation="delete"
            )

        self._run_table_operation(
            operation="delete",
            callback=lambda table: table.delete(filter_str),
            error_message=f"Failed to delete with filter '{filter_str}': {{error}}",
            log_message="VectorStore.delete failed with filter '%s': %s",
            log_args=(filter_str,),
        )

    def delete_by_ids(self, ids: list[str], batch_size: int = 500) -> None:
        """Delete vectors by their specific IDs, in batches.

        Useful for targeted deletion (e.g., removing old vectors during
        re-ingestion) without affecting newly-added vectors.
        """
        if not ids:
            return
        for i in range(0, len(ids), batch_size):
            batch = ids[i : i + batch_size]
            id_list = ", ".join(f"'{id_}'" for id_ in batch)
            self.delete(f"id IN ({id_list})")
