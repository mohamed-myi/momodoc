# Data Model

This document reflects the current persistence model in the codebase:

- relational metadata in SQLite via SQLAlchemy ORM models under `backend/app/models/`
- vector and chunk storage in LanceDB via `backend/app/core/vectordb.py`

There is no SQLite `chunks` table. Chunk text, embeddings, and retrieval metadata live in LanceDB.

## SQLite Overview

- All primary keys are UUID strings.
- Timestamps are stored as UTC datetimes.
- SQLite is initialized with WAL mode, `busy_timeout=5000`, and foreign keys enabled.
- Connection pool: `pool_size=5`, `max_overflow=10`, `pool_timeout=30s`, `pool_recycle=3600s`, `pool_pre_ping=True`. Session factory uses `expire_on_commit=False` so ORM objects remain usable after commit without triggering lazy loads.
- PRAGMA settings are applied via a SQLAlchemy `connect` event listener on the sync engine.
- Alembic migrations run automatically during backend startup. Alembic is configured with `render_as_batch=True` for SQLite compatibility (SQLite does not natively support most `ALTER TABLE` operations; batch mode recreates tables with the new schema). The `+aiosqlite` driver prefix is stripped so migrations always run synchronously with a `NullPool`.

## SQLite Tables

### `projects`

| Column | Type | Notes |
|---|---|---|
| `id` | `String(36)` | Primary key |
| `name` | `String(255)` | Unique, required |
| `description` | `Text` | Nullable |
| `source_directory` | `String(1024)` | Nullable; validated against `ALLOWED_INDEX_PATHS` when set through services/routes |
| `created_at` | `DateTime` | UTC |
| `updated_at` | `DateTime` | UTC; auto-updated |
| `last_sync_at` | `DateTime` | Nullable |
| `last_sync_status` | `String(20)` | Nullable; current sync service writes `"completed"` or `"failed"` |

Relationships:

- `files`
- `notes`
- `issues`
- `chat_sessions`
- `sync_jobs`

All are configured with `cascade="all, delete-orphan"`.

### `files`

| Column | Type | Notes |
|---|---|---|
| `id` | `String(36)` | Primary key |
| `project_id` | `String(36)` | FK to `projects.id` |
| `filename` | `String(512)` | Display filename |
| `original_path` | `String(1024)` | Nullable; set for directory-indexed and sync-tracked files |
| `storage_path` | `String(1024)` | Required; uploads point into the Momodoc upload dir, indexed files point at the original file path |
| `file_type` | `String(50)` | Extension without leading dot |
| `file_size` | `Integer` | Bytes |
| `mime_type` | `String(128)` | Nullable |
| `chunk_count` | `Integer` | Number of current LanceDB chunks |
| `checksum` | `String(64)` | SHA-256 hex digest |
| `tags` | `String(512)` | Nullable |
| `is_managed` | `Boolean` | `True` for uploaded files stored under Momodoc control, `False` for external files indexed in place |
| `indexed_at` | `DateTime` | Nullable; set when vectors are written |
| `created_at` | `DateTime` | UTC |

### `notes`

| Column | Type | Notes |
|---|---|---|
| `id` | `String(36)` | Primary key |
| `project_id` | `String(36)` | FK to `projects.id` |
| `content` | `Text` | Required |
| `tags` | `String(512)` | Nullable; stored as raw comma-separated text in SQLite |
| `chunk_count` | `Integer` | Number of indexed chunks |
| `created_at` | `DateTime` | UTC |
| `updated_at` | `DateTime` | UTC; auto-updated |

Indexing note:

- Notes are chunked with `TextChunker`.
- Tag strings are split on commas and JSON-encoded into the LanceDB `tags` field during indexing.

### `issues`

| Column | Type | Notes |
|---|---|---|
| `id` | `String(36)` | Primary key |
| `project_id` | `String(36)` | FK to `projects.id` |
| `title` | `String(512)` | Required |
| `description` | `Text` | Nullable |
| `status` | `String(20)` | Defaults to `"open"` |
| `priority` | `String(20)` | Defaults to `"medium"` |
| `chunk_count` | `Integer` | Indexed chunk count; currently `0` or `1` in normal operation |
| `created_at` | `DateTime` | UTC |
| `updated_at` | `DateTime` | UTC; auto-updated |

Indexing note:

- Issues are indexed as a single combined chunk containing the title and optional description.

### `chat_sessions`

| Column | Type | Notes |
|---|---|---|
| `id` | `String(36)` | Primary key |
| `project_id` | `String(36)` or `NULL` | Nullable FK to `projects.id`; `NULL` means a global chat session |
| `title` | `String(512)` | Nullable; auto-filled from the first user query when empty |
| `created_at` | `DateTime` | UTC |
| `updated_at` | `DateTime` | UTC; auto-updated |

Relationship:

- `messages` with `cascade="all, delete-orphan"`

### `chat_messages`

