"""
ROGAN LIVE - WebSocket Handler
Real-time communication for streams: chat, gifts, viewers, typing.
Uses redis_client for pub/sub across workers.
"""

import html
import json
import logging
import uuid
from datetime import datetime

logger = logging.getLogger(__name__)
from typing import Any, Dict, List, Optional, Set

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status, Query

from app.config import settings
from app.utils.redis_client import redis_client
from app.database import SessionLocal
from app.services.moderation_service import check_stream_banned, check_user_banned

router = APIRouter()


class ConnectionManager:
    """Manages active WebSocket connections per stream."""

    def __init__(self):
        # stream_id -> set of (user_id, websocket) tuples
        self.active_connections: Dict[str, Dict[str, WebSocket]] = {}
        # stream_id -> set of user_ids
        self.stream_viewers: Dict[str, Set[str]] = {}

    async def connect(self, websocket: WebSocket, stream_id: str, user_id: str):
        """Accept and register a WebSocket connection."""
        await websocket.accept()

        if stream_id not in self.active_connections:
            self.active_connections[stream_id] = {}
            self.stream_viewers[stream_id] = set()

        self.active_connections[stream_id][user_id] = websocket
        self.stream_viewers[stream_id].add(user_id)

    def disconnect(self, stream_id: str, user_id: str, websocket: Optional[WebSocket] = None):
        """Remove a WebSocket connection.

        Pass `websocket` to guard against the React StrictMode race:
        StrictMode double-invokes effects, causing two WS connections for the
        same user_id in quick succession.  The sequence is:
          1. WS1 connects  → manager stores WS1 for user_id
          2. WS2 connects  → manager replaces WS1 with WS2 for user_id
          3. WS1 closes    → disconnect() is called — but the stored entry is
                             now WS2, not WS1.  Without the guard we'd delete
                             WS2's entry and leave it orphaned (broadcasts stop).
        The guard skips the removal if the stored websocket no longer matches
        the one being disconnected.
        """
        if stream_id not in self.active_connections:
            return

        stored = self.active_connections[stream_id].get(user_id)

        # If a specific websocket is supplied, only remove if it's still current.
        if websocket is not None and stored is not websocket:
            return  # a newer connection has already replaced this one — leave it

        self.active_connections[stream_id].pop(user_id, None)
        self.stream_viewers[stream_id].discard(user_id)

        # Cleanup empty streams
        if not self.active_connections[stream_id]:
            del self.active_connections[stream_id]
            del self.stream_viewers[stream_id]

    async def send_personal(self, message: dict, websocket: WebSocket):
        """Send a message to a specific WebSocket connection."""
        try:
            await websocket.send_json(message)
        except Exception:
            pass

    async def broadcast_to_stream(self, stream_id: str, message: dict):
        """Broadcast a message to all connections in a stream."""
        if stream_id not in self.active_connections:
            return

        disconnected = []
        for user_id, websocket in self.active_connections[stream_id].items():
            try:
                await websocket.send_json(message)
            except Exception:
                disconnected.append(user_id)

        # Clean up disconnected clients
        for user_id in disconnected:
            self.disconnect(stream_id, user_id)

    def get_viewer_count(self, stream_id: str) -> int:
        """Get the number of active viewers for a stream."""
        return len(self.stream_viewers.get(stream_id, set()))

    def get_stream_users(self, stream_id: str) -> Set[str]:
        """Get the set of user_ids in a stream."""
        return self.stream_viewers.get(stream_id, set())


# Singleton connection manager
manager = ConnectionManager()


def _publish_event(stream_id: str, event_type: str, data: dict):
    """Publish an event to Redis for cross-worker distribution."""
    event = {
        "stream_id": stream_id,
        "type": event_type,
        "data": data,
        "timestamp": datetime.utcnow().isoformat(),
    }
    try:
        redis_client.publish(f"stream:{stream_id}", json.dumps(event))
    except Exception:
        pass  # Non-critical — local broadcast still works


