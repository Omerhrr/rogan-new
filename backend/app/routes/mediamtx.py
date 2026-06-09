"""
ROGAN LIVE - MediaMTX Webhook Routes
POST /mediamtx/auth — Auth webhook for RTMP ingest (validate stream key)
POST /mediamtx/rtmp-publish — Handle stream start event
POST /mediamtx/rtmp-unpublish — Handle stream end event

These endpoints receive webhooks from MediaMTX server to authenticate
publishers and track stream lifecycle events.
"""

import json
import logging
from datetime import datetime
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.models import Stream, StreamKey, User
from app.schemas import MediaMTXAuthRequest, MediaMTXAuthResponse
from app.utils.redis_client import redis_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/mediamtx", tags=["MediaMTX"])


@router.post("/auth")
def mediamtx_auth(
    req: MediaMTXAuthRequest,
    db: Session = Depends(get_db),
):
    """Auth webhook for RTMP ingest. Validates the stream key from the publish path.

    MediaMTX calls this endpoint when a publisher attempts to connect.
    The stream path should be in the format: rl_{stream_key}
    We extract the key and validate it against the database.
    """
    # Only authenticate publish actions
    if req.action == "publish":
        return _authenticate_publish(db, req)
    elif req.action == "read":
        # Allow all reads (viewers don't need stream keys)
        return MediaMTXAuthResponse(ok=True)
    else:
        # Unknown action — reject
        return MediaMTXAuthResponse(ok=False, error="Unknown action")


@router.post("/rtmp-publish")
async def mediamtx_rtmp_publish(
    request: Request,
    db: Session = Depends(get_db),
):
    """Handle RTMP publish start event from MediaMTX.

    Called when a stream starts publishing. Updates the stream status
    to live and publishes a stream event via Redis PubSub.
    """
    try:
        body = await _parse_event_body(request)
    except Exception:
        body = {}

    path = body.get("path", "")
    logger.info(f"MediaMTX RTMP publish event: path={path}")

    # Find the stream key and update stream status
    key_str = _extract_key_from_path(path)
    if not key_str:
        return {"status": "ignored", "reason": "No valid key in path"}

    stream_key_record = (
        db.query(StreamKey)
        .filter(StreamKey.key == key_str, StreamKey.is_active == True)
        .first()
    )

    if not stream_key_record:
        return {"status": "ignored", "reason": "Stream key not found or inactive"}

    # Find or create the stream record
    stream = _get_or_create_stream(db, stream_key_record.user_id, key_str)
    if stream:
        stream.is_live = True
        stream.ended_at = None
        db.commit()

        # Set creator is_live flag
        creator = db.query(User).filter(User.id == stream_key_record.user_id).first()
        if creator:
            creator.is_live = True
            db.commit()

    # Publish stream start event via Redis
    _publish_stream_event("stream_start", {
        "stream_id": stream.id if stream else None,
        "creator_id": stream_key_record.user_id,
        "stream_key": key_str,
        "path": path,
    })

    return {"status": "ok", "stream_id": stream.id if stream else None}


@router.post("/rtmp-unpublish")
async def mediamtx_rtmp_unpublish(
    request: Request,
    db: Session = Depends(get_db),
):
    """Handle RTMP unpublish (stream end) event from MediaMTX.

    Called when a stream stops publishing. Updates the stream status
    to offline and publishes a stream event via Redis PubSub.
    """
    try:
        body = await _parse_event_body(request)
    except Exception:
        body = {}

    path = body.get("path", "")
    logger.info(f"MediaMTX RTMP unpublish event: path={path}")

    key_str = _extract_key_from_path(path)
    if not key_str:
        return {"status": "ignored", "reason": "No valid key in path"}

    # Find active streams using this key
    stream = (
        db.query(Stream)
        .filter(Stream.stream_key == key_str, Stream.is_live == True)
        .first()
    )

    if stream:
        stream.is_live = False
        stream.ended_at = datetime.utcnow()
        stream.viewer_count = 0
        db.commit()

        # Unset creator is_live flag
        creator = db.query(User).filter(User.id == stream.creator_id).first()
        if creator:
            creator.is_live = False
            db.commit()

    # Publish stream end event via Redis
    _publish_stream_event("stream_end", {
        "stream_id": stream.id if stream else None,
        "creator_id": stream.creator_id if stream else None,
        "stream_key": key_str,
        "path": path,
    })

    return {"status": "ok", "stream_id": stream.id if stream else None}


