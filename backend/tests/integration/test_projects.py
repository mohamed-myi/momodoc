"""Integration tests for project endpoints."""

import uuid

import pytest

from app.models.file import File


class TestProjectEndpoints:
    """Tests for the /api/v1/projects endpoints."""

    @pytest.mark.asyncio
    async def test_create_project(self, client):
        """POST /projects should create a project and return ProjectResponse."""
        resp = await client.post(
            "/api/v1/projects",
            json={"name": "test-project", "description": "A test"},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "test-project"
        assert data["description"] == "A test"
        assert "id" in data
        assert "created_at" in data
        assert "updated_at" in data
        assert data["file_count"] == 0
        assert data["note_count"] == 0
        assert data["issue_count"] == 0

    @pytest.mark.asyncio
    async def test_list_projects(self, client):
        """GET /projects should return a list of ProjectResponse."""
        # Create two projects
        await client.post("/api/v1/projects", json={"name": "proj-a"})
        await client.post("/api/v1/projects", json={"name": "proj-b"})

        resp = await client.get("/api/v1/projects")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        # Should be ordered by created_at desc (newest first)
        names = [p["name"] for p in data]
        assert "proj-a" in names
        assert "proj-b" in names

    @pytest.mark.asyncio
    async def test_get_project_by_name(self, client):
        """GET /projects/{name} should resolve by name."""
        create_resp = await client.post("/api/v1/projects", json={"name": "by-name"})
        project_id = create_resp.json()["id"]

        resp = await client.get("/api/v1/projects/by-name")
        assert resp.status_code == 200
        assert resp.json()["id"] == project_id

    @pytest.mark.asyncio
    async def test_update_project_partial(self, client):
        """PATCH /projects/{id} should support partial updates with exclude_unset."""
        create_resp = await client.post(
            "/api/v1/projects",
            json={"name": "original", "description": "original desc"},
        )
        project_id = create_resp.json()["id"]

        # Update only name, leave description untouched
        resp = await client.patch(
            f"/api/v1/projects/{project_id}",
            json={"name": "updated"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "updated"
        assert data["description"] == "original desc"

    @pytest.mark.asyncio
    async def test_update_project_set_null(self, client):
        """PATCH with explicit null should clear the field."""
        create_resp = await client.post(
            "/api/v1/projects",
            json={"name": "nullable", "description": "has desc"},
        )
        project_id = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/projects/{project_id}",
            json={"description": None},
        )
        assert resp.status_code == 200
        assert resp.json()["description"] is None

    @pytest.mark.asyncio
    async def test_delete_project(self, client):
        """DELETE /projects/{id} should remove the project."""
        create_resp = await client.post("/api/v1/projects", json={"name": "to-delete"})
        project_id = create_resp.json()["id"]

        resp = await client.delete(f"/api/v1/projects/{project_id}")
        assert resp.status_code == 204

        resp = await client.get(f"/api/v1/projects/{project_id}")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_get_nonexistent_project_404(self, client):
        """GET /projects/{id} for a nonexistent project should return 404."""
        resp = await client.get("/api/v1/projects/nonexistent-id")
        assert resp.status_code == 404


class TestProjectValidation:
    """Tests for project input validation and edge cases."""

    @pytest.mark.asyncio
    async def test_create_project_empty_name_rejected(self, client):
        """POST /projects with empty name should return 422."""
        resp = await client.post("/api/v1/projects", json={"name": ""})
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_create_project_name_too_long_rejected(self, client):
        """POST /projects with name exceeding 255 chars should return 422."""
        long_name = "x" * 256
        resp = await client.post("/api/v1/projects", json={"name": long_name})
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_create_project_name_at_max_length(self, client):
        """POST /projects with exactly 255-char name should succeed."""
        max_name = "a" * 255
        resp = await client.post("/api/v1/projects", json={"name": max_name})
        assert resp.status_code == 201
        assert resp.json()["name"] == max_name

    @pytest.mark.asyncio
    async def test_create_project_duplicate_name_rejected(self, client):
        """POST /projects with a duplicate name should return 409 Conflict."""
        await client.post("/api/v1/projects", json={"name": "unique-name"})
        resp = await client.post("/api/v1/projects", json={"name": "unique-name"})
        assert resp.status_code == 409
        assert "already exists" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_create_project_special_chars_in_name(self, client):
        """POST /projects with special characters in name should succeed."""
        resp = await client.post(
            "/api/v1/projects",
            json={"name": "project-with_special.chars (1) & more!"},
        )
        assert resp.status_code == 201
        assert resp.json()["name"] == "project-with_special.chars (1) & more!"

    @pytest.mark.asyncio
    async def test_create_project_unicode_name(self, client):
        """POST /projects with unicode name should succeed."""
        resp = await client.post(
            "/api/v1/projects", json={"name": "projet-fran\u00e7ais-\u65e5\u672c\u8a9e"}
        )
        assert resp.status_code == 201

    @pytest.mark.asyncio
    async def test_update_nonexistent_project_404(self, client):
        """PATCH /projects/{id} for nonexistent project should return 404."""
        fake_id = str(uuid.uuid4())
        resp = await client.patch(
            f"/api/v1/projects/{fake_id}",
            json={"name": "new-name"},
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_nonexistent_project_404(self, client):
        """DELETE /projects/{id} for nonexistent project should return 404."""
        fake_id = str(uuid.uuid4())
        resp = await client.delete(f"/api/v1/projects/{fake_id}")
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_create_project_no_description(self, client):
        """POST /projects without description should default to null."""
        resp = await client.post("/api/v1/projects", json={"name": "no-desc"})
        assert resp.status_code == 201
        assert resp.json()["description"] is None


class TestProjectPagination:
    """Tests for project list pagination."""

    @pytest.mark.asyncio
    async def test_list_projects_with_limit(self, client):
        """GET /projects?limit=N should return at most N projects."""
        for i in range(5):
            await client.post("/api/v1/projects", json={"name": f"pag-proj-{i}"})

        resp = await client.get("/api/v1/projects?limit=3")
        assert resp.status_code == 200
        assert len(resp.json()) == 3

    @pytest.mark.asyncio
    async def test_list_projects_with_offset(self, client):
        """GET /projects?offset=N should skip first N projects."""
        for i in range(5):
            await client.post("/api/v1/projects", json={"name": f"off-proj-{i}"})

        resp = await client.get("/api/v1/projects?offset=3")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    @pytest.mark.asyncio
    async def test_list_projects_offset_beyond_total(self, client):
        """GET /projects with offset beyond total count should return empty list."""
        await client.post("/api/v1/projects", json={"name": "only-one"})

        resp = await client.get("/api/v1/projects?offset=100")
        assert resp.status_code == 200
        assert resp.json() == []

    @pytest.mark.asyncio
    async def test_list_projects_negative_offset_rejected(self, client):
        """GET /projects?offset=-1 should return 422."""
        resp = await client.get("/api/v1/projects?offset=-1")
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_list_projects_limit_zero_rejected(self, client):
        """GET /projects?limit=0 should return 422 (min 1)."""
        resp = await client.get("/api/v1/projects?limit=0")
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_list_projects_limit_over_max_rejected(self, client):
        """GET /projects?limit=101 should return 422 (max 100)."""
        resp = await client.get("/api/v1/projects?limit=101")
        assert resp.status_code == 422


class TestProjectSourceDirectoryValidation:
    """Tests for source_directory validation on create/update."""

    @pytest.mark.asyncio
    async def test_create_project_with_nonexistent_directory_rejected(self, client):
        """POST /projects with nonexistent source_directory should return 422."""
        resp = await client.post(
            "/api/v1/projects",
            json={"name": "bad-dir", "source_directory": "/tmp/momodoc-test/nonexistent"},
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_create_project_without_source_directory_ok(self, client):
        """POST /projects without source_directory should succeed."""
        resp = await client.post(
            "/api/v1/projects",
            json={"name": "no-dir"},
        )
        assert resp.status_code == 201

    @pytest.mark.asyncio
    async def test_update_project_with_nonexistent_directory_rejected(self, client):
        """PATCH /projects/{id} with nonexistent source_directory should return 422."""
        create_resp = await client.post(
            "/api/v1/projects", json={"name": "update-bad-dir"}
        )
        project_id = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/projects/{project_id}",
            json={"source_directory": "/tmp/momodoc-test/nonexistent"},
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_update_project_clear_source_directory_ok(self, client):
        """PATCH /projects/{id} setting source_directory to null should succeed."""
        create_resp = await client.post(
            "/api/v1/projects", json={"name": "clear-dir"}
        )
        project_id = create_resp.json()["id"]

        resp = await client.patch(
            f"/api/v1/projects/{project_id}",
            json={"source_directory": None},
        )
        assert resp.status_code == 200


class TestProjectCounts:
    """Tests that project response counts reflect actual children."""

    @pytest.mark.asyncio
    async def test_issue_count_reflects_issues(self, client):
        """Project issue_count should match actual issue count."""
        resp = await client.post("/api/v1/projects", json={"name": "count-issues"})
        pid = resp.json()["id"]

        # Create 3 issues
        for i in range(3):
            await client.post(
                f"/api/v1/projects/{pid}/issues",
                json={"title": f"Issue {i}"},
            )

        resp = await client.get(f"/api/v1/projects/{pid}")
        assert resp.status_code == 200
        assert resp.json()["issue_count"] == 3

    @pytest.mark.asyncio
    async def test_note_count_reflects_notes(self, client):
        """Project note_count should match actual note count."""
        resp = await client.post("/api/v1/projects", json={"name": "count-notes"})
        pid = resp.json()["id"]

        for i in range(2):
            await client.post(
                f"/api/v1/projects/{pid}/notes",
                json={"content": f"Note content {i}"},
            )

        resp = await client.get(f"/api/v1/projects/{pid}")
        assert resp.status_code == 200
        assert resp.json()["note_count"] == 2

    @pytest.mark.asyncio
    async def test_file_count_reflects_files(self, client, db_session):
        """Project file_count should match actual file count (inserted via DB)."""
        resp = await client.post("/api/v1/projects", json={"name": "count-files"})
        pid = resp.json()["id"]

        # Insert 2 file records directly
        for i in range(2):
            f = File(
                id=str(uuid.uuid4()),
                project_id=pid,
                filename=f"counted-{i}.txt",
                storage_path=f"/tmp/counted-{i}.txt",
                file_type="txt",
                file_size=100,
                chunk_count=1,
                checksum=f"check-{i}",
                is_managed=False,
            )
            db_session.add(f)
        await db_session.commit()

        resp = await client.get(f"/api/v1/projects/{pid}")
        assert resp.status_code == 200
        assert resp.json()["file_count"] == 2

    @pytest.mark.asyncio
    async def test_counts_on_list_endpoint(self, client):
        """Counts should also appear correctly on the list endpoint."""
        resp = await client.post("/api/v1/projects", json={"name": "list-counts"})
        pid = resp.json()["id"]

        await client.post(
            f"/api/v1/projects/{pid}/issues", json={"title": "An issue"}
        )

        resp = await client.get("/api/v1/projects")
        assert resp.status_code == 200
        project = next(p for p in resp.json() if p["id"] == pid)
        assert project["issue_count"] == 1
        assert project["file_count"] == 0
        assert project["note_count"] == 0
