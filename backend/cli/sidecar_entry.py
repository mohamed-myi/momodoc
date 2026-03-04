"""Lightweight backend lifecycle entrypoint for desktop sidecar launchers.

Avoids importing the full Typer CLI tree (`cli.main`), which also imports
heavy modules like `rag_eval` and can significantly slow startup in packaged
desktop environments.
"""

from __future__ import annotations

import os
import sys

import click
from cli.commands import server


def _run_command(fn) -> int:
    try:
        fn()
        return 0
    except click.exceptions.Exit as exc:
        return int(exc.exit_code)


def _env_str(name: str, default: str) -> str:
    value = os.getenv(name)
    return value if value else default


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if not value:
        return default
    try:
        return int(value)
    except ValueError:
        return default


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if not value:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    command = args[0] if args else "serve"

    if command == "serve":
        host = _env_str("HOST", "127.0.0.1")
        port = _env_int("PORT", 8000)
        reload = _env_bool("RELOAD", False)
        return _run_command(lambda: server.serve(host=host, port=port, reload=reload))
    if command == "status":
        return _run_command(server.status)
    if command == "stop":
        return _run_command(server.stop)

    print(f"Unsupported sidecar command: {command}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
