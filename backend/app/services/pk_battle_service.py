"""
ROGAN LIVE - PK Battle Service
Battle lifecycle, real-time scoring, gift routing, winner determination.
"""

import asyncio
import json
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.models import PKBattle, PKBattleGift, User
from app.services.ledger_service import (
    SYSTEM_USER_ID,
    create_transaction,
    get_tk_balance,
    get_tk_balance_with_lock,
)
from app.services.notification_service import create_notification
from app.utils.redis_client import redis_client

# Gift routing: 70% to supported creator, 30% to winner's bonus pool
PK_GIFT_CREATOR_SHARE = 0.70
PK_GIFT_BONUS_POOL = 0.30


def create_battle(
    db: Session,
    creator_a_id: str,
    creator_b_id: str,
    duration_minutes: int,
    entry_gift_requirements: float = 0.0,
) -> PKBattle:
    """Create a PK battle challenge. Creator A challenges Creator B."""
    # Cannot challenge yourself
    if creator_a_id == creator_b_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot challenge yourself",
        )

    # Verify both are creators
    creator_a = db.query(User).filter(User.id == creator_a_id).first()
    creator_b = db.query(User).filter(User.id == creator_b_id).first()

    if not creator_a or not creator_b:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Creator not found",
        )

    if creator_a.role not in ("creator", "admin") or creator_b.role not in ("creator", "admin"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Both users must be creators",
        )

    # Check if either creator has an active battle
    active_battle = (
        db.query(PKBattle)
        .filter(
            PKBattle.status.in_(["pending", "active"]),
            ((PKBattle.creator_a_id == creator_a_id) | (PKBattle.creator_b_id == creator_a_id)),
        )
        .first()
    )
    if active_battle:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You already have an active or pending PK battle",
        )

    battle = PKBattle(
        creator_a_id=creator_a_id,
        creator_b_id=creator_b_id,
        duration_minutes=duration_minutes,
        entry_gift_requirements=entry_gift_requirements,
        status="pending",
    )
    db.add(battle)
    db.commit()
    db.refresh(battle)

    # Notify creator B
    create_notification(
        db=db,
        user_id=creator_b_id,
        type="pk_challenge",
        title="PK Battle Challenge!",
        message=f"You've been challenged to a PK battle! Duration: {duration_minutes} min",
        metadata={"battle_id": battle.id, "challenger_id": creator_a_id},
    )

    # Store pending state in Redis
    _cache_battle_state(battle)

    return battle


def accept_battle(db: Session, battle_id: str, creator_b_id: str) -> PKBattle:
    """Opponent accepts the PK battle challenge."""
    battle = db.query(PKBattle).filter(PKBattle.id == battle_id).first()
    if not battle:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Battle not found",
        )

    if battle.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Battle is not pending (status: {battle.status})",
        )

    if battle.creator_b_id != creator_b_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the challenged creator can accept",
        )

    now = datetime.utcnow()
    battle.status = "active"
    battle.started_at = now
    db.commit()
    db.refresh(battle)

    # Store scores in Redis for real-time tracking
    _init_battle_scores(battle.id)
    _cache_battle_state(battle)

    # Notify creator A
    create_notification(
        db=db,
        user_id=battle.creator_a_id,
        type="pk_challenge",
        title="PK Battle Accepted!",
        message="Your PK battle challenge has been accepted!",
        metadata={"battle_id": battle.id},
    )

    return battle


