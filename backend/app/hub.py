"""Single-process WebSocket broadcaster.

A future multi-worker deployment should replace this with Redis/pub-sub.
For this local engineering demo, a single Uvicorn worker is intentional.
"""
from __future__ import annotations

import asyncio
from collections import defaultdict
from fastapi import WebSocket


class TelemetryHub:
    def __init__(self):
        self._listeners: dict[str, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def connect(self, session_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._listeners[session_id].add(websocket)

    async def disconnect(self, session_id: str, websocket: WebSocket) -> None:
        async with self._lock:
            self._listeners[session_id].discard(websocket)
            if not self._listeners[session_id]:
                self._listeners.pop(session_id, None)

    async def broadcast(self, session_id: str, event: dict) -> None:
        # Snapshot avoids holding the lock while talking to clients.
        async with self._lock:
            listeners = list(self._listeners.get(session_id, ()))
        disconnected = []
        for websocket in listeners:
            try:
                await websocket.send_json(event)
            except Exception:  # A failed socket should not abort another client's notification
                disconnected.append(websocket)
        for websocket in disconnected:
            await self.disconnect(session_id, websocket)
