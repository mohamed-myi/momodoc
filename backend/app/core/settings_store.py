"""Persistent settings store backed by a JSON file in the data directory.

Provides a thread safe read/write layer for LLM related configuration.
Values stored here take precedence over environment variables and coded
defaults. The file uses atomic writes (tmp then rename) to avoid partial
reads on crash.
"""

import json
import logging
import os
import tempfile
import threading
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_LLM_SETTINGS_KEYS = frozenset(
    {
        "llm_provider",
        "anthropic_api_key",
        "claude_model",
        "openai_api_key",
        "openai_model",
        "google_api_key",
        "gemini_model",
        "ollama_base_url",
        "ollama_model",
    }
)


class SettingsStore:
    """Thread safe JSON backed settings persistence.

    Only LLM related keys are accepted; everything else is silently
    dropped on write.
    """

    def __init__(self, path: str | Path) -> None:
        self._path = Path(path)
        self._lock = threading.Lock()
        self._data: dict[str, Any] = {}
        self._load()

    def _load(self) -> None:
        if not self._path.exists():
            return
        try:
            raw = self._path.read_text(encoding="utf-8")
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                self._data = {k: v for k, v in parsed.items() if k in _LLM_SETTINGS_KEYS}
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning("Failed to load settings from %s: %s", self._path, exc)

    def get_all(self) -> dict[str, Any]:
        with self._lock:
            return dict(self._data)

    def get(self, key: str, default: Any = None) -> Any:
        with self._lock:
            return self._data.get(key, default)

    def update(self, partial: dict[str, Any]) -> dict[str, Any]:
        """Merge partial into the store, persist, and return the full state."""
        filtered = {k: v for k, v in partial.items() if k in _LLM_SETTINGS_KEYS}
        if not filtered:
            return self.get_all()

        with self._lock:
            self._data.update(filtered)
            self._persist()
            return dict(self._data)

    def _persist(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        try:
            fd, tmp_path = tempfile.mkstemp(
                dir=str(self._path.parent),
                prefix=".settings_",
                suffix=".tmp",
            )
            try:
                os.write(fd, json.dumps(self._data, indent=2).encode("utf-8"))
            finally:
                os.close(fd)
            os.replace(tmp_path, str(self._path))
        except OSError as exc:
            logger.error("Failed to persist settings to %s: %s", self._path, exc)
