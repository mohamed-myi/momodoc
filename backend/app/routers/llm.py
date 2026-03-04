import logging

from fastapi import APIRouter, Depends, HTTPException

from app.config import Settings
from app.dependencies import get_provider_registry, get_settings
from app.llm.factory import ProviderRegistry
from app.llm.models import CURATED_MODELS, ModelInfo
from app.schemas.settings import ModelInfoResponse

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/llm/providers")
async def list_providers(
    registry: ProviderRegistry = Depends(get_provider_registry),
):
    """Return available LLM providers and their configuration status."""
    return registry.available_providers()


@router.get(
    "/llm/providers/{provider}/models",
    response_model=list[ModelInfoResponse],
)
async def list_provider_models(
    provider: str,
    settings: Settings = Depends(get_settings),
):
    """Return models available for the given provider.

    Attempts to fetch the live model list from the provider API when
    a valid API key is configured. Falls back to the curated list on
    failure or when no key is present.
    """
    if provider not in CURATED_MODELS:
        raise HTTPException(status_code=404, detail=f"Unknown provider: {provider}")

    current_model = _current_model_for_provider(provider, settings)

    models = await _fetch_models_from_api(provider, settings)
    if models is not None:
        return _to_response(models, current_model)

    curated = CURATED_MODELS[provider]
    return _to_response(list(curated), current_model)


def _current_model_for_provider(provider: str, settings: Settings) -> str:
    mapping = {
        "claude": settings.claude_model,
        "openai": settings.openai_model,
        "gemini": settings.gemini_model,
        "ollama": settings.ollama_model,
    }
    return mapping.get(provider, "")


async def _fetch_models_from_api(provider: str, settings: Settings) -> list[ModelInfo] | None:
    """Try to fetch models from the provider API. Returns None on failure."""
    try:
        if provider == "claude" and settings.anthropic_api_key:
            return await _fetch_claude_models(settings.anthropic_api_key)
        if provider == "openai" and settings.openai_api_key:
            return await _fetch_openai_models(settings.openai_api_key)
        if provider == "gemini" and settings.google_api_key:
            return await _fetch_gemini_models(settings.google_api_key)
        if provider == "ollama":
            return await _fetch_ollama_models(settings.ollama_base_url)
    except Exception:
        logger.debug("Failed to fetch models from %s API", provider, exc_info=True)
    return None


async def _fetch_claude_models(api_key: str) -> list[ModelInfo]:
    import anthropic

    client = anthropic.AsyncAnthropic(api_key=api_key)
    result = []
    async for model in client.models.list(limit=100):
        result.append(
            ModelInfo(
                id=model.id,
                display_name=model.display_name or model.id,
            )
        )
    return result


async def _fetch_openai_models(api_key: str) -> list[ModelInfo]:
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=api_key)
    response = await client.models.list()
    result = []
    for model in response.data:
        mid = model.id
        if not _is_chat_model(mid):
            continue
        result.append(ModelInfo(id=mid, display_name=mid))
    return sorted(result, key=lambda m: m.id)


def _is_chat_model(model_id: str) -> bool:
    """Filter to only include models useful for chat completions."""
    prefixes = ("gpt-4", "gpt-5", "gpt-3.5", "o1", "o3", "o4")
    return any(model_id.startswith(p) for p in prefixes)


async def _fetch_gemini_models(api_key: str) -> list[ModelInfo]:
    from google import genai

    client = genai.Client(api_key=api_key)
    result = []
    for model in client.models.list():
        name = model.name or ""
        if name.startswith("models/"):
            name = name[len("models/") :]
        if not name.startswith("gemini-"):
            continue
        result.append(
            ModelInfo(
                id=name,
                display_name=model.display_name or name,
            )
        )
    return result


async def _fetch_ollama_models(base_url: str) -> list[ModelInfo]:
    import httpx

    api_url = base_url.rstrip("/")
    if api_url.endswith("/v1"):
        api_url = api_url[:-3]
    api_url = f"{api_url}/api/tags"

    async with httpx.AsyncClient(timeout=5.0) as client:
        resp = await client.get(api_url)
        resp.raise_for_status()

    data = resp.json()
    result = []
    for m in data.get("models", []):
        name = m.get("name", "")
        if name:
            result.append(ModelInfo(id=name, display_name=name))
    return result


def _to_response(models: list[ModelInfo], current_model: str) -> list[ModelInfoResponse]:
    return [
        ModelInfoResponse(
            id=m.id,
            name=m.display_name,
            context_window=m.context_window,
            is_default=(m.id == current_model),
        )
        for m in models
    ]
