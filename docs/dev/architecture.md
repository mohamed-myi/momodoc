# Architecture

This document reflects the current codebase and covers all major components: backend, desktop, web frontend, VS Code extension, and the shared UI layer.

## 1. System Overview

Momodoc is a local-first RAG knowledge system with:
- FastAPI backend (REST + SSE + WebSocket + optional static frontend serving)
- SQLite for relational metadata
- LanceDB for vector storage/retrieval
- Local embedding model (`nomic-ai/nomic-embed-text-v1.5`, 768 dimensions; configurable)
- Optional LLM providers (Claude/OpenAI/Gemini/Ollama)
- Multiple clients: Desktop app, web static UI, CLI, VS Code extension

## 2. Runtime Components

### Backend process

- Entry point: `backend/app/main.py` (thin app factory, ~75 lines)
- Startup orchestration: `backend/app/bootstrap/` package (`startup.py`, `routes.py`, `exceptions.py`, `watcher.py`)
- 12 routers registered via `bootstrap/routes.py` under `/api/v1` and `/ws`
- Middleware stack:
  - `CORSMiddleware` (allows `"null"` + localhost origins for Electron renderer)
  - `SessionTokenMiddleware` (validates `X-Momodoc-Token`)
  - `RequestLoggingMiddleware` (logs method, path, status, duration)

### Layered design

```
Routers (thin HTTP handlers)
    |
Services (business logic)
    |
Data Layer (SQLAlchemy + LanceDB + LLM)
```

**Routers** live in `backend/app/routers/`. There are 12 routers: projects, files, file_content, notes, issues, chat, search, batch, export, llm, metrics, and ws. They validate input via Pydantic schemas, call service functions, and return responses. No business logic belongs in routers.

**Services** live in `backend/app/services/`. Each domain has its own service module. The ingestion pipeline has its own sub-package at `services/ingestion/`.

| Service | File | Purpose |
|---------|------|---------|
| `project_service` | `project_service.py` | Project CRUD, resolution by name or UUID |
| `file_service` | `file_service.py` | File CRUD, upload handling, content preview |
| `note_service` | `note_service.py` | Note CRUD with vector indexing |
| `issue_service` | `issue_service.py` | Issue CRUD with vector indexing |
| `chat_service` | `chat_service.py` | Chat orchestration (uses `chat_context` and `chat_workflow`) |
| `chat_context` | `chat_context.py` | Retrieval context assembly and prompt building |
| `chat_workflow` | `chat_workflow.py` | Shared pre/post-LLM workflow steps |
| `search_service` | `search_service.py` | Hybrid/vector/keyword search |
| `sync_service` | `sync_service.py` | Background directory sync with progress tracking |
| `metrics_service` | `metrics_service.py` | Aggregated metrics (overview, projects, chat, storage, sync) |
| `maintenance` | `maintenance.py` | Orphaned vector cleanup on startup |
| `rag_evaluation` | `rag_evaluation.py` | RAG retrieval quality evaluation (Recall@K, Precision@K, MRR) |
| `system_config_service` | `system_config_service.py` | Embedding model consistency enforcement |
| `query_pipeline` | `query_pipeline.py` | Adaptive query preprocessing: classification, HyDE, decomposition |
| `query_llm_resolver` | `query_llm_resolver.py` | LLM availability resolver for query-time transforms (60s TTL cache) |
| `retrieval_scoring` | `retrieval_scoring.py` | Shared score extraction/normalization helpers |
| `content_entity_service_helpers` | `content_entity_service_helpers.py` | Shared CRUD lifecycle helpers for notes/issues |

### Desktop app

- Electron main process: `desktop/src/main/index.ts` (thin) -> `app-runtime.ts`, `window-factory.ts`, `shutdown.ts`
- Sidecar starts/reuses backend via `desktop/src/main/sidecar.ts`
- IPC split into domain handlers: `ipc/backend.ts`, `ipc/settings.ts`, `ipc/overlay.ts`, `ipc/window.ts`, `ipc/updater.ts`, `ipc/diagnostics.ts`
- Renderer components are thin wrappers importing from `frontend/src/shared/renderer/`
- Shared modules in `desktop/src/shared/` (`app-config.ts`, `desktop-settings.ts`)
- Overlay chat is a separate always-on-top window using global chat sessions

### VS Code extension

- Optional sidecar lifecycle management (`momodoc.startServer`, `momodoc.stopServer`)
- Sidebar chat webview (`extension/media/chat.html`, `chat.js`, `chat.css`)
- Context command for file ingestion
- API split into `extension/src/api/` (client, streaming, transport, types)
- Shared helpers in `extension/src/shared/` (`momodocSse.ts`, `runtimeFileHelpers.ts`, `sidecarLifecycleCore.ts`)

