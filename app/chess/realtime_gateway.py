from __future__ import annotations

import asyncio
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from fastapi import WebSocket

from app.chess.constants import ChessRealtimeEventType
from app.chess.contracts import ChessRealtimeEnvelope


class ChessRealtimeGateway:
    def __init__(self) -> None:
        self._connections: dict[int, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def connect(self, *, match_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections[match_id].add(websocket)

    async def disconnect(self, *, match_id: int, websocket: WebSocket) -> None:
        async with self._lock:
            sockets = self._connections.get(match_id)
            if sockets is None:
                return
            sockets.discard(websocket)
            if not sockets:
                self._connections.pop(match_id, None)

    async def publish(self, *, match_id: int, event: ChessRealtimeEventType, payload: dict[str, Any]) -> None:
        envelope = ChessRealtimeEnvelope(
            event=event,
            emitted_at=datetime.now(timezone.utc),
            payload=payload,
        ).model_dump(mode="json")
        async with self._lock:
            sockets = tuple(self._connections.get(match_id, set()))
        dead_connections: list[WebSocket] = []
        for socket in sockets:
            try:
                await socket.send_json(envelope)
            except Exception:
                dead_connections.append(socket)
        if dead_connections:
            async with self._lock:
                sockets = self._connections.get(match_id)
                if sockets is not None:
                    for socket in dead_connections:
                        sockets.discard(socket)
                    if not sockets:
                        self._connections.pop(match_id, None)


chess_realtime_gateway = ChessRealtimeGateway()
