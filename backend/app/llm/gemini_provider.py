from collections.abc import AsyncIterator

from google import genai
from google.genai import types

from app.core.exceptions import LLMError
from app.llm.base import LLMMessage, LLMProvider, LLMResponse


class GeminiProvider(LLMProvider):
    def __init__(self, api_key: str, model: str = "gemini-2.5-flash"):
        self.client = genai.Client(api_key=api_key)
        self.model_name = model

    async def complete(
        self,
        messages: list[LLMMessage],
        max_tokens: int = 4096,
        temperature: float = 0.3,
    ) -> LLMResponse:
        contents, system_instruction = self._build_contents(messages)

        config = types.GenerateContentConfig(
            max_output_tokens=max_tokens,
            temperature=temperature,
            system_instruction=system_instruction,
        )

        try:
            response = await self.client.aio.models.generate_content(
                model=self.model_name,
                contents=contents,
                config=config,
            )
        except Exception as e:
            raise LLMError(f"Gemini API error: {e}") from e

        if not response.text:
            raise LLMError("Gemini returned an empty response")

        usage = {}
        if hasattr(response, "usage_metadata") and response.usage_metadata:
            usage = {
                "input_tokens": getattr(response.usage_metadata, "prompt_token_count", 0),
                "output_tokens": getattr(response.usage_metadata, "candidates_token_count", 0),
            }

        return LLMResponse(
            content=response.text,
            model=self.model_name,
            usage=usage,
        )

    async def stream(
        self,
        messages: list[LLMMessage],
        max_tokens: int = 4096,
        temperature: float = 0.3,
    ) -> AsyncIterator[str]:
        contents, system_instruction = self._build_contents(messages)

        config = types.GenerateContentConfig(
            max_output_tokens=max_tokens,
            temperature=temperature,
            system_instruction=system_instruction,
        )

        try:
            response = await self.client.aio.models.generate_content_stream(
                model=self.model_name,
                contents=contents,
                config=config,
            )
        except Exception as e:
            raise LLMError(f"Gemini API error: {e}") from e

        try:
            async for chunk in response:
                if chunk.text:
                    yield chunk.text
        except Exception as e:
            raise LLMError(f"Gemini streaming error: {e}") from e

    def get_model_name(self) -> str:
        return self.model_name

    def _build_contents(self, messages: list[LLMMessage]) -> tuple[list[types.Content], str | None]:
        """Convert LLMMessage list to Gemini's content format.

        Gemini uses 'user' and 'model' roles (not 'assistant').
        System instructions are passed separately via config.
        """
        system_instruction = None
        contents = []
        for msg in messages:
            if msg.role == "system":
                system_instruction = msg.content
            else:
                role = "model" if msg.role == "assistant" else "user"
                contents.append(
                    types.Content(
                        role=role,
                        parts=[types.Part(text=msg.content)],
                    )
                )
        return contents, system_instruction
