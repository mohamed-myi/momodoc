import pytest

from app.services.retrieval_scoring import (
    extract_common_retrieval_fields,
    extract_retrieval_score,
)


class TestExtractRetrievalScore:
    def test_hybrid_uses_relevance_score_when_present(self):
        row = {"_relevance_score": 0.7, "_distance": 0.25}
        assert extract_retrieval_score(row, "hybrid") == pytest.approx(0.7)

    def test_hybrid_falls_back_to_distance_only_rows(self):
        row = {"_distance": 0.25}
        assert extract_retrieval_score(row, "hybrid") == pytest.approx(0.8)

    def test_keyword_uses_score_field(self):
        row = {"_score": 5.0}
        assert extract_retrieval_score(row, "keyword") == pytest.approx(5.0 / 6.0)

    def test_missing_score_default_is_configurable(self):
        assert extract_retrieval_score({}, "hybrid", missing_score_default=1.0) == 1.0


class TestExtractCommonRetrievalFields:
    def test_common_fields_normalize_empty_strings_and_defaults(self):
        row = {
            "source_type": "note",
            "source_id": "n1",
            "filename": "",
            "original_path": "",
            "chunk_text": "hello",
        }
        assert extract_common_retrieval_fields(row) == {
            "source_type": "note",
            "source_id": "n1",
            "filename": None,
            "original_path": None,
            "chunk_text": "hello",
            "chunk_index": 0,
            "section_header": "",
        }

    def test_section_header_extracted_when_present(self):
        row = {
            "source_type": "file",
            "source_id": "f1",
            "filename": "readme.md",
            "original_path": "/tmp/readme.md",
            "chunk_text": "content",
            "chunk_index": 0,
            "section_header": "Intro > Details",
        }
        fields = extract_common_retrieval_fields(row)
        assert fields["section_header"] == "Intro > Details"

    def test_missing_section_header_defaults_to_empty(self):
        row = {
            "source_type": "file",
            "source_id": "f1",
            "chunk_text": "content",
        }
        fields = extract_common_retrieval_fields(row)
        assert fields["section_header"] == ""
