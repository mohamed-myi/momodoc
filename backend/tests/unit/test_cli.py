"""Unit tests for CLI utilities and command modules."""

import json
import os
import signal
from unittest.mock import AsyncMock, MagicMock, mock_open, patch

import httpx
import pytest
import typer
from typer.testing import CliRunner
runner = CliRunner()


@pytest.fixture
def mock_settings():
    """Return a MagicMock standing in for Settings with common paths."""
    s = MagicMock()
    s.port_file_path = "/fake/data/momodoc.port"
    s.session_token_path = "/fake/data/session.token"
    s.pid_file_path = "/fake/data/momodoc.pid"
    s.port = 8000
    s.data_dir = "/fake/data"
    return s


@pytest.fixture
def mock_httpx_response():
    """Factory for creating mock httpx.Response objects."""

    def _make(status_code=200, json_data=None, text=""):
        resp = MagicMock(spec=httpx.Response)
        resp.status_code = status_code
        resp.text = text
        if json_data is not None:
            resp.json.return_value = json_data
        else:
            resp.json.side_effect = ValueError("No JSON")
        return resp

    return _make


class TestGetApiBase:
    """Tests for cli.utils.get_api_base()."""

    def test_env_var_takes_precedence(self, mock_settings):
        """MOMODOC_API_URL env var should override everything else."""
        with (
            patch.dict(os.environ, {"MOMODOC_API_URL": "http://custom:9999"}),
            patch("cli.utils._settings", return_value=mock_settings),
        ):
            from cli.utils import get_api_base

            assert get_api_base() == "http://custom:9999"

    def test_port_file_with_valid_port(self, mock_settings):
        """When port file exists with valid port, use it."""
        with (
            patch.dict(os.environ, {}, clear=True),
            patch("cli.utils._settings", return_value=mock_settings),
            patch("os.path.exists", return_value=True),
            patch("builtins.open", mock_open(read_data="9001\n")),
        ):
            # Remove env var if present
            os.environ.pop("MOMODOC_API_URL", None)
            from cli.utils import get_api_base

            assert get_api_base() == "http://127.0.0.1:9001"

    def test_port_file_missing_falls_back(self, mock_settings):
        """When port file doesn't exist, fall back to settings.port."""
        mock_settings.port = 8000
        with (
            patch.dict(os.environ, {}, clear=True),
            patch("cli.utils._settings", return_value=mock_settings),
            patch("os.path.exists", return_value=False),
        ):
            os.environ.pop("MOMODOC_API_URL", None)
            from cli.utils import get_api_base

            assert get_api_base() == "http://127.0.0.1:8000"

    def test_port_file_with_non_numeric_content(self, mock_settings):
        """Non-numeric port file content should fall back to settings.port."""
        mock_settings.port = 8000
        with (
            patch.dict(os.environ, {}, clear=True),
            patch("cli.utils._settings", return_value=mock_settings),
            patch("os.path.exists", return_value=True),
            patch("builtins.open", mock_open(read_data="not-a-number\n")),
        ):
            os.environ.pop("MOMODOC_API_URL", None)
            from cli.utils import get_api_base

            assert get_api_base() == "http://127.0.0.1:8000"

    def test_port_file_with_empty_content(self, mock_settings):
        """Empty port file should fall back to settings.port."""
        mock_settings.port = 8000
        with (
            patch.dict(os.environ, {}, clear=True),
            patch("cli.utils._settings", return_value=mock_settings),
            patch("os.path.exists", return_value=True),
            patch("builtins.open", mock_open(read_data="")),
        ):
            os.environ.pop("MOMODOC_API_URL", None)
            from cli.utils import get_api_base

            assert get_api_base() == "http://127.0.0.1:8000"


