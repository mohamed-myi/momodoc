"""Async boundary for synchronous LanceDB operations.

This wrapper provides:
1. A dedicated executor for vector DB operations (no shared default thread pool).
2. Bounded read concurrency.
3. Writer-exclusive access to avoid read/write races on shared LanceDB state.
"""

import asyncio
import functools
import threading
from collections.abc import AsyncIterator, Callable
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from typing import TypeVar

from app.core.exceptions import VectorStoreError
from app.core.vectordb import VectorStore

T = TypeVar("T")


class _AsyncRWLock:
    """Reader-writer lock with writer preference."""

    def __init__(self) -> None:
        self._condition = asyncio.Condition()
        self._active_readers = 0
        self._active_writer = False
        self._waiting_writers = 0

    @asynccontextmanager
    async def read(self) -> AsyncIterator[None]:
        async with self._condition:
            while self._active_writer or self._waiting_writers > 0:
                await self._condition.wait()
            self._active_readers += 1
        try:
            yield
        finally:
            async with self._condition:
                self._active_readers -= 1
                if self._active_readers == 0:
                    self._condition.notify_all()

    @asynccontextmanager
    async def write(self) -> AsyncIterator[None]:
        async with self._condition:
            self._waiting_writers += 1
            try:
                while self._active_writer or self._active_readers > 0:
                    await self._condition.wait()
                self._active_writer = True
            finally:
                self._waiting_writers -= 1
        try:
            yield
        finally:
            async with self._condition:
                self._active_writer = False
                self._condition.notify_all()


class AsyncVectorStore:
    """Async adapter around :class:`VectorStore` with explicit concurrency control."""

    def __init__(
        self,
        store: VectorStore,
        *,
        max_workers: int = 4,
        max_read_concurrency: int = 8,
    ) -> None:
        if max_workers < 1:
            raise ValueError("max_workers must be >= 1")
        if max_read_concurrency < 1:
            raise ValueError("max_read_concurrency must be >= 1")

        self._store = store
        self._executor = ThreadPoolExecutor(
            max_workers=max_workers,
            thread_name_prefix="momodoc-vectordb",
        )
        self._read_semaphore = asyncio.Semaphore(max_read_concurrency)
        self._rw_lock = _AsyncRWLock()
        self._shutdown_lock = threading.Lock()
        self._is_shutdown = False

    @property
    def is_shutdown(self) -> bool:
        return self._is_shutdown

    @staticmethod
    def filter_by_project(project_id: str) -> str:
        return VectorStore.filter_by_project(project_id)

    @staticmethod
    def filter_by_source(source_id: str) -> str:
        return VectorStore.filter_by_source(source_id)

    def shutdown(self, wait: bool = True) -> None:
        with self._shutdown_lock:
            if self._is_shutdown:
                return
            self._is_shutdown = True
            executor = self._executor
        executor.shutdown(wait=wait)

    async def _run(self, fn: Callable[..., T], *args, **kwargs) -> T:
        if self._is_shutdown:
            raise VectorStoreError(
                "Vector store is unavailable during shutdown",
                operation="unavailable",
            )

        loop = asyncio.get_running_loop()
        call = functools.partial(fn, *args, **kwargs)
        try:
            return await loop.run_in_executor(self._executor, call)
        except RuntimeError as e:
            if "cannot schedule new futures after shutdown" in str(e):
                raise VectorStoreError(
                    "Vector store is unavailable during shutdown",
                    operation="unavailable",
                ) from e
            raise

    async def reset_table(self) -> None:
        """Drop and recreate the chunks table (used during embedding migration)."""
        async with self._rw_lock.write():
            await self._run(self._store.reset_table)

    async def add(self, records: list[dict]) -> None:
        async with self._rw_lock.write():
            await self._run(self._store.add, records)

    async def search(
        self,
        query_vector: list[float],
        filter_str: str | None = None,
        limit: int = 10,
    ) -> list[dict]:
        async with self._read_semaphore:
            async with self._rw_lock.read():
                return await self._run(self._store.search, query_vector, filter_str, limit)

    async def create_fts_index(self) -> None:
        async with self._rw_lock.write():
            await self._run(self._store.create_fts_index)

    async def hybrid_search(
        self,
        query_vector: list[float],
        query_text: str,
        filter_str: str | None = None,
        limit: int = 10,
    ) -> list[dict]:
        async with self._read_semaphore:
            async with self._rw_lock.read():
                return await self._run(
                    self._store.hybrid_search, query_vector, query_text, filter_str, limit
                )

    async def fts_search(
        self,
        query_text: str,
        filter_str: str | None = None,
        limit: int = 10,
    ) -> list[dict]:
        async with self._read_semaphore:
            async with self._rw_lock.read():
                return await self._run(self._store.fts_search, query_text, filter_str, limit)

    async def get_by_filter(
        self,
        filter_str: str,
        columns: list[str] | None = None,
        limit: int = 1000,
        offset: int = 0,
    ) -> list[dict]:
        async with self._read_semaphore:
            async with self._rw_lock.read():
                return await self._run(
                    self._store.get_by_filter, filter_str, columns, limit, offset
                )

    async def get_distinct_column(self, column: str) -> list[str]:
        async with self._read_semaphore:
            async with self._rw_lock.read():
                return await self._run(self._store.get_distinct_column, column)

    async def delete(self, filter_str: str) -> None:
        async with self._rw_lock.write():
            await self._run(self._store.delete, filter_str)

    async def delete_by_ids(self, ids: list[str], batch_size: int = 500) -> None:
        async with self._rw_lock.write():
            await self._run(self._store.delete_by_ids, ids, batch_size)
