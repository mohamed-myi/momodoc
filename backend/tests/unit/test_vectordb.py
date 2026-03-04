"""Tests for VectorStore (LanceDB wrapper) edge cases."""

import pytest

from app.core.exceptions import VectorStoreError
from app.core.vectordb import VectorStore


@pytest.fixture
def vectordb(tmp_path):
    """Create a real VectorStore backed by a temp directory."""
    return VectorStore(str(tmp_path / "vectors"), vector_dim=4)


def _table_names(vs: VectorStore) -> list[str]:
    listed = vs.db.list_tables() if hasattr(vs.db, "list_tables") else vs.db.table_names()
    if hasattr(listed, "tables"):
        return list(getattr(listed, "tables") or [])
    return list(listed)


def _make_record(project_id="p1", source_id="s1", text="hello", vector=None):
    return {
        "vector": vector or [1.0, 0.0, 0.0, 0.0],
        "project_id": project_id,
        "source_type": "file",
        "source_id": source_id,
        "filename": "test.py",
        "original_path": "/tmp/test.py",
        "file_type": "py",
        "chunk_index": 0,
        "chunk_text": text,
        "language": "python",
        "tags": "[]",
        "section_header": "",
    }


class TestVectorStoreAdd:
    def test_add_and_search_returns_results(self, vectordb):
        vectordb.add([_make_record(text="first chunk")])
        results = vectordb.search([1.0, 0.0, 0.0, 0.0], limit=5)
        assert len(results) == 1
        assert results[0]["chunk_text"] == "first chunk"

    def test_add_auto_generates_id(self, vectordb):
        rec = _make_record()
        assert "id" not in rec
        vectordb.add([rec])
        # Verify record was added with auto-generated ID (not mutated in caller's dict)
        assert "id" not in rec  # caller's dict should not be mutated
        results = vectordb.search([1.0, 0.0, 0.0, 0.0], limit=5)
        assert len(results) == 1
        assert results[0]["id"]  # ID should exist in stored record

    def test_add_preserves_provided_id(self, vectordb):
        rec = _make_record()
        rec["id"] = "custom-id-123"
        vectordb.add([rec])
        results = vectordb.search([1.0, 0.0, 0.0, 0.0])
        assert results[0]["id"] == "custom-id-123"

    def test_add_fills_nullable_fields(self, vectordb):
        """None values for nullable string fields should become empty string."""
        rec = _make_record()
        rec["filename"] = None
        rec["original_path"] = None
        rec["language"] = None
        rec["tags"] = None
        vectordb.add([rec])
        results = vectordb.search([1.0, 0.0, 0.0, 0.0])
        assert results[0]["filename"] == ""
        assert results[0]["language"] == ""

    def test_section_header_stored_and_retrieved(self, vectordb):
        """section_header field should be persisted and retrievable."""
        rec = _make_record()
        rec["section_header"] = "Architecture > Data Storage"
        vectordb.add([rec])
        results = vectordb.search([1.0, 0.0, 0.0, 0.0])
        assert results[0]["section_header"] == "Architecture > Data Storage"

    def test_section_header_defaults_to_empty(self, vectordb):
        """Missing section_header should default to empty string."""
        rec = _make_record()
        del rec["section_header"]
        vectordb.add([rec])
        results = vectordb.search([1.0, 0.0, 0.0, 0.0])
        assert results[0]["section_header"] == ""


class TestVectorStoreSearch:
    def test_search_empty_table_returns_empty(self, vectordb):
        results = vectordb.search([1.0, 0.0, 0.0, 0.0], limit=5)
        assert results == []

    def test_search_with_filter(self, vectordb):
        vectordb.add(
            [
                _make_record(project_id="p1", text="proj 1"),
                _make_record(project_id="p2", text="proj 2"),
            ]
        )
        results = vectordb.search(
            [1.0, 0.0, 0.0, 0.0],
            filter_str="project_id = 'p1'",
            limit=10,
        )
        assert len(results) == 1
        assert results[0]["project_id"] == "p1"

    def test_search_filter_no_match_returns_empty(self, vectordb):
        vectordb.add([_make_record(project_id="p1")])
        results = vectordb.search(
            [1.0, 0.0, 0.0, 0.0],
            filter_str="project_id = 'nonexistent'",
        )
        assert results == []

    def test_search_limit_respected(self, vectordb):
        records = [_make_record(source_id=f"s{i}") for i in range(5)]
        vectordb.add(records)
        results = vectordb.search([1.0, 0.0, 0.0, 0.0], limit=2)
        assert len(results) == 2

    def test_search_returns_distance(self, vectordb):
        vectordb.add([_make_record(vector=[1.0, 0.0, 0.0, 0.0])])
        results = vectordb.search([1.0, 0.0, 0.0, 0.0])
        assert "_distance" in results[0]
        # Same vector should have distance ~0
        assert results[0]["_distance"] < 0.01