def _sanitize_text(text: str) -> str:
    """Strip/sanitize HTML from user-supplied text to prevent XSS."""
    if not text:
        return text
    # Escape all HTML entities
    return html.escape(text, quote=True)


def _verify_ws_token(token: str) -> Optional[dict]:
    """Verify a JWT token for WebSocket authentication.
    Returns the decoded payload or None if invalid.
    """
    try:
        from jose import jwt, JWTError
        payload = jwt.decode(
            token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM]
        )
        user_id: Optional[str] = payload.get("user_id")
        if user_id is None:
            return None
        return payload
    except Exception:
        return None


async def handle_chat_message(
    stream_id: str, user_id: str, data: dict
):
    """Handle a chat message event. Content is sanitized against XSS."""
    raw_content = data.get("content", "")
    sanitized_content = _sanitize_text(raw_content)

    # Enforce bans: global ban check + stream-ban check
    try:
        db = SessionLocal()
        try:
            # Global ban — silently drop the message
            if check_user_banned(db, user_id):
                return
            # Stream-ban — look up creator of this stream and check
            from app.models.models import Stream
            stream = db.query(Stream).filter(Stream.id == stream_id).first()
            if stream and stream.creator_id != user_id:
                if check_stream_banned(db, stream.creator_id, user_id):
                    await manager.send_personal(
                        {"type": "error", "message": "You are banned from this stream's chat."},
                        manager.active_connections.get(stream_id, {}).get(user_id),
                    )
                    return
        finally:
            db.close()
    except Exception as e:
        logger.warning(f"Ban check failed for user {user_id}: {e}")

    role = data.get("role", "user")
    # Moderators display as "System" in chat with MOD badge
    display_username = "System" if role == "moderator" else _sanitize_text(data.get("username", "Anonymous"))
    message = {
        "id": str(uuid.uuid4()),
        "type": "chat_message",
        "stream_id": stream_id,
        "user_id": user_id,
        "username": display_username,
        "role": role,
        "content": sanitized_content,
        "timestamp": datetime.utcnow().isoformat(),
    }
    _publish_event(stream_id, "chat_message", message)
    await manager.broadcast_to_stream(stream_id, message)

    # Persist to Redis so rejoining viewers get history.
    # Key: chat_history:{stream_id}  — list of JSON strings, newest at tail.
    # Keep last 200 messages; expire after 24 h (covers any realistic show length).
    try:
        hist_key = f"chat_history:{stream_id}"
        redis_client.rpush(hist_key, json.dumps(message))
        redis_client.ltrim(hist_key, -200, -1)
        redis_client.expire(hist_key, 86400)
    except Exception as e:
        logger.warning(f"Failed to persist chat message to Redis: {e}")


async def handle_gift_sent(
    stream_id: str, user_id: str, data: dict
):
    """Handle a gift sent event."""
    message = {
        "type": "gift_sent",
        "stream_id": stream_id,
        "user_id": user_id,
        "username": _sanitize_text(data.get("username", "Anonymous")),
        "gift_type": data.get("gift_type", ""),
        "amount": data.get("amount", 0),
        "message": _sanitize_text(data.get("message", "")),
        "timestamp": datetime.utcnow().isoformat(),
    }
    _publish_event(stream_id, "gift_sent", message)
    await manager.broadcast_to_stream(stream_id, message)


async def handle_viewer_join(stream_id: str, user_id: str, data: dict):
    """Handle a viewer joining the stream. Updates DB viewer count."""
    message = {
        "type": "viewer_join",
        "stream_id": stream_id,
        "user_id": user_id,
        "username": _sanitize_text(data.get("username", "Anonymous")),
        "viewer_count": manager.get_viewer_count(stream_id),
        "timestamp": datetime.utcnow().isoformat(),
    }
    _publish_event(stream_id, "viewer_join", message)
    await manager.broadcast_to_stream(stream_id, message)

    # Sync viewer count with database
    _sync_viewer_count_to_db(stream_id)