# ─── Helpers ────────────────────────────────────────────────────────

def _authenticate_publish(db: Session, req: MediaMTXAuthRequest) -> MediaMTXAuthResponse:
    """Authenticate a publish request by validating the stream key in the path.

    Args:
        db: Database session.
        req: The MediaMTX auth request payload.

    Returns:
        MediaMTXAuthResponse indicating success or failure.
    """
    path = req.path or ""
    key_str = _extract_key_from_path(path)

    if not key_str:
        return MediaMTXAuthResponse(ok=False, error="Invalid stream path format")

    # Look up the stream key in the database
    stream_key = (
        db.query(StreamKey)
        .filter(StreamKey.key == key_str, StreamKey.is_active == True)
        .first()
    )

    if not stream_key:
        return MediaMTXAuthResponse(ok=False, error="Invalid or revoked stream key")

    # Update last_used_at
    stream_key.last_used_at = datetime.utcnow()
    db.commit()

    return MediaMTXAuthResponse(ok=True)


def _extract_key_from_path(path: str) -> Optional[str]:
    """Extract the stream key from a MediaMTX path.

    Paths are formatted as: /rl_{stream_key} or rl_{stream_key}
    The stream key itself starts with rl_ and contains 32 hex chars.

    Args:
        path: The stream path string.

    Returns:
        The stream key string or None if the path doesn't match the pattern.
    """
    if not path:
        return None

    # Strip leading slash
    clean_path = path.lstrip("/")

    # Check if it starts with rl_ prefix
    if clean_path.startswith("rl_"):
        # The key is the entire path segment (rl_ + 32 hex chars)
        key_part = clean_path.split("/")[0]  # Take only the first path segment
        if len(key_part) >= 5:  # rl_ + at least 2 chars
            return key_part

    return None


def _get_or_create_stream(db: Session, creator_id: str, stream_key_str: str) -> Optional[Stream]:
    """Find an existing stream by stream_key, or create one if none exists.

    Args:
        db: Database session.
        creator_id: The user ID of the stream creator.
        stream_key_str: The stream key string.

    Returns:
        The Stream object or None on error.
    """
    # Look for existing stream with this key
    stream = db.query(Stream).filter(Stream.stream_key == stream_key_str).first()
    if stream:
        return stream

    # Create a new stream record
    stream = Stream(
        creator_id=creator_id,
        title="Live Stream",
        description="",
        stream_key=stream_key_str,
        is_live=False,
        is_private=False,
        viewer_count=0,
        category="live",
    )
    db.add(stream)
    db.commit()
    db.refresh(stream)
    return stream


def _publish_stream_event(event_type: str, data: Dict[str, Any]) -> None:
    """Publish a stream lifecycle event via Redis PubSub.

    Args:
        event_type: The event type (e.g. "stream_start", "stream_end").
        data: Event data dictionary.
    """
    event = {
        "type": event_type,
        "data": data,
        "timestamp": datetime.utcnow().isoformat(),
    }
    try:
        redis_client.publish("stream_events", json.dumps(event))
    except Exception as e:
        logger.warning(f"Failed to publish stream event via Redis: {e}")


async def _parse_event_body(request: Request) -> Dict[str, Any]:
    """Parse the request body from a MediaMTX event webhook.

    MediaMTX sends events as JSON. This helper safely parses the body.

    Args:
        request: The FastAPI Request object.

    Returns:
        Parsed body as a dictionary, or empty dict on failure.
    """
    try:
        return await request.json()
    except Exception:
        return {}