class TestReadToken:
    """Tests for cli.utils._read_token()."""

    def test_token_file_exists(self, mock_settings):
        """When token file exists, return its stripped content."""
        with (
            patch("cli.utils._settings", return_value=mock_settings),
            patch("os.path.exists", return_value=True),
            patch("builtins.open", mock_open(read_data="  my-secret-token  \n")),
        ):
            from cli.utils import _read_token

            assert _read_token() == "my-secret-token"

    def test_token_file_missing(self, mock_settings):
        """When token file doesn't exist, return None."""
        with (
            patch("cli.utils._settings", return_value=mock_settings),
            patch("os.path.exists", return_value=False),
        ):
            from cli.utils import _read_token

            assert _read_token() is None

    def test_token_file_with_only_whitespace(self, mock_settings):
        """Token file with only whitespace returns empty string (falsy)."""
        with (
            patch("cli.utils._settings", return_value=mock_settings),
            patch("os.path.exists", return_value=True),
            patch("builtins.open", mock_open(read_data="   \n")),
        ):
            from cli.utils import _read_token

            # strip() on whitespace-only yields ""
            assert _read_token() == ""


class TestHandleResponse:
    """Tests for cli.utils.handle_response()."""

    def test_successful_json_response(self, mock_httpx_response):
        """200 response with JSON body should return parsed data."""
        from cli.utils import handle_response

        resp = mock_httpx_response(status_code=200, json_data={"id": "abc", "name": "test"})
        result = handle_response(resp)
        assert result == {"id": "abc", "name": "test"}

    def test_204_returns_empty_dict(self, mock_httpx_response):
        """204 No Content should return an empty dict."""
        from cli.utils import handle_response

        resp = mock_httpx_response(status_code=204)
        result = handle_response(resp)
        assert result == {}

    def test_404_extracts_detail(self, mock_httpx_response):
        """404 response should extract 'detail' field and raise typer.Exit."""
        from cli.utils import handle_response

        resp = mock_httpx_response(
            status_code=404,
            json_data={"detail": "Project not found: xyz"},
            text='{"detail": "Project not found: xyz"}',
        )
        with pytest.raises((SystemExit, typer.Exit)):
            handle_response(resp)

    def test_500_response(self, mock_httpx_response):
        """500 response should raise typer.Exit."""
        from cli.utils import handle_response

        resp = mock_httpx_response(
            status_code=500,
            json_data={"detail": "Internal Server Error"},
            text="Internal Server Error",
        )
        with pytest.raises((SystemExit, typer.Exit)):
            handle_response(resp)

    def test_error_with_non_json_body(self, mock_httpx_response):
        """Error response with non-JSON body should fall back to response.text."""
        from cli.utils import handle_response

        resp = mock_httpx_response(status_code=502, text="Bad Gateway")
        # json() raises ValueError → falls back to text
        with pytest.raises((SystemExit, typer.Exit)):
            handle_response(resp)


class TestApiClient:
    """Tests for cli.utils.api_client()."""

    def test_creates_client_with_token(self, mock_settings):
        """When token exists, client should include X-Momodoc-Token header."""
        with (
            patch("cli.utils._read_token", return_value="my-token"),
            patch("cli.utils.get_api_base", return_value="http://127.0.0.1:8000"),
        ):
            from cli.utils import api_client

            client = api_client()
            assert client.headers.get("X-Momodoc-Token") == "my-token"
            assert str(client.base_url) == "http://127.0.0.1:8000"
            client.close()

    def test_creates_client_without_token(self, mock_settings):
        """When token is None, client should not include X-Momodoc-Token header."""
        with (
            patch("cli.utils._read_token", return_value=None),
            patch("cli.utils.get_api_base", return_value="http://127.0.0.1:8000"),
        ):
            from cli.utils import api_client

            client = api_client()
            assert "X-Momodoc-Token" not in client.headers
            client.close()


