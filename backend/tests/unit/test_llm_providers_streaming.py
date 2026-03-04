from collections.abc import AsyncIterator
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import anthropic
import httpx
import openai
import pytest

from app.core.exceptions import LLMError
from app.llm.base import LLMMessage
from app.llm.claude import ClaudeProvider
from app.llm.gemini_provider import GeminiProvider
from app.llm.ollama_provider import OllamaProvider
from app.llm.openai_provider import OpenAIProvider


def _chunk_with_delta(content: str | None):
    delta = SimpleNamespace(content=content)
    choice = SimpleNamespace(delta=delta)
    return SimpleNamespace(choices=[choice])


async def _iter_chunks(items: list[object]) -> AsyncIterator[object]:
    for item in items:
        yield item


class _FailingStream:
    def __init__(self, first: object, exc: Exception):
        self._first = first
        self._exc = exc
        self._done_first = False

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self._done_first:
            self._done_first = True
            return self._first
        raise self._exc


class _ClaudeStreamContext:
    def __init__(self, tokens: list[str]):
        self.text_stream = _iter_chunks(tokens)

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


class TestOpenAIStreamingContract:
    @pytest.mark.asyncio
    async def test_openai_stream_yields_only_text_tokens(self):
        provider = OpenAIProvider(api_key="test-key")
        stream = _iter_chunks(
            [
                _chunk_with_delta("hello "),
                _chunk_with_delta(None),
                SimpleNamespace(choices=[]),
                _chunk_with_delta("world"),
            ]
        )
        with patch.object(
            provider.client.chat.completions,
            "create",
            new=AsyncMock(return_value=stream),
        ) as mock_create:
            tokens = [token async for token in provider.stream([LLMMessage("user", "q")])]

        assert tokens == ["hello ", "world"]
        assert all(isinstance(token, str) for token in tokens)
        assert mock_create.call_args.kwargs["stream"] is True

    @pytest.mark.asyncio
    async def test_openai_stream_wraps_iteration_errors(self):
        provider = OpenAIProvider(api_key="test-key")
        api_error = openai.APIError("stream failed", request=MagicMock(), body=None)
        stream = _FailingStream(_chunk_with_delta("first"), api_error)

        with patch.object(
            provider.client.chat.completions,
            "create",
            new=AsyncMock(return_value=stream),
        ):
            tokens: list[str] = []
            with pytest.raises(LLMError, match="OpenAI streaming error"):
                async for token in provider.stream([LLMMessage("user", "q")]):
                    tokens.append(token)
        assert tokens == ["first"]


class TestClaudeStreamingContract:
    @pytest.mark.asyncio
    async def test_claude_stream_splits_system_and_yields_text(self):
        provider = ClaudeProvider(api_key="test-key")
        context = _ClaudeStreamContext(tokens=["a", "b"])

        with patch.object(provider.client.messages, "stream", return_value=context) as mock_stream:
            tokens = [
                token
                async for token in provider.stream(
                    [LLMMessage("system", "sys"), LLMMessage("user", "hi")]
                )
            ]

        assert tokens == ["a", "b"]
        kwargs = mock_stream.call_args.kwargs
        assert kwargs["system"] == "sys"
        assert kwargs["messages"] == [{"role": "user", "content": "hi"}]

    @pytest.mark.asyncio
    async def test_claude_stream_wraps_api_error(self):
        provider = ClaudeProvider(api_key="test-key")
        api_error = anthropic.APIError("failed", request=MagicMock(), body=None)

        with patch.object(provider.client.messages, "stream", side_effect=api_error):
            with pytest.raises(LLMError, match="Claude API error"):
                _ = [token async for token in provider.stream([LLMMessage("user", "q")])]


