# Ingestion Pipeline

The ingestion pipeline lives in `backend/app/services/ingestion/`. It handles parsing, chunking, embedding, and storing file and note content as vectors.

## Pipeline Stages

```
Upload / Directory scan
    ↓
Checksum (SHA-256)
    ↓
Deduplication check (same path + same checksum = skip)
    ↓
Parse (extract text + heading hierarchy from file)
    ↓
Chunk (split text into segments with section breadcrumbs)
    ↓
Embed (nomic-embed-text-v1.5, 768 dimensions; heading context prepended)
    ↓
Store (add to LanceDB with rich metadata + section_header)
```

The orchestrator is the `IngestionPipeline` class in `services/ingestion/pipeline.py`. It is instantiated per-request with injected dependencies (DB session, VectorStore, Embedder). Parser selection is managed by `parser_registry.py`, chunking policy by `chunking_policy.py`, and directory traversal by `directory_walk.py`.

## Smart Re-ingestion

Files are identified by `(project_id, original_path or filename)`:

- **Same checksum** → file is **skipped** (no reprocessing)
- **Different checksum** → old vectors are **deleted** from LanceDB, file is **re-indexed**
- **New file** → indexed from scratch

Checksums are SHA-256 hex digests computed from file contents.

## Error Handling

`ingest_file()` is designed to be resilient — it returns an `IngestionResult` with an `errors` list rather than raising exceptions. This is critical for directory ingestion where one bad file should not halt the entire walk.

| Error scenario | Behavior |
|---|---|
| **File unreadable** (checksum fails) | Returns `IngestionResult(errors=["File read error: ..."])`. No DB record created. |
| **Parse failure** (corrupt PDF, bad encoding) | Returns `IngestionResult(errors=["Parse error: ..."])`. File record may exist but has 0 chunks. |
| **Unsupported extension** | Returns `IngestionResult(errors=["No parser for extension: ..."])`. File record exists with 0 chunks. |
| **Vector storage fails** (LanceDB write error) | Rolls back DB transaction (`db.rollback()`), returns `IngestionResult(errors=["Vector storage failed: ..."])`. For new files this removes the flushed File record; for re-ingestion it preserves the old checksum so the next attempt can retry. |
| **Vector storage fails during re-ingestion** | Logged at `CRITICAL` level because old vectors were already deleted. DB rollback preserves old checksum, so the next ingestion attempt sees the content change and retries the full cycle. |

## Parsers

Parsers live in `services/ingestion/parsers/`. Each extends the `FileParser` base class with `supports(ext)` and `parse(file_path)` methods. The `parse()` method returns a `ParsedContent` dataclass with `text`, `language`, `metadata`, and `headings` fields.

| Parser | File | Handles | Library |
|--------|------|---------|---------|
| `PdfParser` | `pdf_parser.py` | `.pdf` | pymupdf4llm (converts to Markdown) |
| `DocxParser` | `docx_parser.py` | `.docx` | python-docx (extracts paragraphs) |
| `MarkdownParser` | `markdown_parser.py` | `.md`, `.markdown`, `.rst`, `.txt` | Read as-is |
| `CodeParser` | `code_parser.py` | All code extensions | Read as-is, detect language from extension |

The pipeline tries parsers in order and uses the first one that `supports()` the extension.

### Heading Extraction

`MarkdownParser` and `PdfParser` extract document heading hierarchy via the shared `heading_extractor.py` module. Each heading is a dict with `level` (int, 1-6), `text` (str), and `char_offset` (int, character position in the source text).

Supported heading formats:
- ATX-style markdown headings (`#` through `######`)
- RST underline-style headings (text followed by a line of repeated punctuation)

`CodeParser` and `DocxParser` return an empty headings list. The headings are used downstream by the `SectionAwareTextChunker` to build section breadcrumbs for each chunk.

## Chunkers

Chunkers live in `services/ingestion/chunkers/`. Each extends a base class with a `chunk(text, metadata)` method.