class TestServeCommand:
    """Tests for the 'serve' CLI command in main.py."""

    def test_already_running_exits(self, tmp_path):
        """If PID file exists and process is alive, serve should exit with code 1."""
        pid_path = str(tmp_path / "momodoc.pid")
        port_path = str(tmp_path / "momodoc.port")

        # Write a PID file
        with open(pid_path, "w") as f:
            f.write("12345")

        mock_s = MagicMock()
        mock_s.pid_file_path = pid_path
        mock_s.port_file_path = port_path
        mock_s.data_dir = str(tmp_path)

        with (
            patch("app.config.Settings", return_value=mock_s),
            patch("cli.commands.server._is_process_alive", return_value=True),
        ):
            from cli.main import app

            result = runner.invoke(app, ["serve"])
            assert result.exit_code == 1
            assert "already running" in result.output

    def test_port_conflict_exits(self, tmp_path):
        """If port is in use, serve should exit with code 1."""
        pid_path = str(tmp_path / "momodoc.pid")
        port_path = str(tmp_path / "momodoc.port")

        mock_s = MagicMock()
        mock_s.pid_file_path = pid_path
        mock_s.port_file_path = port_path
        mock_s.data_dir = str(tmp_path)

        with (
            patch("app.config.Settings", return_value=mock_s),
            patch("cli.commands.server._is_port_free", return_value=False),
        ):
            from cli.main import app

            result = runner.invoke(app, ["serve"])
            assert result.exit_code == 1
            assert "already in use" in result.output

    def test_stale_pid_cleaned_up(self, tmp_path):
        """Stale PID file (dead process) should be removed before starting."""
        pid_path = str(tmp_path / "momodoc.pid")
        port_path = str(tmp_path / "momodoc.port")

        # Write a stale PID file
        with open(pid_path, "w") as f:
            f.write("99999")

        mock_s = MagicMock()
        mock_s.pid_file_path = pid_path
        mock_s.port_file_path = port_path
        mock_s.data_dir = str(tmp_path)

        mock_uvicorn = MagicMock()

        with (
            patch("app.config.Settings", return_value=mock_s),
            patch("cli.commands.server._is_process_alive", return_value=False),
            patch("cli.commands.server._is_port_free", return_value=True),
            patch.dict("sys.modules", {"uvicorn": mock_uvicorn}),
            patch("cli.commands.server.uvicorn", mock_uvicorn, create=True),
        ):
            from cli.main import app

            result = runner.invoke(app, ["serve"])
            # Stale PID file should have been removed, server attempted to start
            assert result.exit_code == 0 or "Starting momodoc" in result.output

    def test_pid_write_failure_exits(self, tmp_path):
        """If PID file write fails, serve should exit before starting uvicorn."""
        pid_path = "/nonexistent/dir/momodoc.pid"
        port_path = str(tmp_path / "momodoc.port")

        mock_s = MagicMock()
        mock_s.pid_file_path = pid_path
        mock_s.port_file_path = port_path
        mock_s.data_dir = str(tmp_path)

        with (
            patch("app.config.Settings", return_value=mock_s),
            patch("cli.commands.server._is_port_free", return_value=True),
        ):
            from cli.main import app

            result = runner.invoke(app, ["serve"])
            assert result.exit_code == 1
            assert "Could not write PID file" in result.output


