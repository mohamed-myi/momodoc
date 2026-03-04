# LLM Abstraction Layer

## Design Goal

Support multiple LLM providers (Claude, OpenAI, Gemini, Ollama) with per-request switching, without scattering provider-specific code across the codebase. Chat is the only feature that requires an LLM; everything else (ingestion, search, sync, metrics) works without any API key.

## Provider-Agnostic Interface

The base abstraction (`LLMProvider`) defines three methods:

```python
class LLMProvider(ABC):
    async def complete(self, messages, system_prompt=None) -> str
    async def stream(self, messages, system_prompt=None) -> AsyncIterator[str]
    def get_model_name(self) -> str
```

Every provider implements this interface. Service code never imports a specific provider class; it receives an `LLMProvider` via dependency injection.

## Four Providers

| Provider | SDK | Base Class |
|----------|-----|------------|
| Claude | Anthropic SDK | Direct `LLMProvider` implementation |
| OpenAI | OpenAI SDK | `OpenAICompatibleBase` |
| Gemini | Google Generative AI SDK | Direct `LLMProvider` implementation |
| Ollama | OpenAI SDK (compatible API) | `OpenAICompatibleBase` |

### OpenAI-Compatible Base Class

OpenAI and Ollama share a common base (`OpenAICompatibleBase`) because Ollama exposes an OpenAI-compatible API. This base handles:
- Message formatting (system prompt as a separate message or merged into user messages)
- Completion and streaming via the OpenAI SDK
- Error handling and timeout configuration

`OllamaProvider` overrides only the initialization (different base URL, no API key required) and model default. This eliminates code duplication between two providers that differ only in configuration.

## Metadata-Driven Factory

The `ProviderRegistry` uses a declarative metadata table rather than switch statements:

```python
_PROVIDER_METADATA = {
    "claude": ProviderMetadata(
        name="claude",
        is_configured=lambda s: bool(s.anthropic_api_key),
        get_model_name=lambda s: s.claude_model,
        create_provider=lambda s: ClaudeProvider(s.anthropic_api_key, s.claude_model),
    ),
    ...
}
```

Each entry defines: how to check if the provider is configured, how to get its model name, and how to create an instance. Adding a new provider means adding one metadata entry. No switch statements, no if-else chains, no multiple files to modify.

The registry lazily creates providers and caches them with a `threading.Lock` for thread safety. Providers are created on first use, not at startup, which means misconfigured providers do not prevent the application from starting.

## Per-Request Provider Override

Chat endpoints accept an optional `llm_mode` field (`claude`, `openai`, `gemini`, `ollama`). When present, the dependency resolver (`resolve_llm_provider`) selects that provider instead of the default.

This enables a workflow where the default provider is a fast/cheap model (Gemini Flash, local Ollama) for everyday queries, but a user can switch to a more capable model (Claude) for complex questions without changing any configuration.

The resolution logic is in the dependency layer, not in the chat service. The service receives an `LLMProvider` and does not know or care which provider it is.

## SSE Streaming Architecture

Chat streaming uses Server-Sent Events (SSE) rather than WebSocket for a specific reason: SSE is HTTP (works through proxies, load balancers, and CORS without special configuration) and provides a natural request-response pattern where the client sends a message and receives a streamed response.

The streaming flow:

1. Client sends `POST /chat/sessions/{sid}/messages/stream` with `ChatMessageRequest`
2. Service retrieves context (hybrid search), builds prompt, persists user message
3. Service calls `provider.stream()` which yields tokens as an `AsyncIterator[str]`
4. Router wraps this in a `StreamingResponse` with `text/event-stream` content type
5. Events are emitted in order: `event: sources` (retrieval results), token data events, `event: done`

Each provider implements streaming differently (Anthropic's `text_stream`, OpenAI's `delta.content`, Google's `generate_content` stream), but the `stream()` interface normalizes all of them to `AsyncIterator[str]`.

## Sliding-Window Rate Limiter

The `ChatRateLimiter` protects against runaway usage with four independent buckets:

| Bucket | Scope | Purpose |
|--------|-------|---------|
| Message (client) | Per-client (hashed token) | Prevents one client from monopolizing chat |
| Message (global) | All clients | Prevents total message throughput from overwhelming the LLM |
| Stream (client) | Per-client (hashed token) | Separate limit for streaming (which holds connections longer) |
| Stream (global) | All clients | Prevents total stream connections from saturating |

Each bucket uses a sliding window algorithm: requests within the window are counted; when the count exceeds the limit, the request is rejected with a 429 response including a `Retry-After` header indicating when the window resets.

Stream endpoints get separate (lower) limits because each streaming request holds an HTTP connection for the duration of the LLM generation, which can be 10-30 seconds. Without separate limits, streaming requests would consume the entire message budget.

All limits are configurable via environment variables, including the window duration. The limiter is in-memory (no Redis, no external state), which is appropriate for a single-process, single-user deployment.
