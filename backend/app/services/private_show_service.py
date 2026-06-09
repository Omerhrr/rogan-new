"""
ROGAN LIVE - Private Show Service
Private show lifecycle: create, join, end, auto-end timer, payouts.
Entry fee collection uses the double-entry ledger.
Revenue split: platform fee (20% Phase 2) + creator payout (80%).
"""

import asyncio
import json
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import settings
from app.models.models import PrivateShow, PrivateShowViewer, StreamKey, User
from app.services.ledger_service import (
    SYSTEM_USER_ID,
    create_transaction,
    get_tk_balance,
    get_tk_balance_with_lock,
)
from app.utils.redis_client import redis_client

logger = logging.getLogger(__name__)

# Phase 2 platform fee rate for private shows
PRIVATE_SHOW_PLATFORM_FEE_RATE = 0.20


def create_private_show(
    db: Session,
    creator_id: str,
    price_tk: float,
    duration_minutes: int,
    max_viewers: Optional[int] = None,
) -> PrivateShow:
    """Creator starts a private show.

    Args:
        db: Database session.
        creator_id: The creator starting the show.
        price_tk: Entry fee per viewer in TK.
        duration_minutes: Scheduled duration in minutes.
        max_viewers: Maximum concurrent viewers (None = unlimited).

    Returns:
        The newly created PrivateShow object.

    Raises:
        HTTPException 404: Creator not found.
        HTTPException 403: User is not a creator.
        HTTPException 400: Creator already has an active show.
    """
    user = db.query(User).filter(User.id == creator_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    if user.role not in ("creator", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only creators can start private shows",
        )

    # Check for existing active show
    active_show = (
        db.query(PrivateShow)
        .filter(
            PrivateShow.creator_id == creator_id,
            PrivateShow.status.in_(["waiting", "live"]),
        )
        .first()
    )
    if active_show:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You already have an active private show. End it before starting a new one.",
        )

    # Get or create a stream key for this private show
    stream_key_record = (
        db.query(StreamKey)
        .filter(StreamKey.user_id == creator_id, StreamKey.is_active == True)
        .first()
    )
    stream_key_str = stream_key_record.key if stream_key_record else None

    show = PrivateShow(
        creator_id=creator_id,
        stream_key=stream_key_str,
        price_tk=price_tk,
        duration_minutes=duration_minutes,
        max_viewers=max_viewers,
        status="waiting",
        total_revenue=0.0,
    )
    db.add(show)
    db.commit()
    db.refresh(show)

    # Schedule auto-end timer
    _schedule_auto_end(show.id, duration_minutes)

    # Publish event
    _publish_show_event("private_show_created", show)

    return show


def join_private_show(
    db: Session,
    show_id: str,
    viewer_id: str,
) -> PrivateShowViewer:
    """Viewer joins a private show. Deducts entry fee via ledger.

    Args:
        db: Database session.
        show_id: The show to join.
        viewer_id: The viewer joining.

    Returns:
        The PrivateShowViewer participation record.

    Raises:
        HTTPException 404: Show not found.
        HTTPException 400: Show not joinable, full, or already joined.
    """
    show = db.query(PrivateShow).filter(PrivateShow.id == show_id).first()
    if not show:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Private show not found",
        )

    if show.status not in ("waiting", "live"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This show is no longer accepting viewers",
        )

    # Can't join your own show
    if show.creator_id == viewer_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot join your own private show",
        )

    # Check capacity
    current_viewers = _get_viewer_count(db, show_id)
    if show.max_viewers and current_viewers >= show.max_viewers:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This show has reached its viewer capacity",
        )

    # Check if already joined
    existing = (
        db.query(PrivateShowViewer)
        .filter(
            PrivateShowViewer.show_id == show_id,
            PrivateShowViewer.viewer_id == viewer_id,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You have already joined this show",
        )

    # Check viewer balance with lock to prevent TOCTOU
    balance = get_tk_balance_with_lock(db, viewer_id)
    if balance < show.price_tk:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Insufficient TK balance. Current: {balance} TK, Entry fee: {show.price_tk} TK",
        )

    # Create viewer participation record
    viewer_entry = PrivateShowViewer(
        show_id=show_id,
        viewer_id=viewer_id,
        paid_amount=show.price_tk,
    )
    db.add(viewer_entry)

    # Double-entry ledger: viewer debit -> creator credit
    # Step 1: Viewer pays full amount to creator
    create_transaction(
        db=db,
        type="private_show_entry",
        amount=show.price_tk,
        from_user_id=viewer_id,
        to_user_id=show.creator_id,
        reference_id=show_id,
        metadata={
            "show_id": show_id,
            "viewer_id": viewer_id,
            "entry_fee": show.price_tk,
        },
    )

    # Step 2: Platform fee (20%) from creator to system
    platform_fee = round(show.price_tk * PRIVATE_SHOW_PLATFORM_FEE_RATE, 2)
    if platform_fee > 0:
        create_transaction(
            db=db,
            type="platform_fee",
            amount=platform_fee,
            from_user_id=show.creator_id,
            to_user_id=SYSTEM_USER_ID,
            reference_id=show_id,
            metadata={
                "show_id": show_id,
                "fee_rate": PRIVATE_SHOW_PLATFORM_FEE_RATE,
                "platform_fee": platform_fee,
            },
        )

    # Update show revenue
    show.total_revenue = round(show.total_revenue + show.price_tk, 2)
    db.commit()
    db.refresh(viewer_entry)

    # Auto-transition to live if still waiting
    if show.status == "waiting":
        show.status = "live"
        show.started_at = datetime.utcnow()
        db.commit()

    # Publish event
    _publish_show_event("private_show_joined", show, viewer_id=viewer_id)

    return viewer_entry