class TestStopCommand:
    """Tests for the 'stop' CLI command in main.py."""

    def test_no_pid_file(self, tmp_path):
        """If no PID file exists, stop should report no instance found."""
        mock_s = MagicMock()
        mock_s.pid_file_path = str(tmp_path / "nonexistent.pid")

        with patch("app.config.Settings", return_value=mock_s):
            from cli.main import app

            result = runner.invoke(app, ["stop"])
            assert "No running momodoc instance found" in result.output

    def test_stale_pid_cleanup(self, tmp_path):
        """Stale PID (dead process) should be cleaned up."""
        pid_path = str(tmp_path / "momodoc.pid")
        port_path = str(tmp_path / "momodoc.port")
        token_path = str(tmp_path / "session.token")

        with open(pid_path, "w") as f:
            f.write("99999")

        mock_s = MagicMock()
        mock_s.pid_file_path = pid_path
        mock_s.port_file_path = port_path
        mock_s.session_token_path = token_path

        with (
            patch("app.config.Settings", return_value=mock_s),
            patch("cli.commands.server._is_process_alive", return_value=False),
        ):
            from cli.main import app

            result = runner.invoke(app, ["stop"])
            assert "not running" in result.output.lower() or "stale" in result.output.lower()

    def test_graceful_stop(self, tmp_path):
        """Graceful stop: SIGTERM succeeds and process exits."""
        pid_path = str(tmp_path / "momodoc.pid")
        port_path = str(tmp_path / "momodoc.port")
        token_path = str(tmp_path / "session.token")

        with open(pid_path, "w") as f:
            f.write("12345")

        mock_s = MagicMock()
        mock_s.pid_file_path = pid_path
        mock_s.port_file_path = port_path
        mock_s.session_token_path = token_path

        # Process is alive initially, then dies after SIGTERM
        alive_calls = [True, False]  # first call: alive check; second: poll loop

        with (
            patch("app.config.Settings", return_value=mock_s),
            patch("cli.commands.server._is_process_alive", side_effect=alive_calls),
            patch("os.kill") as mock_kill,
            patch("cli.commands.server._cleanup_files") as mock_cleanup,
        ):
            from cli.main import app

            result = runner.invoke(app, ["stop"])
            assert "stopped" in result.output.lower()
            mock_kill.assert_called_once_with(12345, signal.SIGTERM)
            mock_cleanup.assert_called_once()

    def test_force_kill_after_timeout(self, tmp_path):
        """If process doesn't exit after SIGTERM, SIGKILL should be sent."""
        pid_path = str(tmp_path / "momodoc.pid")
        port_path = str(tmp_path / "momodoc.port")
        token_path = str(tmp_path / "session.token")

        with open(pid_path, "w") as f:
            f.write("12345")

        mock_s = MagicMock()
        mock_s.pid_file_path = pid_path
        mock_s.port_file_path = port_path
        mock_s.session_token_path = token_path

        # Process stays alive through all 50 poll iterations + initial check
        with (
            patch("app.config.Settings", return_value=mock_s),
            patch("cli.commands.server._is_process_alive", return_value=True),
            patch("os.kill") as mock_kill,
            patch("cli.commands.server._cleanup_files"),
            patch("time.sleep"),  # Don't actually sleep
        ):
            from cli.main import app

            result = runner.invoke(app, ["stop"])
            assert "forcing" in result.output.lower()
            # Should have called SIGTERM then SIGKILL
            kill_calls = mock_kill.call_args_list
            assert any(c.args == (12345, signal.SIGTERM) for c in kill_calls)
            assert any(c.args == (12345, signal.SIGKILL) for c in kill_calls)

    def test_sigterm_process_already_dead(self, tmp_path):
        """If process dies between alive check and SIGTERM, handle gracefully."""
        pid_path = str(tmp_path / "momodoc.pid")
        port_path = str(tmp_path / "momodoc.port")
        token_path = str(tmp_path / "session.token")

        with open(pid_path, "w") as f:
            f.write("12345")

        mock_s = MagicMock()
        mock_s.pid_file_path = pid_path
        mock_s.port_file_path = port_path
        mock_s.session_token_path = token_path

        with (
            patch("app.config.Settings", return_value=mock_s),
            patch("cli.commands.server._is_process_alive", return_value=True),
            patch("os.kill", side_effect=ProcessLookupError("No such process")),
            patch("cli.commands.server._cleanup_files"),
        ):
            from cli.main import app

            result = runner.invoke(app, ["stop"])
            # Should handle gracefully, not crash
            assert result.exit_code == 0
            assert "stopped" in result.output.lower()


class TestStatusCommand:
    """Tests for the 'status' CLI command in main.py."""

    def test_not_running(self, tmp_path):
        """No PID file → not running."""
        mock_s = MagicMock()
        mock_s.pid_file_path = str(tmp_path / "nonexistent.pid")

        with patch("app.config.Settings", return_value=mock_s):
            from cli.main import app

            result = runner.invoke(app, ["status"])
            assert "not running" in result.output.lower()

    def test_running(self, tmp_path):
        """PID file exists + process alive → show running status."""
        pid_path = str(tmp_path / "momodoc.pid")
        port_path = str(tmp_path / "momodoc.port")

        with open(pid_path, "w") as f:
            f.write("12345")
        with open(port_path, "w") as f:
            f.write("9000")

        mock_s = MagicMock()
        mock_s.pid_file_path = pid_path
        mock_s.port_file_path = port_path
        mock_s.data_dir = str(tmp_path)

        with (
            patch("app.config.Settings", return_value=mock_s),
            patch("cli.commands.server._is_process_alive", return_value=True),
            patch("os.path.exists", side_effect=lambda p: p in (pid_path, port_path)),
        ):
            from cli.main import app

            result = runner.invoke(app, ["status"])
            assert "running" in result.output.lower()
            assert "12345" in result.output
            assert "9000" in result.output

    def test_stale_pid(self, tmp_path):
        """PID file exists but process is dead → stale."""
        pid_path = str(tmp_path / "momodoc.pid")

        with open(pid_path, "w") as f:
            f.write("99999")

        mock_s = MagicMock()
        mock_s.pid_file_path = pid_path

        with (
            patch("app.config.Settings", return_value=mock_s),
            patch("cli.commands.server._is_process_alive", return_value=False),
        ):
            from cli.main import app

            result = runner.invoke(app, ["status"])
            assert "stale" in result.output.lower() or "not running" in result.output.lower()