async def handle_viewer_leave(stream_id: str, user_id: str, data: dict):
    """Handle a viewer leaving the stream. Updates DB viewer count."""
    message = {
        "type": "viewer_leave",
        "stream_id": stream_id,
        "user_id": user_id,
        "username": _sanitize_text(data.get("username", "Anonymous")),
        "viewer_count": manager.get_viewer_count(stream_id),
        "timestamp": datetime.utcnow().isoformat(),
    }
    _publish_event(stream_id, "viewer_leave", message)
    await manager.broadcast_to_stream(stream_id, message)

    # Sync viewer count with database
    _sync_viewer_count_to_db(stream_id)


async def handle_typing(stream_id: str, user_id: str, data: dict):
    """Handle a typing indicator event."""
    message = {
        "type": "typing",
        "stream_id": stream_id,
        "user_id": user_id,
        "username": _sanitize_text(data.get("username", "Anonymous")),
        "timestamp": datetime.utcnow().isoformat(),
    }
    await manager.broadcast_to_stream(stream_id, message)


def _sync_viewer_count_to_db(stream_id: str):
    """Sync the in-memory viewer count to the database."""
    try:
        from app.database import SessionLocal
        from app.models.models import Stream

        db = SessionLocal()
        try:
            stream = db.query(Stream).filter(Stream.id == stream_id).first()
            if stream:
                stream.viewer_count = manager.get_viewer_count(stream_id)
                db.commit()
        finally:
            db.close()
    except Exception:
        pass  # Non-critical — viewer count will be corrected on next event


# Event handler mapping
EVENT_HANDLERS = {
    "chat_message": handle_chat_message,
    "gift_sent": handle_gift_sent,
    "viewer_join": handle_viewer_join,
    "viewer_leave": handle_viewer_leave,
    "typing": handle_typing,
}


async def websocket_endpoint(websocket: WebSocket, stream_id: str, user_id: str, token: str = Query(None)):
    """Main WebSocket endpoint handler for a stream.
    Requires a valid JWT token as a query parameter for authentication.
    """
    # Verify JWT token before accepting connection
    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Missing authentication token")
        return

    payload = _verify_ws_token(token)
    if not payload:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid or expired token")
        return

    # Verify the token's user_id matches the requested user_id
    token_user_id = payload.get("user_id")
    if token_user_id != user_id:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Token user_id mismatch")
        return

    # Check for global ban before allowing connection
    try:
        _db = SessionLocal()
        try:
            ban_info = check_user_banned(_db, user_id)
            if ban_info and ban_info.get("ban_type") == "full_ban":
                await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Account banned")
                return
        finally:
            _db.close()
    except Exception as e:
        logger.warning(f"Pre-connect ban check failed: {e}")

    await manager.connect(websocket, stream_id, user_id)

    # Use the username from the verified JWT payload (not raw user_id)
    display_name = payload.get("username") or user_id

    try:
        # Notify others of join
        await handle_viewer_join(
            stream_id, user_id, {"username": display_name}
        )

        # Send current viewer count to the new connection
        await manager.send_personal(
            {
                "type": "connected",
                "stream_id": stream_id,
                "viewer_count": manager.get_viewer_count(stream_id),
            },
            websocket,
        )

        # Message loop
        while True:
            raw_data = await websocket.receive_text()
            try:
                data = json.loads(raw_data)
            except json.JSONDecodeError:
                await manager.send_personal(
                    {"type": "error", "message": "Invalid JSON"}, websocket
                )
                continue

            event_type = data.get("type")
            handler = EVENT_HANDLERS.get(event_type)

            if handler:
                await handler(stream_id, user_id, data)
            else:
                await manager.send_personal(
                    {
                        "type": "error",
                        "message": f"Unknown event type: {event_type}",
                    },
                    websocket,
                )

    except WebSocketDisconnect:
        manager.disconnect(stream_id, user_id, websocket)
        await handle_viewer_leave(stream_id, user_id, {"username": display_name})
    except Exception as e:
        logger.error(f"WebSocket error for user {user_id} in stream {stream_id}: {e}")
        manager.disconnect(stream_id, user_id, websocket)