class TestGeminiStreamingContract:
    @pytest.mark.asyncio
    async def test_gemini_stream_maps_roles_and_yields_text(self):
        provider = GeminiProvider(api_key="test-key")
        response = _iter_chunks(
            [
                SimpleNamespace(text="token-1"),
                SimpleNamespace(text=None),
                SimpleNamespace(text="token-2"),
            ]
        )
        with patch.object(
            provider.client.aio.models,
            "generate_content_stream",
            new=AsyncMock(return_value=response),
        ) as mock_stream:
            tokens = [
                token
                async for token in provider.stream(
                    [
                        LLMMessage("system", "sys"),
                        LLMMessage("user", "user-msg"),
                        LLMMessage("assistant", "assistant-msg"),
                    ]
                )
            ]

        assert tokens == ["token-1", "token-2"]
        kwargs = mock_stream.call_args.kwargs
        contents = kwargs["contents"]
        assert [content.role for content in contents] == ["user", "model"]
        assert kwargs["config"].system_instruction == "sys"

    @pytest.mark.asyncio
    async def test_gemini_stream_wraps_iteration_errors(self):
        provider = GeminiProvider(api_key="test-key")

        class _BrokenResponse:
            def __aiter__(self):
                return self

            async def __anext__(self):
                raise RuntimeError("broken stream")

        with patch.object(
            provider.client.aio.models,
            "generate_content_stream",
            new=AsyncMock(return_value=_BrokenResponse()),
        ):
            with pytest.raises(LLMError, match="Gemini streaming error"):
                _ = [token async for token in provider.stream([LLMMessage("user", "q")])]


class TestOllamaStreamingContract:
    @pytest.mark.asyncio
    async def test_ollama_stream_yields_only_text_tokens(self):
        provider = OllamaProvider(model="qwen2.5-coder:7b", base_url="http://localhost:11434/v1")
        stream = _iter_chunks(
            [
                _chunk_with_delta("foo"),
                _chunk_with_delta(None),
                _chunk_with_delta("bar"),
            ]
        )

        with patch.object(
            provider.client.chat.completions,
            "create",
            new=AsyncMock(return_value=stream),
        ) as mock_create:
            tokens = [token async for token in provider.stream([LLMMessage("user", "q")])]

        assert tokens == ["foo", "bar"]
        assert mock_create.call_args.kwargs["stream"] is True

    @pytest.mark.asyncio
    async def test_ollama_stream_wraps_iteration_errors(self):
        provider = OllamaProvider(model="qwen2.5-coder:7b", base_url="http://localhost:11434/v1")
        api_error = openai.APIError("stream failed", request=MagicMock(), body=None)
        stream = _FailingStream(_chunk_with_delta("first"), api_error)

        with patch.object(
            provider.client.chat.completions,
            "create",
            new=AsyncMock(return_value=stream),
        ):
            tokens: list[str] = []
            with pytest.raises(LLMError, match="Ollama streaming error"):
                async for token in provider.stream([LLMMessage("user", "q")]):
                    tokens.append(token)
        assert tokens == ["first"]

    @pytest.mark.asyncio
    async def test_ollama_complete_wraps_connection_errors_with_ollama_hint(self):
        provider = OllamaProvider(model="qwen2.5-coder:7b", base_url="http://localhost:11434/v1")
        api_error = openai.APIConnectionError(
            message="Connection error.",
            request=httpx.Request("POST", "http://localhost:11434/v1/chat/completions"),
        )

        with patch.object(
            provider.client.chat.completions,
            "create",
            new=AsyncMock(side_effect=api_error),
        ):
            with pytest.raises(LLMError, match="Cannot connect to Ollama at .*ollama serve"):
                await provider.complete([LLMMessage("user", "q")])

    @pytest.mark.asyncio
    async def test_ollama_stream_wraps_connection_errors_with_ollama_hint(self):
        provider = OllamaProvider(model="qwen2.5-coder:7b", base_url="http://localhost:11434/v1")
        api_error = openai.APIConnectionError(
            message="Connection error.",
            request=httpx.Request("POST", "http://localhost:11434/v1/chat/completions"),
        )
        stream = _FailingStream(_chunk_with_delta("first"), api_error)

        with patch.object(
            provider.client.chat.completions,
            "create",
            new=AsyncMock(return_value=stream),
        ):
            tokens: list[str] = []
            with pytest.raises(LLMError, match="Cannot connect to Ollama at .*ollama serve"):
                async for token in provider.stream([LLMMessage("user", "q")]):
                    tokens.append(token)
        assert tokens == ["first"]
