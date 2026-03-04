# Data Model

## Overview

Structured metadata lives in **SQLite** (WAL mode). Vector embeddings and chunk text live in **LanceDB** (embedded). There is no `chunks` table in SQLite — all chunk data is stored as LanceDB records.

## SQLite Tables

All models are in `backend/app/models/`. All IDs are UUID4 strings. All timestamps are UTC.

### projects

|| Column | Type | Notes |
||--------|------|-------|
|| `id` | String(36) | PK, UUID4 |
|| `name` | String(255) | Unique, required |
|| `description` | Text | Optional |
|| `source_directory` | String(1024) | Optional, local directory path for auto-sync |
|| `created_at` | DateTime | UTC |
|| `updated_at` | DateTime | UTC, auto-updates |
|| `last_sync_at` | DateTime | Nullable, last successful sync timestamp |
|| `last_sync_status` | String(20) | Nullable, `"synced"` or `"sync_failed"` |

Relationships: `files`, `notes`, `issues`, `chat_sessions`, `sync_jobs` — all with `cascade="all, delete-orphan"`.

When `source_directory` is set, the project auto-syncs from that directory on server startup via background tasks. The sync can also be triggered manually via `POST /projects/{id}/files/sync`.

### files

|| Column | Type | Notes |
||--------|------|-------|
|| `id` | String(36) | PK, UUID4 |
|| `project_id` | String(36) | FK → projects.id |
|| `filename` | String(512) | Original filename |
|| `original_path` | String(1024) | Full path for directory-indexed files |
|| `storage_path` | String(1024) | On-disk location |
|| `file_type` | String(50) | Extension without dot (e.g., "py", "pdf") |
|| `file_size` | Integer | Bytes |
|| `mime_type` | String(128) | Optional |
|| `chunk_count` | Integer | Number of vectors in LanceDB |
|| `checksum` | String(64) | SHA-256 hex digest |
|| `tags` | String(512) | Optional, user-defined tags |
|| `is_managed` | Boolean | True for uploads, False for directory-indexed |
|| `indexed_at` | DateTime | When vectors were created |
|| `created_at` | DateTime | UTC |

### notes

|| Column | Type | Notes |
||--------|------|-------|
|| `id` | String(36) | PK, UUID4 |
|| `project_id` | String(36) | FK → projects.id |
|| `content` | Text | Note body |
|| `tags` | String(512) | Optional, comma-separated |
|| `chunk_count` | Integer | Number of vectors |
|| `created_at` | DateTime | UTC |
|| `updated_at` | DateTime | UTC, auto-updates |

### issues

|| Column | Type | Notes |
||--------|------|-------|
|| `id` | String(36) | PK, UUID4 |
|| `project_id` | String(36) | FK → projects.id |
|| `title` | String(512) | Required |
|| `description` | Text | Optional |
|| `status` | String(20) | `open` / `in_progress` / `done` |
|| `priority` | String(20) | `low` / `medium` / `high` / `critical` |
|| `chunk_count` | Integer | Number of vectors (default 0) |
|| `created_at` | DateTime | UTC |
|| `updated_at` | DateTime | UTC, auto-updates |

Issues **are vectorized**. The `chunk_count` column tracks the number of vector chunks created from the issue's title and description.

### chat_sessions

|| Column | Type | Notes |
||--------|------|-------|
|| `id` | String(36) | PK, UUID4 |
|| `project_id` | String(36) or NULL | FK → projects.id, **nullable** — NULL for global chat sessions |
|| `title` | String(512) | Auto-set from first query (truncated to 100 chars) |
|| `created_at` | DateTime | UTC |
|| `updated_at` | DateTime | UTC, auto-updates |

Relationship: `messages` with `cascade="all, delete-orphan"`.

When `project_id` is NULL, the session is a "global" session not tied to any project. Global sessions search across all projects in LanceDB (no `project_id` filter). The service layer queries global sessions with `WHERE project_id IS NULL`.

### chat_messages

|| Column | Type | Notes |
||--------|------|-------|
|| `id` | String(36) | PK, UUID4 |
|| `session_id` | String(36) | FK → chat_sessions.id |
|| `role` | String(20) | `user` or `assistant` |
|| `content` | Text | Message body |
|| `created_at` | DateTime | UTC |

