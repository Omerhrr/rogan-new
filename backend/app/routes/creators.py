"""
ROGAN LIVE - Creator Routes
GET /creators/{creator_id}/profile, GET /creators/{creator_id}/earnings,
GET /creators/dashboard
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import Stream, User
from app.routes.auth import get_current_user_dependency
from app.services import gift_service, ledger_service, wallet_service

router = APIRouter(prefix="/creators", tags=["Creators"])


@router.get("/{creator_id}/profile")
def get_creator_profile(creator_id: str, db: Session = Depends(get_db)):
    """Get creator profile with stats."""
    user = db.query(User).filter(User.id == creator_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Creator not found",
        )

    gift_stats = gift_service.get_creator_gift_stats(db=db, creator_id=creator_id)

    return {
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "avatar": user.avatar,
        "bio": user.bio,
        "role": user.role,
        "is_live": user.is_live,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "stats": {
            "total_gifts_received": gift_stats["total_gifts_received"],
            "total_tk_earned": gift_stats["total_tk_earned"],
            "breakdown_by_type": gift_stats["breakdown_by_type"],
        },
    }


@router.get("/{creator_id}/earnings")
def get_creator_earnings(creator_id: str, db: Session = Depends(get_db)):
    """Get creator earnings breakdown."""
    user = db.query(User).filter(User.id == creator_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Creator not found",
        )

    gift_stats = gift_service.get_creator_gift_stats(db=db, creator_id=creator_id)
    tk_balance = ledger_service.get_tk_balance(db=db, user_id=creator_id)

    return {
        "creator_id": creator_id,
        "tk_balance": tk_balance,
        "total_tk_earned": gift_stats["total_tk_earned"],
        "total_gifts_received": gift_stats["total_gifts_received"],
        "breakdown_by_type": gift_stats["breakdown_by_type"],
    }


@router.get("/dashboard")
def get_creator_dashboard(
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Get creator dashboard data (auth required, creator only)."""
    if current_user.role != "creator":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only creators can access the dashboard",
        )

    # User info
    user_data = {
        "id": current_user.id,
        "username": current_user.username,
        "display_name": current_user.display_name,
        "avatar": current_user.avatar,
        "role": current_user.role,
        "is_live": current_user.is_live,
    }

    # Wallet info
    wallet_data = wallet_service.get_wallet(db=db, user_id=current_user.id)

    # Gift stats
    gift_stats = gift_service.get_creator_gift_stats(db=db, creator_id=current_user.id)

    # Recent streams
    streams = (
        db.query(Stream)
        .filter(Stream.creator_id == current_user.id)
        .order_by(Stream.created_at.desc())
        .limit(10)
        .all()
    )
    recent_streams = [
        {
            "id": s.id,
            "title": s.title,
            "is_live": s.is_live,
            "viewer_count": s.viewer_count,
            "category": s.category,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "ended_at": s.ended_at.isoformat() if s.ended_at else None,
        }
        for s in streams
    ]

    tk_balance = ledger_service.get_tk_balance(db=db, user_id=current_user.id)

    return {
        "user": user_data,
        "wallet": wallet_data,
        "gift_stats": gift_stats,
        "recent_streams": recent_streams,
        "tk_balance": tk_balance,
    }
