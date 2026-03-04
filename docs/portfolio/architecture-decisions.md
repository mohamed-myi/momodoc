# Architecture Decisions

Last verified against source on 2026-03-04.

Each entry below reflects a decision that is still visible in the current codebase.

## ADR-1: SQLite Instead Of PostgreSQL

Context:

Momodoc needs relational storage for metadata, chat history, sync jobs, and migration-backed schema evolution.

Decision:

Use SQLite in WAL mode.

Rationale:

- zero external service requirement
- good fit for single-user local workloads
- straightforward Alembic migration story
- concurrent reads during writes are good enough for the app's sync and UI patterns

Tradeoff:

- not designed for multi-user or networked deployment

## ADR-2: LanceDB Instead Of A Cloud Vector Database

Context:

Retrieval needs persistent local vector search plus FTS without introducing hosted infrastructure.

Decision:

Use embedded LanceDB.

Rationale:

- local persistence
- hybrid retrieval support through LanceDB search primitives
- metadata filtering for project and source scoping
- no API keys or hosted vector bill

Tradeoff:

- fewer operational guarantees than large managed vector systems

## ADR-3: Local Embeddings Instead Of API Embeddings

Context:

Every indexed chunk needs embeddings, and the product goal is local-first operation.

Decision:

Use local `sentence-transformers` models.

Rationale:

- no per-document API cost
- works offline after model download
- keeps source text local
- model choice can still evolve through a local registry

Tradeoff:

- higher local CPU or GPU cost than a hosted API

## ADR-4: Static Frontend Export Instead Of A Separate Frontend Server

Context:

The browser UI needs to ship without adding another always-on runtime.

Decision:

Build the frontend as a static export and serve it from FastAPI.

Rationale:

- one backend process serves both API and UI
- no separate Node server in production
- works well with SPA fallback behavior in `SPAStaticFiles`

Tradeoff:

- no SSR-based features and no server-side Next.js runtime

## ADR-5: State-Based App Navigation Instead Of Route-Heavy Client Navigation

Context:

The current product has a small number of primary views and does not rely on deep-link-heavy navigation.

Decision:

Use internal view state for most client navigation.

Rationale:

- simpler desktop and static-web behavior
- avoids dynamic route complexity for the current app shape
- makes shared renderer components easier to reuse between web and desktop

Tradeoff:

- limited deep-linking and browser-history semantics

## ADR-6: Electron Sidecar Instead Of Requiring Users To Start The Backend Manually

Context:

The desktop app needs a usable backend without expecting terminal setup on every launch.

Decision:

Have Electron manage backend lifecycle as a sidecar.

Rationale:

- better desktop UX
- ability to reuse an already-running backend when available
- clean separation between Electron shell concerns and Python backend concerns

Tradeoff:

- more lifecycle and recovery logic in the main process

## ADR-7: Keep Chunk Rows In LanceDB, Not SQLite

Context:

Search and chat need chunk text and metadata immediately after retrieval.

Decision:

Store chunk rows only in LanceDB and keep only summary metadata in SQLite.

Rationale:

- retrieval results are self-contained
- no mandatory cross-store join to render a search result or citation
- chunk metadata naturally travels with the vector record

Tradeoff:

- chunk maintenance flows use LanceDB APIs rather than relational queries

## ADR-8: Wrap LanceDB In `AsyncVectorStore`

Context:

The backend is async, but LanceDB operations are synchronous.

Decision:

Use a dedicated async wrapper with its own executor, semaphore, and reader/writer coordination.

Rationale:

- protects the event loop
- prevents uncontrolled read bursts
- gives writes a path that cannot be starved by searches

Tradeoff:

- additional concurrency code to maintain

## ADR-9: Use Deferred Startup For Heavy Retrieval Dependencies

Context:

Embedder load, reranker load, FTS build, orphan cleanup, and watcher startup are too expensive to keep on the critical path.

Decision:

Serve requests after the critical startup path, then finish expensive initialization in the background.

Rationale:

- faster time-to-first-response for the backend process
- startup stays predictable even when models are large
- long-running initialization steps can broadcast progress independently

Tradeoff:

- early requests can temporarily see reduced capabilities

## ADR-10: Use A Metadata-Driven Provider Registry For LLMs

Context:

Supporting multiple LLM providers can easily spread provider-specific conditionals everywhere.

Decision:

Centralize provider creation and availability checks in a registry plus metadata table.

Rationale:

- one place to add providers
- lazy construction
- runtime hot reload when settings change
- cleaner router and service code

Tradeoff:

- the registry becomes a critical abstraction point that has to stay aligned with settings and provider modules
