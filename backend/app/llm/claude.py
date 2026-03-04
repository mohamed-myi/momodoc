from collections.abc import AsyncIterator

import anthropic

from app.core.exceptions import LLMError
from app.llm.base import LLMMessage, LLMProvider, LLMResponse


class ClaudeProvider(LLMProvider):
    def __init__(self, api_key: str, model: str = "claude-sonnet-4-6"):
        self.client = anthropic.AsyncAnthropic(api_key=api_key)
        self.model = model

    async def complete(
        self,
        messages: list[LLMMessage],
        max_tokens: int = 4096,
        temperature: float = 0.3,
    ) -> LLMResponse:
        system_msg, chat_messages = self._split_messages(messages)

        kwargs = {
            "model": self.model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": chat_messages,
        }
        if system_msg:
            kwargs["system"] = system_msg

        try:
            response = await self.client.messages.create(**kwargs)
        except anthropic.APIError as e:
            raise LLMError(f"Claude API error: {e}") from e

        if not response.content:
            raise LLMError("LLM returned an empty response (no content blocks)")

        # Handle case where first block might not be text (e.g. tool_use blocks)
        text_blocks = [b for b in response.content if hasattr(b, "text")]
        if not text_blocks:
            raise LLMError("LLM response contained no text blocks")

        return LLMResponse(
            content=text_blocks[0].text,
            model=response.model,
            usage={
                "input_tokens": response.usage.input_tokens,
                "output_tokens": response.usage.output_tokens,
            },
        )

    async def stream(
        self,
        messages: list[LLMMessage],
        max_tokens: int = 4096,
        temperature: float = 0.3,
    ) -> AsyncIterator[str]:
        system_msg, chat_messages = self._split_messages(messages)

        kwargs = {
            "model": self.model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": chat_messages,
        }
        if system_msg:
            kwargs["system"] = system_msg

        try:
            async with self.client.messages.stream(**kwargs) as stream:
                async for text in stream.text_stream:
                    yield text
        except anthropic.APIError as e:
            raise LLMError(f"Claude API error: {e}") from e

    def get_model_name(self) -> str:
        return self.model

    def _split_messages(
        self, messages: list[LLMMessage]
    ) -> tuple[str | None, list[dict]]:
        system_msg = None
        chat_messages = []
        for msg in messages:
            if msg.role == "system":
                system_msg = msg.content
            else:
                chat_messages.append({"role": msg.role, "content": msg.content})
        return system_msg, chat_messages