### SectionAwareTextChunker (`text_chunker.py`)

- **Strategy:** Splits at heading boundaries first, then recursively by paragraph → line → sentence → word
- **Max chunk size:** 2000 characters (configurable per file type)
- **Overlap:** 200 characters between consecutive chunks within a section
- **Section headers:** Each chunk carries a `section_header` breadcrumb derived from the active heading hierarchy (e.g. "Architecture > Data Storage > SQLite Tables")
- **Embedding enrichment:** The pipeline prepends the section_header to the chunk text before embedding, giving the embedding model structural context. The stored `chunk_text` remains clean (no prepended header).
- Used for: documents, markdown, plain text, PDFs
- When no headings are available, output is identical to the legacy TextChunker

### TextChunker (`text_chunker.py`)

- **Strategy:** Recursive splitting by paragraph → line → sentence → word boundaries
- **Max chunk size:** 2000 characters
- **Overlap:** 200 characters between consecutive chunks
- Kept for backward compatibility and used as the inner splitter within SectionAwareTextChunker
- Used for: notes, code fallback

### TreeSitterChunker (`treesitter_chunker.py`)

- **Strategy:** AST-based code chunking using tree-sitter parsers
- **Max chunk size:** 2000 characters (configurable per file type)
- **Languages:** 13 supported — Python, JavaScript, TypeScript, TSX, Java, Go, Rust, C, C++, Ruby, PHP
- **Lazy loading:** Parsers loaded on first use and cached per language (class-level cache)
- **Extraction:** Top-level definitions (functions, classes, etc.) with leading comments/decorators
- **Fallback:** Returns empty list when grammar unavailable, triggering fallback to RegexCodeChunker
- Grammar configuration: `grammar_config.py` maps languages to tree-sitter modules and target AST node types

In the ingestion pipeline, tree-sitter is tried first for code files. If it returns no chunks (unsupported language or no top-level definitions found), `RegexCodeChunker` is used as fallback.

### RegexCodeChunker (`code_chunker.py`)

