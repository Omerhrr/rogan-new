"""
ROGAN LIVE - Gift Routes
POST /gifts/send, GET /gifts/stream/{stream_id}, GET /gifts/stats/{creator_id}
"""

from fastapi import APIRouter, Depends, Query, Request, status
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.database import get_db
from app.models.models import User
from app.routes.auth import get_current_user_dependency
from app.schemas import SendGiftRequest
from app.services import gift_service
from app.services.economy_service import GIFT_PRICES

router = APIRouter(prefix="/gifts", tags=["Gifts"])

limiter = Limiter(key_func=get_remote_address)


@router.post("/send", status_code=status.HTTP_201_CREATED)
@limiter.limit("10/second")
def send_gift(
    request: Request,
    gift_request: SendGiftRequest,
    current_user: User = Depends(get_current_user_dependency),
    db=Depends(get_db),
):
    """Send a gift on a stream (auth required, rate limited 10/sec)."""
    result = gift_service.send_gift(
        db=db,
        sender_id=current_user.id,
        stream_id=gift_request.stream_id,
        gift_type=gift_request.gift_type,
        message=gift_request.message or "",
    )
    gift = result["gift"]
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
        "creator_earnings": result["creator_earnings"],
    }


@router.get("/stream/{stream_id}")
def get_stream_gifts(
    stream_id: str,
    limit: int = Query(50, ge=1, le=200),
    db=Depends(get_db),
):
    """Get recent gifts for a stream."""
    gifts = gift_service.get_stream_gifts(db=db, stream_id=stream_id, limit=limit)
    return {
        "gifts": [
            {
                "id": g.id,
                "sender_id": g.sender_id,
                "receiver_id": g.receiver_id,
                "gift_type": g.gift_type,
                "amount": g.amount,
                "message": g.message,
                "created_at": g.created_at.isoformat() if g.created_at else None,
            }
            for g in gifts
        ],
        "count": len(gifts),
    }


@router.get("/stats/{creator_id}")
def get_creator_gift_stats(creator_id: str, db=Depends(get_db)):
    """Get creator gift stats: total received, TK earned, breakdown by type."""
    return gift_service.get_creator_gift_stats(db=db, creator_id=creator_id)
