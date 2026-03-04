# RAG Pipeline

## Overview

The ingestion pipeline transforms raw documents into searchable vector embeddings through five stages: parse, chunk, embed, store, and (on query) retrieve. Each stage is designed around a specific set of tradeoffs for a local-first, personal-scale system.

```
File/Note/Issue
    |
    v
Parse (file-type-aware)
    |
    v
Chunk (strategy per content type)
    |
    v
Embed (all-MiniLM-L6-v2, 384 dims)
    |
    v
Store (LanceDB vectors + SQLite metadata)
    |
    v
Retrieve (hybrid: vector + BM25 + RRF)
```

## Parsing: Registry Pattern

Parsers are managed by a `ParserRegistry` that selects the appropriate parser based on file extension. The registry maintains an ordered chain:

1. **PdfParser**: Uses pymupdf4llm to convert PDF pages to markdown-formatted text. Preserves structural formatting better than raw text extraction.
2. **DocxParser**: Uses python-docx to extract paragraph text.
3. **MarkdownParser**: Handles `.md`, `.markdown`, `.rst`, `.txt`. Reads raw content.
4. **CodeParser**: Handles 25+ code/config extensions. Reads raw content and detects language from extension.

The registry pattern decouples parser selection from the pipeline orchestrator. Adding a new parser means implementing the interface and registering it; the pipeline itself does not change.

## Chunking: Tree-Sitter with Regex Fallback

Chunking strategy is the most architecturally interesting decision in the pipeline. The system uses different strategies based on content type.

### Text chunking

`TextChunker` uses recursive character splitting with configurable separators (paragraph breaks -> line breaks -> sentence boundaries -> word boundaries). Default: 2000 characters with 200-character overlap. Per-file-type overrides: PDF gets 3000 chars (preserving page context), code gets 2000 chars.

### Code chunking (two-tier strategy)

Code files use `TreeSitterChunker` as the primary strategy with `RegexCodeChunker` as a fallback.

**TreeSitterChunker** parses source code into an AST and extracts semantically meaningful units: function definitions, class definitions, method declarations. This produces chunks that align with logical code boundaries rather than arbitrary character positions.

Grammars are configured for 13 languages (Python, JavaScript, TypeScript, TSX, Java, Go, Rust, C, C++, Ruby, PHP) via a declarative `LANGUAGE_CONFIG` table. Each entry specifies the tree-sitter module, optional language-specific initialization, and the AST node types to extract. Parsers are lazy-loaded and cached.

**RegexCodeChunker** activates when tree-sitter has no grammar for the language or when the AST yields no chunks (configuration files, languages with no function/class definitions). It uses per-language regex patterns to identify definition boundaries, falling back to blank-line splitting.

### Why this matters

Naive fixed-size chunking produces chunks that split mid-function or mid-paragraph, degrading retrieval quality. A search for "authentication middleware" should retrieve the complete middleware function, not an arbitrary 2000-character window that starts halfway through it. Tree-sitter chunking at definition boundaries makes this possible for supported languages, while the regex fallback ensures every file produces usable chunks.

The tradeoff is complexity: maintaining grammar configurations for 13 languages and handling edge cases (empty files, files with only comments, very large functions that exceed chunk size). The `ChunkingPolicy` orchestrator manages this by selecting the strategy per file and falling back gracefully.

## Embedding: Local CPU Model

The system uses `all-MiniLM-L6-v2` (384 dimensions) from sentence-transformers. This was chosen over API-based embeddings (OpenAI, Cohere) for three reasons:

1. **Cost**: Zero marginal cost per embedding. A personal tool ingesting thousands of files would accumulate API costs quickly.
2. **Latency**: No network round-trip. Embedding a batch of chunks takes milliseconds locally.
3. **Privacy**: Document content never leaves the machine.

The tradeoff is quality. MiniLM-L6-v2 ranks lower on MTEB benchmarks than larger models or API embeddings. For personal knowledge management (querying your own documents where you know the vocabulary), this quality gap is less impactful than it would be for a general-purpose search engine.

Embedding runs on CPU with `normalize_embeddings=True` for cosine similarity via L2 distance. Batch processing (default batch size 512) is offloaded to a dedicated `ThreadPoolExecutor` to keep the async event loop responsive during large ingestion jobs.

## Deduplication: Checksum-Based Skip

Before parsing a file, the pipeline computes its SHA-256 checksum and compares it to the stored checksum. If they match, the file is skipped entirely. This means re-syncing a 10,000-file directory only processes files that actually changed.

Re-ingestion follows an add-then-delete strategy: new vectors are inserted before old vectors are removed. This prevents a window where a file has zero search results during re-indexing.

## Per-File-Type Chunk Sizing

Chunk sizes are configurable per content type:
- Default: 2000 characters, 200 overlap
- PDF: 3000 characters (pages contain more contextual density)
- Code: 2000 characters (functions tend to be shorter)
- Markdown: 2000 characters

These defaults were tuned empirically for retrieval relevance on personal document collections.

## Hybrid Search: Vector + BM25 + Reciprocal Rank Fusion

The retrieval layer supports three search modes:

### Vector search
Embedding-based ANN (Approximate Nearest Neighbor) via LanceDB. Best for semantic queries ("how does authentication work?") where the exact keywords may not appear in the document.

### Keyword search
Tantivy BM25 full-text search via LanceDB's built-in FTS index. Best for exact-match queries ("SessionTokenMiddleware") where you know the precise term.

### Hybrid search (default)
Combines vector and keyword results using Reciprocal Rank Fusion (RRF). RRF merges two ranked lists by assigning scores based on rank position rather than raw scores, which handles the incomparability between cosine similarity and BM25 scores. This mode handles both semantic and keyword queries well.

Score normalization ensures consistent [0, 1] output regardless of search mode: vector distances are converted to similarity, hybrid relevance is clamped, and BM25 scores are transformed.

The FTS index is built asynchronously during deferred startup (after the API is live), so the first few seconds after a cold start may see hybrid search fall back to vector-only. This is an intentional tradeoff: API availability is prioritized over search completeness at startup.

## Directory Traversal and Sync

Directory indexing walks the file tree using a generator-based approach with batch consumption (`next_directory_batch()`). Files are filtered by supported extension and directories are filtered against a deny-list (`node_modules`, `.git`, `.venv`, `__pycache__`, etc.).

Sync jobs are tracked in SQLite with a `JobTracker` that enforces one active job per project. Progress counters (total, processed, skipped, failed) are updated atomically. A filesystem watcher (`watchdog`) on `source_directory` projects handles incremental changes: create/modify triggers re-ingestion, delete removes the record and vectors.
