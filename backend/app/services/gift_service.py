"""
ROGAN LIVE - Gift Service
Handle gift sending, stream gifts, and creator stats.
"""

from typing import Any, Dict, List

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.models import Gift, Stream, User
from app.services.economy_service import GIFT_PRICES, get_gift_price, validate_gift_type
from app.services.ledger_service import get_tk_balance, process_gift


def send_gift(
    db: Session,
    sender_id: str,
    stream_id: str,
    gift_type: str,
    message: str = "",
) -> Dict[str, Any]:
    """Send a gift on a stream. Validates, creates Gift record, processes ledger."""
    # Validate gift type
    if not validate_gift_type(gift_type):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid gift type. Valid types: {list(GIFT_PRICES.keys())}",
        )

    # Validate stream exists and is live
    stream = db.query(Stream).filter(Stream.id == stream_id).first()
    if not stream:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Stream not found",
        )

    receiver_id = stream.creator_id

    # Can't gift yourself
    if sender_id == receiver_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot send gifts to yourself",
        )

    # Get TK price
    tk_amount = get_gift_price(gift_type)

    # Check sender balance before creating gift
    balance = get_tk_balance(db, sender_id)
    if balance < tk_amount:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Insufficient TK balance. Current: {balance} TK, Gift cost: {tk_amount} TK",
        )

    # Create gift record
    gift = Gift(
        stream_id=stream_id,
        sender_id=sender_id,
        receiver_id=receiver_id,
        gift_type=gift_type,
        amount=tk_amount,
        message=message or None,
    )
    db.add(gift)
    db.commit()
    db.refresh(gift)

    # Process ledger transaction
    sender_tx, creator_earnings = process_gift(
        db=db,
        sender_id=sender_id,
        receiver_id=receiver_id,
        tk_amount=tk_amount,
        gift_id=gift.id,
    )

    # Get updated balances
    sender_balance = get_tk_balance(db, sender_id)
    receiver_balance = get_tk_balance(db, receiver_id)

    return {
        "gift": gift,
        "sender_balance": sender_balance,
        "receiver_balance": receiver_balance,
        "creator_earnings": creator_earnings,
    }


def get_stream_gifts(db: Session, stream_id: str, limit: int = 50) -> List[Gift]:
    """Get recent gifts for a stream."""
    return (
        db.query(Gift)
        .filter(Gift.stream_id == stream_id)
        .order_by(Gift.created_at.desc())
        .limit(limit)
        .all()
    )


def get_creator_gift_stats(db: Session, creator_id: str) -> Dict[str, Any]:
    """Get total gifts received, total TK earned, breakdown by type for a creator."""
    # Total gifts received
    total_gifts = (
        db.query(func.count(Gift.id))
        .filter(Gift.receiver_id == creator_id)
        .scalar()
    )

    # Total TK earned (gross, before platform fee)
    total_tk_earned = (
        db.query(func.coalesce(func.sum(Gift.amount), 0.0))
        .filter(Gift.receiver_id == creator_id)
        .scalar()
    )

    # Breakdown by gift type
    type_breakdown_rows = (
        db.query(Gift.gift_type, func.count(Gift.id).label("count"), func.coalesce(func.sum(Gift.amount), 0.0).label("total_tk"))
        .filter(Gift.receiver_id == creator_id)
        .group_by(Gift.gift_type)
        .all()
    )

    breakdown = {}
    for row in type_breakdown_rows:
        breakdown[row.gift_type] = {
            "count": row.count,
            "total_tk": round(row.total_tk, 2),
        }

    # Add types with zero stats
    for gift_type in GIFT_PRICES:
        if gift_type not in breakdown:
            breakdown[gift_type] = {"count": 0, "total_tk": 0.0}

    return {
        "creator_id": creator_id,
        "total_gifts_received": total_gifts,
        "total_tk_earned": round(total_tk_earned, 2),
        "breakdown_by_type": breakdown,
    }