### Web frontend

- Next.js static export (`frontend/next.config.ts` -> `output: "export"`)
- Backend serves static files from `backend/static` when present via `SPAStaticFiles`

### Shared UI layer

- `frontend/src/shared/renderer/` is the shared source of truth for components, UI primitives, and library code
- Both the web frontend (`frontend/src/components/`) and the desktop renderer (`desktop/src/renderer/components/`) use thin re-export wrappers that import from the shared layer
- Shared lib includes `apiClientCore.ts` (API client factory), `momodocSse.ts` (SSE parser), `types.ts`, `hooks.ts`
- Shared CSS tokens in `shared/renderer/app/globals-core.css`

## 3. Dependency Injection

All shared resources are injected via FastAPI `Depends()`. Providers live in `backend/app/dependencies.py`:

| Dependency | What it returns |
|------------|-----------------|
| `get_db` | `AsyncSession` from SQLAlchemy |
| `get_vectordb` | `AsyncVectorStore` (async LanceDB wrapper) |
| `get_embedder` | `Embedder` singleton |
| `get_reranker` | `Reranker` or `None` (disabled or still loading) |
| `get_llm_provider` | `LLMProvider` or raises `LLMNotConfiguredError` |
| `get_provider_registry` | `ProviderRegistry` |
| `get_job_tracker` | `JobTracker` |
| `get_ws_manager` | `WSManager` |
| `get_file_watcher` | `ProjectFileWatcher` |
| `get_settings` | `Settings` (cached via `@lru_cache`) |
| `get_project` | Resolves `project_id` (UUID or name) via `resolve_project_or_404` |
| `get_chat_rate_limiter` | `ChatRateLimiter` (lazy-initialized) |
| `resolve_llm_provider` | Resolves per-request `llm_mode` override or fallback |
| `get_query_llm` | `LLMProvider` or `None` for query-time transforms (HyDE, decomposition) |

## 4. Backend Lifecycle

### Critical startup path (`bootstrap/startup.py:lifespan`)

1. Configure logging (`momodoc.log`, `momodoc-startup.log`)
2. Ensure data/upload/vector dirs exist
3. Initialize DB engine/session factory (WAL mode, FKs ON, 5s busy timeout)
4. Run Alembic migrations (`alembic upgrade head`)
5. Check embedding model consistency (`system_config` table); if model changed, wipe vectors and reset chunk counts for automatic re-indexing
6. Initialize LanceDB `VectorStore` + `AsyncVectorStore`
7. Initialize default LLM provider and provider registry
8. Generate session token (`secrets.token_urlsafe(32)`) and write `session.token` with mode `0600`
9. Recover stale sync jobs and hydrate active jobs
10. Initialize WebSocket manager and file watcher
11. Mark app ready and launch deferred startup task

### Deferred startup

Runs in background after API is live:
- Load embedder instance
- Load reranker model (if `reranker_enabled`; hardware-aware model selection)
- Build FTS index asynchronously
- Cleanup orphaned vectors (`maintenance.cleanup_orphaned_vectors`)
- Auto-trigger sync for projects with `source_directory`
- Start filesystem watchers for those projects

### Shutdown

- Stop file watchers
- Shutdown embedder pools
- Cancel outstanding FTS task
- Shutdown vector store executor
- Remove `session.token`

## 5. Data Storage

### 5.1 SQLite tables (ORM models)

- `projects`, `files`, `notes`, `issues`
- `chat_sessions`, `chat_messages`, `message_sources`
- `sync_jobs`, `sync_job_errors`
- `system_config`

All entity IDs are UUID strings. See [Data Model](data-model.md) for full column details.

### 5.2 Vector storage (LanceDB)

Single table: `chunks`. Schema fields: `id`, `vector` (768-dim by default), `project_id`, `source_type`, `source_id`, `filename`, `original_path`, `file_type`, `chunk_index`, `chunk_text`, `language`, `tags`, `content_hash`.

### 5.3 Data directory

Default: `platformdirs.user_data_dir("momodoc")`

Contains: `db/momodoc.db`, `vectors/`, `uploads/`, `session.token`, `momodoc.pid`, `momodoc.port`, logs.

## 6. Ingestion Architecture

See [Ingestion Pipeline](ingestion-pipeline.md) for full details.

Parser chain order: PdfParser -> DocxParser -> MarkdownParser -> CodeParser.

Chunking: SectionAwareTextChunker for text/markdown/PDF (section-aware splitting with heading breadcrumbs), TreeSitterChunker (with RegexCodeChunker fallback) for code files. Tree-sitter grammars configured for Python, JS, TS/TSX, Java, Go, Rust, C, C++, Ruby, PHP.

