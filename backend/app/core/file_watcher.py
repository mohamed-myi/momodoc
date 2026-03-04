"""Filesystem watcher for incremental project sync."""

import asyncio
import logging
import os

from watchdog.events import (
    FileSystemEventHandler,
)
from watchdog.observers import Observer

logger = logging.getLogger(__name__)

# Debounce window in seconds — coalesces rapid successive events on the same path.
_DEBOUNCE_SECONDS = 0.5


class _DebouncedHandler(FileSystemEventHandler):
    """Collects file change events and debounces them before dispatching."""

    def __init__(
        self,
        callback,
        loop: asyncio.AbstractEventLoop,
        supported_extensions: set[str],
        ignore_dirs: set[str],
    ):
        self._callback = callback
        self._loop = loop
        self._pending: dict[str, asyncio.TimerHandle] = {}
        self._supported = supported_extensions
        self._ignore_dirs = ignore_dirs

    def _should_ignore(self, path: str) -> bool:
        normalized = os.path.normpath(path)
        parts = [part for part in normalized.split(os.sep) if part]
        for part in parts:
            if part in self._ignore_dirs:
                return True

        # Ignore hidden files (e.g. ".env"), but do not blanket-ignore hidden
        # parent directories so projects under dot-prefixed folders can sync.
        filename = os.path.basename(normalized)
        if filename.startswith("."):
            return True

        ext = os.path.splitext(filename)[1].lower()
        return ext not in self._supported

    def on_any_event(self, event):
        if event.is_directory:
            return
        if self._should_ignore(event.src_path):
            return

        # Cancel any pending debounce for this path
        handle = self._pending.pop(event.src_path, None)
        if handle:
            handle.cancel()

        # Schedule callback after debounce window
        handle = self._loop.call_later(
            _DEBOUNCE_SECONDS,
            lambda p=event.src_path, t=type(event): asyncio.run_coroutine_threadsafe(
                self._callback(p, t), self._loop
            ),
        )
        self._pending[event.src_path] = handle


class ProjectFileWatcher:
    """Watches project directories for changes and triggers re-ingestion.

    One ``Observer`` per project directory.  The watcher is started via
    ``watch_project`` and removed via ``stop_project`` or ``stop_all``.
    """

    def __init__(self) -> None:
        self._observers: dict[str, Observer] = {}  # project_id -> Observer
        self._loop: asyncio.AbstractEventLoop | None = None

    def watch_project(
        self,
        project_id: str,
        directory: str,
        on_change,  # async callable(path: str, event_type: type)
        supported_extensions: set[str],
        ignore_dirs: set[str],
    ) -> None:
        """Start watching *directory* for file changes.

        ``on_change`` is an async callback that receives ``(file_path, event_type)``
        where *event_type* is one of :class:`FileCreatedEvent`,
        :class:`FileModifiedEvent`, or :class:`FileDeletedEvent`.
        """
        if project_id in self._observers:
            return  # Already watching

        if self._loop is None:
            self._loop = asyncio.get_event_loop()

        handler = _DebouncedHandler(
            on_change, self._loop, supported_extensions, ignore_dirs
        )
        observer = Observer()
        observer.schedule(handler, directory, recursive=True)
        observer.daemon = True
        observer.start()
        self._observers[project_id] = observer
        logger.info("Started watching project %s at %s", project_id, directory)

    def stop_project(self, project_id: str) -> None:
        """Stop watching a single project directory."""
        observer = self._observers.pop(project_id, None)
        if observer:
            observer.stop()
            observer.join(timeout=5)
            logger.info("Stopped watching project %s", project_id)

    def stop_all(self) -> None:
        """Stop all active watchers (called during shutdown)."""
        for pid in list(self._observers.keys()):
            self.stop_project(pid)

    @property
    def watched_project_ids(self) -> list[str]:
        """Return IDs of projects currently being watched."""
        return list(self._observers.keys())
