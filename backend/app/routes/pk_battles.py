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


@router.post("/", status_code=status.HTTP_201_CREATED)
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
def accept_battle(
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
    return pk_battle_service.get_battle(db=db, battle_id=battle.id)


@router.post("/{battle_id}/gift", status_code=status.HTTP_201_CREATED)
def send_battle_gift(
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
    return {
        "gift_id": gift.id,
        "amount_tk": gift.amount_tk,
        "side": gift.side,
        "battle": battle_data,
    }


@router.get("/{battle_id}")
def get_battle(
    battle_id: str,
    db: Session = Depends(get_db),
):
    """Get battle status + live scores."""
    return pk_battle_service.get_battle(db=db, battle_id=battle_id)


@router.get("/active")
def list_active_battles(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """List active PK battles."""
    return pk_battle_service.list_active_battles(db=db, page=page, limit=limit)


@router.post("/{battle_id}/end")
def end_battle(
    battle_id: str,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """End a PK battle (manual end by one of the creators or auto)."""
    battle = pk_battle_service.end_battle(
        db=db,
        battle_id=battle_id,
        ended_by_id=current_user.id,
    )
    return pk_battle_service.get_battle(db=db, battle_id=battle.id)
