"""Tests for file watcher path ignore behavior."""

import asyncio

import pytest

from app.core.file_watcher import _DebouncedHandler


@pytest.fixture
def handler():
    async def _callback(path: str, event_type: type) -> None:
        return None

    loop = asyncio.new_event_loop()
    try:
        yield _DebouncedHandler(
            callback=_callback,
            loop=loop,
            supported_extensions={".py", ".ts", ".js"},
            ignore_dirs={"node_modules", ".git"},
        )
    finally:
        loop.close()


def test_should_ignore_hidden_file(handler):
    assert handler._should_ignore("/repo/.env")


def test_should_not_ignore_file_under_hidden_parent_directory(handler):
    assert not handler._should_ignore("/repo/.hidden-dir/important.py")


def test_should_ignore_configured_ignore_directory(handler):
    assert handler._should_ignore("/repo/node_modules/pkg/index.js")


def test_should_ignore_unsupported_extension(handler):
    assert handler._should_ignore("/repo/src/README.md")
