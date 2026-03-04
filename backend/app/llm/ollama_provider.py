"""Ollama LLM provider using the OpenAI-compatible API."""

import openai
from openai import AsyncOpenAI

from app.core.exceptions import LLMError
from app.llm.openai_compatible_base import OpenAICompatibleProviderBase


class OllamaProvider(OpenAICompatibleProviderBase):
    provider_label = "Ollama"

    def __init__(
        self,
        model: str = "qwen2.5-coder:7b",
        base_url: str = "http://localhost:11434/v1",
    ):
        # Ollama's OpenAI-compatible endpoint doesn't require a real API key
        self.client = AsyncOpenAI(api_key="ollama", base_url=base_url)
        self.model = model

    def _map_connection_error(
        self,
        error: openai.APIConnectionError,
        *,
        phase: str,
    ) -> LLMError:
        _ = phase
        return LLMError(
            f"Cannot connect to Ollama at {self.client.base_url}. "
            "Is Ollama running? Start it with: ollama serve"
        )
