"""Curated model lists for each LLM provider.

These serve as fallback when dynamic model fetching is unavailable
(no API key, network failure, etc.). Keep this file updated as
providers retire and launch models.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ModelInfo:
    id: str
    display_name: str
    context_window: int | None = None
    recommended: bool = False

    def to_dict(self, *, is_default: bool = False) -> dict:
        return {
            "id": self.id,
            "name": self.display_name,
            "context_window": self.context_window,
            "is_default": is_default,
        }


CLAUDE_MODELS: tuple[ModelInfo, ...] = (
    ModelInfo("claude-sonnet-4-6", "Claude Sonnet 4.6", 200_000, recommended=True),
    ModelInfo("claude-opus-4-6", "Claude Opus 4.6", 200_000),
    ModelInfo("claude-sonnet-4-5-20250929", "Claude Sonnet 4.5", 200_000),
    ModelInfo("claude-opus-4-5-20251101", "Claude Opus 4.5", 200_000),
    ModelInfo("claude-haiku-4-5-20251001", "Claude Haiku 4.5", 200_000),
    ModelInfo("claude-opus-4-1-20250805", "Claude Opus 4.1", 200_000),
    ModelInfo("claude-opus-4-20250514", "Claude Opus 4", 200_000),
    ModelInfo("claude-sonnet-4-20250514", "Claude Sonnet 4", 200_000),
)

OPENAI_MODELS: tuple[ModelInfo, ...] = (
    ModelInfo("gpt-4o", "GPT-4o", 128_000, recommended=True),
    ModelInfo("gpt-4o-mini", "GPT-4o Mini", 128_000),
    ModelInfo("gpt-5.2", "GPT-5.2", 128_000),
    ModelInfo("o3", "o3", 200_000),
    ModelInfo("o4-mini", "o4-mini", 200_000),
)

GEMINI_MODELS: tuple[ModelInfo, ...] = (
    ModelInfo("gemini-2.5-flash", "Gemini 2.5 Flash", 1_000_000, recommended=True),
    ModelInfo("gemini-2.5-pro", "Gemini 2.5 Pro", 1_000_000),
    ModelInfo("gemini-3-flash", "Gemini 3 Flash", 1_000_000),
    ModelInfo("gemini-3.1-pro", "Gemini 3.1 Pro", 1_000_000),
    ModelInfo("gemini-2.5-flash-lite", "Gemini 2.5 Flash Lite", 1_000_000),
)

OLLAMA_MODELS: tuple[ModelInfo, ...] = ()

CURATED_MODELS: dict[str, tuple[ModelInfo, ...]] = {
    "claude": CLAUDE_MODELS,
    "openai": OPENAI_MODELS,
    "gemini": GEMINI_MODELS,
    "ollama": OLLAMA_MODELS,
}


def get_context_window(model_id: str) -> int | None:
    """Look up context window from curated lists; returns None if unknown."""
    for models in CURATED_MODELS.values():
        for m in models:
            if m.id == model_id:
                return m.context_window
    return None
