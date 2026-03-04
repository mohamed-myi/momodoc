import os
from pathlib import Path

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app.config import Settings
from app.core.exceptions import ValidationError
from app.core.security import validate_index_path
from app.dependencies import get_settings

router = APIRouter()


class DirectoryEntry(BaseModel):
    name: str
    path: str


class BrowseResponse(BaseModel):
    current_path: str | None
    parent_path: str | None
    entries: list[DirectoryEntry]


def _list_subdirectories(directory: Path) -> list[DirectoryEntry]:
    entries: list[DirectoryEntry] = []
    try:
        for entry in os.scandir(directory):
            if not entry.is_dir(follow_symlinks=False):
                continue
            if entry.name.startswith("."):
                continue
            entries.append(DirectoryEntry(name=entry.name, path=entry.path))
    except PermissionError:
        pass
    entries.sort(key=lambda e: e.name.lower())
    return entries


def _resolve_allowed_roots(allowed_paths: list[str]) -> list[DirectoryEntry]:
    roots: list[DirectoryEntry] = []
    for p in allowed_paths:
        try:
            resolved = Path(p).resolve(strict=True)
        except (OSError, ValueError):
            continue
        if resolved.is_dir():
            roots.append(DirectoryEntry(name=resolved.name, path=str(resolved)))
    roots.sort(key=lambda e: e.name.lower())
    return roots


@router.get("/directories/browse", response_model=BrowseResponse)
async def browse_directories(
    path: str | None = Query(default=None),
    settings: Settings = Depends(get_settings),
):
    allowed = settings.allowed_index_paths

    if not allowed:
        raise ValidationError(
            "No allowed index paths are configured. "
            "Set ALLOWED_INDEX_PATHS to one or more directories."
        )

    if path is None:
        return BrowseResponse(
            current_path=None,
            parent_path=None,
            entries=_resolve_allowed_roots(allowed),
        )

    resolved = validate_index_path(path, allowed)

    parent = resolved.parent
    parent_path: str | None = None
    for ap in allowed:
        try:
            ap_resolved = Path(ap).resolve(strict=True)
        except (OSError, ValueError):
            continue
        try:
            parent.relative_to(ap_resolved)
            parent_path = str(parent)
            break
        except ValueError:
            if parent == ap_resolved:
                parent_path = str(parent)
                break

    return BrowseResponse(
        current_path=str(resolved),
        parent_path=parent_path,
        entries=_list_subdirectories(resolved),
    )
