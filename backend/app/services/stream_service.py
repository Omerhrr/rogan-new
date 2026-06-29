"""
ROGAN LIVE - Stream Service
Stream lifecycle: create, go live, end, browse, view counts.
"""

import uuid
from datetime import datetime
from typing import Any, Dict, Optional

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.models import Stream, User, PrivateShow

# Hard cap on per-creator stream records to prevent unbounded DB growth.
# Old non-live streams accumulate every time a creator goes live (each session
# creates a new Stream row). 100 is generous for any real creator.
_MAX_STREAMS_PER_CREATOR = 100


def create_stream(
    db: Session,
    creator_id: str,
    title: str,
    description: Optional[str] = None,
    is_private: bool = False,
    category: Optional[str] = None,
) -> Dict[str, Any]:
    """Create a new stream record. Returns stream + stream_key."""
    # Verify user exists and is a creator
    user = db.query(User).filter(User.id == creator_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    # Guard against unbounded stream record accumulation (each Go Live creates a new row).
    stream_count = (
        db.query(func.count(Stream.id))
        .filter(Stream.creator_id == creator_id)
        .scalar()
        or 0
    )
    if stream_count >= _MAX_STREAMS_PER_CREATOR:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                f"Stream record limit reached ({_MAX_STREAMS_PER_CREATOR}). "
                "Delete old streams before creating new ones."
            ),
        )

    stream_key = str(uuid.uuid4())

    stream = Stream(
        creator_id=creator_id,
        title=title,
        description=description,
        is_private=is_private,
        category=category,
        stream_key=stream_key,
        is_live=False,
        viewer_count=0,
    )
    db.add(stream)
    db.commit()
    db.refresh(stream)

    return {
        "stream": stream,
        "stream_key": stream_key,
    }


def go_live(db: Session, stream_id: str) -> Stream:
    """Set a stream live. Also sets the creator's is_live flag."""
    stream = db.query(Stream).filter(Stream.id == stream_id).first()
    if not stream:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Stream not found",
        )

    if stream.is_live:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Stream is already live",
        )

    # Prevent creator from running multiple concurrent live streams
    existing_live = (
        db.query(Stream)
        .filter(Stream.creator_id == stream.creator_id, Stream.is_live == True, Stream.id != stream_id)
        .first()
    )
    if existing_live:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You already have an active live stream. End it before starting a new one.",
        )

    stream.is_live = True
    stream.ended_at = None

    # Set creator is_live
    creator = db.query(User).filter(User.id == stream.creator_id).first()
    if creator:
        creator.is_live = True

    db.commit()
    db.refresh(stream)
    return stream


def end_stream(db: Session, stream_id: str) -> Stream:
    """End a live stream. Also unsets the creator's is_live flag."""
    stream = db.query(Stream).filter(Stream.id == stream_id).first()
    if not stream:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Stream not found",
        )

    if not stream.is_live:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Stream is not live",
        )

    stream.is_live = False
    stream.ended_at = datetime.utcnow()
    stream.viewer_count = 0

    # Unset creator is_live
    creator = db.query(User).filter(User.id == stream.creator_id).first()
    if creator:
        creator.is_live = False

    db.commit()
    db.refresh(stream)
    return stream


def get_live_streams(db: Session, page: int = 1, limit: int = 20) -> Dict[str, Any]:
    """Get paginated live streams with creator info."""
    offset = (page - 1) * limit

    query = (
        db.query(Stream)
        .filter(Stream.is_live == True)
        .order_by(Stream.viewer_count.desc())
    )

    total = query.count()
    streams = query.offset(offset).limit(limit).all()

    # Attach creator info
    result = []
    for stream in streams:
        creator = db.query(User).filter(User.id == stream.creator_id).first()
        stream_dict = {
            "id": stream.id,
            "creator_id": stream.creator_id,
            "title": stream.title,
            "description": stream.description,
            "thumbnail": stream.thumbnail,
            "is_live": stream.is_live,
            "is_private": stream.is_private,
            "viewer_count": stream.viewer_count,
            "category": stream.category,
            "stream_key": stream.stream_key,  # needed by frontend for thumbnail URL
            "created_at": stream.created_at.isoformat() if stream.created_at else None,
            "creator": {
                "id": creator.id,
                "username": creator.username,
                "display_name": creator.display_name,
                "avatar": creator.avatar,
            } if creator else None,
            "active_private_show_id": stream.active_private_show_id,
            "private_show_price": None,
            "private_show_status": None,
        }
        if stream.active_private_show_id:
            ps = db.query(PrivateShow).filter(PrivateShow.id == stream.active_private_show_id).first()
            if ps and ps.status in ('announced', 'live'):
                stream_dict["private_show_price"] = ps.price_tk
                stream_dict["private_show_status"] = ps.status
        result.append(stream_dict)

    return {
        "streams": result,
        "total": total,
        "page": page,
        "limit": limit,
        "pages": (total + limit - 1) // limit if total > 0 else 0,
    }


def get_stream(db: Session, stream_id: str) -> Dict[str, Any]:
    """Get stream details with creator info."""
    stream = db.query(Stream).filter(Stream.id == stream_id).first()
    if not stream:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Stream not found",
        )

    creator = db.query(User).filter(User.id == stream.creator_id).first()

    # hls_url is a root-relative path so the browser fetches it through the
    # Next.js /live/* → mediamtx:8888 proxy (same origin → no CORS).
    # Using an absolute http://localhost:8888/... URL would be blocked by CORS
    # when hls.js makes XHR requests from the frontend origin.
    hls_url = (
        f"/live/{stream.stream_key}/index.m3u8"
        if stream.stream_key and stream.is_live
        else None
    )

    return {
        "id": stream.id,
        "creator_id": stream.creator_id,
        "title": stream.title,
        "description": stream.description,
        "thumbnail": stream.thumbnail,
        "stream_key": stream.stream_key,  # stripped for non-creators in route layer
        "hls_url": hls_url,               # public HLS playback URL (always included)
        "is_live": stream.is_live,
        "is_private": stream.is_private,
        "viewer_count": stream.viewer_count,
        "category": stream.category,
        "created_at": stream.created_at.isoformat() if stream.created_at else None,
        "ended_at": stream.ended_at.isoformat() if stream.ended_at else None,
        "creator": {
            "id": creator.id,
            "username": creator.username,
            "display_name": creator.display_name,
            "avatar": creator.avatar,
            "bio": creator.bio,
        } if creator else None,
    }


def increment_viewers(db: Session, stream_id: str) -> int:
    """Increment viewer count by 1. Returns new count."""
    stream = db.query(Stream).filter(Stream.id == stream_id).first()
    if not stream:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Stream not found",
        )

    stream.viewer_count = (stream.viewer_count or 0) + 1
    db.commit()
    db.refresh(stream)
    return stream.viewer_count


def decrement_viewers(db: Session, stream_id: str) -> int:
    """Decrement viewer count by 1 (minimum 0). Returns new count."""
    stream = db.query(Stream).filter(Stream.id == stream_id).first()
    if not stream:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Stream not found",
        )

    stream.viewer_count = max((stream.viewer_count or 0) - 1, 0)
    db.commit()
    return stream
