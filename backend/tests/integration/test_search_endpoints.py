"""Integration tests for global and project-scoped search endpoints."""

import pytest


class TestGlobalSearch:
    @pytest.mark.asyncio
    async def test_global_search_returns_response_with_results(self, client):
        """POST /search should return a SearchResponse with results list."""
        resp = await client.post("/api/v1/search", json={"query": "test query"})
        assert resp.status_code == 200
        body = resp.json()
        assert "results" in body
        assert isinstance(body["results"], list)

    @pytest.mark.asyncio
    async def test_global_search_includes_query_plan(self, client):
        """Response should include a query_plan field."""
        resp = await client.post("/api/v1/search", json={"query": "test query"})
        assert resp.status_code == 200
        body = resp.json()
        assert "query_plan" in body
        assert body["query_plan"] is not None
        assert "type" in body["query_plan"]

    @pytest.mark.asyncio
    async def test_global_search_empty_query_rejected(self, client):
        """Empty query should be rejected by schema validation (min_length=1)."""
        resp = await client.post("/api/v1/search", json={"query": ""})
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_global_search_top_k_respected(self, client, mock_vectordb):
        """With reranker enabled, retrieval uses candidate_k (50) for overretrieval.

        The reranker then narrows the results to the requested top_k.
        """
        mock_vectordb.hybrid_search.reset_mock()
        await client.post("/api/v1/search", json={"query": "test", "top_k": 5})
        call_args = mock_vectordb.hybrid_search.call_args
        assert call_args[0][3] == 50

    @pytest.mark.asyncio
    async def test_global_search_no_project_filter(self, client, mock_vectordb):
        """Global search should pass None as the filter string (no project scope)."""
        mock_vectordb.hybrid_search.reset_mock()
        await client.post("/api/v1/search", json={"query": "global query"})
        call_args = mock_vectordb.hybrid_search.call_args
        assert call_args[0][2] is None

    @pytest.mark.asyncio
    async def test_global_search_top_k_bounds(self, client):
        """top_k below 1 or above 50 should be rejected."""
        resp = await client.post("/api/v1/search", json={"query": "test", "top_k": 0})
        assert resp.status_code == 422

        resp = await client.post("/api/v1/search", json={"query": "test", "top_k": 51})
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_global_search_with_results(self, client, mock_vectordb):
        """When vectordb returns results, they should be mapped to SearchResult format.

        With the reranker active, scores come from the cross-encoder rather
        than the raw hybrid relevance score.
        """
        mock_vectordb.hybrid_search.return_value = [
            {
                "source_type": "file",
                "source_id": "file-1",
                "filename": "readme.md",
                "original_path": "/tmp/readme.md",
                "chunk_text": "Some content",
                "chunk_index": 0,
                "file_type": "md",
                "_relevance_score": 0.8,
                "project_id": "proj-1",
            }
        ]
        resp = await client.post("/api/v1/search", json={"query": "readme"})
        assert resp.status_code == 200
        results = resp.json()["results"]
        assert len(results) == 1
        assert results[0]["filename"] == "readme.md"
        assert results[0]["source_type"] == "file"
        assert 0.0 <= results[0]["score"] <= 1.0


class TestProjectScopedSearch:
    @pytest.mark.asyncio
    async def test_project_search_returns_response(self, client, project_id):
        """POST /projects/{id}/search should return a SearchResponse."""
        resp = await client.post(
            f"/api/v1/projects/{project_id}/search",
            json={"query": "test query"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "results" in body
        assert isinstance(body["results"], list)

    @pytest.mark.asyncio
    async def test_project_search_passes_project_filter(self, client, project_id, mock_vectordb):
        """Project-scoped search should pass the project_id as a filter."""
        mock_vectordb.hybrid_search.reset_mock()
        await client.post(
            f"/api/v1/projects/{project_id}/search",
            json={"query": "scoped query"},
        )
        call_args = mock_vectordb.hybrid_search.call_args
        assert f"project_id = '{project_id}'" == call_args[0][2]

    @pytest.mark.asyncio
    async def test_project_search_nonexistent_project_404(self, client):
        """Searching in a nonexistent project should return 404."""
        resp = await client.post(
            "/api/v1/projects/nonexistent-project/search",
            json={"query": "test"},
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_project_search_empty_query_rejected(self, client, project_id):
        """Empty query should be rejected."""
        resp = await client.post(
            f"/api/v1/projects/{project_id}/search",
            json={"query": ""},
        )
        assert resp.status_code == 422