class TestVectorStoreDelete:
    def test_delete_by_source_id(self, vectordb):
        vectordb.add(
            [
                _make_record(source_id="keep", text="keep me"),
                _make_record(source_id="remove", text="remove me"),
            ]
        )
        vectordb.delete("source_id = 'remove'")
        results = vectordb.search([1.0, 0.0, 0.0, 0.0], limit=10)
        assert len(results) == 1
        assert results[0]["source_id"] == "keep"

    def test_delete_by_project_id(self, vectordb):
        vectordb.add(
            [
                _make_record(project_id="p1", source_id="s1"),
                _make_record(project_id="p1", source_id="s2"),
                _make_record(project_id="p2", source_id="s3"),
            ]
        )
        vectordb.delete("project_id = 'p1'")
        results = vectordb.search([1.0, 0.0, 0.0, 0.0], limit=10)
        assert len(results) == 1
        assert results[0]["project_id"] == "p2"

    def test_delete_nonexistent_filter_is_noop(self, vectordb):
        vectordb.add([_make_record()])
        # Should not raise
        vectordb.delete("source_id = 'nonexistent'")
        results = vectordb.search([1.0, 0.0, 0.0, 0.0], limit=10)
        assert len(results) == 1


class TestVectorStoreFilterQueries:
    def test_get_by_filter_returns_sorted_rows_and_selected_columns(self, vectordb):
        vectordb.add(
            [
                {
                    **_make_record(source_id="s-filter", text="chunk two"),
                    "chunk_index": 2,
                },
                {
                    **_make_record(source_id="s-filter", text="chunk zero"),
                    "chunk_index": 0,
                },
                {
                    **_make_record(source_id="s-filter", text="chunk one"),
                    "chunk_index": 1,
                },
            ]
        )

        rows = vectordb.get_by_filter(
            "source_id = 's-filter'",
            columns=["chunk_index", "chunk_text"],
            limit=20,
        )
        assert [row["chunk_index"] for row in rows] == [0, 1, 2]
        assert all("vector" not in row for row in rows)
        assert [row["chunk_text"] for row in rows] == ["chunk zero", "chunk one", "chunk two"]

    def test_get_by_filter_requires_non_empty_filter(self, vectordb):
        with pytest.raises(VectorStoreError):
            vectordb.get_by_filter("")

    def test_get_by_filter_supports_offset_pagination(self, vectordb):
        vectordb.add(
            [
                {**_make_record(source_id="s-page", text="chunk zero"), "chunk_index": 0},
                {**_make_record(source_id="s-page", text="chunk one"), "chunk_index": 1},
                {**_make_record(source_id="s-page", text="chunk two"), "chunk_index": 2},
            ]
        )

        rows = vectordb.get_by_filter(
            "source_id = 's-page'",
            columns=["chunk_index", "chunk_text"],
            limit=2,
            offset=1,
        )
        assert [row["chunk_index"] for row in rows] == [1, 2]

    def test_get_distinct_column_paginates_without_hard_cap(self, vectordb, monkeypatch):
        from app.core import vectordb as vectordb_module

        monkeypatch.setattr(vectordb_module, "_DISTINCT_SCAN_PAGE_SIZE", 2)
        vectordb.add(
            [
                _make_record(project_id="p1", source_id="s1"),
                _make_record(project_id="p2", source_id="s2"),
                _make_record(project_id="p3", source_id="s3"),
                _make_record(project_id="p4", source_id="s4"),
                _make_record(project_id="p5", source_id="s5"),
            ]
        )

        values = set(vectordb.get_distinct_column("project_id"))
        assert values == {"p1", "p2", "p3", "p4", "p5"}

    def test_get_by_filter_handles_deep_offsets_for_large_sources(self, vectordb):
        records = []
        for idx in range(300):
            rec = _make_record(source_id="s-large", text=f"chunk-{idx}")
            rec["chunk_index"] = idx
            records.append(rec)
        vectordb.add(records)

        rows = vectordb.get_by_filter(
            "source_id = 's-large'",
            columns=["chunk_index", "chunk_text"],
            limit=5,
            offset=250,
        )
        assert [row["chunk_index"] for row in rows] == [250, 251, 252, 253, 254]
        assert [row["chunk_text"] for row in rows] == [
            "chunk-250",
            "chunk-251",
            "chunk-252",
            "chunk-253",
            "chunk-254",
        ]