Source references are stored in the `message_sources` table (see below), linked via the `sources` relationship on `ChatMessage`.

### message_sources

|| Column | Type | Notes |
||--------|------|-------|
|| `id` | String(36) | PK, UUID4 |
|| `message_id` | String(36) | FK → chat_messages.id (CASCADE) |
|| `source_type` | String(50) | `"file"`, `"note"`, or `"issue"` |
|| `source_id` | String(36) | UUID of the source entity |
|| `filename` | String(512) | Nullable |
|| `original_path` | String(1024) | Nullable |
|| `chunk_text` | Text | The matched chunk content |
|| `chunk_index` | Integer | Position within source (default 0) |
|| `score` | Float | Relevance score (default 0.0) |
|| `source_order` | Integer | Display ordering (default 0) |

Relationship: `message` (back_populates `ChatMessage.sources`)

### sync_jobs

|| Column | Type | Notes |
||--------|------|-------|
|| `id` | String(36) | PK, UUID4 |
|| `project_id` | String(36) | FK → projects.id |
|| `status` | String(20) | `pending` / `running` / `completed` / `failed` |
|| `total_files` | Integer | Total files to process |
|| `processed_files` | Integer | Files processed so far |
|| `skipped_files` | Integer | Unchanged files skipped |
|| `failed_files` | Integer | Files that failed |
|| `total_chunks` | Integer | Total chunks created |
|| `current_file` | String(512) | Currently processing |
|| `error` | Text | Nullable, job-level error |
|| `created_at` | DateTime | UTC |
|| `completed_at` | DateTime | Nullable |

Relationships: `project` (back_populates), `errors` (cascade delete-orphan)

### sync_job_errors

|| Column | Type | Notes |
||--------|------|-------|
|| `id` | String(36) | PK, UUID4 |
|| `job_id` | String(36) | FK → sync_jobs.id (CASCADE) |
|| `filename` | String(512) | File that caused the error |
|| `error_message` | Text | Error description |
|| `created_at` | DateTime | UTC |

### system_config

|| Column | Type | Notes |
||--------|------|-------|
|| `key` | String(255) | PK |
|| `value` | Text | Configuration value |
|| `updated_at` | DateTime | UTC |

Used for embedding model safety: stores `embedding_model` key on first startup.

## LanceDB

### VectorStore (`core/vectordb.py`)

The `VectorStore` class wraps LanceDB and manages a single table called `chunks`.

- **Location:** `{data_dir}/vectors/` directory
- **Vector size:** 768 dimensions by default (configurable via `EMBEDDING_DIMENSION`)
- **Distance:** L2 (LanceDB default); scores converted to similarity via `1.0 - distance`

### Table Schema (PyArrow)

|| Field | Type | Description |
||-------|------|-------------|
|| `id` | string | UUID of the chunk |
|| `vector` | list\<float32\>[768] | Embedding vector (dimension matches `EMBEDDING_DIMENSION`) |
|| `project_id` | string | UUID of parent project |
|| `source_type` | string | `"file"`, `"note"`, or `"issue"` |
|| `source_id` | string | UUID of the source file or note |
|| `filename` | string | Original filename (files only) |
|| `original_path` | string | Full path (directory-indexed files only) |
|| `file_type` | string | Extension without dot |
|| `chunk_index` | int32 | Position within the source |
|| `chunk_text` | string | The actual text content |
|| `language` | string | Programming language (code files only) |
|| `tags` | string | JSON-encoded list of tags |
|| `content_hash` | string | SHA-256 prefix (16 chars) for deduplication |
|| `section_header` | string | Heading breadcrumb for the chunk (e.g. "Architecture > Data Storage") |

### VectorStore Methods