def end_private_show(db: Session, show_id: str, creator_id: str) -> PrivateShow:
    """Creator ends a private show.

    Args:
        db: Database session.
        show_id: The show to end.
        creator_id: The creator ending the show (for authorization).

    Returns:
        The ended PrivateShow object.

    Raises:
        HTTPException 404: Show not found.
        HTTPException 403: Not the show creator.
        HTTPException 400: Show already ended.
    """
    show = db.query(PrivateShow).filter(PrivateShow.id == show_id).first()
    if not show:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Private show not found",
        )

    if show.creator_id != creator_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the show creator can end this show",
        )

    if show.status == "ended":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This show has already ended",
        )

    show.status = "ended"
    show.ended_at = datetime.utcnow()
    db.commit()
    db.refresh(show)

    # Publish event
    _publish_show_event("private_show_ended", show)

    return show


def get_active_shows(
    db: Session,
    page: int = 1,
    limit: int = 20,
) -> Dict[str, Any]:
    """List active private shows (waiting or live).

    Args:
        db: Database session.
        page: Page number (1-based).
        limit: Items per page.

    Returns:
        Paginated list of active shows with viewer counts.
    """
    offset = (page - 1) * limit

    query = (
        db.query(PrivateShow)
        .filter(PrivateShow.status.in_(["waiting", "live"]))
        .order_by(PrivateShow.created_at.desc())
    )

    total = query.count()
    shows = query.offset(offset).limit(limit).all()

    result = []
    for show in shows:
        viewer_count = _get_viewer_count(db, show.id)
        creator = db.query(User).filter(User.id == show.creator_id).first()
        result.append({
            "id": show.id,
            "creator_id": show.creator_id,
            "creator": {
                "id": creator.id,
                "username": creator.username,
                "display_name": creator.display_name,
                "avatar": creator.avatar,
            } if creator else None,
            "price_tk": show.price_tk,
            "duration_minutes": show.duration_minutes,
            "max_viewers": show.max_viewers,
            "status": show.status,
            "viewer_count": viewer_count,
            "started_at": show.started_at.isoformat() if show.started_at else None,
            "total_revenue": show.total_revenue,
            "created_at": show.created_at.isoformat() if show.created_at else None,
        })

    return {
        "shows": result,
        "total": total,
        "page": page,
        "limit": limit,
        "pages": (total + limit - 1) // limit if total > 0 else 0,
    }


