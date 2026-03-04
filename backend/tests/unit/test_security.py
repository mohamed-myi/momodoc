"""Tests for path traversal protection (Issue #25)."""

import os

import pytest

from app.core.exceptions import ValidationError
from app.core.security import validate_index_path


class TestValidateIndexPath:
    """Tests for the sandbox path validation."""

    def test_empty_allowed_paths_rejects_with_configuration_error(self, tmp_path):
        """Empty allowlist should fail closed with a clear configuration error."""
        with pytest.raises(ValidationError, match="No allowed index paths are configured"):
            validate_index_path(str(tmp_path), [])

    def test_empty_allowed_paths_rejects_nonexistent(self):
        """Configuration error should be raised before requested path validation."""
        with pytest.raises(ValidationError, match="No allowed index paths are configured"):
            validate_index_path("/nonexistent/path/12345", [])

    def test_empty_allowed_paths_rejects_file_not_dir(self, tmp_path):
        """Configuration error should be raised before file-vs-directory checks."""
        file_path = tmp_path / "file.txt"
        file_path.write_text("test")
        with pytest.raises(ValidationError, match="No allowed index paths are configured"):
            validate_index_path(str(file_path), [])

    def test_path_outside_allowed_raises(self, tmp_path):
        """Paths outside the allowed directories should be rejected."""
        allowed = str(tmp_path / "allowed")
        os.makedirs(allowed)
        outside = str(tmp_path / "outside")
        os.makedirs(outside)

        with pytest.raises(ValidationError, match="outside the allowed directories"):
            validate_index_path(outside, [allowed])

    def test_path_inside_allowed_succeeds(self, tmp_path):
        """Paths inside the allowed directories should pass validation."""
        allowed = str(tmp_path / "allowed")
        subdir = os.path.join(allowed, "subdir")
        os.makedirs(subdir)

        result = validate_index_path(subdir, [allowed])
        assert result.is_dir()

    def test_relative_traversal_rejected(self, tmp_path):
        """Relative path traversal (../) should be rejected."""
        allowed = str(tmp_path / "allowed")
        os.makedirs(allowed)
        os.makedirs(tmp_path / "secret")

        traversal_path = os.path.join(allowed, "..", "secret")
        with pytest.raises(ValidationError, match="outside the allowed directories"):
            validate_index_path(traversal_path, [allowed])

    def test_nonexistent_path_raises(self, tmp_path):
        """Non-existent paths should be rejected."""
        allowed = str(tmp_path / "allowed")
        os.makedirs(allowed)

        with pytest.raises(ValidationError, match="Invalid path"):
            validate_index_path("/nonexistent/path/12345", [allowed])

    def test_file_path_not_directory_raises(self, tmp_path):
        """Files (not directories) should be rejected."""
        allowed = str(tmp_path / "allowed")
        os.makedirs(allowed)
        file_path = os.path.join(allowed, "file.txt")
        with open(file_path, "w") as f:
            f.write("test")

        with pytest.raises(ValidationError, match="not a directory"):
            validate_index_path(file_path, [allowed])

    def test_exact_allowed_path_succeeds(self, tmp_path):
        """The allowed path itself should be valid."""
        allowed = str(tmp_path / "allowed")
        os.makedirs(allowed)

        result = validate_index_path(allowed, [allowed])
        assert result.is_dir()

    def test_multiple_allowed_paths(self, tmp_path):
        """Should succeed if path is under any of multiple allowed paths."""
        allowed1 = str(tmp_path / "path1")
        allowed2 = str(tmp_path / "path2")
        os.makedirs(allowed1)
        os.makedirs(allowed2)

        result = validate_index_path(allowed2, [allowed1, allowed2])
        assert result.is_dir()