class TestVectorStoreTableCreation:
    def test_table_created_on_init(self, tmp_path):
        vs = VectorStore(str(tmp_path / "v"), vector_dim=4)
        assert "chunks" in _table_names(vs)

    def test_existing_table_not_recreated(self, tmp_path):
        db_path = str(tmp_path / "v")
        vs1 = VectorStore(db_path, vector_dim=4)
        vs1.add([_make_record()])

        # Create second instance pointing at same path — should not wipe data
        vs2 = VectorStore(db_path, vector_dim=4)
        results = vs2.search([1.0, 0.0, 0.0, 0.0])
        assert len(results) == 1


class TestVectorStoreResetTable:
    def test_reset_table_wipes_all_data(self, vectordb):
        vectordb.add([_make_record(text="before reset")])
        assert len(vectordb.search([1.0, 0.0, 0.0, 0.0])) == 1

        vectordb.reset_table()

        results = vectordb.search([1.0, 0.0, 0.0, 0.0])
        assert results == []

    def test_reset_table_allows_new_inserts(self, vectordb):
        vectordb.add([_make_record(text="original")])
        vectordb.reset_table()

        vectordb.add([_make_record(text="after reset")])
        results = vectordb.search([1.0, 0.0, 0.0, 0.0])
        assert len(results) == 1
        assert results[0]["chunk_text"] == "after reset"

    def test_reset_table_clears_index_flag(self, vectordb):
        vectordb._index_created = True
        vectordb.reset_table()
        assert vectordb._index_created is False

    def test_reset_table_preserves_table_name(self, vectordb):
        vectordb.reset_table()
        assert "chunks" in _table_names(vectordb)


class TestVectorStoreIndexStrategy:
    def test_sub_vectors_for_384_dim(self):
        """384-dim uses aggressive quantization: 384 // 2 = 192, capped to 96."""
        vs = VectorStore.__new__(VectorStore)
        vs.vector_dim = 384
        assert vs._compute_ivfpq_sub_vectors() == 96

    def test_sub_vectors_for_768_dim(self):
        """768-dim uses lighter quantization: 768 // 8 = 96."""
        vs = VectorStore.__new__(VectorStore)
        vs.vector_dim = 768
        assert vs._compute_ivfpq_sub_vectors() == 96

    def test_sub_vectors_for_256_dim(self):
        """256-dim uses aggressive quantization: 256 // 2 = 128, capped to 96."""
        vs = VectorStore.__new__(VectorStore)
        vs.vector_dim = 256
        assert vs._compute_ivfpq_sub_vectors() == 96

    def test_sub_vectors_for_small_dim(self):
        """Small dimensions should use dim // 2."""
        vs = VectorStore.__new__(VectorStore)
        vs.vector_dim = 64
        assert vs._compute_ivfpq_sub_vectors() == 32

    def test_sub_vectors_for_2560_dim(self):
        """2560-dim: 2560 // 8 = 320, capped to 96."""
        vs = VectorStore.__new__(VectorStore)
        vs.vector_dim = 2560
        assert vs._compute_ivfpq_sub_vectors() == 96

    def test_index_threshold_is_5000(self, vectordb):
        """Index creation should not trigger below 5000 rows."""
        vectordb.add([_make_record()])
        assert vectordb._index_created is False


class TestVectorStoreErrorWrapping:
    def test_search_wraps_open_table_errors(self, vectordb, monkeypatch):
        def _raise():
            raise RuntimeError("db unavailable")

        monkeypatch.setattr(vectordb, "_open_table", _raise)

        with pytest.raises(VectorStoreError) as exc_info:
            vectordb.search([1.0, 0.0, 0.0, 0.0], limit=3)

        assert exc_info.value.operation == "search"
        assert "Failed to search with limit=3" in str(exc_info.value)

    def test_get_by_filter_wraps_open_table_errors(self, vectordb, monkeypatch):
        def _raise():
            raise RuntimeError("db unavailable")

        monkeypatch.setattr(vectordb, "_open_table", _raise)

        with pytest.raises(VectorStoreError) as exc_info:
            vectordb.get_by_filter("source_id = 's1'")

        assert exc_info.value.operation == "get_by_filter"
        assert "source_id = 's1'" in str(exc_info.value)
