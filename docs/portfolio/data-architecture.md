# Data Architecture

## Dual-Store Design

Momodoc splits data across two embedded stores, each chosen for what it does best:

| Store | Purpose | Why |
|-------|---------|-----|
| SQLite | Relational metadata (projects, files, notes, issues, chat, sync jobs) | ACID transactions, foreign keys, cascade deletes, zero-config |
| LanceDB | Vector embeddings and chunk text | ANN search, built-in FTS (Tantivy), SQL-like filtering, persistent storage |

### Why not one store for everything?

Relational operations (project CRUD, chat session management, sync job tracking with status updates and error recording) require transactions, joins, and foreign key constraints. Vector databases are not designed for these workloads.

Conversely, storing embeddings in SQLite would mean loading vectors into memory for similarity search or implementing custom ANN indexing. LanceDB handles this natively with IVF-PQ indexing.

The cost of the dual-store approach is coordinating deletions across two systems. This is addressed by the deletion strategy described below.

## No Chunks Table in SQLite

A deliberate design choice: there is no `chunks` table in SQLite. All chunk metadata (text, index, source reference, language, tags, content hash) lives as fields in LanceDB records alongside the embedding vector.

This avoids:
- A join between SQLite and LanceDB on every search query
- Synchronization complexity when chunks are added or deleted
- Duplication of chunk text in two stores

The tradeoff is that non-vector queries about chunks (listing all chunks for a file) must go through LanceDB's metadata filtering rather than a SQL query. LanceDB's `get_by_filter()` method handles this, but it is not as flexible as SQL joins.

Chunk counts are stored on the parent entity (files, notes, issues) in SQLite for efficient display without querying LanceDB.

## SQLite Configuration

- **WAL mode**: Enables concurrent reads during writes. Important during sync jobs where the UI reads project listings while the sync writes file metadata.
- **Foreign keys ON**: Enforced at the connection level. Cascade deletes on project -> files, notes, issues, chat sessions, sync jobs.
- **5-second busy timeout**: Prevents immediate failures during contention.
- **Connection pool**: Configurable `DB_POOL_SIZE` (default 5) and `DB_MAX_OVERFLOW` (default 10) via SQLAlchemy async engine.

## LanceDB Schema

Single table: `chunks`. Schema (PyArrow):

| Field | Type | Purpose |
|-------|------|---------|
| `id` | string | UUID of the chunk |
| `vector` | list\<float32\>[384] | Embedding vector |
| `project_id` | string | Scopes searches to a project |
| `source_type` | string | `"file"`, `"note"`, or `"issue"` |
| `source_id` | string | UUID of the parent entity |
| `filename` | string | Original filename |
| `original_path` | string | Full filesystem path |
| `file_type` | string | Extension without dot |
| `chunk_index` | int32 | Position within source |
| `chunk_text` | string | The actual text content |
| `language` | string | Programming language (code files) |
| `tags` | string | JSON-encoded tag list |
| `content_hash` | string | SHA-256 prefix (16 chars) for deduplication |

LanceDB uses L2 distance with scores converted to similarity via `1.0 - distance`. An IVF-PQ index is built when the table exceeds ~10k rows. UUID-validated filter helpers (`filter_by_project()`, `filter_by_source()`) prevent SQL injection in filter string construction.

## AsyncVectorStore: Concurrency Control

LanceDB is synchronous. The backend is async. Bridging this gap without introducing data corruption or deadlocks required a purpose-built wrapper.

`AsyncVectorStore` wraps the synchronous `VectorStore` with three concurrency mechanisms:

### Dedicated ThreadPoolExecutor

All LanceDB I/O runs on a dedicated executor (configurable via `VECTORDB_MAX_WORKERS`, default scales with CPU count). This isolates LanceDB operations from the main event loop and from other CPU-bound work (embedding, file parsing) that uses separate executors.

### Bounded read concurrency

An `asyncio.Semaphore` (configurable via `VECTORDB_MAX_READ_CONCURRENCY`) limits how many concurrent reads can execute. Without this, a burst of search requests during a sync job could saturate the executor and starve write operations.

### Writer-exclusive coordination

An `asyncio.Lock` provides writer-exclusive access. When a write operation (add, delete) acquires the lock, all pending reads wait. This prevents reads from seeing partially-written data.

The combination means: multiple reads can execute concurrently (up to the semaphore limit), but writes are serialized and exclusive. This matches the workload: reads are frequent (search, chat), writes are batched (ingestion, sync).

## Deletion Strategy

Deletions follow a DB-first pattern:

1. Commit the SQLite deletion first (with cascade for child records)
2. Delete vectors from LanceDB (best-effort)
3. Remove files from disk (best-effort, uploads only)

If the SQLite commit fails, nothing has changed (safe rollback). If vector or disk cleanup fails afterward, only harmless orphaned data remains. A startup maintenance task (`cleanup_orphaned_vectors`) scans for orphaned vectors and removes them.

This ordering prevents the more confusing failure mode: a user sees a record in the UI but search cannot find its content (which would happen if vectors were deleted first and the DB commit then failed).

## Embedding Model Safety

On first startup, the active embedding model name is stored in the `system_config` table. On every subsequent startup, the configured model is verified against the stored value. If they differ, the app raises `EmbeddingModelMismatchError` and refuses to start.

This prevents silent vector space mismatches where old vectors (from model A) and new vectors (from model B) coexist in the same table. Since different models produce incompatible embedding spaces, search results would be meaningless. The only way to change models is to re-index all data, which is a deliberate action.
