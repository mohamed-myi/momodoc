# RAG Pipeline

Last verified against source on 2026-03-04.

## End-To-End Shape

Momodoc's retrieval pipeline has two distinct halves:

1. ingestion-time indexing of files, notes, and issues
2. query-time planning, retrieval, reranking, and chat assembly

```text
files / notes / issues
  -> parse or normalize
  -> chunk
  -> local embeddings
  -> LanceDB storage
  -> query classification
  -> optional HyDE or decomposition
  -> keyword / vector / hybrid retrieval
  -> optional rerank
  -> search results or chat context with citations
```

## Indexed Source Types

The retrieval table contains three source types:

- `file`
- `note`
- `issue`

Files are the richest path. Notes and issues are simpler indexers that still land in the same `chunks` table, which allows search and chat to span all three source types.

## Ingestion-Time Processing

### Files

Files pass through:

- parser selection
- file-type-aware chunking
- local embedding
- LanceDB writes
- SQL metadata updates

The pipeline deduplicates by SHA-256 checksum and uses add-then-delete semantics for re-ingestion so search coverage is preserved during updates.

### Notes

Notes are chunked with `TextChunker` and indexed directly from note content plus comma-delimited tags.

### Issues

Issues are indexed as one combined chunk from title plus description.

## Parser And Chunking Strategy

Current parser chain:

1. `PdfParser`
2. `DocxParser`
3. `MarkdownParser`
4. `CodeParser`

Current chunking strategy:

- text-like documents -> `SectionAwareTextChunker`
- code with configured grammar -> `TreeSitterChunker`
- unsupported or unavailable grammar -> `RegexCodeChunker`

Chunk-size defaults come from runtime settings:

- default text: `2000`
- markdown/text: `2000`
- code: `2000`
- PDF: `3000`
- text overlap: `200`

## Embeddings

Embeddings are always local. `Embedder` wraps `SentenceTransformer` and supports a small model registry.

Current built-in models:

- `nomic-ai/nomic-embed-text-v1.5`
- `Qwen/Qwen3-Embedding-4B`
- `all-MiniLM-L6-v2`

Implementation details that matter:

- embeddings are normalized
- the embedder supports document-mode and query-mode calls
- ingestion prepends `section_header` to the embedded text when present
- indexing batches are limited to 512 chunks at a time

## Query Classification

Before retrieval, the system classifies the query as:

- `SIMPLE`
- `KEYWORD_LOOKUP`
- `CONCEPTUAL`
- `MULTI_PART`

That classification produces a `QueryPlan` with:

- whether HyDE should run
- whether decomposition should run
- a search-mode hint
- optional sub-queries

## Retrieval Modes

The search layer exposes three effective modes:

- `keyword`
- `vector`
- `hybrid`

Important current behavior:

- keyword-like queries can force hybrid requests down to keyword retrieval
- hybrid is the normal default for search and chat
- if LanceDB hybrid search fails, `VectorStore.hybrid_search(...)` falls back to vector-only retrieval

## HyDE

For conceptual queries, the system can:

1. ask an LLM for a short hypothetical answer passage
2. embed both the original query and that hypothetical passage
3. average and normalize the vectors
4. run vector search with the blended vector

HyDE is only used when a separate query-time LLM is available.

## Query Decomposition

For multi-part queries, the system can:

1. ask an LLM to split the question into 2 to 4 sub-questions
2. run hybrid retrieval for each sub-query
3. merge the ranked lists with reciprocal rank fusion using `k=60`

That path is also opportunistic and only runs when a query-time LLM is available.

## Query-Time LLM Resolution

Momodoc does not use the chat provider blindly for HyDE and decomposition.

`query_llm_resolver.py` currently:

1. caches the resolved provider for 60 seconds
2. tries the configured default provider first unless it is Ollama
3. falls back to other configured cloud providers
4. tries Ollama last, but only after a quick health check

If no query-time LLM is available, retrieval still proceeds without HyDE or decomposition.

## Retrieve And Rerank

When the reranker is available and the request is not keyword-only:

1. fetch `candidate_k` retrieval candidates first, default `50`
2. score query-document pairs with the reranker
3. return the top `top_k`

Current reranker defaults are hardware-aware:

- CPU-friendly fallback: `cross-encoder/ms-marco-MiniLM-L-6-v2`
- GPU-capable default: `BAAI/bge-reranker-v2-m3`

## Score Normalization

The retrieval stack normalizes heterogeneous score types into a common 0-to-1 style output:

- vector distance -> `1 / (1 + distance)`
- hybrid relevance -> clamp LanceDB `_relevance_score` to `[0, 1]`
- keyword FTS -> `_score / (1 + _score)`
- reranker logits -> sigmoid

This makes search and chat sources more consistent across modes.

## Chat Context Assembly

Chat adds extra retrieval rules on top of search:

- pinned source ids are fetched directly and included first
- retrieved chunks already represented by pinned chunks are removed
- retrieved chunks are capped to at most 3 chunks per source
- context is trimmed to a token budget inferred from the chosen LLM
- saved assistant messages persist exact `message_sources` rows for replay and export

The prompt requires citations in `[Source N]` format, and stored sources preserve the exact chunk text supplied to the model.

## Startup Tradeoff

The backend does not wait for all retrieval dependencies before accepting requests.

Deferred startup loads:

- the embedder
- the reranker
- the FTS index
- orphan cleanup
- auto-sync
- file watchers

That improves startup responsiveness, but early requests can see temporary degradation:

- embedder unavailable until it loads
- hybrid search falling back before FTS is ready
- reranking unavailable until the reranker finishes loading