def get_show_details(db: Session, show_id: str) -> Dict[str, Any]:
    """Get private show details with viewer count and creator info.

    Args:
        db: Database session.
        show_id: The show ID.

    Returns:
        Show details dictionary.

    Raises:
        HTTPException 404: Show not found.
    """
    show = db.query(PrivateShow).filter(PrivateShow.id == show_id).first()
    if not show:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Private show not found",
        )

    viewer_count = _get_viewer_count(db, show.id)
    creator = db.query(User).filter(User.id == show.creator_id).first()

    # Build WebRTC stream URL if show is live
    webrtc_url = None
    hls_url = None
    if show.status == "live" and show.stream_key:
        webrtc_url = f"ws://{settings.MEDIAMTX_HOST}:{settings.MEDIAMTX_WEBRTC_PORT}/{show.stream_key}/ws"
        hls_url = f"http://{settings.MEDIAMTX_HOST}:{settings.MEDIAMTX_HLS_PORT}/{show.stream_key}/index.m3u8"

    return {
        "id": show.id,
        "creator_id": show.creator_id,
        "creator": {
            "id": creator.id,
            "username": creator.username,
            "display_name": creator.display_name,
            "avatar": creator.avatar,
        } if creator else None,
        "stream_key": show.stream_key,
        "price_tk": show.price_tk,
        "duration_minutes": show.duration_minutes,
        "max_viewers": show.max_viewers,
        "status": show.status,
        "viewer_count": viewer_count,
        "started_at": show.started_at.isoformat() if show.started_at else None,
        "ended_at": show.ended_at.isoformat() if show.ended_at else None,
        "total_revenue": show.total_revenue,
        "webrtc_url": webrtc_url,
        "hls_url": hls_url,
        "created_at": show.created_at.isoformat() if show.created_at else None,
    }


def auto_end_show(db: Session, show_id: str) -> None:
    """Auto-end a show when its duration expires.

    Called by the background scheduler. Marks the show as ended
    and publishes a notification.

    Args:
        db: Database session.
        show_id: The show to auto-end.
    """
    show = db.query(PrivateShow).filter(PrivateShow.id == show_id).first()
    if not show or show.status == "ended":
        return

    show.status = "ended"
    show.ended_at = datetime.utcnow()
    db.commit()

    _publish_show_event("private_show_auto_ended", show)
    logger.info(f"Private show {show_id} auto-ended after {show.duration_minutes} minutes")


def _get_viewer_count(db: Session, show_id: str) -> int:
    """Get current viewer count for a show.

    Args:
        db: Database session.
        show_id: The show ID.

    Returns:
        Number of viewers.
    """
    return (
        db.query(func.count(PrivateShowViewer.id))
        .filter(PrivateShowViewer.show_id == show_id)
        .scalar()
    ) or 0


def _schedule_auto_end(show_id: str, duration_minutes: int) -> None:
    """Schedule an auto-end timer for a private show.

    Uses asyncio to schedule a background task that will auto-end
    the show after the specified duration.

    Args:
        show_id: The show ID.
        duration_minutes: Minutes until auto-end.
    """
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        loop.create_task(_auto_end_task(show_id, duration_minutes))
    else:
        logger.info(f"Auto-end scheduled for show {show_id} in {duration_minutes} minutes")


async def _auto_end_task(show_id: str, delay_minutes: int) -> None:
    """Async background task that auto-ends a show after a delay.

    Args:
        show_id: The show ID.
        delay_minutes: Minutes to wait before ending.
    """
    try:
        await asyncio.sleep(delay_minutes * 60)
        # Import here to avoid circular imports
        from app.database import SessionLocal
        db = SessionLocal()
        try:
            auto_end_show(db, show_id)
        finally:
            db.close()
    except asyncio.CancelledError:
        logger.info(f"Auto-end task cancelled for show {show_id}")
    except Exception as e:
        logger.error(f"Auto-end task failed for show {show_id}: {e}")


def _publish_show_event(
    event_type: str,
    show: PrivateShow,
    viewer_id: Optional[str] = None,
) -> None:
    """Publish a private show event via Redis PubSub.

    Args:
        event_type: The event type.
        show: The PrivateShow object.
        viewer_id: Optional viewer ID for join events.
    """
    event = {
        "type": event_type,
        "data": {
            "show_id": show.id,
            "creator_id": show.creator_id,
            "status": show.status,
            "price_tk": show.price_tk,
            "viewer_id": viewer_id,
            "total_revenue": show.total_revenue,
        },
        "timestamp": datetime.utcnow().isoformat(),
    }
    try:
        redis_client.publish(f"private_show:{show.id}", json.dumps(event))
        redis_client.publish("private_shows", json.dumps(event))
    except Exception as e:
        logger.warning(f"Failed to publish private show event: {e}")