class TestProjectCommands:
    """Tests for CLI project commands via CliRunner."""

    def _mock_client(self, responses):
        """Create a mock api_client context manager returning preset responses."""
        client = MagicMock()
        client.__enter__ = MagicMock(return_value=client)
        client.__exit__ = MagicMock(return_value=False)
        # Map method calls to responses
        for method, resp_data in responses.items():
            resp = MagicMock(spec=httpx.Response)
            resp.status_code = 200
            resp.json.return_value = resp_data
            resp.text = ""
            getattr(client, method).return_value = resp
        return client

    def test_create_project(self):
        """project create should POST and display created project."""
        client = self._mock_client({
            "post": {"id": "aaaa-bbbb-cccc", "name": "my-proj"},
        })

        with patch("cli.commands.project.api_client", return_value=client):
            from cli.main import app

            result = runner.invoke(app, ["project", "create", "my-proj"])
            assert result.exit_code == 0
            assert "my-proj" in result.output

    def test_list_projects_empty(self):
        """project list with no projects should show 'No projects found'."""
        client = self._mock_client({"get": []})
        # Override: for list, response is a list
        resp = MagicMock(spec=httpx.Response)
        resp.status_code = 200
        resp.json.return_value = []
        resp.text = ""
        client.get.return_value = resp

        with patch("cli.commands.project.api_client", return_value=client):
            from cli.main import app

            result = runner.invoke(app, ["project", "list"])
            assert result.exit_code == 0
            assert "No projects found" in result.output

    def test_list_projects_with_data(self):
        """project list should display projects in a table."""
        projects = [
            {
                "id": "aaaa-bbbb-cccc-dddd",
                "name": "proj1",
                "file_count": 5,
                "note_count": 2,
                "issue_count": 1,
                "created_at": "2025-01-15T10:00:00",
            },
        ]
        client = self._mock_client({"get": projects})
        resp = MagicMock(spec=httpx.Response)
        resp.status_code = 200
        resp.json.return_value = projects
        resp.text = ""
        client.get.return_value = resp

        with patch("cli.commands.project.api_client", return_value=client):
            from cli.main import app

            result = runner.invoke(app, ["project", "list"])
            assert result.exit_code == 0
            assert "proj1" in result.output


class TestNoteCommands:
    """Tests for CLI note commands."""

    def test_add_note(self):
        """note add should POST and display note ID."""
        client = MagicMock()
        client.__enter__ = MagicMock(return_value=client)
        client.__exit__ = MagicMock(return_value=False)

        resp = MagicMock(spec=httpx.Response)
        resp.status_code = 200
        resp.json.return_value = {"id": "note-1234-5678", "chunk_count": 3}
        resp.text = ""
        client.post.return_value = resp

        with patch("cli.commands.note.api_client", return_value=client):
            from cli.main import app

            result = runner.invoke(app, ["note", "add", "my-project", "Hello world"])
            assert result.exit_code == 0
            assert "Note added" in result.output

    def test_list_notes_with_missing_content_key(self):
        """list_notes should handle notes missing 'content' key gracefully."""
        client = MagicMock()
        client.__enter__ = MagicMock(return_value=client)
        client.__exit__ = MagicMock(return_value=False)

        # Note missing 'content' key — .get("content", "") should handle it
        notes = [
            {
                "id": "note-1234-5678",
                "created_at": "2025-01-15T10:00:00",
                # deliberately missing "content"
            },
        ]
        resp = MagicMock(spec=httpx.Response)
        resp.status_code = 200
        resp.json.return_value = notes
        resp.text = ""
        client.get.return_value = resp

        with patch("cli.commands.note.api_client", return_value=client):
            from cli.main import app

            result = runner.invoke(app, ["note", "list", "my-project"])
            assert result.exit_code == 0
            # Should not crash — content defaults to ""


