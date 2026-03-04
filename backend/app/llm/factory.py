import logging
import threading
from collections.abc import Callable
from dataclasses import dataclass

from app.config import Settings
from app.llm.base import LLMProvider

logger = logging.getLogger(__name__)

# Canonical provider names
PROVIDER_CLAUDE = "claude"
PROVIDER_OPENAI = "openai"
PROVIDER_GEMINI = "gemini"
PROVIDER_OLLAMA = "ollama"

_CACHE_MISS = object()


@dataclass(frozen=True)
class ProviderMetadata:
    name: str
    is_configured: Callable[[Settings], bool]
    get_model_name: Callable[[Settings], str]
    create_provider: Callable[[Settings], LLMProvider | None]


def _create_claude_provider(settings: Settings) -> LLMProvider | None:
    if not settings.anthropic_api_key:
        logger.warning("No Anthropic API key configured; Claude unavailable.")
        return None

    from app.llm.claude import ClaudeProvider

    return ClaudeProvider(
        api_key=settings.anthropic_api_key,
        model=settings.claude_model,
    )


def _create_openai_provider(settings: Settings) -> LLMProvider | None:
    if not settings.openai_api_key:
        logger.warning("No OpenAI API key configured; OpenAI unavailable.")
        return None

    from app.llm.openai_provider import OpenAIProvider

    return OpenAIProvider(
        api_key=settings.openai_api_key,
        model=settings.openai_model,
    )


def _create_gemini_provider(settings: Settings) -> LLMProvider | None:
    if not settings.google_api_key:
        logger.warning("No Google API key configured; Gemini unavailable.")
        return None

    from app.llm.gemini_provider import GeminiProvider

    return GeminiProvider(
        api_key=settings.google_api_key,
        model=settings.gemini_model,
    )


def _create_ollama_provider(settings: Settings) -> LLMProvider | None:
    from app.llm.ollama_provider import OllamaProvider

    return OllamaProvider(
        model=settings.ollama_model,
        base_url=settings.ollama_base_url,
    )


_PROVIDER_METADATA: dict[str, ProviderMetadata] = {
    PROVIDER_CLAUDE: ProviderMetadata(
        name=PROVIDER_CLAUDE,
        is_configured=lambda settings: bool(settings.anthropic_api_key),
        get_model_name=lambda settings: settings.claude_model,
        create_provider=_create_claude_provider,
    ),
    PROVIDER_OPENAI: ProviderMetadata(
        name=PROVIDER_OPENAI,
        is_configured=lambda settings: bool(settings.openai_api_key),
        get_model_name=lambda settings: settings.openai_model,
        create_provider=_create_openai_provider,
    ),
    PROVIDER_GEMINI: ProviderMetadata(
        name=PROVIDER_GEMINI,
        is_configured=lambda settings: bool(settings.google_api_key),
        get_model_name=lambda settings: settings.gemini_model,
        create_provider=_create_gemini_provider,
    ),
    PROVIDER_OLLAMA: ProviderMetadata(
        name=PROVIDER_OLLAMA,
        is_configured=lambda _settings: True,  # Availability depends on Ollama runtime
        get_model_name=lambda settings: settings.ollama_model,
        create_provider=_create_ollama_provider,
    ),
}

ALL_PROVIDERS = tuple(_PROVIDER_METADATA)


def create_llm_provider(settings: Settings) -> LLMProvider | None:
    """Create the default LLM provider based on settings.

    Returns None if no API key is configured (chat will be unavailable).
    Called once during application startup.
    """
    provider = create_provider_by_name(settings.llm_provider, settings)
    if provider is not None:
        logger.info("Initialized default LLM provider: %s", settings.llm_provider)
    return provider


def create_provider_by_name(name: str, settings: Settings) -> LLMProvider | None:
    """Create a specific LLM provider by name.

    Returns None if the required API key is missing.
    Raises ValueError for unknown provider names.
    """
    metadata = _PROVIDER_METADATA.get(name)
    if metadata is None:
        raise ValueError(f"Unknown LLM provider: {name}")
    return metadata.create_provider(settings)


class ProviderRegistry:
    """Lazily caches LLM provider instances by name.

    Providers are created on first request and reused for subsequent calls.
    This avoids creating SDK clients for providers that are never used.
    """

    def __init__(self, settings: Settings):
        self._settings = settings
        self._cache: dict[str, LLMProvider | None] = {}
        self._cache_lock = threading.Lock()

    def get(self, name: str) -> LLMProvider | None:
        """Get a provider by name, creating it if needed."""
        cached = self._cache.get(name, _CACHE_MISS)
        if cached is not _CACHE_MISS:
            return cached

        with self._cache_lock:
            cached = self._cache.get(name, _CACHE_MISS)
            if cached is _CACHE_MISS:
                cached = create_provider_by_name(name, self._settings)
                self._cache[name] = cached
            return cached

    def reload(self, settings: Settings) -> None:
        """Replace the settings reference and clear the provider cache.

        Called when LLM configuration changes at runtime (e.g. via the
        settings API). Subsequent get() calls will create fresh providers
        using the new settings.
        """
        with self._cache_lock:
            self._settings = settings
            self._cache.clear()

    def available_providers(self) -> list[dict]:
        """Return metadata about all configured providers."""
        result = []
        for name in ALL_PROVIDERS:
            available = self._is_configured(name)
            result.append(
                {
                    "name": name,
                    "available": available,
                    "model": self._get_model_name(name),
                }
            )
        return result

    def _is_configured(self, name: str) -> bool:
        metadata = _PROVIDER_METADATA.get(name)
        if metadata is None:
            return False
        return metadata.is_configured(self._settings)

    def _get_model_name(self, name: str) -> str:
        metadata = _PROVIDER_METADATA.get(name)
        if metadata is None:
            return ""
        return metadata.get_model_name(self._settings)