def send_battle_gift(
    db: Session,
    battle_id: str,
    sender_id: str,
    amount_tk: float,
    side: str,
) -> PKBattleGift:
    """Viewer sends a gift to support a side in the PK battle.
    70% to supported creator, 30% to winner's bonus pool.
    """
    battle = db.query(PKBattle).filter(PKBattle.id == battle_id).first()
    if not battle:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Battle not found",
        )

    if battle.status != "active":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Battle is not active",
        )

    # Determine the receiver based on side
    if side == "a":
        receiver_id = battle.creator_a_id
    elif side == "b":
        receiver_id = battle.creator_b_id
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Side must be 'a' or 'b'",
        )

    # Check entry gift requirements
    if battle.entry_gift_requirements > 0 and amount_tk < battle.entry_gift_requirements:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Minimum gift amount is {battle.entry_gift_requirements} TK",
        )

    # Check sender balance and deduct
    balance = get_tk_balance_with_lock(db, sender_id)
    if balance < amount_tk:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Insufficient TK balance. Current: {balance}, Required: {amount_tk}",
        )

    # Create gift record
    gift = PKBattleGift(
        battle_id=battle_id,
        sender_id=sender_id,
        receiver_id=receiver_id,
        amount_tk=amount_tk,
        side=side,
    )
    db.add(gift)
    db.flush()

    # Double-entry: sender -> supported creator (70%)
    creator_share = round(amount_tk * PK_GIFT_CREATOR_SHARE, 2)
    bonus_pool_share = round(amount_tk * PK_GIFT_BONUS_POOL, 2)

    # Full debit from sender
    create_transaction(
        db=db,
        type="pk_gift",
        amount=amount_tk,
        from_user_id=sender_id,
        to_user_id=receiver_id,
        reference_id=gift.id,
        metadata={
            "battle_id": battle_id,
            "side": side,
            "creator_share": creator_share,
            "bonus_pool": bonus_pool_share,
        },
    )

    # Bonus pool: creator -> SYSTEM (30% held for winner)
    if bonus_pool_share > 0:
        create_transaction(
            db=db,
            type="pk_bonus_pool",
            amount=bonus_pool_share,
            from_user_id=receiver_id,
            to_user_id=SYSTEM_USER_ID,
            reference_id=gift.id,
            metadata={
                "battle_id": battle_id,
                "side": side,
                "bonus_pool": bonus_pool_share,
            },
        )

    # Update battle scores
    if side == "a":
        battle.creator_a_score = (battle.creator_a_score or 0) + amount_tk
    else:
        battle.creator_b_score = (battle.creator_b_score or 0) + amount_tk

    db.commit()
    db.refresh(gift)
    db.refresh(battle)

    # Update Redis scores for real-time
    _update_battle_scores(battle)
    _publish_score_update(battle)

    return gift


def get_battle(db: Session, battle_id: str) -> Dict[str, Any]:
    """Get battle status + live scores."""
    battle = db.query(PKBattle).filter(PKBattle.id == battle_id).first()
    if not battle:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Battle not found",
        )

    # Get live scores from Redis if available
    scores = _get_battle_scores(battle_id)

    return {
        "id": battle.id,
        "creator_a_id": battle.creator_a_id,
        "creator_b_id": battle.creator_b_id,
        "duration_minutes": battle.duration_minutes,
        "entry_gift_requirements": battle.entry_gift_requirements,
        "status": battle.status,
        "started_at": battle.started_at.isoformat() if battle.started_at else None,
        "ended_at": battle.ended_at.isoformat() if battle.ended_at else None,
        "creator_a_score": scores.get("a", battle.creator_a_score or 0),
        "creator_b_score": scores.get("b", battle.creator_b_score or 0),
        "winner_id": battle.winner_id,
        "created_at": battle.created_at.isoformat() if battle.created_at else None,
    }


def list_active_battles(db: Session, page: int = 1, limit: int = 20) -> Dict[str, Any]:
    """List active PK battles."""
    query = (
        db.query(PKBattle)
        .filter(PKBattle.status.in_(["pending", "active"]))
        .order_by(PKBattle.created_at.desc())
    )

    total = query.count()
    offset = (page - 1) * limit
    battles = query.offset(offset).limit(limit).all()

    return {
        "battles": [
            {
                "id": b.id,
                "creator_a_id": b.creator_a_id,
                "creator_b_id": b.creator_b_id,
                "duration_minutes": b.duration_minutes,
                "status": b.status,
                "creator_a_score": b.creator_a_score or 0,
                "creator_b_score": b.creator_b_score or 0,
                "started_at": b.started_at.isoformat() if b.started_at else None,
                "created_at": b.created_at.isoformat() if b.created_at else None,
            }
            for b in battles
        ],
        "total": total,
        "page": page,
        "limit": limit,
        "pages": (total + limit - 1) // limit if total > 0 else 0,
    }