class TestIssueCommands:
    """Tests for CLI issue commands."""

    def test_add_issue(self):
        """issue add should POST and display issue title."""
        client = MagicMock()
        client.__enter__ = MagicMock(return_value=client)
        client.__exit__ = MagicMock(return_value=False)

        resp = MagicMock(spec=httpx.Response)
        resp.status_code = 200
        resp.json.return_value = {"id": "issue-1234", "title": "Fix bug"}
        resp.text = ""
        client.post.return_value = resp

        with patch("cli.commands.issue.api_client", return_value=client):
            from cli.main import app

            result = runner.invoke(app, ["issue", "add", "my-project", "Fix bug"])
            assert result.exit_code == 0
            assert "Fix bug" in result.output

    def test_list_issues_with_missing_status(self):
        """list_issues should handle issues with missing 'status' gracefully."""
        client = MagicMock()
        client.__enter__ = MagicMock(return_value=client)
        client.__exit__ = MagicMock(return_value=False)

        issues = [
            {
                "id": "issue-1234-5678",
                "title": "My issue",
                # deliberately missing "status", "priority", "created_at"
            },
        ]
        resp = MagicMock(spec=httpx.Response)
        resp.status_code = 200
        resp.json.return_value = issues
        resp.text = ""
        client.get.return_value = resp

        with patch("cli.commands.issue.api_client", return_value=client):
            from cli.main import app

            result = runner.invoke(app, ["issue", "list", "my-project"])
            assert result.exit_code == 0
            assert "My issue" in result.output


class TestSearchCommand:
    """Tests for the CLI search command."""

    def test_search_with_results(self):
        """search should display results with scores."""
        client = MagicMock()
        client.__enter__ = MagicMock(return_value=client)
        client.__exit__ = MagicMock(return_value=False)

        body = {
            "results": [
                {
                    "score": 0.85,
                    "filename": "readme.md",
                    "original_path": "/docs/readme.md",
                    "chunk_text": "This is a test document about momodoc features.",
                },
            ],
            "query_plan": {"type": "SIMPLE", "hyde": False, "decomposed": False},
        }
        resp = MagicMock(spec=httpx.Response)
        resp.status_code = 200
        resp.json.return_value = body
        resp.text = ""
        client.post.return_value = resp

        with patch("cli.commands.search.api_client", return_value=client):
            from cli.main import app

            result = runner.invoke(app, ["search", "test query", "--project", "my-proj"])
            assert result.exit_code == 0
            assert "readme.md" in result.output
            assert "85.0%" in result.output

    def test_search_empty_results(self):
        """search with no results should show 'No results found'."""
        client = MagicMock()
        client.__enter__ = MagicMock(return_value=client)
        client.__exit__ = MagicMock(return_value=False)

        resp = MagicMock(spec=httpx.Response)
        resp.status_code = 200
        resp.json.return_value = {"results": [], "query_plan": None}
        resp.text = ""
        client.post.return_value = resp

        with patch("cli.commands.search.api_client", return_value=client):
            from cli.main import app

            result = runner.invoke(app, ["search", "nonexistent"])
            assert result.exit_code == 0
            assert "No results found" in result.output

    def test_search_with_missing_score_key(self):
        """search should handle results with missing 'score' key gracefully."""
        client = MagicMock()
        client.__enter__ = MagicMock(return_value=client)
        client.__exit__ = MagicMock(return_value=False)

        body = {
            "results": [
                {
                    "filename": "readme.md",
                },
            ],
            "query_plan": None,
        }
        resp = MagicMock(spec=httpx.Response)
        resp.status_code = 200
        resp.json.return_value = body
        resp.text = ""
        client.post.return_value = resp

        with patch("cli.commands.search.api_client", return_value=client):
            from cli.main import app

            result = runner.invoke(app, ["search", "test query"])
            assert result.exit_code == 0
            assert "0.0%" in result.output