Heading extraction: MarkdownParser and PdfParser extract document heading hierarchy via `heading_extractor.py`. Each chunk carries a `section_header` breadcrumb (e.g. "Architecture > Data Storage"). The section header is prepended to chunk text for embedding (semantic enrichment) but stored separately in LanceDB.

Embedding by `Embedder` (sentence-transformers, `nomic-ai/nomic-embed-text-v1.5` default). Task prefixes are applied transparently: "search_document: " for indexing, "search_query: " for search. Re-ingestion uses add-then-delete for robustness.

## 7. Retrieval and Search

`search_service.search()` modes:
- `keyword`: FTS only (Tantivy BM25)
- `vector`: vector ANN search
- `hybrid` (default): vector + keyword with RRF reranking

### Query preprocessing (adaptive pipeline)

Before retrieval, the query pipeline classifies and optionally transforms the query:

1. `classify_query()` assigns a `QueryType` using heuristic rules (no model calls):
   - `KEYWORD_LOOKUP`: camelCase, snake_case, or dotted identifiers detected
   - `MULTI_PART`: multiple question marks or conjunction patterns
   - `CONCEPTUAL`: starts with how/why/explain/describe, or contains "what is"/"what are"
   - `SIMPLE`: everything else (default)

2. `plan_query()` builds a `QueryPlan` from the type and LLM availability:
   - CONCEPTUAL + LLM available: enables HyDE (Hypothetical Document Embedding)
   - MULTI_PART + LLM available: enables query decomposition
   - KEYWORD_LOOKUP: hints keyword search mode
   - All transforms degrade gracefully to plain retrieval when no LLM is available

3. Transform execution (when LLM is available):
   - **HyDE**: generates a hypothetical answer passage via LLM, embeds both query and passage, averages and L2-normalizes vectors, then runs vector search
   - **Decomposition**: splits multi-part query into 2-4 sub-questions via LLM, runs parallel hybrid searches, merges results using Reciprocal Rank Fusion (RRF, k=60)

LLM availability is resolved by `query_llm_resolver.resolve_query_llm()` which checks configured providers with a 60-second TTL cache. The resolver tries the default provider first, falls back to other configured providers, and as a last resort pings Ollama with a 2-second HTTP health check.

### Two-stage retrieve-and-rerank

When `reranker_enabled` is True (default) and the reranker has finished loading:
1. Retrieval fetches `retrieval_candidate_k` (default 50) candidates via the appropriate search path (normal, HyDE, or decomposed).
2. A cross-encoder reranker (`Reranker` service) scores each query-document pair.
3. The top `reranker_top_k` (default 10) results are returned with normalized cross-encoder scores.
4. Keyword-only mode bypasses the reranker entirely.

When the reranker is disabled or not yet loaded, the pipeline falls back to single-stage retrieval with the original score normalization.

Score normalization: with reranker, scores are sigmoid-normalized cross-encoder logits in [0,1]. Without reranker, vector distance -> similarity, hybrid relevance clamped to [0,1], keyword BM25 transformed to [0,1].

## 8. Chat Architecture

### Session model

- Project sessions: `/api/v1/projects/{project_id}/chat/sessions/...`
- Global sessions: `/api/v1/chat/sessions/...` (project_id IS NULL)
- Session title auto-populates from first query

### Request flow

1. Persist user message
2. Classify query and plan retrieval strategy (HyDE, decomposition, or standard; see Section 7)
3. Retrieve context via the chosen search path + optional pinned sources; cross-encoder reranking when available
4. Apply per-source diversity cap (max 3 chunks per source_id) to prevent single-document flooding
5. Select context sources within token budget (tiktoken-based estimation)
6. Build prompt with system instruction + history + context blocks (source labels include section_header breadcrumbs when available)
7. Call selected LLM provider (`llm_mode` override supported)
8. Persist assistant response and ordered `message_sources`; return `retrieval_metadata` in response

### Streaming (SSE)

SSE endpoint emits: `event: sources`, token `data` events, `event: done`, `event: error`.

### LLM abstraction

| File | Class | Notes |
|------|-------|-------|
| `llm/base.py` | `LLMProvider` | Abstract base with `complete()`, `stream()`, `get_model_name()` |
| `llm/claude.py` | `ClaudeProvider` | Anthropic SDK |
| `llm/openai_provider.py` | `OpenAIProvider` | Extends `OpenAICompatibleBase` |
| `llm/gemini_provider.py` | `GeminiProvider` | Google Generative AI SDK |
| `llm/ollama_provider.py` | `OllamaProvider` | Extends `OpenAICompatibleBase` with Ollama defaults |
| `llm/openai_compatible_base.py` | `OpenAICompatibleBase` | Shared base for OpenAI-compatible providers |
| `llm/factory.py` | `ProviderRegistry` | Declarative metadata table, `create_llm_provider()`, `available_providers()` |

