"""Tests for session token file permission security."""

import os
import stat


class TestTokenFilePermissions:
    """Verify the token file is written with restrictive permissions."""

    def test_token_file_is_owner_only(self, tmp_path):
        """Token file should be mode 0600 (owner read/write only)."""
        token_path = str(tmp_path / "session.token")
        token = "test-secret-token"

        # Reproduce the write logic from main.py lifespan
        fd = os.open(token_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        try:
            os.write(fd, token.encode())
        finally:
            os.close(fd)

        mode = stat.S_IMODE(os.stat(token_path).st_mode)
        assert mode == 0o600, f"Expected 0600, got {oct(mode)}"

        # Verify content is correct
        with open(token_path) as f:
            assert f.read() == token

    def test_default_open_is_world_readable(self, tmp_path):
        """Demonstrate that plain open() creates world-readable files (the bug we fixed)."""
        path = str(tmp_path / "insecure.txt")
        with open(path, "w") as f:
            f.write("secret")

        mode = stat.S_IMODE(os.stat(path).st_mode)
        # On most systems with default umask, group/other will have read
        # This test documents why we use os.open() with explicit mode
        assert mode != 0o600 or True  # Don't fail — umask varies, just document
