"""
ROGAN LIVE - Moderation Routes (Phase 4)
Reports, ban/mute, auto-moderation, admin actions.
"""

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
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


@router.get("/reports/")
def list_reports(
    status_filter: Optional[str] = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Admin gets pending reports (pagination, priority sorting)."""
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can view reports",
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
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can take moderation actions",
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


@router.get("/banned/")
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