The `ProviderRegistry` uses a declarative metadata table so adding a provider requires editing only the metadata.

## 9. Sync and File Watching

`JobTracker` persists status in SQLite with an in-memory active-project guard. Statuses: `pending`, `running`, `completed`, `failed`. Crash recovery marks stale jobs failed on restart.

`sync_service.run_sync_job()`: discovers files in batches, processes with bounded worker queue, updates progress atomically, records per-file errors, removes deleted external files.

`ProjectFileWatcher` (watchdog) watches `source_directory` projects: create/modify -> ingest, delete -> remove record + vectors.

## 10. Security Model

### Token auth

`SessionTokenMiddleware` enforces `X-Momodoc-Token` for API routes except `/api/v1/health` and `/api/v1/token`. WebSocket auth is handled via query token.

### Path safety

`validate_index_path()`: requires non-empty path, resolves canonical path, ensures within `ALLOWED_INDEX_PATHS`.

### Rate limiting

`ChatRateLimiter`: in-memory sliding window, separate buckets for non-stream and stream, per-client + global limits, returns 429 with `Retry-After`.

### CORS

Allows `"null"` origin (Electron `file://` sends `null`) and localhost origins via regex.

### Error handling

Custom exceptions in `core/exceptions.py` mapped to HTTP status codes via `bootstrap/exceptions.py`. See [API Patterns](api-patterns.md) for the full mapping.

## 11. Async Patterns

- All DB operations use `async with session` and `await`
- CPU-bound work (file parsing, checksums, embedding) offloaded via `asyncio.to_thread()`
- `Embedder` uses an instance-owned `ThreadPoolExecutor`
- `AsyncVectorStore` wraps synchronous `VectorStore` with a dedicated executor, bounded read concurrency, and writer-exclusive coordination

## 12. Key Files

| File | Purpose |
|------|---------|
| `main.py` | Thin app factory, CORS, health/token endpoints, static mount |
| `config.py` | `Settings` class (Pydantic BaseSettings with platformdirs) |
| `dependencies.py` | All FastAPI dependency providers |
| `bootstrap/startup.py` | Lifespan, deferred startup, migrations |
| `bootstrap/routes.py` | Router registration |
| `bootstrap/exceptions.py` | Exception handler registration |
| `bootstrap/watcher.py` | Filesystem watcher setup |
| `middleware/auth.py` | `SessionTokenMiddleware` |
| `middleware/logging.py` | `RequestLoggingMiddleware` |
| `core/database.py` | SQLAlchemy async engine, WAL mode |
| `core/async_vectordb.py` | `AsyncVectorStore` with executor and RW lock |
| `core/vectordb.py` | Synchronous `VectorStore` |
| `core/exceptions.py` | Custom exceptions |
| `core/job_tracker.py` | Persistent sync job tracker |
| `core/ws_manager.py` | WebSocket broadcast manager |
| `core/file_watcher.py` | `ProjectFileWatcher` |
| `core/security.py` | `validate_index_path()` |
| `core/rate_limiter.py` | `ChatRateLimiter` |
| `core/hardware.py` | GPU detection for device-aware model loading |
| `core/logging.py` | Rotating file handlers |
| `services/reranker.py` | Cross-encoder reranker (MiniLM or BGE, hardware-aware) |
| `services/tokenizer.py` | tiktoken-based token counting for context budgets |
| `services/query_pipeline.py` | Query classifier, HyDE, decomposition, RRF merge |
| `services/query_llm_resolver.py` | LLM availability resolver with TTL cache |

## 13. Operational Constraints

- Designed for single-user local deployment (localhost by default)
- Uses embedded SQLite + LanceDB (no external DB service)
- Embedding model consistency is checked at startup; changing the model triggers automatic vector wipe and re-indexing
- Cloud provider keys are optional unless chat mode needs them

## 14. Adding a New Feature (End-to-End)

1. **Model**: Create SQLAlchemy model in `backend/app/models/`, add to `models/__init__.py`
2. **Migration**: Run `alembic revision --autogenerate -m "description"` in the backend directory
3. **Schema**: Create Pydantic `Create`, `Update`, `Response` schemas in `backend/app/schemas/`
4. **Service**: Create service module in `backend/app/services/` with async functions
5. **Router**: Create router in `backend/app/routers/` with thin endpoint handlers
6. **Register**: Import and include the router in `bootstrap/routes.py`
7. **Frontend**: Add method to `apiClientCore.ts` and types to `types.ts`
8. **Test**: Add integration tests in `backend/tests/integration/`
