from pathlib import Path

from app.core.exceptions import ValidationError


def _resolve_existing_directory(path_str: str) -> Path:
    """Resolve a path and validate it points to an existing directory."""
    try:
        resolved = Path(path_str).resolve(strict=True)
    except (OSError, ValueError) as e:
        raise ValidationError(f"Invalid path: {e}")

    if not resolved.is_dir():
        raise ValidationError(f"Path is not a directory: {path_str}")

    return resolved


def validate_index_path(requested: str, allowed_paths: list[str]) -> Path:
    """Validate that the requested path is within one of the allowed directories.

    Resolves the path to its canonical absolute form and checks that it is a
    subdirectory of at least one allowed path. Rejects symlinks that escape
    the sandbox.

    Raises ValidationError if the path is not allowed.
    """
    if not requested or not requested.strip():
        raise ValidationError("Path must not be empty")

    if not allowed_paths:
        raise ValidationError(
            "No allowed index paths are configured. "
            "Set ALLOWED_INDEX_PATHS to one or more directories."
        )

    resolved = _resolve_existing_directory(requested)

    resolved_count = 0
    for allowed in allowed_paths:
        try:
            allowed_resolved = Path(allowed).resolve(strict=True)
        except (OSError, ValueError):
            continue
        if not allowed_resolved.is_dir():
            continue
        resolved_count += 1

        try:
            resolved.relative_to(allowed_resolved)
            return resolved
        except ValueError:
            continue

    if resolved_count == 0:
        raise ValidationError(
            "None of the allowed index paths could be resolved. "
            f"Check that these directories exist: {allowed_paths}"
        )
    
    raise ValidationError(
        f"Path '{requested}' is outside the allowed directories. "
        f"Allowed: {allowed_paths}"
    )
