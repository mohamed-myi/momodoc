import os

import httpx
import typer

from app.config import Settings


def _settings() -> Settings:
    return Settings()


def get_api_base() -> str:
    """Resolve the API base URL from port file, env var, or default."""
    env = os.environ.get("MOMODOC_API_URL")
    if env:
        return env

    settings = _settings()
    port_path = settings.port_file_path
    if os.path.exists(port_path):
        try:
            with open(port_path) as f:
                port = int(f.read().strip())
            return f"http://127.0.0.1:{port}"
        except (ValueError, OSError):
            pass

    return f"http://127.0.0.1:{settings.port}"


def _read_token() -> str | None:
    """Read the session token from the data directory."""
    settings = _settings()
    token_path = settings.session_token_path
    if os.path.exists(token_path):
        try:
            with open(token_path) as f:
                return f.read().strip()
        except OSError:
            return None
    return None


def api_client() -> httpx.Client:
    token = _read_token()
    headers = {}
    if token:
        headers["X-Momodoc-Token"] = token
    return httpx.Client(base_url=get_api_base(), timeout=120.0, headers=headers)


def handle_response(response: httpx.Response) -> dict | list:
    if response.status_code >= 400:
        try:
            detail = response.json().get("detail", response.text)
        except (ValueError, httpx.DecodingError):
            detail = response.text
        typer.echo(f"Error ({response.status_code}): {detail}", err=True)
        raise typer.Exit(1)
    if response.status_code == 204:
        return {}
    return response.json()
