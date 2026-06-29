"""
ROGAN LIVE - Stream Routes
POST /streams/, GET /streams/live, GET /streams/{stream_id},
POST /streams/{stream_id}/go-live, POST /streams/{stream_id}/end,
GET /streams/{stream_id}/viewers, GET /streams/{stream_id}/chat
"""

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import User
from app.routes.auth import get_current_user_dependency
from app.schemas import CreateStreamRequest
from app.services import auth_service, stream_service, private_show_service
from app.websocket.handler import manager

logger = logging.getLogger(__name__)

# Optional security — allows unauthenticated access to GET /streams/{id}
_optional_security = HTTPBearer(auto_error=False)

router = APIRouter(prefix="/streams", tags=["Streams"])


@router.post("", status_code=status.HTTP_201_CREATED)
def create_stream(
    request: CreateStreamRequest,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Create a new stream (auth required)."""
    result = stream_service.create_stream(
        db=db,
        creator_id=current_user.id,
        title=request.title,
        description=request.description,
        is_private=request.is_private,
        category=request.category,
    )
    stream = result["stream"]
    return {
        "id": stream.id,
        "creator_id": stream.creator_id,
        "title": stream.title,
        "description": stream.description,
        "stream_key": result["stream_key"],
        "is_live": stream.is_live,
        "is_private": stream.is_private,
        "viewer_count": stream.viewer_count,
        "category": stream.category,
        "created_at": stream.created_at.isoformat() if stream.created_at else None,
    }


@router.get("/live")
def get_live_streams(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """Get paginated live streams with creator info."""
    return stream_service.get_live_streams(db=db, page=page, limit=limit)


@router.get("/{stream_id}")
def get_stream(
    stream_id: str,
    credentials: HTTPAuthorizationCredentials = Depends(_optional_security),
    db: Session = Depends(get_db),
):
    """Get stream details. stream_key is only visible to the creator."""
    stream_data = stream_service.get_stream(db=db, stream_id=stream_id)

    # Determine if requester is the creator (strip stream_key for non-creators)
    current_user = None
    if credentials:
        try:
            current_user = auth_service.get_current_user(db, credentials.credentials)
        except Exception:
            pass  # Invalid token — treat as anonymous

    if not current_user or current_user.id != stream_data["creator_id"]:
        stream_data.pop("stream_key", None)

    return stream_data


@router.post("/{stream_id}/go-live")
async def go_live(
    stream_id: str,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Go live with a stream (auth required, creator only)."""
    # Verify the user owns this stream
    stream_data = stream_service.get_stream(db=db, stream_id=stream_id)
    if stream_data["creator_id"] != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the stream creator can go live",
        )

    stream = stream_service.go_live(db=db, stream_id=stream_id)

    # Notify all followers of this creator via their user-level WebSocket
    try:
        from app.models.models import Follow
        from app.websocket.dm_handler import user_manager

        followers = db.query(Follow).filter(
            Follow.following_id == current_user.id
        ).all()

        stream_title = getattr(stream, 'title', None) or f"{current_user.username}'s stream"
        event = {
            "type": "stream_live",
            "stream_id": stream.id,
            "creator_username": current_user.username,
            "title": stream_title,
        }
        for follow in followers:
            await user_manager.send_to_user(follow.follower_id, event)
    except Exception:
        pass  # Never block go-live due to notification failure

    return {
        "id": stream.id,
        "is_live": stream.is_live,
        "message": "Stream is now live",
    }


@router.post("/{stream_id}/end")
async def end_stream(
    stream_id: str,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """End a live stream (auth required)."""
    # Verify the user owns this stream
    stream_data = stream_service.get_stream(db=db, stream_id=stream_id)
    if stream_data["creator_id"] != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the stream creator can end the stream",
        )

    stream = stream_service.end_stream(db=db, stream_id=stream_id)
    # Notify all viewers in real-time that the stream has ended
    await manager.broadcast_to_stream(stream_id, {"type": "stream_ended"})
    return {
        "id": stream.id,
        "is_live": stream.is_live,
        "ended_at": stream.ended_at.isoformat() if stream.ended_at else None,
        "message": "Stream has ended",
    }


@router.get("/{stream_id}/viewers")
def get_viewer_count(stream_id: str, db: Session = Depends(get_db)):
    """Get current viewer count for a stream."""
    stream_data = stream_service.get_stream(db=db, stream_id=stream_id)
    return {
        "stream_id": stream_id,
        "viewer_count": stream_data["viewer_count"],
    }


@router.post("/{stream_id}/go-private/announce")
async def announce_private_show(
    stream_id: str,
    price_tk: float = Query(..., gt=0),
    countdown_seconds: int = Query(60, ge=15, le=600),
    duration_minutes: int = Query(60, ge=5, le=240),
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Announce a live→private transition. Broadcasts countdown to all viewers."""
    show = private_show_service.announce_live_to_private(
        db, stream_id, current_user.id, price_tk, countdown_seconds, duration_minutes
    )
    await manager.broadcast_to_stream(stream_id, {
        "type": "private_show_announced",
        "show_id": show.id,
        "price_tk": show.price_tk,
        "countdown_seconds": show.countdown_seconds,
        "creator_username": current_user.username,
    })
    return {"show_id": show.id, "status": "announced"}


@router.post("/{stream_id}/go-private/start")
async def start_private_show_from_live(
    stream_id: str,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Start the private show (countdown done). Broadcasts private_show_started."""
    show = private_show_service.start_announced_show(db, stream_id, current_user.id)
    await manager.broadcast_to_stream(stream_id, {
        "type": "private_show_started",
        "show_id": show.id,
        "price_tk": show.price_tk,
    })
    return {"show_id": show.id, "status": "live"}


@router.post("/{stream_id}/go-private/cancel")
async def cancel_private_show(
    stream_id: str,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Cancel an announced private show."""
    private_show_service.cancel_announced_show(db, stream_id, current_user.id)
    await manager.broadcast_to_stream(stream_id, {"type": "private_show_cancelled"})
    return {"status": "cancelled"}


@router.post("/{stream_id}/go-private/end")
async def end_private_show_from_live(
    stream_id: str,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """End active private show and return stream to public."""
    private_show_service.end_live_private_show(db, stream_id, current_user.id)
    await manager.broadcast_to_stream(stream_id, {"type": "private_show_ended"})
    return {"status": "ended"}


@router.get("/{stream_id}/private-show")
def get_stream_private_show_status(
    stream_id: str,
    db: Session = Depends(get_db),
):
    """Get active private show for a stream (for new viewers who join mid-show)."""
    result = private_show_service.get_stream_private_show(db, stream_id)
    return result or {"show_id": None, "status": None}


@router.get("/{stream_id}/chat")
def get_chat_history(
    stream_id: str,
    limit: int = Query(50, ge=1, le=200),
):
    """Return the last N chat messages for a stream from the Redis ring buffer.
    No auth required — chat is public. Returns an empty list if Redis is
    unavailable or no messages exist yet.
    """
    try:
        from app.utils.redis_client import redis_client
        if redis_client is None:
            return {"messages": []}

        hist_key = f"chat_history:{stream_id}"
        # LRANGE with negative indices: -limit to -1 = the last `limit` entries.
        raw = redis_client.lrange(hist_key, -limit, -1)
        messages = []
        for item in raw:
            try:
                messages.append(json.loads(item))
            except Exception:
                continue
        return {"messages": messages}
    except Exception as exc:
        logger.warning("chat_history fetch failed for %s: %s", stream_id, exc)
        return {"messages": []}
