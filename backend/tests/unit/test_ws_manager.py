"""Tests for WebSocket connection manager concurrency behavior."""

import asyncio
import time

import pytest

from app.core.ws_manager import WSManager


class _FakeWebSocket:
    def __init__(self, delay: float = 0.0, fail: bool = False) -> None:
        self.delay = delay
        self.fail = fail
        self.accepted = False
        self.messages: list[dict] = []
        self.last_send_at: float | None = None

    async def accept(self) -> None:
        self.accepted = True

    async def send_json(self, message: dict) -> None:
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.fail:
            raise RuntimeError("send failed")
        self.messages.append(message)
        self.last_send_at = time.monotonic()


@pytest.mark.asyncio
async def test_connect_disconnect_are_set_based():
    manager = WSManager()
    ws = _FakeWebSocket()

    await manager.connect(ws)
    await manager.connect(ws)  # duplicate should not create duplicate entries
    assert len(manager._connections) == 1

    await manager.disconnect(ws)
    assert ws not in manager._connections


@pytest.mark.asyncio
async def test_broadcast_does_not_block_fast_clients_on_slow_client():
    manager = WSManager()
    slow = _FakeWebSocket(delay=0.2)
    fast = _FakeWebSocket()

    # Add slow first to prove we are not relying on list ordering.
    await manager.connect(slow)
    await manager.connect(fast)

    start = time.monotonic()
    await manager.broadcast({"type": "sync_progress"})
    broadcast_elapsed = time.monotonic() - start
    await asyncio.sleep(0.25)

    assert fast.last_send_at is not None
    assert slow.last_send_at is not None
    assert fast.last_send_at - start < 0.1
    assert slow.last_send_at - start >= 0.2
    assert broadcast_elapsed < 0.1


@pytest.mark.asyncio
async def test_broadcast_removes_dead_connections():
    manager = WSManager()
    alive = _FakeWebSocket()
    dead = _FakeWebSocket(fail=True)

    await manager.connect(alive)
    await manager.connect(dead)

    await manager.broadcast({"type": "sync_progress"})
    await asyncio.sleep(0.05)

    assert alive in manager._connections
    assert dead not in manager._connections


@pytest.mark.asyncio
async def test_concurrent_broadcast_and_disconnect_is_safe():
    manager = WSManager()
    clients = [_FakeWebSocket() for _ in range(30)]

    await asyncio.gather(*(manager.connect(client) for client in clients))
    await asyncio.gather(
        manager.broadcast({"type": "sync_progress"}),
        manager.broadcast({"type": "sync_progress"}),
        *(manager.disconnect(client) for client in clients[:10]),
    )
    await asyncio.sleep(0.05)

    assert all(client not in manager._connections for client in clients[:10])
