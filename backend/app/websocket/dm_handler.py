"""
ROGAN LIVE - DM WebSocket Handler
Real-time typing indicators for direct message conversations.
Endpoint: /ws/dm/{conversation_id}/{user_id}?token=...
"""

import json
from datetime import datetime
from typing import Dict

from fastapi import WebSocket, WebSocketDisconnect, Query

from app.websocket.handler import _verify_ws_token


class DMConnectionManager:
    """Manages active WebSocket connections per DM conversation."""

    def __init__(self):
        # conversation_id -> {user_id -> websocket}
        self.connections: Dict[str, Dict[str, WebSocket]] = {}

    async def connect(self, websocket: WebSocket, conversation_id: str, user_id: str):
        await websocket.accept()
        if conversation_id not in self.connections:
            self.connections[conversation_id] = {}
        self.connections[conversation_id][user_id] = websocket

    def disconnect(self, conversation_id: str, user_id: str):
        if conversation_id in self.connections:
            self.connections[conversation_id].pop(user_id, None)
            if not self.connections[conversation_id]:
                del self.connections[conversation_id]

    async def broadcast_to_others(self, conversation_id: str, sender_id: str, message: dict):
        """Broadcast to all participants in a conversation except the sender."""
        if conversation_id not in self.connections:
            return
        dead = []
        for uid, ws in list(self.connections[conversation_id].items()):
            if uid == sender_id:
                continue
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(uid)
        for uid in dead:
            self.disconnect(conversation_id, uid)


dm_manager = DMConnectionManager()


class UserConnectionManager:
    """Per-user WebSocket for global notifications (new DM alerts, etc.)."""

    def __init__(self):
        self.connections: Dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket, user_id: str):
        await websocket.accept()
        self.connections[user_id] = websocket

    def disconnect(self, user_id: str):
        self.connections.pop(user_id, None)

    async def send_to_user(self, user_id: str, message: dict):
        ws = self.connections.get(user_id)
        if not ws:
            return
        try:
            await ws.send_json(message)
        except Exception:
            self.disconnect(user_id)


user_manager = UserConnectionManager()


async def user_websocket_endpoint(
    websocket: WebSocket,
    user_id: str,
    token: str = None,
):
    """User-level WS for real-time notifications. Connects once per logged-in session."""
    payload = _verify_ws_token(token)
    if not payload:
        await websocket.accept()
        await websocket.close(code=4001, reason="Unauthorized")
        return

    jwt_user_id = payload.get("sub") or payload.get("user_id") or user_id
    await user_manager.connect(websocket, jwt_user_id)
    try:
        await websocket.send_json({"type": "connected"})
        while True:
            # Keep alive — client sends pings, server echoes pong
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
                if data.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        user_manager.disconnect(jwt_user_id)
    except Exception:
        user_manager.disconnect(jwt_user_id)


async def dm_websocket_endpoint(
    websocket: WebSocket,
    conversation_id: str,
    user_id: str,
    token: str = None,
):
    """DM WebSocket endpoint. Handles typing / stop_typing events."""
    payload = _verify_ws_token(token)
    if not payload:
        # Must accept() before close() — Starlette requires the upgrade to complete
        # (HTTP 101) before we can send a WebSocket close frame. Calling close()
        # without accept() sends an HTTP 403 instead, which the browser reports as
        # "WebSocket is closed before the connection is established."
        await websocket.accept()
        await websocket.close(code=4001, reason="Unauthorized")
        return

    # Resolve user identity from JWT (same pattern as stream handler)
    jwt_user_id = payload.get("sub") or payload.get("user_id") or user_id
    username = payload.get("username") or payload.get("email") or "User"

    await dm_manager.connect(websocket, conversation_id, jwt_user_id)

    try:
        await websocket.send_json({"type": "connected", "conversation_id": conversation_id})

        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue

            event_type = data.get("type")

            if event_type == "typing":
                await dm_manager.broadcast_to_others(conversation_id, jwt_user_id, {
                    "type": "typing",
                    "user_id": jwt_user_id,
                    "username": username,
                    "conversation_id": conversation_id,
                    "timestamp": datetime.utcnow().isoformat(),
                })

            elif event_type == "stop_typing":
                await dm_manager.broadcast_to_others(conversation_id, jwt_user_id, {
                    "type": "stop_typing",
                    "user_id": jwt_user_id,
                    "conversation_id": conversation_id,
                })

            elif event_type and (
                event_type.startswith("call_") or event_type == "photo_data"
            ):
                # Relay WebRTC call signaling events and P2P photo transfers to the
                # other participant. The backend is a pure relay — nothing is persisted.
                await dm_manager.broadcast_to_others(conversation_id, jwt_user_id, {
                    **data,
                    "from_user_id": jwt_user_id,
                })

    except WebSocketDisconnect:
        dm_manager.disconnect(conversation_id, jwt_user_id)
    except Exception:
        dm_manager.disconnect(conversation_id, jwt_user_id)
