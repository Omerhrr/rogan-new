"""
ROGAN LIVE - PK Battle Routes (Phase 3)
Challenge, accept, gift, score tracking, and battle management.
"""

from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import User
from app.routes.auth import get_current_user_dependency
from app.schemas import (
    PKBattleAccept,
    PKBattleCreate,
    PKBattleGiftCreate,
    PKBattleResponse,
)
from app.services import pk_battle_service

router = APIRouter(prefix="/pk-battles", tags=["PK Battles"])


# ── GET routes must come before parameterised /{battle_id} routes ─────────────

@router.get("/active")
def list_active_battles(db: Session = Depends(get_db)):
    """Return all currently active PK battles."""
    return {"battles": pk_battle_service.list_active_battles(db=db)}


@router.get("/creator/{creator_id}/active")
def get_creator_active_battle(creator_id: str, db: Session = Depends(get_db)):
    """Return the active (or pending) battle for a given creator, or null."""
    from app.models.models import PKBattle
    battle = (
        db.query(PKBattle)
        .filter(
            PKBattle.status.in_(["pending", "active"]),
            (PKBattle.creator_a_id == creator_id) | (PKBattle.creator_b_id == creator_id),
        )
        .first()
    )
    if not battle:
        return {"battle": None}
    return {"battle": pk_battle_service.get_battle(db=db, battle_id=battle.id)}


@router.get("/{battle_id}")
def get_battle(
    battle_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_dependency),
):
    """Fetch a single battle by ID."""
    data = pk_battle_service.get_battle(db=db, battle_id=battle_id)
    if not data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Battle not found")
    return data


@router.post("", status_code=status.HTTP_201_CREATED)
def create_battle(
    req: PKBattleCreate,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Creator challenges another creator to a PK battle."""
    if current_user.role not in ("creator", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only creators can start PK battles",
        )

    battle = pk_battle_service.create_battle(
        db=db,
        creator_a_id=current_user.id,
        creator_b_id=req.creator_b_id,
        duration_minutes=req.duration_minutes,
        entry_gift_requirements=req.entry_gift_requirements,
    )
    return pk_battle_service.get_battle(db=db, battle_id=battle.id)


@router.post("/{battle_id}/accept")
async def accept_battle(
    battle_id: str,
    req: PKBattleAccept,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Opponent accepts the PK battle challenge."""
    battle = pk_battle_service.accept_battle(
        db=db,
        battle_id=battle_id,
        creator_b_id=current_user.id,
    )
    battle_data = pk_battle_service.get_battle(db=db, battle_id=battle.id)

    # Broadcast battle started event to everyone in the PK room
    from app.websocket.handler import manager
    await manager.broadcast_to_stream(battle_id, {
        "type": "pk_battle_started",
        "battle_id": battle_id,
        "creator_a_id": battle.creator_a_id,
        "creator_b_id": battle.creator_b_id,
        "creator_a_username": battle_data.get("creator_a_username"),
        "creator_b_username": battle_data.get("creator_b_username"),
        "duration_minutes": battle.duration_minutes,
        "started_at": battle.started_at.isoformat() if battle.started_at else None,
    })

    return battle_data


@router.post("/{battle_id}/gift", status_code=status.HTTP_201_CREATED)
async def send_battle_gift(
    battle_id: str,
    req: PKBattleGiftCreate,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Viewer sends a gift to support a side (70% to creator, 30% to winner bonus)."""
    gift = pk_battle_service.send_battle_gift(
        db=db,
        battle_id=battle_id,
        sender_id=current_user.id,
        amount_tk=req.amount_tk,
        side=req.side,
    )
    battle_data = pk_battle_service.get_battle(db=db, battle_id=battle_id)

    # Broadcast score update to everyone watching the battle
    from app.websocket.handler import manager
    await manager.broadcast_to_stream(battle_id, {
        "type": "pk_score_update",
        "battle_id": battle_id,
        "creator_a_score": battle_data["creator_a_score"],
        "creator_b_score": battle_data["creator_b_score"],
        "sender_username": current_user.username,
        "amount_tk": req.amount_tk,
        "side": req.side,
    })

    return {"message": "gift sent", "battle": battle_data}


@router.post("/{battle_id}/end")
async def end_battle(
    battle_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_dependency),
):
    battle = pk_battle_service.end_battle(db=db, battle_id=battle_id, ended_by=current_user.id)
    battle_data = pk_battle_service.get_battle(db=db, battle_id=battle_id)
    from app.websocket.handler import manager
    await manager.broadcast_to_stream(battle_id, {
        "type": "pk_battle_ended",
        "battle_id": battle_id,
        "winner_id": battle.winner_id,
        "creator_a_score": battle.creator_a_score,
        "creator_b_score": battle.creator_b_score,
    })
    return battle_data
