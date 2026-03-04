"""Public directory traversal helpers for ingestion/sync workflows."""

from collections.abc import Iterator
import os


def iter_directory_paths(
    directory_path: str,
    *,
    supported_extensions: set[str],
    ignore_dirs: set[str],
) -> Iterator[str]:
    """Yield supported, non-hidden files under `directory_path`."""
    for root, dirs, files in os.walk(directory_path):
        dirs[:] = [
            d for d in dirs
            if d not in ignore_dirs
            and not d.endswith(".egg-info")
        ]
        for fname in files:
            if fname.startswith("."):
                continue
            _, ext = os.path.splitext(fname)
            if ext.lower() not in supported_extensions:
                continue
            yield os.path.join(root, fname)


def next_directory_batch(path_iterator: Iterator[str], batch_size: int) -> list[str]:
    """Consume up to `batch_size` paths from an iterator."""
    batch: list[str] = []
    for _ in range(batch_size):
        try:
            batch.append(next(path_iterator))
        except StopIteration:
            break
    return batch