def end_battle(db: Session, battle_id: str, ended_by_id: Optional[str] = None) -> PKBattle:
    """End a PK battle and determine the winner. Pays out bonus pool to winner."""
    battle = db.query(PKBattle).filter(PKBattle.id == battle_id).first()
    if not battle:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Battle not found",
        )

    if battle.status != "active":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Battle is not active (status: {battle.status})",
        )

    # Determine winner
    if battle.creator_a_score > battle.creator_b_score:
        winner_id = battle.creator_a_id
    elif battle.creator_b_score > battle.creator_a_score:
        winner_id = battle.creator_b_id
    else:
        winner_id = None  # Draw

    now = datetime.utcnow()
    battle.status = "ended"
    battle.ended_at = now
    battle.winner_id = winner_id
    db.commit()
    db.refresh(battle)

    # Calculate and distribute bonus pool
    _distribute_bonus_pool(db, battle)

    # Notify both creators
    result_msg = "It's a draw!" if not winner_id else f"Winner: {winner_id}"
    for creator_id in [battle.creator_a_id, battle.creator_b_id]:
        create_notification(
            db=db,
            user_id=creator_id,
            type="pk_battle",
            title="PK Battle Ended!",
            message=f"Your PK battle has ended. {result_msg}",
            metadata={"battle_id": battle.id, "winner_id": winner_id},
        )

    # Clean up Redis
    _cleanup_battle_redis(battle.id)
    _cache_battle_state(battle)

    return battle


def _distribute_bonus_pool(db: Session, battle: PKBattle) -> None:
    """Distribute the bonus pool (30% of all gifts) to the winner."""
    if not battle.winner_id:
        # Draw: split bonus pool evenly between both creators
        total_bonus_a = round(battle.creator_a_score * PK_GIFT_BONUS_POOL, 2)
        total_bonus_b = round(battle.creator_b_score * PK_GIFT_BONUS_POOL, 2)

        # Return bonus to both creators from SYSTEM
        if total_bonus_a > 0:
            create_transaction(
                db=db,
                type="pk_bonus_payout",
                amount=total_bonus_a,
                from_user_id=SYSTEM_USER_ID,
                to_user_id=battle.creator_a_id,
                reference_id=battle.id,
                metadata={"battle_id": battle.id, "payout_type": "draw_split"},
            )
        if total_bonus_b > 0:
            create_transaction(
                db=db,
                type="pk_bonus_payout",
                amount=total_bonus_b,
                from_user_id=SYSTEM_USER_ID,
                to_user_id=battle.creator_b_id,
                reference_id=battle.id,
                metadata={"battle_id": battle.id, "payout_type": "draw_split"},
            )
    else:
        # Winner gets the full bonus pool from both sides
        total_bonus = round(
            (battle.creator_a_score + battle.creator_b_score) * PK_GIFT_BONUS_POOL, 2
        )
        if total_bonus > 0:
            create_transaction(
                db=db,
                type="pk_bonus_payout",
                amount=total_bonus,
                from_user_id=SYSTEM_USER_ID,
                to_user_id=battle.winner_id,
                reference_id=battle.id,
                metadata={"battle_id": battle.id, "payout_type": "winner_bonus"},
            )


def _init_battle_scores(battle_id: str) -> None:
    """Initialize battle scores in Redis."""
    try:
        key = f"pk_scores:{battle_id}"
        redis_client.set(key, json.dumps({"a": 0.0, "b": 0.0}), ex=7200)  # 2h TTL
    except Exception:
        pass


def _update_battle_scores(battle: PKBattle) -> None:
    """Update battle scores in Redis."""
    try:
        key = f"pk_scores:{battle.id}"
        redis_client.set(
            key,
            json.dumps({"a": battle.creator_a_score or 0, "b": battle.creator_b_score or 0}),
            ex=7200,
        )
    except Exception:
        pass


def _get_battle_scores(battle_id: str) -> Dict[str, float]:
    """Get battle scores from Redis."""
    try:
        key = f"pk_scores:{battle_id}"
        data = redis_client.get(key)
        if data:
            return json.loads(data)
    except Exception:
        pass
    return {}


def _publish_score_update(battle: PKBattle) -> None:
    """Publish score update event for WebSocket distribution."""
    try:
        event = {
            "type": "pk_score_update",
            "battle_id": battle.id,
            "creator_a_score": battle.creator_a_score or 0,
            "creator_b_score": battle.creator_b_score or 0,
        }
        redis_client.publish(f"pk_battle:{battle.id}", json.dumps(event))
    except Exception:
        pass


def _cache_battle_state(battle: PKBattle) -> None:
    """Cache battle state in Redis for quick lookups."""
    try:
        key = f"pk_battle:{battle.id}"
        state = {
            "id": battle.id,
            "status": battle.status,
            "creator_a_id": battle.creator_a_id,
            "creator_b_id": battle.creator_b_id,
        }
        redis_client.set(key, json.dumps(state), ex=7200)
    except Exception:
        pass


def _cleanup_battle_redis(battle_id: str) -> None:
    """Clean up Redis keys for a finished battle."""
    try:
        redis_client.delete(f"pk_scores:{battle_id}")
    except Exception:
        pass
