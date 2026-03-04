# Architecture Decision Records

Each entry documents a key technical decision: the context, the options considered, the choice made, and the rationale.

## ADR-1: SQLite over PostgreSQL

**Context**: The application needs a relational store for metadata (projects, files, notes, issues, chat sessions, sync jobs).

**Options considered**:
1. **PostgreSQL**: Full-featured RDBMS with excellent concurrency, JSON support, and extensions.
2. **SQLite**: Embedded, zero-config, single-file database.

**Decision**: SQLite.

**Rationale**: Momodoc is a single-user, single-machine application. Requiring users to install, configure, and maintain a PostgreSQL server (or Docker container) for a personal tool is disproportionate overhead. SQLite provides ACID transactions, foreign keys, and sufficient throughput for the workload. WAL mode handles the primary concurrency concern (reads during sync writes). The tradeoff is no multi-user access and no network accessibility, which are non-requirements.

## ADR-2: LanceDB over Cloud Vector Databases

**Context**: The system needs a vector store for embedding-based retrieval.

**Options considered**:
1. **Pinecone/Weaviate/Qdrant (cloud)**: Managed vector databases with scaling and managed infrastructure.
2. **FAISS (in-memory)**: High-performance ANN search, pure vector index.
3. **LanceDB (embedded)**: Persistent embedded vector database with FTS support.

**Decision**: LanceDB.

**Rationale**: Cloud vector databases require API keys, internet access, and ongoing costs, contradicting the local-first, free-to-run design. FAISS is in-memory only and loses data on restart (requiring index rebuilds). LanceDB provides persistent storage, built-in Tantivy FTS (enabling hybrid search without a separate index), and SQL-like filtering for project-scoped queries. The tradeoff is less maturity and community support than FAISS or Pinecone, which is acceptable at personal scale.

## ADR-3: sentence-transformers over API Embeddings

**Context**: Documents and notes need to be embedded for vector search.

**Options considered**:
1. **OpenAI/Cohere embedding APIs**: Higher quality embeddings, no local compute.
2. **sentence-transformers (local)**: CPU-based embedding with no API costs.

**Decision**: Local sentence-transformers (`all-MiniLM-L6-v2`, 384 dimensions).

**Rationale**: A personal knowledge tool that charges per embedding request contradicts the free-to-run principle. Local embedding also eliminates latency (no network round-trip) and privacy concerns (content never leaves the machine). MiniLM-L6-v2 is a deliberate quality/efficiency tradeoff: it scores lower on MTEB benchmarks than larger models, but runs fast on CPU and produces good enough results for personal document retrieval where the user knows the vocabulary.

## ADR-4: Static Export over Server-Side Rendering

**Context**: The web frontend needs to be served to users.

**Options considered**:
1. **Next.js SSR**: Server-rendered pages with dynamic data fetching.
2. **Next.js static export**: Pre-built HTML/JS/CSS served as static files.
3. **Plain React (Vite)**: No framework, just bundled React.

**Decision**: Next.js static export.

**Rationale**: SSR requires a running Node.js process, adding a second server to manage alongside the Python backend. Static export produces files that FastAPI serves directly via `SPAStaticFiles`, keeping the deployment to a single process. Next.js was retained (over plain React/Vite) because the frontend was already using it and the migration cost was not justified. The tradeoff is losing SSR and API routes, which are unnecessary for a local tool that authenticates via session token and fetches all data client-side.

## ADR-5: State-Based Routing over File-Based Routing

**Context**: The frontend needs view navigation (dashboard, project detail).

**Options considered**:
1. **Next.js App Router**: File-based routing with URL segments.
2. **State-based routing**: `useState<View>` with conditional rendering.

**Decision**: State-based routing.

**Rationale**: The static export cannot handle dynamic URL segments (`/projects/[id]`) without server-side rewrites. The application has exactly two primary views (dashboard and project), making URL-based routing unnecessary complexity. State-based routing keeps navigation as simple function calls (`setView("project"); setProjectId(id)`). The tradeoff is no deep-linking and no browser history navigation, which are acceptable for a local tool where the entry point is always the dashboard.

## ADR-6: Sidecar Process over Embedded Server

**Context**: The desktop app needs the Python backend to be running.

**Options considered**:
1. **Embedded Python (PyInstaller/cx_Freeze)**: Bundle Python into the Electron app as a single binary.
2. **Sidecar process**: Electron spawns and manages the backend as a child process.
3. **User-managed**: Require users to start the backend manually.

**Decision**: Sidecar process.

**Rationale**: Embedding Python into Electron creates complex build and debugging challenges (two runtimes in one process, platform-specific binary packaging). User-managed startup is poor UX for a desktop app. The sidecar pattern provides clean separation: Electron manages the process lifecycle while the backend runs independently. The sidecar can also detect and reuse an already-running backend (started via CLI), preventing port conflicts. The tradeoff is process management complexity (health polling, stale PID cleanup, shutdown coordination), which is addressed by the shared `sidecarLifecycleCore`.

## ADR-7: No Chunks Table in SQLite

**Context**: Chunk metadata (text, index, source reference) needs to be stored alongside embeddings.

**Options considered**:
1. **Chunks table in SQLite**: Normalized relational storage with a foreign key to files/notes.
2. **Chunk fields in LanceDB records**: Store all chunk metadata as LanceDB record fields alongside the vector.

**Decision**: All chunk data in LanceDB records only.

**Rationale**: Separating chunks across two stores introduces a join problem: every search result would require a cross-store lookup (LanceDB for the vector match, SQLite for the chunk text). Storing everything in LanceDB records means search results are self-contained. The tradeoff is that non-vector queries about chunks (listing all chunks for a file) must use LanceDB's metadata filtering rather than SQL, which is less flexible but sufficient for the access patterns needed.

## ADR-8: Async Wrapper with RW Lock over Native Async Driver

**Context**: LanceDB is synchronous. The backend is fully async (FastAPI + SQLAlchemy async).

**Options considered**:
1. **Wait for native async LanceDB**: LanceDB has discussed async support but it was not available.
2. **Simple `asyncio.to_thread()` per call**: Wrap each LanceDB call individually.
3. **Dedicated `AsyncVectorStore` with executor, semaphore, and lock**: Purpose-built async wrapper.

**Decision**: Purpose-built `AsyncVectorStore`.

**Rationale**: Simple `to_thread()` wrapping does not address concurrency: multiple concurrent reads during a sync job could saturate the default thread pool, and concurrent writes could corrupt data. The `AsyncVectorStore` provides three coordinated mechanisms: a dedicated `ThreadPoolExecutor` (isolation from other CPU-bound work), a `Semaphore` (bounded read concurrency), and a `Lock` (writer-exclusive access). The tradeoff is additional complexity in the wrapper, but this complexity is isolated in one module (`core/async_vectordb.py`) and provides correctness guarantees that simple wrapping cannot.
