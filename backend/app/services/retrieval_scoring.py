"""Shared row-mapping and score-normalization helpers for retrieval outputs."""

from collections.abc import Mapping


def clamp_unit_interval(value: float) -> float:
    """Clamp a numeric value to [0.0, 1.0]."""
    return max(0.0, min(1.0, value))


def distance_to_similarity(distance: float) -> float:
    """Map vector distance to a stable similarity score in (0, 1].

    Uses 1 / (1 + d) to preserve rank ordering without collapsing
    distances > 1.0 to zero.
    """
    safe_distance = max(0.0, distance)
    return 1.0 / (1.0 + safe_distance)


def keyword_score_to_similarity(raw_score: float) -> float:
    """Map unbounded keyword relevance scores into [0, 1)."""
    safe_score = max(0.0, raw_score)
    return safe_score / (1.0 + safe_score)


def _row_number(row: Mapping[str, object], key: str) -> float | None:
    value = row.get(key)
    if isinstance(value, (int, float)):
        return float(value)
    return None


def extract_retrieval_score(
    row: Mapping[str, object],
    mode: str,
    *,
    missing_score_default: float = 0.0,
) -> float:
    """Extract a normalized 0-1 score from LanceDB result rows.

    ``mode`` supports ``vector``, ``hybrid``, and ``keyword``. Unknown modes
    fall back to keyword-score handling to preserve existing search-service
    behavior for unexpected inputs.
    """
    if mode == "vector":
        distance = _row_number(row, "_distance")
        return distance_to_similarity(distance) if distance is not None else missing_score_default

    if mode == "hybrid":
        relevance = _row_number(row, "_relevance_score")
        if relevance is not None:
            return clamp_unit_interval(relevance)
        distance = _row_number(row, "_distance")
        return distance_to_similarity(distance) if distance is not None else missing_score_default

    raw_score = _row_number(row, "_score")
    return (
        keyword_score_to_similarity(raw_score) if raw_score is not None else missing_score_default
    )


def extract_common_retrieval_fields(row: Mapping[str, object]) -> dict[str, object]:
    """Extract shared search/chat fields from a LanceDB result row."""
    return {
        "source_type": row.get("source_type", ""),
        "source_id": row.get("source_id", ""),
        "filename": row.get("filename") or None,
        "original_path": row.get("original_path") or None,
        "chunk_text": row.get("chunk_text", ""),
        "chunk_index": row.get("chunk_index", 0),
        "section_header": row.get("section_header", ""),
    }