|| Method | Description |
||--------|-------------|
|| `add(records)` | Insert records into the chunks table. **Does not mutate input dicts** (works on shallow copies). Early-returns for empty list (no-op). Wraps LanceDB errors in `VectorStoreError`. |
|| `search(query_vector, filter_str, limit)` | Vector similarity search with optional SQL filter. **Clamps `limit` to >= 1** (LanceDB requires positive limit for ANN queries). Wraps LanceDB errors in `VectorStoreError`. |
|| `delete(filter_str)` | Delete records matching a SQL filter expression. **Rejects empty/whitespace-only filter** (raises `VectorStoreError` to prevent accidental mass deletion). Wraps LanceDB errors in `VectorStoreError`. |
|| `hybrid_search(query_vector, query_text, filter_str, limit)` | Hybrid vector+FTS search with RRF reranking. Falls back to vector-only on failure. |
|| `fts_search(query_text, filter_str, limit)` | Keyword-only full-text search via Tantivy BM25. |
|| `create_fts_index()` | Creates Tantivy FTS index on `chunk_text`. Safe to call multiple times (`replace=True`). |
|| `get_by_filter(filter_str, columns, limit)` | Metadata-only retrieval (no semantic query). Sorted by `chunk_index`. |
|| `get_distinct_column(column)` | Metadata-only distinct-value scan (paginated internally). |
|| `filter_by_project(project_id)` | (Static) Returns filter string with UUID validation. |
|| `filter_by_source(source_id)` | (Static) Returns filter string with UUID validation. |
|| `delete_by_ids(ids, batch_size)` | Delete records by a list of chunk IDs (batched). |

All `VectorStore` methods are **synchronous**. In production, the `AsyncVectorStore` wrapper (`core/async_vectordb.py`) provides the async interface with a dedicated executor, bounded read concurrency, and writer-exclusive coordination. Service code calls `AsyncVectorStore` methods directly (no manual `to_thread` needed).

### AsyncVectorStore (`core/async_vectordb.py`)

`AsyncVectorStore` wraps the synchronous `VectorStore` and manages concurrency:

- Dedicated `ThreadPoolExecutor` for all LanceDB I/O
- Bounded read concurrency via `asyncio.Semaphore` (configurable via `VECTORDB_MAX_READ_CONCURRENCY`)
- Writer-exclusive `asyncio.Lock` prevents concurrent writes
- Exposes the same method signatures as `VectorStore` but as `async def`
- Injected via `get_vectordb` dependency

All methods include error handling: LanceDB exceptions are caught, logged, and re-raised as `VectorStoreError` with context about the operation and parameters.

### Filter Expressions

LanceDB uses SQL-like filter strings:

- `"project_id = 'uuid'"` — filter by project
- `"source_id = 'uuid'"` — filter by source file/note
- Filters are passed as the `filter_str` parameter to `search()` and `delete()`

UUID-validated filter helpers (`filter_by_project()`, `filter_by_source()`) prevent SQL injection via format-string filter construction. Invalid UUIDs raise `VectorStoreError`.

### Deletion Strategy

Deletions follow a **DB-first** pattern for data consistency. The SQLite record is committed first, then vector and disk cleanup happens as best-effort. This means:

- If the DB commit fails, nothing has changed (safe rollback)
- If vector/disk cleanup fails afterward, only harmless orphaned data remains (no confusing desync where a user sees a record but search cannot find its content)

Ordering for each delete operation:

- **File deleted** → `db.delete(file)` + `db.commit()` → `vectordb.delete(f"source_id = '{file_id}'")` (best-effort) → `os.remove(storage_path)` (best-effort)
- **Note deleted** → `db.delete(note)` + `db.commit()` → `vectordb.delete(f"source_id = '{note_id}'")` (best-effort)
- **Project deleted** → `db.delete(project)` + `db.commit()` (cascades to files, notes, issues, sessions) → `vectordb.delete(f"project_id = '{project_id}'")` (best-effort) → remove managed files from disk (best-effort)

## Migrations

- **Tool:** Alembic
- **Config:** `backend/alembic.ini`
- **Versions:** `backend/migrations/versions/`
- **Auto-run:** Migrations execute automatically on app startup via `alembic upgrade head` in the lifespan

### Creating a New Migration

```bash
cd backend
alembic revision --autogenerate -m "description of change"
```

## Embedding Model Safety

On first startup, the active embedding model name is stored in the `system_config` table. On every subsequent startup, the configured model is verified against the stored value. If they differ, the system automatically wipes all vectors via `VectorStore.reset_table()`, resets `chunk_count` to 0 across files, notes, and issues, and triggers background re-indexing for projects with source directories. WebSocket clients receive `startup_progress` events during migration.
