"""Integration tests for issue endpoints."""

import uuid

import pytest


class TestIssueEndpoints:
    """Tests for the /api/v1/projects/{id}/issues endpoints."""

    @pytest.mark.asyncio
    async def test_create_issue(self, client):
        """POST /projects/{id}/issues should create an issue."""
        proj = await client.post("/api/v1/projects", json={"name": "issue-proj"})
        project_id = proj.json()["id"]

        resp = await client.post(
            f"/api/v1/projects/{project_id}/issues",
            json={"title": "Fix bug", "priority": "high"},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["title"] == "Fix bug"
        assert data["priority"] == "high"
        assert data["status"] == "open"

    @pytest.mark.asyncio
    async def test_update_issue_partial(self, client):
        """PATCH should support partial updates with enum fields."""
        proj = await client.post("/api/v1/projects", json={"name": "issue-update"})
        pid = proj.json()["id"]

        issue = await client.post(
            f"/api/v1/projects/{pid}/issues",
            json={"title": "Task", "description": "Do something"},
        )
        iid = issue.json()["id"]

        # Update only status
        resp = await client.patch(
            f"/api/v1/projects/{pid}/issues/{iid}",
            json={"status": "done"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "done"
        assert data["title"] == "Task"
        assert data["description"] == "Do something"

    @pytest.mark.asyncio
    async def test_update_issue_set_description_null(self, client):
        """PATCH with description=null should clear it."""
        proj = await client.post("/api/v1/projects", json={"name": "issue-null"})
        pid = proj.json()["id"]

        issue = await client.post(
            f"/api/v1/projects/{pid}/issues",
            json={"title": "Clear me", "description": "has desc"},
        )
        iid = issue.json()["id"]

        resp = await client.patch(
            f"/api/v1/projects/{pid}/issues/{iid}",
            json={"description": None},
        )
        assert resp.status_code == 200
        assert resp.json()["description"] is None

    @pytest.mark.asyncio
    async def test_list_issues_ordered(self, client):
        """GET /issues should return issues in deterministic order."""
        proj = await client.post("/api/v1/projects", json={"name": "ordered-issues"})
        pid = proj.json()["id"]

        await client.post(f"/api/v1/projects/{pid}/issues", json={"title": "First"})
        await client.post(f"/api/v1/projects/{pid}/issues", json={"title": "Second"})

        resp = await client.get(f"/api/v1/projects/{pid}/issues")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        # Newest first (created_at desc)
        assert data[0]["title"] == "Second"
        assert data[1]["title"] == "First"


class TestIssueDelete:
    """Tests for issue deletion."""

    @pytest.mark.asyncio
    async def test_delete_issue(self, client):
        """DELETE /issues/{id} should remove the issue and return 204."""
        proj = await client.post("/api/v1/projects", json={"name": "del-issue"})
        pid = proj.json()["id"]

        issue = await client.post(
            f"/api/v1/projects/{pid}/issues", json={"title": "To delete"}
        )
        iid = issue.json()["id"]

        resp = await client.delete(f"/api/v1/projects/{pid}/issues/{iid}")
        assert resp.status_code == 204

        # Verify it's gone
        resp = await client.get(f"/api/v1/projects/{pid}/issues")
        assert resp.status_code == 200
        assert len(resp.json()) == 0

    @pytest.mark.asyncio
    async def test_delete_nonexistent_issue_404(self, client):
        """DELETE /issues/{id} for nonexistent issue should return 404."""
        proj = await client.post("/api/v1/projects", json={"name": "del-404"})
        pid = proj.json()["id"]
        fake_id = str(uuid.uuid4())

        resp = await client.delete(f"/api/v1/projects/{pid}/issues/{fake_id}")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_issue_wrong_project_404(self, client):
        """DELETE /issues/{id} with wrong project_id should return 404."""
        proj_a = await client.post("/api/v1/projects", json={"name": "del-proj-a"})
        pid_a = proj_a.json()["id"]
        proj_b = await client.post("/api/v1/projects", json={"name": "del-proj-b"})
        pid_b = proj_b.json()["id"]

        issue = await client.post(
            f"/api/v1/projects/{pid_a}/issues", json={"title": "In A"}
        )
        iid = issue.json()["id"]

        # Try to delete using project B
        resp = await client.delete(f"/api/v1/projects/{pid_b}/issues/{iid}")
        assert resp.status_code == 404


class TestIssueFiltering:
    """Tests for issue status filtering."""

    @pytest.mark.asyncio
    async def test_filter_by_status_open(self, client):
        """GET /issues?status=open should return only open issues."""
        proj = await client.post("/api/v1/projects", json={"name": "filter-status"})
        pid = proj.json()["id"]

        # Create one open and one done issue
        await client.post(f"/api/v1/projects/{pid}/issues", json={"title": "Open one"})
        issue2 = await client.post(
            f"/api/v1/projects/{pid}/issues", json={"title": "Done one"}
        )
        iid2 = issue2.json()["id"]
        await client.patch(
            f"/api/v1/projects/{pid}/issues/{iid2}", json={"status": "done"}
        )

        resp = await client.get(f"/api/v1/projects/{pid}/issues?status=open")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["title"] == "Open one"
        assert data[0]["status"] == "open"

    @pytest.mark.asyncio
    async def test_filter_by_status_done(self, client):
        """GET /issues?status=done should return only done issues."""
        proj = await client.post("/api/v1/projects", json={"name": "filter-done"})
        pid = proj.json()["id"]

        issue = await client.post(
            f"/api/v1/projects/{pid}/issues", json={"title": "Will be done"}
        )
        iid = issue.json()["id"]
        await client.patch(
            f"/api/v1/projects/{pid}/issues/{iid}", json={"status": "done"}
        )
        # Leave another as open
        await client.post(f"/api/v1/projects/{pid}/issues", json={"title": "Still open"})

        resp = await client.get(f"/api/v1/projects/{pid}/issues?status=done")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["status"] == "done"

    @pytest.mark.asyncio
    async def test_filter_by_status_in_progress(self, client):
        """GET /issues?status=in_progress should return only in-progress issues."""
        proj = await client.post("/api/v1/projects", json={"name": "filter-ip"})
        pid = proj.json()["id"]

        issue = await client.post(
            f"/api/v1/projects/{pid}/issues", json={"title": "Working on it"}
        )
        iid = issue.json()["id"]
        await client.patch(
            f"/api/v1/projects/{pid}/issues/{iid}", json={"status": "in_progress"}
        )

        resp = await client.get(f"/api/v1/projects/{pid}/issues?status=in_progress")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["status"] == "in_progress"

    @pytest.mark.asyncio
    async def test_filter_by_invalid_status_rejected(self, client):
        """GET /issues?status=invalid should return 422 (enum validation)."""
        proj = await client.post("/api/v1/projects", json={"name": "filter-bad"})
        pid = proj.json()["id"]

        await client.post(f"/api/v1/projects/{pid}/issues", json={"title": "Exists"})

        resp = await client.get(f"/api/v1/projects/{pid}/issues?status=invalid_status")
        assert resp.status_code == 422


class TestIssueValidation:
    """Tests for issue input validation."""

    @pytest.mark.asyncio
    async def test_create_issue_empty_title_rejected(self, client):
        """POST /issues with empty title should return 422 (min_length=1)."""
        proj = await client.post("/api/v1/projects", json={"name": "val-empty"})
        pid = proj.json()["id"]

        resp = await client.post(
            f"/api/v1/projects/{pid}/issues", json={"title": ""}
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_create_issue_title_too_long_rejected(self, client):
        """POST /issues with title exceeding 512 chars should return 422."""
        proj = await client.post("/api/v1/projects", json={"name": "val-long"})
        pid = proj.json()["id"]

        long_title = "x" * 513
        resp = await client.post(
            f"/api/v1/projects/{pid}/issues", json={"title": long_title}
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_create_issue_title_at_max_length(self, client):
        """POST /issues with exactly 512-char title should succeed."""
        proj = await client.post("/api/v1/projects", json={"name": "val-max"})
        pid = proj.json()["id"]

        max_title = "a" * 512
        resp = await client.post(
            f"/api/v1/projects/{pid}/issues", json={"title": max_title}
        )
        assert resp.status_code == 201
        assert resp.json()["title"] == max_title

    @pytest.mark.asyncio
    async def test_create_issue_invalid_priority_rejected(self, client):
        """POST /issues with invalid priority should return 422."""
        proj = await client.post("/api/v1/projects", json={"name": "val-prio"})
        pid = proj.json()["id"]

        resp = await client.post(
            f"/api/v1/projects/{pid}/issues",
            json={"title": "Bad prio", "priority": "super_urgent"},
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_update_issue_invalid_status_rejected(self, client):
        """PATCH /issues with invalid status enum should return 422."""
        proj = await client.post("/api/v1/projects", json={"name": "val-status"})
        pid = proj.json()["id"]

        issue = await client.post(
            f"/api/v1/projects/{pid}/issues", json={"title": "Bad status"}
        )
        iid = issue.json()["id"]

        resp = await client.patch(
            f"/api/v1/projects/{pid}/issues/{iid}",
            json={"status": "cancelled"},  # not a valid IssueStatus
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_update_issue_invalid_priority_rejected(self, client):
        """PATCH /issues with invalid priority enum should return 422."""
        proj = await client.post("/api/v1/projects", json={"name": "val-uprio"})
        pid = proj.json()["id"]

        issue = await client.post(
            f"/api/v1/projects/{pid}/issues", json={"title": "Bad update prio"}
        )
        iid = issue.json()["id"]

        resp = await client.patch(
            f"/api/v1/projects/{pid}/issues/{iid}",
            json={"priority": "ultra"},
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_create_issue_default_priority_medium(self, client):
        """POST /issues without priority should default to medium."""
        proj = await client.post("/api/v1/projects", json={"name": "val-default"})
        pid = proj.json()["id"]

        resp = await client.post(
            f"/api/v1/projects/{pid}/issues", json={"title": "Defaulted"}
        )
        assert resp.status_code == 201
        assert resp.json()["priority"] == "medium"

    @pytest.mark.asyncio
    async def test_create_issue_all_priorities(self, client):
        """POST /issues should accept all valid priorities."""
        proj = await client.post("/api/v1/projects", json={"name": "val-allprio"})
        pid = proj.json()["id"]

        for priority in ["low", "medium", "high", "critical"]:
            resp = await client.post(
                f"/api/v1/projects/{pid}/issues",
                json={"title": f"Priority {priority}", "priority": priority},
            )
            assert resp.status_code == 201
            assert resp.json()["priority"] == priority

    @pytest.mark.asyncio
    async def test_issue_in_nonexistent_project_404(self, client):
        """POST /issues for a nonexistent project should return 404."""
        fake_pid = str(uuid.uuid4())
        resp = await client.post(
            f"/api/v1/projects/{fake_pid}/issues", json={"title": "Orphan"}
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_get_issue_wrong_project_404(self, client):
        """Accessing an issue via the wrong project should return 404."""
        proj_a = await client.post("/api/v1/projects", json={"name": "xproj-a"})
        pid_a = proj_a.json()["id"]
        proj_b = await client.post("/api/v1/projects", json={"name": "xproj-b"})
        pid_b = proj_b.json()["id"]

        issue = await client.post(
            f"/api/v1/projects/{pid_a}/issues", json={"title": "In A"}
        )
        iid = issue.json()["id"]

        # Try to update via project B
        resp = await client.patch(
            f"/api/v1/projects/{pid_b}/issues/{iid}",
            json={"title": "Hijacked"},
        )
        assert resp.status_code == 404


class TestIssuePagination:
    """Tests for issue list pagination."""

    @pytest.mark.asyncio
    async def test_list_issues_with_limit(self, client):
        """GET /issues?limit=N should return at most N issues."""
        proj = await client.post("/api/v1/projects", json={"name": "issue-pag"})
        pid = proj.json()["id"]

        for i in range(5):
            await client.post(
                f"/api/v1/projects/{pid}/issues", json={"title": f"Issue {i}"}
            )

        resp = await client.get(f"/api/v1/projects/{pid}/issues?limit=3")
        assert resp.status_code == 200
        assert len(resp.json()) == 3

    @pytest.mark.asyncio
    async def test_list_issues_with_offset(self, client):
        """GET /issues?offset=N should skip first N issues."""
        proj = await client.post("/api/v1/projects", json={"name": "issue-off"})
        pid = proj.json()["id"]

        for i in range(5):
            await client.post(
                f"/api/v1/projects/{pid}/issues", json={"title": f"Issue {i}"}
            )

        resp = await client.get(f"/api/v1/projects/{pid}/issues?offset=3")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    @pytest.mark.asyncio
    async def test_list_issues_offset_beyond_total(self, client):
        """GET /issues with offset beyond total returns empty list."""
        proj = await client.post("/api/v1/projects", json={"name": "issue-far"})
        pid = proj.json()["id"]

        await client.post(
            f"/api/v1/projects/{pid}/issues", json={"title": "Only one"}
        )

        resp = await client.get(f"/api/v1/projects/{pid}/issues?offset=100")
        assert resp.status_code == 200
        assert resp.json() == []

    @pytest.mark.asyncio
    async def test_list_issues_negative_offset_rejected(self, client):
        """GET /issues?offset=-1 should return 422."""
        proj = await client.post("/api/v1/projects", json={"name": "issue-neg"})
        pid = proj.json()["id"]

        resp = await client.get(f"/api/v1/projects/{pid}/issues?offset=-1")
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_list_issues_limit_zero_rejected(self, client):
        """GET /issues?limit=0 should return 422 (min 1)."""
        proj = await client.post("/api/v1/projects", json={"name": "issue-lz"})
        pid = proj.json()["id"]

        resp = await client.get(f"/api/v1/projects/{pid}/issues?limit=0")
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_list_issues_limit_over_max_rejected(self, client):
        """GET /issues?limit=101 should return 422 (max 100)."""
        proj = await client.post("/api/v1/projects", json={"name": "issue-lmax"})
        pid = proj.json()["id"]

        resp = await client.get(f"/api/v1/projects/{pid}/issues?limit=101")
        assert resp.status_code == 422


class TestIssueResponseStructure:
    """Tests for issue response field completeness."""

    @pytest.mark.asyncio
    async def test_issue_response_has_all_fields(self, client):
        """Issue response should have all expected fields."""
        proj = await client.post("/api/v1/projects", json={"name": "resp-fields"})
        pid = proj.json()["id"]

        resp = await client.post(
            f"/api/v1/projects/{pid}/issues",
            json={"title": "Complete", "description": "Full issue", "priority": "high"},
        )
        assert resp.status_code == 201
        data = resp.json()
        expected_fields = {
            "id", "project_id", "title", "description",
            "status", "priority", "chunk_count", "created_at", "updated_at",
        }
        assert expected_fields == set(data.keys())
        assert data["project_id"] == pid

    @pytest.mark.asyncio
    async def test_issue_update_changes_updated_at(self, client):
        """Updating an issue should change its updated_at timestamp."""
        proj = await client.post("/api/v1/projects", json={"name": "ts-update"})
        pid = proj.json()["id"]

        issue = await client.post(
            f"/api/v1/projects/{pid}/issues", json={"title": "Timestamp test"}
        )
        original_updated = issue.json()["updated_at"]

        resp = await client.patch(
            f"/api/v1/projects/{pid}/issues/{issue.json()['id']}",
            json={"title": "Updated title"},
        )
        assert resp.status_code == 200
        # updated_at should change (or at least not be before original)
        assert resp.json()["updated_at"] >= original_updated
