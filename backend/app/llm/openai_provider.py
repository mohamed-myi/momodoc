from openai import AsyncOpenAI

from app.llm.openai_compatible_base import OpenAICompatibleProviderBase


class OpenAIProvider(OpenAICompatibleProviderBase):
    provider_label = "OpenAI"

    def __init__(self, api_key: str, model: str = "gpt-4o"):
        self.client = AsyncOpenAI(api_key=api_key)
        self.model = model
