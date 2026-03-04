# Data Architecture

Last verified against source on 2026-03-04.

## Two Embedded Stores

Momodoc splits persistence across two local stores with different responsibilities.

| Store | Holds | Why |
|---|---|---|
| SQLite | entities, chat history, sync jobs, system configuration markers | relational integrity, migrations, transactions |
| LanceDB | chunk text, vectors, retrieval metadata | vector search, FTS, metadata-filtered retrieval |

The split follows workload, not fashion.

## What Lives In SQLite

SQLite currently stores:

- projects
- files
- notes
- issues
- chat sessions
- chat messages
- persisted `message_sources`
- sync jobs
- sync errors
- `system_config`

SQLite is the source of truth for entity existence and workflow state.

## What Lives In LanceDB

LanceDB stores the `chunks` table.

Current schema fields:

- `id`
- `vector`
- `project_id`
- `source_type`
- `source_id`
- `filename`
- `original_path`
- `file_type`
- `chunk_index`
- `chunk_text`
- `language`
- `tags`
- `content_hash`
- `section_header`

This table contains enough metadata for retrieval results to be self-describing without a mandatory SQLite join.

## Why There Is No SQLite Chunks Table

The codebase intentionally keeps chunk rows out of SQLite.

Reasoning reflected in the implementation:

- search results should already include the text that matched
- chat citations need chunk-level metadata immediately
- retrieval should not require a second round-trip into SQL just to render a result

The tradeoff is that chunk maintenance and filtering happen through LanceDB APIs instead of relational queries.

## Summary Fields In SQLite

Although chunk rows do not live in SQL, parent entities still carry summary metadata:

- `File.chunk_count`
- `Note.chunk_count`
- `Issue.chunk_count`

That supports UI summaries without hitting LanceDB for simple counts.

## Async Concurrency Boundary

LanceDB itself is synchronous. The backend is async. `AsyncVectorStore` is the coordination layer between them.

Current responsibilities:

- run LanceDB work in a dedicated `ThreadPoolExecutor`
- cap concurrent reads with a semaphore
- serialize writes with a writer-preferring async read/write lock

This is more than an `asyncio.to_thread()` wrapper. It prevents search-heavy workloads from starving writes and isolates vector work from other executor-bound tasks.

## Query And Index Behavior

Current `VectorStore` behavior includes:

- validation of UUID-based filters before building filter strings
- normalization of positive limits to protect LanceDB queries
- automatic normalization of nullable string metadata on insert
- opportunistic ANN index creation once the table becomes large enough
- FTS index creation on `chunk_text`

ANN index creation currently waits for enough rows, then prefers `IVF_HNSW_SQ` and falls back when necessary.

## Deletion Strategy

Deletes are deliberately DB-first.

Current ordering:

1. commit SQL deletion first
2. attempt LanceDB cleanup afterward
3. remove uploaded file contents afterward when relevant

That keeps the user-facing system of record coherent even if LanceDB cleanup fails. The cost is temporary orphaned vectors.

## Orphan Cleanup

To support the DB-first deletion model, deferred startup runs orphan cleanup.

It currently removes:

- vectors belonging to deleted projects
- vectors whose `source_id` no longer exists in `files`, `notes`, or `issues`

This keeps best-effort cleanup from turning into permanent retrieval drift.

## Embedding Model Migration

`system_config` records the embedding model used for indexing under the `embedding_model` key.

At startup:

1. the configured embedding model is compared to the stored one
2. if the model changed, LanceDB is reset
3. `chunk_count` is reset to `0` for files, notes, and issues
4. deferred startup re-launches auto-sync for projects with `source_directory`

This avoids silently mixing incompatible vector spaces.

Important limitation:

- manually uploaded files, notes, and issues are not automatically reindexed just because the vector table was reset

Their metadata remains in SQLite, but retrieval coverage returns only after later re-indexing activity.