- **Strategy:** Language-aware boundary splitting using regex patterns
- **Max chunk size:** 2000 characters
- **Overlap:** None (code chunks don't overlap)
- Small chunks are merged together
- Falls back to blank-line splitting if no language boundaries are found
- Used for: all code file types

**Language boundary patterns** (12 languages):

| Language | Boundaries |
|----------|-----------|
| Python | `def`, `class`, `async def` |
| JavaScript/TypeScript | `function`, `const`, `class`, `export`, `interface`, `type` |
| Java | Access modifiers (`public`, `private`, `protected`) |
| Go | `func`, `type` |
| Rust | `fn`, `impl`, `struct`, `enum`, `trait`, `mod` |
| C/C++ | Function signatures, `class`, `struct`, `namespace` |
| Ruby | `def`, `class`, `module` |
| PHP | `function`, `class` |
| Swift | `func`, `class`, `struct`, `enum`, `protocol` |
| Kotlin | `fun`, `class`, `object`, `interface`, `data class` |

## Configurable Chunk Sizes

Chunk sizes vary by file type (configurable via Settings):

| File type | Chunk size | Setting |
|-----------|-----------|---------|
| PDF | 3000 chars | `chunk_size_pdf` |
| Code | 2000 chars | `chunk_size_code` |
| Markdown/text | 2000 chars | `chunk_size_markdown` |
| Default | 2000 chars | `chunk_size_default` |
| Overlap (text only) | 200 chars | `chunk_overlap_default` |

## Supported File Types

| Category | Extensions |
|----------|-----------|
| Documents | `.pdf`, `.docx`, `.md`, `.markdown`, `.rst`, `.txt` |
| Python | `.py` |
| JavaScript/TypeScript | `.js`, `.ts`, `.jsx`, `.tsx` |
| Systems | `.c`, `.cpp`, `.h`, `.go`, `.rs` |
| JVM | `.java`, `.kt`, `.scala` |
| Scripting | `.rb`, `.php`, `.swift`, `.sh`, `.bash` |
| Data/Config | `.json`, `.yaml`, `.yml`, `.toml`, `.xml`, `.sql` |
| Web | `.html`, `.css`, `.scss` |

## Ignored Directories

During codebase indexing, these directories are skipped:

`node_modules`, `__pycache__`, `.git`, `.venv`, `venv`, `dist`, `build`, `.next`, `.tox`, `.mypy_cache`, `.pytest_cache`, `egg-info`

Additionally:
- Any directory starting with `.` is skipped
- Any directory ending with `.egg-info` is skipped (e.g., `mypackage.egg-info`)

## Embedding

- **Default model:** `nomic-ai/nomic-embed-text-v1.5` (via sentence-transformers)
- **Dimensions:** 768 (configurable; supports Matryoshka truncation for nomic and Qwen models)
- **Distance metric:** Cosine (normalized)
- **Task prefixes:** The nomic model requires "search_document: " for indexing and "search_query: " for retrieval. The Embedder handles this transparently via `aembed_texts(texts, mode="document")` and `aembed_single(text)` (always query mode).
- **Device:** Auto-detected (CUDA if >= 4GB VRAM, MPS if available, else CPU). Override via `EMBEDDING_DEVICE` env var.
- **Execution:** Local, no external API calls
- **Legacy support:** `all-MiniLM-L6-v2` (384 dims) is still supported for backward compatibility
- The `Embedder` class (in `services/ingestion/embedder.py`) is loaded once at startup and stored as a singleton on `app.state`
- Batch embedding via `aembed_texts()` offloads to a thread pool using `asyncio.get_running_loop().run_in_executor()`
- Changing the `EMBEDDING_MODEL` env var triggers automatic migration on next startup: all vectors are wiped and projects with source directories are re-indexed
- `embed_single()` guards against empty model results with an explicit `ValueError`

## Batch Embedding

All chunks from a single file are embedded in one batch call to `embedder.aembed_texts()`. This amortizes model initialization overhead and improves throughput for large files.

## Chunk Deduplication

Each chunk's content is hashed using SHA-256, truncated to 16 characters, and stored as `content_hash` in LanceDB. This enables future deduplication of identical content across different files.

## Vector Storage

Records are stored in LanceDB via the `VectorStore` class (`core/vectordb.py`):

- Records are dicts with fields: `id`, `vector`, `project_id`, `source_type`, `source_id`, `filename`, `original_path`, `file_type`, `chunk_index`, `chunk_text`, `language`, `tags`, `content_hash`, `section_header`
- Tags are JSON-encoded strings (e.g., `'["python", "backend"]'`)
- Vector operations are exposed via `AsyncVectorStore` (dedicated executor, bounded read concurrency, writer-exclusive access)
- Deletion uses SQL-like filter strings: `vectordb.delete(f"source_id = '{file_id}'")`

## Directory Indexing Sandbox

Directory indexing is restricted by the `ALLOWED_INDEX_PATHS` setting:

- The path must resolve to a real directory
- It must be a subdirectory of at least one allowed path
- Symlinks that escape the sandbox are rejected
- If `ALLOWED_INDEX_PATHS` is empty, all directory indexing is rejected
- Validation logic is in `core/security.py` → `validate_index_path()`

## Notes as RAG Sources

Notes use the same pipeline as text files:

- Chunked with `TextChunker` (2000-char chunks, 200-char overlap)
- Embedded and stored in LanceDB with `source_type: "note"`
- When a note's content is updated, old vectors are deleted and new ones are created
- Notes appear alongside file chunks in search and chat context retrieval

**Re-indexing Error Handling:** When a note's content is updated, the service deletes old vectors before creating new ones. If the vectorization step fails after deletion (due to LanceDB errors, embedding failures, etc.), the service:

1. Sets `chunk_count = 0` to reflect that the note has no vectors
2. Commits the content change (preserving the user's edit)
3. Logs the failure at CRITICAL level with instructions to retry
4. Re-raises the exception so the API returns an error

This ensures the user's content is never lost, even if vector indexing fails. A subsequent edit to the note will retry the full indexing process. This mirrors the error handling strategy used in file re-ingestion (see "Vector storage fails during re-ingestion" above).

## Adding a New Parser

1. Create a new file in `services/ingestion/parsers/`
2. Extend `FileParser` base class
3. Implement `supports(ext: str) -> bool` and `parse(file_path: str) -> ParseResult`
4. Register the parser in `ParserRegistry.with_defaults()` in `services/ingestion/parser_registry.py`
5. Add the new extensions to `SUPPORTED_EXTENSIONS` in `pipeline.py`

## Background Sync Service

The sync service (`services/sync_service.py`) provides background directory synchronization with progress tracking.

### How it works

`run_sync_job()` is called as a background task (via FastAPI `BackgroundTasks` or `asyncio.create_task()`):

1. Creates its own DB session via `db_module.async_session_factory()` (background tasks can't use request-scoped sessions)
2. Creates an `IngestionPipeline` and calls `_walk_directory()` to enumerate files
3. Sets `progress.total_files`, then iterates calling `pipeline.ingest_file()` per file
4. Updates `JobTracker` progress after each file (processed count, current_file, skipped, errors)
5. After all files: runs `_cleanup_deleted_files()` to remove DB records + vectors for files no longer on disk
6. Calls `job_tracker.complete_job()` or `fail_job()` on completion/error

### Deleted file cleanup

`_cleanup_deleted_files()` queries `File` records where `is_managed=False` and `original_path` starts with the synced directory. Any file not in the `seen_paths` set (files actually found on disk) is deleted from both SQLite and LanceDB.

### Job tracking

The `JobTracker` (`core/job_tracker.py`) is a SQLite-backed, thread-safe tracker:

- `SyncJob` and `SyncJobError` SQLAlchemy models store job state persistently
- `JobStatus` enum: `pending`, `running`, `completed`, `failed`
- One active job per project (enforced by `create_job()`, raises `ValueError` if already running)
- `recover_stale_jobs()` marks crashed jobs as failed on startup
- Uses a bounded worker queue (`sync_max_concurrent_files`, default 4) to avoid one-task-per-file fanout on large directories

### Auto-sync on startup

In `main.py`, the `_auto_sync_projects()` function runs before `yield` in the lifespan:
- Queries all projects with non-null `source_directory`
- For each, validates the directory exists on disk (skips with warning if not)
- Creates a job and launches `sync_service.run_sync_job` via `asyncio.create_task()` (non-blocking)

## Adding a New Chunker

1. Create a new file in `services/ingestion/chunkers/`
2. Extend the base chunker class
3. Implement `chunk(text: str, metadata: dict) -> list[Chunk]`
4. Add selection logic in `services/ingestion/chunking_policy.py`

## Directory Walk Utilities

Public directory traversal helpers live in `services/ingestion/directory_walk.py`:

- `iter_directory_paths(root, supported_extensions, ignore_dirs)` — generator yielding file paths
- `next_directory_batch(iterator, batch_size)` — consume the next batch from the iterator

These are used by the sync service for batched file discovery during background sync jobs. They replace the previous private methods on `IngestionPipeline`.

## Parser Registry

`services/ingestion/parser_registry.py` provides `ParserRegistry`:

- `ParserRegistry.with_defaults()` — creates a registry with the standard parser ordering (PDF, DOCX, Markdown, Code)
- `select_parser(extension)` — returns the first parser that supports the given extension, or `None`

This is used by both the ingestion pipeline and the file content preview router to ensure consistent parser selection.

## Query-Time Transforms

Query-time transformations such as Hypothetical Document Embedding (HyDE) and query decomposition are not part of the ingestion pipeline. They live in `services/query_pipeline.py` and are applied at search and chat retrieval time. See [Architecture: Retrieval and Search](architecture.md) for details.
