"""WebSocket connection manager for broadcasting real-time events."""

import asyncio
import logging

from fastapi import WebSocket

logger = logging.getLogger(__name__)
_SEND_TIMEOUT_SECONDS = 5.0


class WSManager:
    def __init__(self) -> None:
        self._connections: set[WebSocket] = set()
        self._lock = asyncio.Lock()
        self._send_tasks: set[asyncio.Task] = set()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._connections.add(ws)

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            self._connections.discard(ws)

    async def broadcast(self, message: dict) -> None:
        async with self._lock:
            connections = tuple(self._connections)

        if not connections:
            return

        # Fan out sends without awaiting each socket. This prevents a slow
        # client from stalling broadcasts to everyone else.
        for ws in connections:
            task = asyncio.create_task(self._send_and_prune(ws, message))
            self._send_tasks.add(task)
            task.add_done_callback(self._send_tasks.discard)

    async def _send_and_prune(self, ws: WebSocket, message: dict) -> None:
        try:
            await self._send_with_timeout(ws, message)
        except Exception:
            async with self._lock:
                self._connections.discard(ws)

    async def _send_with_timeout(self, ws: WebSocket, message: dict) -> None:
        await asyncio.wait_for(
            ws.send_json(message),
            timeout=_SEND_TIMEOUT_SECONDS,
        )
