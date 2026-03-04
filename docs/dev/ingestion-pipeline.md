# Ingestion Pipeline

Last verified against source on 2026-03-04.

## Source Of Truth

- `backend/app/services/ingestion/pipeline.py`
- `backend/app/services/ingestion/chunking_policy.py`
- `backend/app/services/ingestion/parser_registry.py`
- `backend/app/services/ingestion/parsers/*`
- `backend/app/services/ingestion/chunkers/*`
- `backend/app/services/note_service.py`
- `backend/app/services/issue_service.py`

## Scope

Momodoc has three indexing paths that all write into the shared LanceDB `chunks` table:

- files via `IngestionPipeline`
- notes via `note_service._index_note(...)`
- issues via `issue_service._index_issue(...)`

Files are the most complex path. Notes and issues use narrower, purpose-built indexers.

## File Ingestion Flow

`IngestionPipeline.ingest_file(...)` currently performs:

```text
file path
  -> file-size guard
  -> SHA-256 checksum
  -> existing-file lookup
  -> parser selection
  -> chunking policy
  -> embedding in batches
  -> LanceDB writes
  -> old-vector cleanup for re-ingestion
  -> SQL metadata commit
```

The pipeline is instantiated with:

- an `AsyncSession`
- `AsyncVectorStore`
- `Embedder`
- optional `Settings`
- optional `ParserRegistry`
- optional `ChunkingPolicy`

## Existing-File Matching

Re-ingestion lookup is not a simple filename match.

Current matching rules:

- if the identifier looks like a path, match on normalized `original_path`
- otherwise fall back to `(project_id, filename, is_managed)`

Important edge cases:

- path identifiers are normalized with `os.path.realpath(...)`
- filename fallback is only used when the input is not path-like
- ambiguous filename fallback returns no match instead of guessing
- path collisions choose the most recent record and log a warning

## Re-Ingestion Semantics

Current behavior is:

- same checksum: skip indexing and return the existing `chunk_count`
- new checksum on an existing file: collect current vector ids, write new vectors, then delete old ones
- new file: create the `files` row first and commit it before vector work starts

The re-ingestion path intentionally uses add-then-delete. That keeps retrieval coverage intact if the process fails mid-update.

## Error Handling

`ingest_file(...)` returns `IngestionResult` for normal per-file failures rather than raising, so batch and sync flows can continue.

| Scenario | Current behavior |
|---|---|
| File stat or checksum failure | Returns `errors=["File read error: ..."]` |
| File exceeds `max_file_size_mb` | Returns `errors=["File too large ..."]` before parsing |
| No parser supports the extension | Returns `errors=["No parser for extension: ..."]` |
| Parser raises | Returns `errors=["Parse error: ..."]` |
| Vector write fails for a new file | File row survives, `chunk_count` remains `0`, result reports `Vector storage failed` |
| Vector write fails for a re-ingestion | SQL session rolls back so the old checksum remains authoritative and old vectors stay live |
| Old-vector deletion fails after successful re-ingestion | New vectors stay live and duplicates may remain until a later cleanup or re-sync |

## Supported File Types

`SUPPORTED_EXTENSIONS` is built from `CodeParser.EXTENSION_TO_LANGUAGE` plus document extensions.

Current categories include:

- documents: `.pdf`, `.docx`, `.md`, `.markdown`, `.rst`, `.txt`
- Python: `.py`
- JavaScript and TypeScript: `.js`, `.jsx`, `.ts`, `.tsx`
- systems: `.c`, `.cpp`, `.h`, `.go`, `.rs`
- JVM and mobile: `.java`, `.kt`, `.scala`, `.swift`
- scripting: `.rb`, `.php`, `.sh`, `.bash`
- data and config: `.json`, `.yaml`, `.yml`, `.toml`, `.xml`, `.sql`
- web: `.html`, `.css`, `.scss`

## Parser Chain

`ParserRegistry.with_defaults()` currently registers parsers in this order:

1. `PdfParser`
2. `DocxParser`
3. `MarkdownParser`
4. `CodeParser`

That order matters because selection is first-match by extension support.

## Parsed Output

Parsers return `ParsedContent` containing:

- `text`
- `language`
- optional `headings`

Current parser behavior:

- `PdfParser`: extracts text via `pymupdf4llm` plus heading metadata via `heading_extractor.py`
- `DocxParser`: extracts body paragraphs, section headers (labeled `[Header]`), section footers (labeled `[Footer]`), and tables (pipe-delimited rows labeled `[Table N]`). Logs a warning when embedded visual objects (inline shapes) are detected but not extracted. Does not extract heading hierarchy.
- `MarkdownParser`: extracts text plus heading metadata via `heading_extractor.py`
- `CodeParser`: reads source text and maps extension to language

## Chunking Policy

`ChunkingPolicy` decides both chunk size and chunker family.

### Text-like content

Text-like files use `SectionAwareTextChunker`.

Current size selection:

- PDF -> `chunk_size_pdf`
- markdown/text -> `chunk_size_markdown`
- everything else text-like -> `chunk_size_default`

Current overlap:

- `chunk_overlap_default`

If headings exist, the chunker splits by heading boundaries first and assigns `section_header`. The breadcrumb algorithm maintains a `heading_stack` of `(level, text)` tuples. When each heading is encountered, all entries at equal or deeper levels are popped, and the new heading is pushed. The breadcrumb is formed by joining the remaining stack with ` > ` separators (e.g. `"Architecture > Data Storage > SQLite Tables"`). Text before the first heading gets an empty breadcrumb. Each section is then sub-chunked using the plain `TextChunker`. If headings do not exist, it falls back to plain recursive text chunking.

### Heading extraction formats

`heading_extractor.py` supports two heading styles:

- ATX markdown headings (`# H1` through `###### H6`)
- RST underline-style headings (a text line followed by repeated punctuation characters like `=`, `-`, `~`, etc., with levels assigned by first-appearance order of the underline character)

Results from both extractors are merged and sorted by character offset.

### Code content

Code files use `chunk_size_code` with zero overlap.

Current decision path:

1. map extension to language
2. check whether tree-sitter support exists for that language
3. try `TreeSitterChunker`
4. if it returns no chunks, fall back to `RegexCodeChunker`

Important current behavior:

- if tree-sitter loads but finds no top-level definitions, it returns the full file as one chunk
- regex fallback is mainly for unsupported or unavailable grammars, not for ordinary definition-free files
- tree-sitter captures leading comments (`comment`, `block_comment`, `line_comment`), decorators (`decorator`, `decorated_definition`), and attributes with the definition node that follows them, so docstrings and decorators are included in the semantic chunk
- preamble content (imports, module docstrings) is captured as a separate chunk when it precedes the first definition
- adjacent small definitions below `min_chunk_size` (default 200) are merged into a single chunk via `_merge_small()`

## Tree-Sitter Coverage

Tree-sitter grammars are currently configured for specific AST node types per language (defined in `grammar_config.py`):

- Python: `function_definition`, `class_definition`, `decorated_definition`
- JavaScript/JSX: `function_declaration`, `class_declaration`, `method_definition`, `export_statement`, `lexical_declaration`
- TypeScript/TSX: same as JavaScript plus `interface_declaration`, `type_alias_declaration`, `enum_declaration`
- Java: `class_declaration`, `method_declaration`, `interface_declaration`, `enum_declaration`, `constructor_declaration`
- Go: `function_declaration`, `method_declaration`, `type_declaration`
- Rust: `function_item`, `impl_item`, `struct_item`, `enum_item`, `trait_item`, `mod_item`
- C: `function_definition`, `struct_specifier`, `enum_specifier`, `type_definition`
- C++: same as C plus `class_specifier`, `namespace_definition`
- Ruby: `method`, `class`, `module`, `singleton_method`
- PHP: `function_definition`, `class_declaration`, `method_declaration`, `interface_declaration`, `trait_declaration`

Language aliases: `jsx` maps to `javascript`, `tsx` uses a distinct grammar from `typescript`.

### Regex code chunker patterns

`RegexCodeChunker` defines `BOUNDARY_PATTERNS` with language-specific regex patterns for 12 languages. Examples:

- Python: `def `, `class `, `async def `
- TypeScript: `function `, `const `, `let `, `class `, `export `, `interface `, `type `
- Go: `func `, `type `
- Swift: `func `, `class `, `struct `, `enum `, `protocol `
- Kotlin: `fun `, `class `, `object `, `interface `

When no pattern exists for a language, it falls back to splitting on blank lines. Both paths merge small chunks below `min_size=200`.

Regex-only chunk boundary support additionally includes:

- Swift
- Kotlin

## Chunk Size Defaults

Current defaults from `Settings` are:

| Setting | Default |
|---|---|
| `chunk_size_default` | `2000` |
| `chunk_overlap_default` | `200` |
| `chunk_size_code` | `2000` |
| `chunk_size_pdf` | `3000` |
| `chunk_size_markdown` | `2000` |

## Embedding Behavior

The pipeline embeds in document mode through `Embedder.aembed_texts(..., mode="document")`.

### Embedding model registry

The `Embedder` class uses a model registry (`EMBEDDING_MODELS`) supporting three model configs, each with distinct query/document prefix strings:

| Model | Dimension | Query prefix | Document prefix |
|---|---|---|---|
| `nomic-ai/nomic-embed-text-v1.5` | 768 | `"search_query: "` | `"search_document: "` |
| `Qwen/Qwen3-Embedding-4B` | 2560 | `"Instruct: Retrieve relevant passages\nQuery: "` | (empty) |
| `all-MiniLM-L6-v2` | 384 | (empty) | (empty) |

Matryoshka dimension truncation is supported: if a non-native dimension is requested and is in `supported_dimensions`, the model's `truncate_dim` is set accordingly.

### Hardware-aware device selection

Device selection uses a preference cascade in `core/hardware.py`: CUDA (only if at least 4 GB VRAM), then MPS (Apple Silicon GPU), then CPU. GPU detection results are cached at module level. `all-MiniLM-L6-v2` forces `device="cpu"` regardless of GPU availability; the other models use the detected device.

### Concurrency and lifecycle

The `Embedder` creates a dedicated `ThreadPoolExecutor` (default 4 workers, prefixed `momodoc-embedder`) with a `threading.Lock`-guarded shutdown flag. All async embedding calls check the shutdown flag before submitting. The `shutdown()` method also cleans up the `loky` reusable executor used by sentence-transformers for parallel tokenization.

Important current behavior:

- batching is capped at 512 chunks per embed/write cycle
- `section_header` is prepended to the embedded text when present
- the stored `chunk_text` remains the raw chunk body

## Vector Records

File ingestion writes rows with:

- `id`
- `vector`
- `project_id`
- `source_type="file"`
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

Notes and issues write into the same table with:

- `source_type="note"` or `source_type="issue"`
- logical `file_type` values of `note` or `issue`
- `language="text"`

When nullable string metadata is omitted, `VectorStore.add(...)` normalizes those fields to empty strings before Arrow insert.

## Notes And Issues

### Notes

Notes are indexed with `TextChunker(max_chunk_size=2000, overlap=200)`.

Current behavior:

- tags are split from the note's comma-delimited `tags` string
- note updates delete old vectors first, then re-index
- if re-indexing fails, SQLite content still commits and `chunk_count` becomes `0`

### Issues

Issues are indexed as a single chunk:

```text
title

description
```

if a description exists, otherwise just the title.

Current behavior:

- issue updates also use delete-then-reindex semantics
- empty title/description content produces zero chunks

## Directory Ingestion

`ingest_directory(...)` uses:

- lazy directory iteration
- `index_discovery_batch_size` for batch discovery
- `index_max_concurrent_files` as a semaphore cap

When the global async session factory exists, each file is ingested inside its own fresh DB session by `_ingest_directory_path(...)`. That isolates failures across files.

## Directory Filtering

Directory traversal also skips any file whose name starts with `.` (dotfiles such as `.env`, `.gitignore`, `.eslintrc.js`). Directory pruning includes both exact name matching against `IGNORE_DIRS` and a suffix match: any directory ending in `.egg-info` is excluded.

The default ignored directories are:

- `node_modules`
- `__pycache__`
- `.git`
- `.venv`
- `venv`
- `dist`
- `build`
- `.next`
- `.tox`
- `.mypy_cache`
- `.pytest_cache`
- `egg-info`

The public traversal helpers are:

- `iter_directory_paths(...)`
- `next_directory_batch(...)`

## Path Safety

Directory indexing is additionally gated by `ALLOWED_INDEX_PATHS` validation in `core/security.py`.

Current rules:

- target must resolve to a real directory
- target must stay within an allowed root
- symlink escapes are rejected
- an empty allowlist blocks directory indexing

## What This Document Does Not Cover

Query-time retrieval, HyDE, decomposition, reranking, and chat prompt assembly are separate from ingestion. Those behaviors live in:

- `backend/app/services/query_pipeline.py`
- `backend/app/services/search_service.py`
- `backend/app/services/chat_context.py`
