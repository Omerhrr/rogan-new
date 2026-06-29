"""
ROGAN LIVE - Moderation Routes (Phase 4)
Reports, ban/mute, auto-moderation, admin actions.
"""

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import User
from app.routes.auth import get_current_user_dependency
from app.schemas import (
    AutoModCheckRequest,
    AutoModCheckResponse,
    BanRequest,
    ModerationActionRequest,
    ModerationReportCreate,
    ModerationReportResponse,
    MuteRequest,
)
from app.services import moderation_service


class SuspendRequest(BaseModel):
    reason: str
    duration_minutes: Optional[int] = None  # None = permanent


class AppealRequest(BaseModel):
    reason: str
    ban_id: Optional[str] = None


class AppealReviewRequest(BaseModel):
    approved: bool
    reviewer_note: Optional[str] = None


class StreamBanRequest(BaseModel):
    viewer_id: str
    reason: Optional[str] = None

router = APIRouter(prefix="/moderation", tags=["Moderation"])


# ─── Reports ──────────────────────────────────────────────────────


@router.post("/report", status_code=status.HTTP_201_CREATED)
def create_report(
    req: ModerationReportCreate,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """User reports content/user (type: stream/message/user, reason, evidence_url)."""
    report = moderation_service.create_report(
        db=db,
        reporter_id=current_user.id,
        target_type=req.target_type,
        target_id=req.target_id,
        reason=req.reason,
        evidence_url=req.evidence_url,
    )
    return {
        "id": report.id,
        "reporter_id": report.reporter_id,
        "target_type": report.target_type,
        "target_id": report.target_id,
        "reason": report.reason,
        "evidence_url": report.evidence_url,
        "status": report.status,
        "priority": report.priority,
        "created_at": report.created_at.isoformat() if report.created_at else None,
    }


@router.get("/reports")
def list_reports(
    status_filter: Optional[str] = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Admin gets pending reports (pagination, priority sorting)."""
    if current_user.role not in ("admin", "moderator"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin or moderator access required",
        )

    return moderation_service.get_pending_reports(
        db=db,
        page=page,
        limit=limit,
        status_filter=status_filter,
    )


@router.post("/reports/{report_id}/action")
def take_action(
    report_id: str,
    req: ModerationActionRequest,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Admin takes action on a report (warn/mute/ban/dismiss)."""
    if current_user.role not in ("admin", "moderator"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin or moderator access required",
        )

    return moderation_service.take_action(
        db=db,
        report_id=report_id,
        admin_id=current_user.id,
        action=req.action,
        reason=req.reason,
        duration_minutes=req.duration_minutes,
    )


# ─── Ban / Mute ───────────────────────────────────────────────────


@router.post("/ban/{user_id}")
def ban_user(
    user_id: str,
    req: BanRequest,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Ban user (duration, reason). Admin only."""
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can ban users",
        )

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
        "created_at": ban.created_at.isoformat() if ban.created_at else None,
        "message": f"User {req.ban_type.replace('_', ' ')}ed",
    }


@router.post("/mute/{user_id}")
def mute_user(
    user_id: str,
    req: MuteRequest,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Mute user in chat (duration). Admin only."""
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can mute users",
        )

    ban = moderation_service.mute_user(
        db=db,
        user_id=user_id,
        reason=req.reason,
        duration_minutes=req.duration_minutes,
    )
    return {
        "id": ban.id,
        "user_id": ban.user_id,
        "reason": ban.reason,
        "ban_type": ban.ban_type,
        "expires_at": ban.expires_at.isoformat() if ban.expires_at else None,
        "created_at": ban.created_at.isoformat() if ban.created_at else None,
        "message": "User muted",
    }


@router.get("/banned")
def list_banned_users(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """List banned users. Admin only."""
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can view banned users",
        )

    return moderation_service.get_banned_users(db=db, page=page, limit=limit)


# ─── My Ban / Appeal status ──────────────────────────────────────

@router.get("/my-ban")
def my_ban_status(
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Return the caller's active ban (if any) and their most recent appeal."""
    from app.models.models import UserBan, Appeal
    from datetime import datetime

    now = datetime.utcnow()
    active_ban = (
        db.query(UserBan)
        .filter(
            UserBan.user_id == current_user.id,
            UserBan.is_active == True,
            UserBan.ban_type.in_(["full_ban", "live_suspend"]),
        )
        .filter(
            (UserBan.expires_at == None) | (UserBan.expires_at > now)
        )
        .order_by(UserBan.created_at.desc())
        .first()
    )

    latest_appeal = (
        db.query(Appeal)
        .filter(Appeal.user_id == current_user.id)
        .order_by(Appeal.created_at.desc())
        .first()
    ) if active_ban else None

    return {
        "ban": {
            "id": active_ban.id,
            "ban_type": active_ban.ban_type,
            "reason": active_ban.reason,
            "expires_at": active_ban.expires_at.isoformat() if active_ban.expires_at else None,
        } if active_ban else None,
        "appeal": {
            "id": latest_appeal.id,
            "status": latest_appeal.status,
            "reason": latest_appeal.reason,
            "reviewer_note": latest_appeal.reviewer_note,
        } if latest_appeal else None,
    }


# ─── Force-Stop Stream ────────────────────────────────────────────

@router.post("/reports/{report_id}/force-stop")
def force_stop_stream(
    report_id: str,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Mod force-stops the live stream in a stream report."""
    if current_user.role not in ("admin", "moderator"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Moderator access required")
    return moderation_service.force_stop_stream(db=db, report_id=report_id, mod_id=current_user.id)


# ─── Suspend / Lift ───────────────────────────────────────────────

@router.post("/suspend/{user_id}")
def suspend_user(
    user_id: str,
    req: SuspendRequest,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Moderator suspends a creator from going live (live_suspend)."""
    if current_user.role not in ("admin", "moderator"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Moderator access required")
    ban = moderation_service.suspend_user(db=db, user_id=user_id, reason=req.reason, duration_minutes=req.duration_minutes)
    return {
        "id": ban.id,
        "user_id": ban.user_id,
        "ban_type": ban.ban_type,
        "reason": ban.reason,
        "expires_at": ban.expires_at.isoformat() if ban.expires_at else None,
        "message": "User live-suspended",
    }


@router.post("/lift/{user_id}")
def lift_ban(
    user_id: str,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Moderator lifts all active bans/suspensions for a user."""
    if current_user.role not in ("admin", "moderator"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Moderator access required")
    return moderation_service.lift_ban(db=db, user_id=user_id)


# ─── Appeals ──────────────────────────────────────────────────────

@router.post("/appeals", status_code=201)
def submit_appeal(
    req: AppealRequest,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Creator/user submits an appeal against a ban or suspension."""
    appeal = moderation_service.submit_appeal(
        db=db, user_id=current_user.id, reason=req.reason, ban_id=req.ban_id
    )
    return {
        "id": appeal.id,
        "user_id": appeal.user_id,
        "ban_id": appeal.ban_id,
        "reason": appeal.reason,
        "status": appeal.status,
        "created_at": appeal.created_at.isoformat() if appeal.created_at else None,
    }


@router.get("/appeals")
def list_appeals(
    status_filter: Optional[str] = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Moderator views submitted appeals."""
    if current_user.role not in ("admin", "moderator"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Moderator access required")
    return moderation_service.get_appeals(db=db, status_filter=status_filter, page=page, limit=limit)


@router.post("/appeals/{appeal_id}/review")
def review_appeal(
    appeal_id: str,
    req: AppealReviewRequest,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Moderator approves or rejects an appeal."""
    if current_user.role not in ("admin", "moderator"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Moderator access required")
    return moderation_service.review_appeal(
        db=db,
        appeal_id=appeal_id,
        reviewer_id=current_user.id,
        approved=req.approved,
        reviewer_note=req.reviewer_note,
    )


# ─── Stream Bans (creator bans viewer from their stream) ──────────

@router.post("/stream-ban")
def ban_viewer(
    req: StreamBanRequest,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Creator bans a viewer from their stream."""
    if current_user.role not in ("creator", "admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Creator access required")
    ban = moderation_service.ban_viewer_from_stream(
        db=db, creator_id=current_user.id, viewer_id=req.viewer_id, reason=req.reason
    )
    return {"id": ban.id, "banned_user_id": ban.banned_user_id, "message": "Viewer banned from your stream"}


@router.delete("/stream-ban/{viewer_id}")
def unban_viewer(
    viewer_id: str,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Creator lifts a stream ban on a viewer."""
    if current_user.role not in ("creator", "admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Creator access required")
    return moderation_service.unban_viewer_from_stream(db=db, creator_id=current_user.id, viewer_id=viewer_id)


@router.get("/stream-bans")
def list_stream_bans(
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Creator gets list of viewers they've banned from their stream."""
    if current_user.role not in ("creator", "admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Creator access required")
    return {"banned": moderation_service.get_stream_banned_viewers(db=db, creator_id=current_user.id)}


# ─── Auto-Moderation ──────────────────────────────────────────────


@router.post("/automod/check")
def auto_mod_check(
    req: AutoModCheckRequest,
    current_user: User = Depends(get_current_user_dependency),
):
    """Auto-moderation check (profanity filter, spam detection)."""
    result = moderation_service.auto_mod_check(
        content=req.content,
        user_id=req.user_id or current_user.id,
    )
    return AutoModCheckResponse(**result)
