"""
ROGAN LIVE - Gift Routes
POST /gifts/send, GET /gifts/stream/{stream_id}, GET /gifts/stats/{creator_id}
"""

import asyncio
from datetime import datetime

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy import func
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.database import get_db
from app.models.models import Gift, User
from app.routes.auth import get_current_user_dependency
from app.schemas import SendGiftRequest
from app.services import gift_service
from app.services.economy_service import GIFT_PRICES

router = APIRouter(prefix="/gifts", tags=["Gifts"])

limiter = Limiter(key_func=get_remote_address)


@router.post("/send", status_code=status.HTTP_201_CREATED)
@limiter.limit("10/second")
async def send_gift(
    request: Request,
    gift_request: SendGiftRequest,
    current_user: User = Depends(get_current_user_dependency),
    db=Depends(get_db),
):
    """Send a gift on a stream (auth required, rate limited 10/sec).

    After the ledger transaction succeeds, the backend broadcasts the gift_sent
    event directly to all WebSocket connections in the stream room.  This is
    more reliable than relying on the frontend to call wsRef.sendGift() after
    the HTTP response, which silently drops if the WS is momentarily disconnected.
    """
    result = gift_service.send_gift(
        db=db,
        sender_id=current_user.id,
        stream_id=gift_request.stream_id,
        gift_type=gift_request.gift_type,
        message=gift_request.message or "",
    )
    gift = result["gift"]

    # Broadcast gift event to all viewers in the stream room.
    # Import here to avoid circular imports at module load time.
    from app.websocket.handler import manager  # noqa: PLC0415
    asyncio.create_task(
        manager.broadcast_to_stream(
            gift.stream_id,
            {
                "type": "gift_sent",
                "stream_id": gift.stream_id,
                "user_id": current_user.id,
                "username": current_user.username,
                "gift_type": gift.gift_type,
                "amount": gift.amount,
                "message": gift.message or "",
                "timestamp": datetime.utcnow().isoformat(),
            },
        )
    )

    return {
        "gift": {
            "id": gift.id,
            "stream_id": gift.stream_id,
            "sender_id": gift.sender_id,
            "receiver_id": gift.receiver_id,
            "gift_type": gift.gift_type,
            "amount": gift.amount,
            "message": gift.message,
            "created_at": gift.created_at.isoformat() if gift.created_at else None,
        },
        "sender_balance": result["sender_balance"],
        "receiver_balance": result["receiver_balance"],
    }


@router.get("/stream/{stream_id}")
def get_stream_gifts(
    stream_id: str,
    limit: int = Query(50, ge=1, le=200),
    current_user: User = Depends(get_current_user_dependency),
    db=Depends(get_db),
):
    """Get recent gifts for a stream."""
    from app.models.models import Gift
    gifts = (
        db.query(Gift)
        .filter(Gift.stream_id == stream_id)
        .order_by(Gift.created_at.desc())
        .limit(limit)
        .all()
    )
    return {
        "gifts": [
            {
                "id": g.id,
                "gift_type": g.gift_type,
                "amount": g.amount,
                "sender_id": g.sender_id,
                "message": g.message,
                "created_at": g.created_at.isoformat() if g.created_at else None,
            }
            for g in reversed(gifts)
        ]
    }


@router.get("/stats/{creator_id}")
def get_creator_gift_stats(
    creator_id: str,
    current_user: User = Depends(get_current_user_dependency),
    db=Depends(get_db),
):
    """Aggregated gift stats for a creator."""
    from app.models.models import Gift
    from sqlalchemy import func
    total_tk = db.query(func.sum(Gift.amount)).filter(Gift.receiver_id == creator_id).scalar() or 0.0
    total_received = db.query(func.count(Gift.id)).filter(Gift.receiver_id == creator_id).scalar() or 0
    rows = (
        db.query(Gift.gift_type, func.count(Gift.id), func.sum(Gift.amount))
        .filter(Gift.receiver_id == creator_id)
        .group_by(Gift.gift_type)
        .all()
    )
    by_type = {row[0]: {"count": row[1], "total_tk": round(row[2] or 0, 2)} for row in rows}
    return {
        "creator_id": creator_id,
        "total_received": total_received,
        "total_tk": round(total_tk, 2),
        "by_type": by_type,
    }
