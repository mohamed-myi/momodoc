from pydantic import BaseModel


def _mask_key(value: str) -> str:
    """Mask an API key for safe display, preserving prefix and last 4 chars."""
    if not value or len(value) <= 8:
        return "****" if value else ""
    return f"{value[:4]}...{value[-4:]}"


class SettingsUpdate(BaseModel):
    """Partial update payload; all fields optional."""

    llm_provider: str | None = None
    anthropic_api_key: str | None = None
    claude_model: str | None = None
    openai_api_key: str | None = None
    openai_model: str | None = None
    google_api_key: str | None = None
    gemini_model: str | None = None
    ollama_base_url: str | None = None
    ollama_model: str | None = None


class SettingsResponse(BaseModel):
    llm_provider: str = ""
    anthropic_api_key: str = ""
    claude_model: str = ""
    openai_api_key: str = ""
    openai_model: str = ""
    google_api_key: str = ""
    gemini_model: str = ""
    ollama_base_url: str = ""
    ollama_model: str = ""

    @classmethod
    def from_settings(cls, settings) -> "SettingsResponse":
        return cls(
            llm_provider=settings.llm_provider,
            anthropic_api_key=_mask_key(settings.anthropic_api_key),
            claude_model=settings.claude_model,
            openai_api_key=_mask_key(settings.openai_api_key),
            openai_model=settings.openai_model,
            google_api_key=_mask_key(settings.google_api_key),
            gemini_model=settings.gemini_model,
            ollama_base_url=settings.ollama_base_url,
            ollama_model=settings.ollama_model,
        )


class ModelInfoResponse(BaseModel):
    id: str
    name: str
    context_window: int | None = None
    is_default: bool = False
