"""Tests for ingestion directory walk filtering behavior."""

from unittest.mock import MagicMock

from app.services.ingestion.directory_walk import iter_directory_paths, next_directory_batch
from app.services.ingestion.pipeline import IngestionPipeline


def _pipeline_for_walk() -> IngestionPipeline:
    return IngestionPipeline(
        db=MagicMock(),
        vectordb=MagicMock(),
        embedder=MagicMock(),
        settings=None,
    )


def test_walk_directory_includes_supported_files_under_hidden_directories(tmp_path):
    hidden_dir = tmp_path / ".hidden-dir"
    hidden_dir.mkdir()
    important = hidden_dir / "important.py"
    important.write_text("print('ok')", encoding="utf-8")

    pipeline = _pipeline_for_walk()
    paths = pipeline._walk_directory(str(tmp_path))

    assert str(important) in paths


def test_walk_directory_ignores_hidden_files(tmp_path):
    hidden_file = tmp_path / ".hidden.py"
    hidden_file.write_text("print('ok')", encoding="utf-8")
    visible_file = tmp_path / "visible.py"
    visible_file.write_text("print('ok')", encoding="utf-8")

    pipeline = _pipeline_for_walk()
    paths = pipeline._walk_directory(str(tmp_path))

    assert str(hidden_file) not in paths
    assert str(visible_file) in paths


def test_public_directory_walk_helpers_are_usable_directly(tmp_path):
    hidden_file = tmp_path / ".hidden.py"
    hidden_file.write_text("print('skip')", encoding="utf-8")
    visible_file = tmp_path / "visible.py"
    visible_file.write_text("print('ok')", encoding="utf-8")

    iterator = iter_directory_paths(
        str(tmp_path),
        supported_extensions={".py"},
        ignore_dirs=set(),
    )
    batch = next_directory_batch(iterator, batch_size=10)

    assert str(visible_file) in batch
    assert str(hidden_file) not in batch
