"""WebSocket endpoint for real-time sync progress events.

Authentication is handled via a ``token`` query parameter instead of the
``X-Momodoc-Token`` header (browsers cannot send custom headers on WS
handshakes). The middleware excludes ``/ws`` so auth is validated here.
"""

import hmac
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()
logger = logging.getLogger(__name__)


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    # Validate token from query parameter
    token = ws.query_params.get("token")
    expected = getattr(ws.app.state, "session_token", None)

    if expected is None or token is None or not hmac.compare_digest(token, expected):
        await ws.close(code=4001, reason="Invalid or missing session token")
        return

    manager = getattr(ws.app.state, "ws_manager", None)
    if manager is None:
        await ws.close(code=4002, reason="WebSocket manager not available")
        return

    await manager.connect(ws)
    try:
        while True:
            # Keep the connection alive; receive messages for keepalive pings
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.debug("WebSocket connection failed unexpectedly", exc_info=True)
    finally:
        await manager.disconnect(ws)
