"""Tests for the exclude_unset partial update pattern (Issue #24)."""


from app.schemas.project import ProjectUpdate
from app.schemas.note import NoteUpdate
from app.schemas.issue import IssueUpdate


class TestExcludeUnset:
    """Verify Pydantic exclude_unset works correctly for partial updates."""

    def test_project_update_unset_vs_null(self):
        """Absent fields should be excluded; explicit null should be included."""
        # Only name sent, description absent
        data = ProjectUpdate.model_validate({"name": "new-name"})
        dumped = data.model_dump(exclude_unset=True)
        assert dumped == {"name": "new-name"}
        assert "description" not in dumped

        # Description explicitly set to null
        data = ProjectUpdate.model_validate({"description": None})
        dumped = data.model_dump(exclude_unset=True)
        assert dumped == {"description": None}
        assert "name" not in dumped

        # Empty body
        data = ProjectUpdate.model_validate({})
        dumped = data.model_dump(exclude_unset=True)
        assert dumped == {}

    def test_note_update_content_vs_tags(self):
        """Note content change should be detectable via exclude_unset."""
        # Only content sent
        data = NoteUpdate.model_validate({"content": "updated content"})
        dumped = data.model_dump(exclude_unset=True)
        assert "content" in dumped
        assert "tags" not in dumped

        # Tags explicitly set to null
        data = NoteUpdate.model_validate({"tags": None})
        dumped = data.model_dump(exclude_unset=True)
        assert dumped == {"tags": None}

    def test_issue_update_enum_fields(self):
        """Enum fields should serialize correctly with exclude_unset."""
        data = IssueUpdate.model_validate({"status": "done"})
        dumped = data.model_dump(exclude_unset=True)
        assert "status" in dumped
        assert "title" not in dumped
        assert "priority" not in dumped

        # Multiple fields
        data = IssueUpdate.model_validate({"status": "done", "priority": "high"})
        dumped = data.model_dump(exclude_unset=True)
        assert len(dumped) == 2
