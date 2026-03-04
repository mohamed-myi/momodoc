import logging

from fastapi import APIRouter, Depends, Request

from app.config import Settings
from app.core.settings_store import SettingsStore
from app.dependencies import get_settings, get_settings_store
from app.llm.factory import ProviderRegistry, create_llm_provider
from app.schemas.settings import SettingsResponse, SettingsUpdate

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/settings", response_model=SettingsResponse)
async def get_current_settings(
    settings: Settings = Depends(get_settings),
):
    """Return current LLM settings with API keys masked."""
    return SettingsResponse.from_settings(settings)


@router.put("/settings", response_model=SettingsResponse)
async def update_settings(
    body: SettingsUpdate,
    request: Request,
    settings: Settings = Depends(get_settings),
    store: SettingsStore = Depends(get_settings_store),
):
    """Partial update of LLM settings.

    Persists to settings.json and hot reloads the provider registry
    so the change takes effect without a backend restart.
    """
    partial = body.model_dump(exclude_unset=True)
    if not partial:
        return SettingsResponse.from_settings(settings)

    store.update(partial)

    for key, value in partial.items():
        if hasattr(settings, key) and value not in (None, ""):
            object.__setattr__(settings, key, value)

    _hot_reload_providers(request, settings)

    logger.info("Settings updated: %s", list(partial.keys()))
    return SettingsResponse.from_settings(settings)


def _hot_reload_providers(request: Request, settings: Settings) -> None:
    """Invalidate cached providers and recreate the default provider."""
    registry: ProviderRegistry | None = getattr(request.app.state, "provider_registry", None)
    if registry is not None:
        registry.reload(settings)
    request.app.state.llm_provider = create_llm_provider(settings)
