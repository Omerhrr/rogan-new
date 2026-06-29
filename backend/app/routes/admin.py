"""
ROGAN LIVE — Admin Routes
Full admin panel: stats, user management, stream oversight, transactions.
Role access:
  - admin: full access to all endpoints
  - moderator: reports/moderation + streams only
"""

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, desc, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import (
    Gift, ModerationReport, Stream, Transaction, User, UserBan
)
from app.routes.auth import get_current_user_dependency

router = APIRouter(prefix="/admin", tags=["Admin"])


# ─── Guards ────────────────────────────────────────────────────────────────────

def require_admin(current_user: User = Depends(get_current_user_dependency)) -> User:
    if current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user


def require_admin_or_moderator(current_user: User = Depends(get_current_user_dependency)) -> User:
    if current_user.role not in ("admin", "moderator"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin or moderator access required")
    return current_user


# ─── Schemas ───────────────────────────────────────────────────────────────────

class RoleUpdateRequest(BaseModel):
    role: str  # user | creator | moderator | admin

class BanUserRequest(BaseModel):
    reason: str
    ban_type: str = "full_ban"        # full_ban | chat_mute | stream_ban
    duration_minutes: Optional[int] = None  # None = permanent

class ForceEndStreamRequest(BaseModel):
    reason: Optional[str] = "Ended by admin"

class ReportActionRequest(BaseModel):
    action: str                        # warn | mute | ban | dismiss
    reason: Optional[str] = "Admin action"
    duration_minutes: Optional[int] = None


# ─── Helpers ───────────────────────────────────────────────────────────────────

def _active_ban_filter():
    """SQLAlchemy filter expression for currently active bans (no is_active column)."""
    now = datetime.utcnow()
    return (UserBan.expires_at == None) | (UserBan.expires_at > now)  # noqa: E711


def _user_dict(u: User) -> Dict[str, Any]:
    return {
        "id": u.id,
        "username": u.username,
        "display_name": u.display_name,
        "email": u.email,
        "role": u.role,
        "is_active": u.is_active,
        "is_live": u.is_live,
        "avatar": u.avatar,
        "created_at": u.created_at.isoformat() if u.created_at else None,
    }


def _stream_dict(s: Stream) -> Dict[str, Any]:
    return {
        "id": s.id,
        "title": s.title,
        "creator_id": s.creator_id,
        "creator_username": s.creator.username if s.creator else None,
        "creator_display_name": s.creator.display_name if s.creator else None,
        "is_live": s.is_live,
        "is_private": s.is_private,
        "viewer_count": s.viewer_count,
        "category": s.category,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "ended_at": s.ended_at.isoformat() if s.ended_at else None,
    }


# ─── Stats ─────────────────────────────────────────────────────────────────────

@router.get("/stats")
def get_stats(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Platform-wide stats for admin overview."""
    total_users = db.query(func.count(User.id)).scalar() or 0
    total_creators = db.query(func.count(User.id)).filter(User.role == "creator").scalar() or 0
    total_admins = db.query(func.count(User.id)).filter(User.role == "admin").scalar() or 0
    total_moderators = db.query(func.count(User.id)).filter(User.role == "moderator").scalar() or 0
    active_streams = db.query(func.count(Stream.id)).filter(Stream.is_live == True).scalar() or 0
    total_streams = db.query(func.count(Stream.id)).scalar() or 0

    total_gifted = db.query(func.sum(Gift.amount)).scalar() or 0.0
    total_transactions = db.query(func.count(Transaction.id)).scalar() or 0

    pending_reports = db.query(func.count(ModerationReport.id)).filter(
        ModerationReport.status == "pending"
    ).scalar() or 0

    # Active bans: expires_at IS NULL (permanent) or expires_at > now
    active_bans = db.query(func.count(UserBan.id)).filter(_active_ban_filter()).scalar() or 0

    week_ago = datetime.utcnow() - timedelta(days=7)
    new_users_7d = db.query(func.count(User.id)).filter(User.created_at >= week_ago).scalar() or 0

    return {
        "users": {
            "total": total_users,
            "creators": total_creators,
            "moderators": total_moderators,
            "admins": total_admins,
            "new_last_7d": new_users_7d,
        },
        "streams": {
            "active": active_streams,
            "total": total_streams,
        },
        "economy": {
            "total_tk_gifted": round(total_gifted, 2),
            "total_transactions": total_transactions,
        },
        "moderation": {
            "pending_reports": pending_reports,
            "active_bans": active_bans,
        },
    }


# ─── Users ─────────────────────────────────────────────────────────────────────

@router.get("/users")
def list_users(
    q: Optional[str] = Query(None, description="Search by username or email"),
    role: Optional[str] = Query(None, description="Filter by role"),
    is_active: Optional[bool] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=100),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Paginated user list with optional search and role filter."""
    query = db.query(User)

    if q:
        term = f"%{q.strip()}%"
        query = query.filter(or_(User.username.ilike(term), User.email.ilike(term), User.display_name.ilike(term)))
    if role:
        query = query.filter(User.role == role)
    if is_active is not None:
        query = query.filter(User.is_active == is_active)

    total = query.count()
    users = query.order_by(desc(User.created_at)).offset((page - 1) * limit).limit(limit).all()

    return {
        "users": [_user_dict(u) for u in users],
        "total": total,
        "page": page,
        "limit": limit,
        "pages": max(1, (total + limit - 1) // limit),
    }


@router.get("/users/{user_id}")
def get_user(
    user_id: str,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Get full user details including active ban and stream count."""
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")

    stream_count = db.query(func.count(Stream.id)).filter(Stream.creator_id == user_id).scalar() or 0
    ban = db.query(UserBan).filter(UserBan.user_id == user_id, _active_ban_filter()).first()

    return {
        **_user_dict(u),
        "stream_count": stream_count,
        "active_ban": {
            "id": ban.id,
            "ban_type": ban.ban_type,
            "reason": ban.reason,
            "expires_at": ban.expires_at.isoformat() if ban.expires_at else None,
        } if ban else None,
    }


@router.patch("/users/{user_id}/role")
def update_user_role(
    user_id: str,
    req: RoleUpdateRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Change a user's role. Admins cannot demote themselves."""
    valid_roles = {"user", "creator", "moderator", "admin"}
    if req.role not in valid_roles:
        raise HTTPException(status_code=400, detail=f"Invalid role. Must be one of: {', '.join(valid_roles)}")
    if user_id == admin.id and req.role != "admin":
        raise HTTPException(status_code=400, detail="Admins cannot change their own role")

    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")

    old_role = u.role
    u.role = req.role
    db.commit()
    db.refresh(u)
    return {"message": f"Role updated from '{old_role}' to '{req.role}'", "user": _user_dict(u)}


@router.patch("/users/{user_id}/status")
def toggle_user_status(
    user_id: str,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Toggle user active/suspended status."""
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot suspend yourself")

    u.is_active = not u.is_active
    db.commit()
    return {"message": f"User {'activated' if u.is_active else 'suspended'}", "is_active": u.is_active}


@router.post("/users/{user_id}/ban")
def ban_user(
    user_id: str,
    req: BanUserRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Ban a user. ban_type: full_ban | chat_mute. duration_minutes=None means permanent."""
    from app.services import moderation_service
    ban = moderation_service.ban_user(
        db=db,
        user_id=user_id,
        reason=req.reason,
        ban_type=req.ban_type,
        duration_minutes=req.duration_minutes,
    )
    return {
        "id": ban.id,
        "user_id": ban.user_id,
        "reason": ban.reason,
        "ban_type": ban.ban_type,
        "expires_at": ban.expires_at.isoformat() if ban.expires_at else None,
    }


@router.post("/users/{user_id}/unban")
def unban_user(
    user_id: str,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Lift all active bans for a user by setting expires_at to now."""
    now = datetime.utcnow()
    bans = db.query(UserBan).filter(UserBan.user_id == user_id, _active_ban_filter()).all()
    if not bans:
        raise HTTPException(status_code=404, detail="No active bans found for this user")
    for b in bans:
        b.expires_at = now  # expire immediately
    db.commit()

    # Clear Redis ban cache if available
    try:
        from app.services.moderation_service import redis_client
        redis_client.delete(f"user_ban:{user_id}")
    except Exception:
        pass

    return {"message": f"Lifted {len(bans)} active ban(s)", "user_id": user_id}


# ─── Streams ───────────────────────────────────────────────────────────────────

@router.get("/streams")
def list_streams(
    is_live: Optional[bool] = Query(None),
    q: Optional[str] = Query(None, description="Search by title"),
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=100),
    admin: User = Depends(require_admin_or_moderator),
    db: Session = Depends(get_db),
):
    """All streams, filterable by live status or search."""
    from sqlalchemy.orm import joinedload
    query = db.query(Stream).options(joinedload(Stream.creator))

    if is_live is not None:
        query = query.filter(Stream.is_live == is_live)
    if q:
        query = query.filter(Stream.title.ilike(f"%{q.strip()}%"))

    total = query.count()
    streams = query.order_by(desc(Stream.created_at)).offset((page - 1) * limit).limit(limit).all()

    return {
        "streams": [_stream_dict(s) for s in streams],
        "total": total,
        "page": page,
        "limit": limit,
        "pages": max(1, (total + limit - 1) // limit),
    }


@router.post("/streams/{stream_id}/end")
def force_end_stream(
    stream_id: str,
    req: ForceEndStreamRequest = ForceEndStreamRequest(),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Force-end a live stream."""
    stream = db.query(Stream).filter(Stream.id == stream_id).first()
    if not stream:
        raise HTTPException(status_code=404, detail="Stream not found")
    if not stream.is_live:
        raise HTTPException(status_code=400, detail="Stream is not currently live")

    stream.is_live = False
    stream.ended_at = datetime.utcnow()
    creator = db.query(User).filter(User.id == stream.creator_id).first()
    if creator:
        creator.is_live = False
    db.commit()
    return {"message": "Stream ended", "stream_id": stream_id, "reason": req.reason}


# ─── Transactions ──────────────────────────────────────────────────────────────

@router.get("/transactions")
def list_transactions(
    tx_type: Optional[str] = Query(None, description="Filter by type"),
    user_id: Optional[str] = Query(None, description="Filter by user"),
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=100),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """All platform transactions."""
    query = db.query(Transaction)
    if tx_type:
        query = query.filter(Transaction.type == tx_type)
    if user_id:
        query = query.filter(or_(Transaction.from_user_id == user_id, Transaction.to_user_id == user_id))

    total = query.count()
    txs = query.order_by(desc(Transaction.created_at)).offset((page - 1) * limit).limit(limit).all()

    user_ids = {t.from_user_id for t in txs} | {t.to_user_id for t in txs}
    users_map = {u.id: u.username for u in db.query(User).filter(User.id.in_(user_ids)).all()}

    return {
        "transactions": [
            {
                "id": t.id,
                "type": t.type,
                "amount": t.amount,
                "from_user_id": t.from_user_id,
                "from_username": users_map.get(t.from_user_id),
                "to_user_id": t.to_user_id,
                "to_username": users_map.get(t.to_user_id),
                "reference_id": t.reference_id,
                "created_at": t.created_at.isoformat() if t.created_at else None,
            }
            for t in txs
        ],
        "total": total,
        "page": page,
        "limit": limit,
        "pages": max(1, (total + limit - 1) // limit),
    }


# ─── Reports ──────────────────────────────────────────────────────────────────

@router.get("/reports")
def list_all_reports(
    status_filter: Optional[str] = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=100),
    admin: User = Depends(require_admin_or_moderator),
    db: Session = Depends(get_db),
):
    """All reports (admins + moderators)."""
    from app.services import moderation_service
    return moderation_service.get_pending_reports(db=db, page=page, limit=limit, status_filter=status_filter)


@router.post("/reports/{report_id}/action")
def take_report_action(
    report_id: str,
    req: ReportActionRequest,
    admin: User = Depends(require_admin_or_moderator),
    db: Session = Depends(get_db),
):
    """Take action on a report (warn | mute | ban | dismiss)."""
    from app.services import moderation_service
    return moderation_service.take_action(
        db=db,
        report_id=report_id,
        admin_id=admin.id,
        action=req.action,
        reason=req.reason or "Admin action",
        duration_minutes=req.duration_minutes,
    )


# ─── Economy Summary ───────────────────────────────────────────────────────────

@router.get("/economy")
def economy_summary(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Platform economy overview: TK circulation, deposits, withdrawals, top earners."""
    total_deposited = db.query(func.sum(Transaction.amount)).filter(Transaction.type == "deposit").scalar() or 0.0
    total_withdrawn  = db.query(func.sum(Transaction.amount)).filter(Transaction.type == "withdraw").scalar() or 0.0
    total_gifted     = db.query(func.sum(Transaction.amount)).filter(Transaction.type == "gift_send").scalar() or 0.0
    tk_in_circulation = max(total_deposited - total_withdrawn, 0)

    # Top earners by gifts received (using to_user_id on gift_send transactions)
    top_rows = (
        db.query(Transaction.to_user_id, func.sum(Transaction.amount).label("earned"))
        .filter(Transaction.type.in_(["gift_send", "subscription", "private_show_entry", "dm_payment"]))
        .group_by(Transaction.to_user_id)
        .order_by(desc("earned"))
        .limit(10)
        .all()
    )
    user_ids = [r.to_user_id for r in top_rows]
    umap = {u.id: u.username for u in db.query(User).filter(User.id.in_(user_ids)).all()}
    top_earners = [{"user_id": r.to_user_id, "username": umap.get(r.to_user_id), "earned": float(r.earned)} for r in top_rows]

    # Recent deposits and withdrawals
    recent_txs = (
        db.query(Transaction)
        .filter(Transaction.type.in_(["deposit", "withdraw"]))
        .order_by(desc(Transaction.created_at))
        .limit(20)
        .all()
    )
    tx_user_ids = {t.from_user_id for t in recent_txs} | {t.to_user_id for t in recent_txs}
    tx_umap = {u.id: u.username for u in db.query(User).filter(User.id.in_(tx_user_ids)).all()}

    return {
        "economy": {
            "tk_in_circulation": round(tk_in_circulation, 2),
            "total_deposited":   round(float(total_deposited), 2),
            "total_withdrawn":   round(float(total_withdrawn), 2),
            "total_gifted":      round(float(total_gifted), 2),
        },
        "top_earners": top_earners,
        "recent_flow": [
            {
                "id": t.id,
                "type": t.type,
                "amount": t.amount,
                "user_id": t.from_user_id if t.type == "withdraw" else t.to_user_id,
                "username": tx_umap.get(t.from_user_id if t.type == "withdraw" else t.to_user_id),
                "created_at": t.created_at.isoformat() if t.created_at else None,
            }
            for t in recent_txs
        ],
    }


# ─── Creator Leaderboard ───────────────────────────────────────────────────────

@router.get("/creators")
def creator_leaderboard(
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=100),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Top creators ranked by total TK earned."""
    from app.models.models import Stream, Follower
    rows = (
        db.query(Transaction.to_user_id, func.sum(Transaction.amount).label("earned"))
        .filter(Transaction.type.in_(["gift_send", "subscription", "private_show_entry", "dm_payment", "pk_bonus_payout"]))
        .group_by(Transaction.to_user_id)
        .order_by(desc("earned"))
        .offset((page - 1) * limit)
        .limit(limit)
        .all()
    )
    user_ids = [r.to_user_id for r in rows]
    users = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()}
    stream_counts = {
        row[0]: row[1]
        for row in db.query(Stream.creator_id, func.count(Stream.id))
        .filter(Stream.creator_id.in_(user_ids))
        .group_by(Stream.creator_id)
        .all()
    }

    return {
        "creators": [
            {
                "user_id": r.to_user_id,
                "username": users[r.to_user_id].username if r.to_user_id in users else None,
                "display_name": users[r.to_user_id].display_name if r.to_user_id in users else None,
                "avatar": users[r.to_user_id].avatar if r.to_user_id in users else None,
                "is_live": users[r.to_user_id].is_live if r.to_user_id in users else False,
                "earned_tk": float(r.earned),
                "stream_count": stream_counts.get(r.to_user_id, 0),
            }
            for r in rows
        ],
        "page": page,
        "limit": limit,
    }


# ─── Broadcast Notification ────────────────────────────────────────────────────

class BroadcastRequest(BaseModel):
    title: str
    message: str
    type: str = "announcement"  # announcement | warning | info


@router.post("/notifications/broadcast")
def broadcast_notification(
    req: BroadcastRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Broadcast a notification to all active users."""
    from app.services.notification_service import create_notification
    user_ids = [row[0] for row in db.query(User.id).filter(User.is_active == True).all()]
    sent = 0
    for uid in user_ids:
        try:
            create_notification(db=db, user_id=uid, type=req.type,
                                title=req.title, message=req.message,
                                metadata={"broadcaster": admin.id})
            sent += 1
        except Exception:
            pass
    db.commit()
    return {"sent": sent, "message": f"Broadcast sent to {sent} users"}


# ─── Platform Config ───────────────────────────────────────────────────────────

import json as _json, os as _os

_CONFIG_PATH = _os.path.join(_os.path.dirname(__file__), "../platform_config.json")

_DEFAULT_CONFIG = {
    "platform_fee_phase1": 0.10,
    "platform_fee_phase2": 0.20,
    "platform_fee_phase3": 0.30,
    "withdraw_fee": 0.02,
    "tk_to_rogan_rate": 1.0,
    "max_streams_per_creator": 1,
    "gift_rate_limit_per_sec": 10,
    "dm_rate_limit_per_sec": 5,
    "live_streaming_enabled": True,
    "gifts_enabled": True,
    "private_shows_enabled": True,
    "pk_battles_enabled": True,
}


def _read_config() -> dict:
    try:
        if _os.path.exists(_CONFIG_PATH):
            return {**_DEFAULT_CONFIG, **_json.load(open(_CONFIG_PATH))}
    except Exception:
        pass
    return dict(_DEFAULT_CONFIG)


def _write_config(cfg: dict) -> None:
    _json.dump(cfg, open(_CONFIG_PATH, "w"), indent=2)


@router.get("/platform/config")
def get_platform_config(admin: User = Depends(require_admin)):
    """Read platform configuration."""
    return _read_config()


class PlatformConfigPatch(BaseModel):
    platform_fee_phase1: Optional[float] = None
    platform_fee_phase2: Optional[float] = None
    platform_fee_phase3: Optional[float] = None
    withdraw_fee: Optional[float] = None
    tk_to_rogan_rate: Optional[float] = None
    max_streams_per_creator: Optional[int] = None
    gift_rate_limit_per_sec: Optional[int] = None
    dm_rate_limit_per_sec: Optional[int] = None
    live_streaming_enabled: Optional[bool] = None
    gifts_enabled: Optional[bool] = None
    private_shows_enabled: Optional[bool] = None
    pk_battles_enabled: Optional[bool] = None


@router.patch("/platform/config")
def update_platform_config(
    req: PlatformConfigPatch,
    admin: User = Depends(require_admin),
):
    """Update one or more platform config keys."""
    cfg = _read_config()
    patch = {k: v for k, v in req.model_dump().items() if v is not None}
    cfg.update(patch)
    _write_config(cfg)
    return cfg
