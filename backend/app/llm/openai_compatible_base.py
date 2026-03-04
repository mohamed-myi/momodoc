from collections.abc import AsyncIterator
from typing import Any

import openai

from app.core.exceptions import LLMError
from app.llm.base import LLMMessage, LLMProvider, LLMResponse


class OpenAICompatibleProviderBase(LLMProvider):
    provider_label = "OpenAI-compatible"

    client: Any
    model: str

    async def complete(
        self,
        messages: list[LLMMessage],
        max_tokens: int = 4096,
        temperature: float = 0.3,
    ) -> LLMResponse:
        response = await self._create_chat_completion(
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
        )

        if not response.choices:
            raise LLMError(f"{self.provider_label} returned no choices in response")

        choice = response.choices[0]
        return LLMResponse(
            content=choice.message.content or "",
            model=response.model,
            usage={
                "input_tokens": response.usage.prompt_tokens if response.usage else 0,
                "output_tokens": response.usage.completion_tokens if response.usage else 0,
            },
        )

    async def stream(
        self,
        messages: list[LLMMessage],
        max_tokens: int = 4096,
        temperature: float = 0.3,
    ) -> AsyncIterator[str]:
        stream = await self._create_chat_completion(
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
            stream=True,
        )

        try:
            async for chunk in stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
        except openai.APIConnectionError as e:
            raise self._map_connection_error(e, phase="stream") from e
        except openai.APIError as e:
            raise self._map_api_error(e, phase="stream") from e

    def get_model_name(self) -> str:
        return self.model

    async def _create_chat_completion(
        self,
        messages: list[LLMMessage],
        max_tokens: int,
        temperature: float,
        *,
        stream: bool = False,
    ):
        request_kwargs = {
            "model": self.model,
            "messages": self._format_messages(messages),
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        if stream:
            request_kwargs["stream"] = True

        try:
            return await self.client.chat.completions.create(**request_kwargs)
        except openai.APIConnectionError as e:
            raise self._map_connection_error(e, phase="request") from e
        except openai.APIError as e:
            raise self._map_api_error(e, phase="request") from e

    def _format_messages(self, messages: list[LLMMessage]) -> list[dict]:
        return [{"role": msg.role, "content": msg.content} for msg in messages]

    def _map_connection_error(
        self,
        error: openai.APIConnectionError,
        *,
        phase: str,
    ) -> LLMError:
        return self._map_api_error(error, phase=phase)

    def _map_api_error(self, error: openai.APIError, *, phase: str) -> LLMError:
        if phase == "stream":
            return LLMError(f"{self.provider_label} streaming error: {error}")
        return LLMError(f"{self.provider_label} API error: {error}")

