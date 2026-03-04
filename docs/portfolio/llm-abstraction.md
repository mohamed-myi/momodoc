# LLM Abstraction Layer

Last verified against source on 2026-03-04.

## Design Goal

The codebase needs to support multiple chat providers without scattering provider-specific logic through routers and services.

Current supported providers:

- Claude
- OpenAI
- Gemini
- Ollama

Only chat and a few query-time transformations require an LLM. Indexing, search, sync, diagnostics, and most of the product remain usable without one.

## Provider Interface

The common abstraction is `LLMProvider` in `backend/app/llm/base.py`.

Current interface:

- `complete(messages, max_tokens=4096, temperature=0.3) -> LLMResponse`
- `stream(messages, max_tokens=4096, temperature=0.3) -> AsyncIterator[str]`
- `get_model_name() -> str`

Messages use a lightweight shared type:

- `LLMMessage { role, content }`

Responses normalize:

- generated content
- resolved model name
- token-usage metadata when the provider exposes it

## Provider Implementations

Current provider modules are:

- `claude.py`
- `openai_provider.py`
- `gemini_provider.py`
- `ollama_provider.py`

OpenAI and Ollama both use `OpenAICompatibleProviderBase`, which centralizes:

- message formatting
- chat completion requests
- streaming iteration
- API and connection error mapping

## Registry And Factory

Provider creation is metadata-driven through `ProviderMetadata` entries in `factory.py`.

Each provider declares:

- how to check configuration
- how to read its selected model from settings
- how to construct an instance

This keeps provider wiring concentrated in one module instead of spreading switch statements across routers and services.

## Lazy Instantiation

`ProviderRegistry` lazily creates provider instances on first use and caches them behind a lock.

That means:

- unused SDK clients are never created
- startup is not blocked on every provider
- settings changes can invalidate the cache cleanly

## Runtime Settings Reload

The settings API hot-reloads provider state.

Current `PUT /api/v1/settings` behavior:

1. persist partial settings into `settings.json`
2. update the in-memory `Settings` object
3. call `provider_registry.reload(settings)`
4. recreate `app.state.llm_provider`

This allows provider and model changes without a backend restart.

## Default Provider Versus Per-Request Override

Chat requests can include `llm_mode` to request a specific provider for that request.

However, there is an important implementation detail in the current router wiring:

- chat endpoints still depend on `get_llm_provider`
- `get_llm_provider` raises if the configured default provider is unavailable

So per-request override works within a running chat stack, but the chat route still expects the default provider to be resolvable today. This is stricter than the abstract design suggests.

## Query-Time LLM Resolution

HyDE and query decomposition do not directly use the default chat provider.

`query_llm_resolver.py` resolves a best available provider with this order:

1. configured default provider, unless it is Ollama
2. any other configured cloud provider
3. Ollama, but only if a fast health check succeeds

The result is cached for 60 seconds.

This allows query-time enhancements to degrade gracefully when the preferred chat provider is not suitable or available.

## Provider Discovery

The backend also exposes provider metadata through:

- `GET /api/v1/llm/providers`
- `GET /api/v1/llm/providers/{provider}/models`

Current behavior:

- provider availability is derived from settings
- live model lists are fetched from provider APIs when possible
- curated fallback model lists are used when live discovery fails or credentials are missing

## Streaming Model

Chat streaming is implemented with Server-Sent Events rather than WebSockets.

Current flow:

1. client posts a chat message to `/messages/stream`
2. retrieval runs first
3. provider `stream(...)` yields text chunks
4. the router returns `StreamingResponse(text/event-stream)`
5. the stream emits source metadata, token chunks, completion, or structured error events

The provider abstraction hides SDK-specific streaming mechanics and normalizes them to plain async text chunks.

## Rate Limiting

The LLM-facing chat routes are guarded by `ChatRateLimiter`.

Current buckets:

- per-client message limit
- global message limit
- per-client stream limit
- global stream limit

Client identity is derived from a hash of `X-Momodoc-Token` when present, otherwise the request IP.

The limiter is in-memory, which matches the single-process local deployment model.