| Column | Type | Notes |
|---|---|---|
| `id` | `String(36)` | Primary key |
| `session_id` | `String(36)` | FK to `chat_sessions.id` |
| `role` | `String(20)` | `user` or `assistant` |
| `content` | `Text` | Required |
| `created_at` | `DateTime` | UTC |

Relationships:

- `session`
- `sources`

### `message_sources`

| Column | Type | Notes |
|---|---|---|
| `id` | `String(36)` | Primary key |
| `message_id` | `String(36)` | FK to `chat_messages.id`, `ondelete="CASCADE"` |
| `source_type` | `String(50)` | `file`, `note`, or `issue` |
| `source_id` | `String(36)` | Source entity UUID |
| `filename` | `String(512)` | Nullable |
| `original_path` | `String(1024)` | Nullable |
| `chunk_text` | `Text` | Stored citation text |
| `chunk_index` | `Integer` | Chunk position within the source |
| `score` | `Float` | Retrieval or reranker score |
| `source_order` | `Integer` | Preserves citation ordering |
| `section_header` | `String(1024)` | Non-null with server default `""`; section breadcrumb for the cited chunk |

### `sync_jobs`

| Column | Type | Notes |
|---|---|---|
| `id` | `String(36)` | Primary key |
| `project_id` | `String(36)` | FK to `projects.id` |
| `status` | `String(20)` | `pending`, `running`, `completed`, or `failed` |
| `total_files` | `Integer` | Files discovered for the job |
| `processed_files` | `Integer` | Completion counter across success, skip, and failure |
| `skipped_files` | `Integer` | Unchanged files skipped during sync |
| `failed_files` | `Integer` | Failed files |
| `total_chunks` | `Integer` | Total chunks produced during the job |
| `current_file` | `String(512)` | Best-effort progress marker |
| `error` | `Text` | Nullable job-level error |
| `created_at` | `DateTime` | UTC |
| `completed_at` | `DateTime` | Nullable |

Relationship:

- `errors` ordered by `SyncJobError.created_at`

Current API note:

- `completed_files` and `succeeded_files` in `SyncJobResponse` are derived response fields, not database columns.
- The current file-job routers serialize `errors` as an empty list because the relationship is not loaded into `_job_to_response()`.

### `sync_job_errors`

| Column | Type | Notes |
|---|---|---|
| `id` | `String(36)` | Primary key |
| `job_id` | `String(36)` | FK to `sync_jobs.id`, `ondelete="CASCADE"` |
| `filename` | `String(512)` | File that failed |
| `error_message` | `Text` | Recorded error text |
| `created_at` | `DateTime` | UTC |

### `system_config`

| Column | Type | Notes |
|---|---|---|
| `key` | `String(255)` | Primary key |
| `value` | `Text` | Stored config value |
| `updated_at` | `DateTime` | UTC |

Current usage:

- The backend records the active embedding model under the `embedding_model` key.

### `settings.json` (SettingsStore)

LLM configuration is persisted to a JSON file (`settings.json`) in the data directory, managed by `SettingsStore` in `core/settings_store.py`. This is a separate persistence layer outside SQLite.

- Uses atomic writes (temp file + `os.replace()`) for crash safety
- Thread-safe via `threading.Lock`
- Strict allowlist of exactly 9 keys: `llm_provider`, `anthropic_api_key`, `claude_model`, `openai_api_key`, `openai_model`, `google_api_key`, `gemini_model`, `ollama_base_url`, `ollama_model`
- Keys not in the allowlist are silently dropped on both read and write
- At startup, persisted values override environment variables (precedence: `settings.json` > env > defaults)

## LanceDB

### Storage layout

- Path: `{data_dir}/vectors/`
- Table name: `chunks`
- Access pattern: synchronous `VectorStore`, wrapped by `AsyncVectorStore`

### Arrow schema

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Chunk UUID |
| `vector` | `list<float32>[dimension]` | Embedding vector |
| `project_id` | `string` | Parent project UUID |
| `source_type` | `string` | `file`, `note`, or `issue` |
| `source_id` | `string` | Source entity UUID |
| `filename` | `string` | File display name; empty string for notes/issues |
| `original_path` | `string` | Original file path when applicable |
| `file_type` | `string` | Extension or logical type such as `note` / `issue` |
| `chunk_index` | `int32` | Position within the source |
| `chunk_text` | `string` | Retrieved chunk content |
| `language` | `string` | Parser/chunker language hint |
| `tags` | `string` | JSON-encoded tag list |
| `content_hash` | `string` | Short SHA-256 prefix used during re-ingestion cleanup |
| `section_header` | `string` | Heading breadcrumb |

### Vector dimensions

The LanceDB schema uses the configured `embedding_dimension`.

Current backend `Settings` defaults:

- `embedding_model = "nomic-ai/nomic-embed-text-v1.5"`
- `embedding_dimension = 768`

Important codebase nuance:

- The desktop config defaults `embeddingModel` to `all-MiniLM-L6-v2`, but the backend-side dimension setting still comes from backend `Settings`.
- The backend treats embedding model changes as a migration event and resets the LanceDB table when the configured model name changes.

### Search and metadata methods

`VectorStore` currently exposes:

- `add(records)`
- `search(query_vector, filter_str, limit)`
- `hybrid_search(query_vector, query_text, filter_str, limit)`
- `fts_search(query_text, filter_str, limit)`
- `create_fts_index()`
- `get_by_filter(filter_str, columns, limit, offset)`
- `get_distinct_column(column)`
- `delete(filter_str)`
- `delete_by_ids(ids, batch_size)`
- `reset_table()`
- filter helpers `filter_by_project()` and `filter_by_source()`

Behavior worth documenting:

- `search()`, `hybrid_search()`, and `fts_search()` clamp `limit` to at least `1`.
- `delete()` and `get_by_filter()` reject empty filter strings.
- `get_by_filter()` sorts returned rows by `chunk_index`.
- `hybrid_search()` falls back to vector-only search if hybrid search fails.
- `create_fts_index()` builds a Tantivy index on `chunk_text`.
- `add()` fills nullable string fields with empty strings and auto-generates missing chunk IDs.
- Filter helpers (`filter_by_project`, `filter_by_source`) validate UUIDs against a regex before building filter strings, defending against injection in LanceDB filter expressions.

### Search tuning parameters

`VectorStore` accepts configurable `search_nprobes` (default `32`) and `search_refine_factor` (default `2`). During search, `nprobes` is dynamically adjusted to `max(search_nprobes, min(64, max(8, limit * 4)))` — scaling with the requested limit for better recall on larger result sets. Both knobs are applied to vector and hybrid query builders.

### Index creation

Vector indexing is lazy.

- Until the table reaches `5000` rows, Momodoc does not attempt ANN index creation.
- Above that threshold, it tries `IVF_HNSW_SQ` first with `metric="cosine"`.
- If unsupported, it falls back to IVF-PQ with `metric="L2"`. IVF-PQ partitioning uses `num_partitions = min(count // 500, 256)` and sub-vector count is computed per dimension: for dimensions <= 512, `min(dim // 2, 96)`; for dimensions > 512, `min(dim // 8, 96)`.
- Index creation uses double-checked locking (`threading.Lock` + boolean flag) to prevent redundant index creation across concurrent threads.

### Async wrapper

`AsyncVectorStore` adds:

- a dedicated `ThreadPoolExecutor` (default 4 workers, prefixed `momodoc-vectordb`)
- bounded read concurrency via `asyncio.Semaphore` (default 8)
- a writer-preferring async read/write lock (readers block when `_waiting_writers > 0`, not just when a writer is active)
- graceful shutdown protection via `threading.Lock`-guarded flag; `_run()` catches `RuntimeError` from "cannot schedule new futures after shutdown" and converts it to `VectorStoreError`

## Deletion Strategy

The service layer treats SQLite as the source of truth and deletes relational rows first.

Current order:

- delete DB row
- commit
- best-effort vector cleanup
- best-effort managed-file cleanup

That behavior is used for files, notes, issues, and projects.

### Content entity lifecycle helpers

`content_entity_service_helpers.py` codifies three reusable patterns for notes and issues:

- `create_entity_with_indexing()`: flushes the DB row first (to get the ID), indexes the entity to get `chunk_count`, then commits
- `finalize_entity_update()`: on content change, deletes old vectors, re-indexes. If re-indexing fails, sets `chunk_count=0`, commits the partial state, and re-raises — leaving content saved but vectors missing (logged at CRITICAL level)
- `delete_entity_with_vector_cleanup()`: commits the DB deletion first, then does best-effort vector cleanup

### Orphaned vector cleanup

`maintenance.py` implements a two-phase cleanup that runs during deferred startup:

1. `_cleanup_orphaned_projects()`: scans `get_distinct_column("project_id")` from LanceDB, compares against SQLite projects, deletes vectors for missing project IDs
2. `_cleanup_orphaned_sources()`: scans `source_id` values, compares against `File.id`, `Note.id`, and `Issue.id`, deletes vectors for missing sources

Both phases are best-effort — failures are logged as warnings but do not block startup.

### Issue and note schema enums

The Pydantic schemas enforce strict enums on the `String(20)` status and priority columns:

- `IssueStatus`: `open`, `in_progress`, `done`
- `IssuePriority`: `low`, `medium`, `high`, `critical`

## Migrations

- Config file: `backend/alembic.ini`
- Migration scripts: `backend/migrations/versions/`
- Runtime behavior: `bootstrap/startup.py` runs `alembic upgrade head` during startup

To create a migration:

```bash
cd backend
alembic revision --autogenerate -m "describe change"
```

## Embedding Model Safety

`system_config_service.check_embedding_model()` enforces model consistency:

1. On first boot, it records the configured embedding model in `system_config`.
2. On later boots, it compares the stored model name to the configured one.
3. If the name changed, startup:
   - resets the LanceDB `chunks` table
   - sets `chunk_count = 0` on `files`, `notes`, and `issues`
   - leaves re-indexing to deferred startup and normal sync/index flows

The backend also broadcasts `startup_progress` events over WebSocket while this happens.