class TestChatCommand:
    """Tests for the CLI chat command."""

    def test_single_query(self):
        """chat --query should create session, send message, display answer."""
        client = MagicMock()
        client.__enter__ = MagicMock(return_value=client)
        client.__exit__ = MagicMock(return_value=False)

        # First POST: create session
        session_resp = MagicMock(spec=httpx.Response)
        session_resp.status_code = 200
        session_resp.json.return_value = {"id": "session-123"}
        session_resp.text = ""

        # Second POST: send message
        message_resp = MagicMock(spec=httpx.Response)
        message_resp.status_code = 200
        message_resp.json.return_value = {
            "answer": "The answer is 42.",
            "sources": [
                {"filename": "guide.md", "score": 0.9, "original_path": "/docs/guide.md"},
            ],
        }
        message_resp.text = ""

        client.post.side_effect = [session_resp, message_resp]

        with patch("cli.commands.chat.api_client", return_value=client):
            from cli.main import app

            result = runner.invoke(app, ["chat", "my-project", "--query", "What is 42?"])
            assert result.exit_code == 0
            assert "42" in result.output

    def test_chat_sources_missing_score(self):
        """chat sources with missing 'score' should not crash."""
        client = MagicMock()
        client.__enter__ = MagicMock(return_value=client)
        client.__exit__ = MagicMock(return_value=False)

        session_resp = MagicMock(spec=httpx.Response)
        session_resp.status_code = 200
        session_resp.json.return_value = {"id": "session-123"}
        session_resp.text = ""

        message_resp = MagicMock(spec=httpx.Response)
        message_resp.status_code = 200
        message_resp.json.return_value = {
            "answer": "An answer.",
            "sources": [
                {
                    "filename": "doc.md",
                    # deliberately missing "score"
                },
            ],
        }
        message_resp.text = ""

        client.post.side_effect = [session_resp, message_resp]

        with patch("cli.commands.chat.api_client", return_value=client):
            from cli.main import app

            result = runner.invoke(app, ["chat", "my-project", "--query", "question"])
            assert result.exit_code == 0
            # Should not crash — score defaults to 0
            assert "0%" in result.output


class TestRagEvalCommand:
    """Tests for the CLI rag-eval command."""

    def test_rag_eval_writes_json_report(self, tmp_path):
        from app.services.rag_evaluation import RetrievalEvalCaseResult, RetrievalEvalReport

        cases_file = tmp_path / "cases.jsonl"
        cases_file.write_text("", encoding="utf-8")
        output_file = tmp_path / "reports" / "rag-eval.json"

        report = RetrievalEvalReport(
            total_cases=2,
            avg_recall_at_k=0.75,
            avg_precision_at_k=0.5,
            hit_rate_at_k=1.0,
            mean_reciprocal_rank=0.8,
            case_results=[
                RetrievalEvalCaseResult(
                    query="q1",
                    project_id=None,
                    expected_source_ids=["s1"],
                    retrieved_source_ids=["s1"],
                    recall_at_k=1.0,
                    precision_at_k=1.0,
                    reciprocal_rank=1.0,
                    first_relevant_rank=1,
                ),
                RetrievalEvalCaseResult(
                    query="q2",
                    project_id="p1",
                    expected_source_ids=["s2", "s3"],
                    retrieved_source_ids=["s3", "s9"],
                    recall_at_k=0.5,
                    precision_at_k=0.5,
                    reciprocal_rank=0.5,
                    first_relevant_rank=2,
                ),
            ],
        )

        with patch(
            "cli.commands.rag_eval._run_eval",
            new=AsyncMock(return_value=report),
        ) as mock_run:
            from cli.main import app

            result = runner.invoke(
                app,
                [
                    "rag-eval",
                    str(cases_file),
                    "--output",
                    str(output_file),
                    "--max-cases",
                    "10",
                    "--concurrency",
                    "4",
                ],
            )

        assert result.exit_code == 0
        assert "RAG Retrieval Evaluation" in result.output
        assert output_file.exists()
        payload = json.loads(output_file.read_text(encoding="utf-8"))
        assert payload["total_cases"] == 2
        assert payload["case_results"][0]["query"] == "q1"
        mock_run.assert_awaited_once_with(str(cases_file), 10, 4)

    def test_rag_eval_handles_errors(self, tmp_path):
        cases_file = tmp_path / "bad-cases.jsonl"
        cases_file.write_text("", encoding="utf-8")

        with patch(
            "cli.commands.rag_eval._run_eval",
            new=AsyncMock(side_effect=ValueError("Invalid query at line 1")),
        ):
            from cli.main import app

            result = runner.invoke(app, ["rag-eval", str(cases_file)])

        assert result.exit_code == 1
        assert "RAG evaluation failed" in result.output
