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
from app.services import gift_service, ledger_service

router = APIRouter(prefix="/creators", tags=["Creators"])


@router.get("/search")
def search_creators(
    q: str = "",
    db: Session = Depends(get_db),
):
    """Search creators by username prefix (for PK challenge UI)."""
    if not q or len(q) < 2:
        return {"creators": []}
    users = (
        db.query(User)
        .filter(
            User.role.in_(["creator", "admin"]),
            User.username.ilike(f"{q}%"),
            User.is_active == True,
        )
        .limit(10)
        .all()
    )
    return {
        "creators": [
            {"id": u.id, "username": u.username, "avatar": u.avatar,
                "banner_url": getattr(u, "banner_url", None), "is_live": u.is_live}
            for u in users
        ]
    }


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
            "banner_url": getattr(user, "banner_url", None),
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
    """Get creator dashboard data (auth required, creator/admin only)."""
    if current_user.role not in ("creator", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only creators can access the dashboard",
        )

    from app.models.models import Follow, Subscription, SubscriptionTier, PKBattle

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
    from app.services.wallet_service import get_linked_wallet
    linked_address = get_linked_wallet(db, current_user.id)
    wallet_data = {
        "tk_balance": ledger_service.get_tk_balance(db=db, user_id=current_user.id),
        "wallet_address": linked_address,
    }

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

    # Follower count
    follower_count = (
        db.query(Follow)
        .filter(Follow.following_id == current_user.id)
        .count()
    )

    # Active subscriber count
    subscriber_count = (
        db.query(Subscription)
        .filter(Subscription.creator_id == current_user.id, Subscription.is_active == True)
        .count()
    )

    # PK battle stats
    pk_total = (
        db.query(PKBattle)
        .filter(
            PKBattle.status == "ended",
            (PKBattle.creator_a_id == current_user.id) | (PKBattle.creator_b_id == current_user.id),
        )
        .count()
    )
    pk_wins = (
        db.query(PKBattle)
        .filter(PKBattle.status == "ended", PKBattle.winner_id == current_user.id)
        .count()
    )

    # Subscription tier count
    sub_tier_count = (
        db.query(SubscriptionTier)
        .filter(SubscriptionTier.creator_id == current_user.id, SubscriptionTier.is_active == True)
        .count()
    )

    return {
        "user": user_data,
        "wallet": wallet_data,
        "gift_stats": gift_stats,
        "recent_streams": recent_streams,
        "tk_balance": tk_balance,
        "follower_count": follower_count,
        "subscriber_count": subscriber_count,
        "pk_wins": pk_wins,
        "pk_total": pk_total,
        "sub_tier_count": sub_tier_count,
    }


@router.get("/dashboard/earnings-chart")
def get_earnings_chart(
    days: int = 7,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Return daily TK earnings for the last N days (creator dashboard chart)."""
    from datetime import datetime, timedelta
    from sqlalchemy import func
    from app.models.models import Transaction

    if current_user.role not in ("creator", "admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Creators only")

    now = datetime.utcnow()
    start = now - timedelta(days=days)

    # Sum of TK received per day (gift_send transactions where to_user_id == creator)
    rows = (
        db.query(
            func.date(Transaction.created_at).label("day"),
            func.coalesce(func.sum(Transaction.amount), 0.0).label("earned"),
        )
        .filter(
            Transaction.to_user_id == current_user.id,
            Transaction.type.in_(["gift_send", "dm_payment", "task_payment", "subscription"]),
            Transaction.created_at >= start,
        )
        .group_by(func.date(Transaction.created_at))
        .order_by(func.date(Transaction.created_at))
        .all()
    )

    # Fill in missing days with 0
    day_map = {str(r.day): float(r.earned) for r in rows}
    chart = []
    for i in range(days):
        day = (start + timedelta(days=i + 1)).date()
        chart.append({"day": day.strftime("%b %d"), "earnings": day_map.get(str(day), 0.0)})

    total = sum(p["earnings"] for p in chart)
    return {"chart": chart, "total": round(total, 2)}


@router.get("/{creator_id}/profile")
def get_creator_profile(
    creator_id: str,
    db: Session = Depends(get_db),
):
    """Public creator profile."""
    from app.models.models import Follow, Subscription
    from app.services.wallet_service import get_linked_wallet

    creator = db.query(User).filter(User.id == creator_id).first()
    if not creator or creator.role not in ("creator", "admin"):
        raise HTTPException(status_code=404, detail="Creator not found")

    follower_count = db.query(Follow).filter(Follow.following_id == creator_id).count()
    subscriber_count = (
        db.query(Subscription)
        .filter(Subscription.creator_id == creator_id, Subscription.is_active == True)
        .count()
    )
    gift_stats = gift_service.get_creator_gift_stats(db=db, creator_id=creator_id)
    tk_balance = ledger_service.get_tk_balance(db=db, user_id=creator_id)

    return {
        "id": creator.id,
        "username": creator.username,
        "display_name": creator.display_name,
        "avatar": creator.avatar,
        "bio": creator.bio if hasattr(creator, "bio") else None,
        "role": creator.role,
        "is_live": creator.is_live,
        "follower_count": follower_count,
        "subscriber_count": subscriber_count,
        "gift_stats": gift_stats,
        "tk_balance": tk_balance,
    }
