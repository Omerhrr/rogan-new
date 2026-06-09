"""
ROGAN LIVE - Moderation Service (Phase 4)
Report management, ban/mute enforcement, auto-moderation, strike system.
"""

import json
import re
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.models import ModerationReport, User, UserBan, UserStrike
from app.services.notification_service import create_notification
from app.utils.redis_client import redis_client

# Strike system: 3 strikes → auto-ban
MAX_STRIKES = 3
AUTO_BAN_DURATION_HOURS = 72  # 3 days

# Auto-moderation: profanity patterns
PROFANITY_PATTERNS = [
    r'\b(fuck|shit|damn|ass|bitch|bastard)\b',
    r'\b(nigger|nigga|fag|faggot|retard)\b',
    r'\b(cunt|dick|pussy|cock)\b',
]

# Spam detection thresholds
SPAM_MESSAGE_THRESHOLD = 5  # Messages per 10 seconds
SPAM_WINDOW_SECONDS = 10

# Link filtering pattern
URL_PATTERN = r'https?://[^\s<>"]+|www\.[^\s<>"]+'


def create_report(
    db: Session,
    reporter_id: str,
    target_type: str,
    target_id: str,
    reason: str,
    evidence_url: Optional[str] = None,
) -> ModerationReport:
    """Create a moderation report."""
    # Validate target type
    if target_type not in ("stream", "message", "user"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid target_type. Must be: stream, message, or user",
        )

    # Calculate priority based on report content and reporter history
    priority = _calculate_report_priority(db, reporter_id, target_type, reason)

    report = ModerationReport(
        reporter_id=reporter_id,
        target_type=target_type,
        target_id=target_id,
        reason=reason,
        evidence_url=evidence_url,
        priority=priority,
        status="pending",
    )
    db.add(report)
    db.commit()
    db.refresh(report)

    # Cache the report in Redis for quick admin access
    _cache_report(report)

    return report


def get_pending_reports(
    db: Session,
    page: int = 1,
    limit: int = 20,
    status_filter: Optional[str] = None,
) -> Dict[str, Any]:
    """Get pending reports for admin review (priority-sorted)."""
    query = db.query(ModerationReport)

    if status_filter:
        query = query.filter(ModerationReport.status == status_filter)
    else:
        query = query.filter(ModerationReport.status.in_(["pending", "reviewing"]))

    # Sort by priority (highest first), then by creation date
    query = query.order_by(ModerationReport.priority.desc(), ModerationReport.created_at.desc())

    total = query.count()
    offset = (page - 1) * limit
    reports = query.offset(offset).limit(limit).all()

    return {
        "reports": [
            {
                "id": r.id,
                "reporter_id": r.reporter_id,
                "target_type": r.target_type,
                "target_id": r.target_id,
                "reason": r.reason,
                "evidence_url": r.evidence_url,
                "status": r.status,
                "priority": r.priority,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "resolved_at": r.resolved_at.isoformat() if r.resolved_at else None,
                "resolver_id": r.resolver_id,
            }
            for r in reports
        ],
        "total": total,
        "page": page,
        "limit": limit,
        "pages": (total + limit - 1) // limit if total > 0 else 0,
    }


def take_action(
    db: Session,
    report_id: str,
    admin_id: str,
    action: str,
    reason: Optional[str] = None,
    duration_minutes: Optional[int] = None,
) -> Dict[str, Any]:
    """Admin takes action on a report: warn, mute, ban, or dismiss."""
    report = db.query(ModerationReport).filter(ModerationReport.id == report_id).first()
    if not report:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report not found",
        )

    if action not in ("warn", "mute", "ban", "dismiss"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid action. Must be: warn, mute, ban, or dismiss",
        )

    result = {"report_id": report_id, "action": action}

    if action == "dismiss":
        report.status = "dismissed"
        report.resolver_id = admin_id
        report.resolved_at = datetime.utcnow()
        result["message"] = "Report dismissed"
    elif action == "warn":
        report.status = "resolved"
        report.resolver_id = admin_id
        report.resolved_at = datetime.utcnow()
        # Add a strike
        _add_strike(db, report.target_id, reason or "Warning from moderation")
        # Notify user
        create_notification(
            db=db,
            user_id=report.target_id if report.target_type == "user" else None,
            type="moderation",
            title="Warning",
            message=reason or "You have received a warning from moderation",
            metadata={"report_id": report_id, "action": "warn"},
        )
        result["message"] = "User warned"
    elif action == "mute":
        report.status = "resolved"
        report.resolver_id = admin_id
        report.resolved_at = datetime.utcnow()
        mute_duration = duration_minutes or 60  # Default 1 hour
        _mute_user(db, report.target_id, reason or "Muted by moderator", mute_duration)
        result["message"] = f"User muted for {mute_duration} minutes"
    elif action == "ban":
        report.status = "resolved"
        report.resolver_id = admin_id
        report.resolved_at = datetime.utcnow()
        ban_duration = duration_minutes  # None = permanent
        _ban_user(db, report.target_id, reason or "Banned by moderator", "full_ban", ban_duration)
        result["message"] = "User banned"

    db.commit()
    return result


def ban_user(
    db: Session,
    user_id: str,
    reason: str,
    ban_type: str = "full_ban",
    duration_minutes: Optional[int] = None,
) -> UserBan:
    """Ban or mute a user directly."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return _ban_user(db, user_id, reason, ban_type, duration_minutes)


def mute_user(
    db: Session,
    user_id: str,
    reason: str,
    duration_minutes: int,
) -> UserBan:
    """Mute a user in chat."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return _mute_user(db, user_id, reason, duration_minutes)


def get_banned_users(
    db: Session,
    page: int = 1,
    limit: int = 20,
) -> Dict[str, Any]:
    """List currently banned users (active bans only)."""
    now = datetime.utcnow()
    query = (
        db.query(UserBan)
        .filter(
            (UserBan.expires_at == None) | (UserBan.expires_at > now)
        )
        .order_by(UserBan.created_at.desc())
    )

    total = query.count()
    offset = (page - 1) * limit
    bans = query.offset(offset).limit(limit).all()

    return {
        "banned_users": [
            {
                "id": b.id,
                "user_id": b.user_id,
                "reason": b.reason,
                "ban_type": b.ban_type,
                "expires_at": b.expires_at.isoformat() if b.expires_at else None,
                "created_at": b.created_at.isoformat() if b.created_at else None,
            }
            for b in bans
        ],
        "total": total,
        "page": page,
        "limit": limit,
        "pages": (total + limit - 1) // limit if total > 0 else 0,
    }


def check_user_banned(db: Session, user_id: str) -> Optional[Dict[str, Any]]:
    """Check if a user is currently banned or muted. Returns ban info or None."""
    # Check Redis cache first
    try:
        cache_key = f"user_ban:{user_id}"
        cached = redis_client.get(cache_key)
        if cached:
            return json.loads(cached)
    except Exception:
        pass

    now = datetime.utcnow()
    ban = (
        db.query(UserBan)
        .filter(
            UserBan.user_id == user_id,
            (UserBan.expires_at == None) | (UserBan.expires_at > now),
        )
        .order_by(UserBan.created_at.desc())
        .first()
    )

    if not ban:
        # Cache negative result briefly
        try:
            redis_client.set(f"user_ban:{user_id}", json.dumps(None), ex=60)
        except Exception:
            pass
        return None

    ban_info = {
        "id": ban.id,
        "user_id": ban.user_id,
        "reason": ban.reason,
        "ban_type": ban.ban_type,
        "expires_at": ban.expires_at.isoformat() if ban.expires_at else None,
    }

    # Cache result
    try:
        ttl = 300  # 5 minutes
        if ban.expires_at:
            remaining = (ban.expires_at - now).total_seconds()
            ttl = min(int(remaining), 300)
        redis_client.set(f"user_ban:{user_id}", json.dumps(ban_info), ex=max(ttl, 10))
    except Exception:
        pass

    return ban_info


def auto_mod_check(content: str, user_id: Optional[str] = None) -> Dict[str, Any]:
    """Auto-moderation check for content.
    Checks for: profanity, spam, links.
    Returns whether flagged, reasons, and severity.
    """
    reasons: List[str] = []
    severity = "none"

    # Profanity check
    has_profanity = _check_profanity(content)
    if has_profanity:
        reasons.append("profanity")
        severity = "medium"

    # Link filtering
    has_links = _check_links(content)
    if has_links:
        reasons.append("contains_links")
        if severity == "none":
            severity = "low"

    # Spam detection
    if user_id:
        is_spam = _check_spam(user_id, content)
        if is_spam:
            reasons.append("spam_detected")
            severity = "high"

    # Hate speech check (extended profanity patterns)
    has_hate = _check_hate_speech(content)
    if has_hate:
        reasons.append("hate_speech")
        severity = "high"

    return {
        "is_flagged": len(reasons) > 0,
        "reasons": reasons,
        "severity": severity,
    }


# ─── Private Helpers ──────────────────────────────────────────────


def _calculate_report_priority(
    db: Session, reporter_id: str, target_type: str, reason: str
) -> int:
    """Calculate report priority (higher = more urgent)."""
    priority = 0

    # User reports are higher priority
    if target_type == "user":
        priority += 3
    elif target_type == "stream":
        priority += 2
    elif target_type == "message":
        priority += 1

    # Reason keywords that increase priority
    high_priority_keywords = ["threat", "violence", "minor", "illegal", "csam", "self-harm"]
    for keyword in high_priority_keywords:
        if keyword in reason.lower():
            priority += 5
            break

    return priority


def _add_strike(db: Session, user_id: str, reason: str) -> UserStrike:
    """Add a strike to a user. Auto-bans after MAX_STRIKES."""
    strike = UserStrike(
        user_id=user_id,
        reason=reason,
    )
    db.add(strike)

    # Check total strikes
    strike_count = db.query(UserStrike).filter(UserStrike.user_id == user_id).count() + 1

    if strike_count >= MAX_STRIKES:
        # Auto-ban
        _ban_user(
            db,
            user_id,
            reason=f"Auto-banned: {MAX_STRIKES} strikes reached",
            ban_type="full_ban",
            duration_minutes=AUTO_BAN_DURATION_HOURS * 60,
        )

    db.commit()
    return strike


def _ban_user(
    db: Session,
    user_id: str,
    reason: str,
    ban_type: str = "full_ban",
    duration_minutes: Optional[int] = None,
) -> UserBan:
    """Internal: create a ban record."""
    expires_at = None
    if duration_minutes:
        expires_at = datetime.utcnow() + timedelta(minutes=duration_minutes)

    ban = UserBan(
        user_id=user_id,
        reason=reason,
        ban_type=ban_type,
        expires_at=expires_at,
    )
    db.add(ban)
    db.commit()
    db.refresh(ban)

    # Cache the ban
    _cache_ban(ban)

    # Notify user
    create_notification(
        db=db,
        user_id=user_id,
        type="moderation",
        title="Account Restricted",
        message=f"Your account has been {ban_type.replace('_', ' ')}ed. Reason: {reason}",
        metadata={"ban_id": ban.id, "ban_type": ban_type},
    )

    return ban


def _mute_user(db: Session, user_id: str, reason: str, duration_minutes: int) -> UserBan:
    """Internal: mute a user (creates a chat_mute ban record)."""
    return _ban_user(db, user_id, reason, ban_type="chat_mute", duration_minutes=duration_minutes)


def _check_profanity(content: str) -> bool:
    """Check content for profanity using regex patterns."""
    content_lower = content.lower()
    for pattern in PROFANITY_PATTERNS:
        if re.search(pattern, content_lower, re.IGNORECASE):
            return True
    return False


def _check_hate_speech(content: str) -> bool:
    """Check content for hate speech patterns."""
    hate_patterns = [
        r'\b(kill\s+(your|ur)?self|die|suicide)\b',
        r'\b(terrorist|terrorism)\b',
    ]
    content_lower = content.lower()
    for pattern in hate_patterns:
        if re.search(pattern, content_lower, re.IGNORECASE):
            return True
    return False


def _check_links(content: str) -> bool:
    """Check content for URLs/links."""
    return bool(re.search(URL_PATTERN, content))


def _check_spam(user_id: str, content: str) -> bool:
    """Check if user is sending messages too frequently (spam detection)."""
    try:
        key = f"spam:{user_id}"
        now = datetime.utcnow().timestamp()

        # Get message timestamps from Redis
        data = redis_client.get(key)
        if data:
            timestamps = json.loads(data)
        else:
            timestamps = []

        # Add current timestamp
        timestamps.append(now)

        # Remove old timestamps outside the window
        window_start = now - SPAM_WINDOW_SECONDS
        timestamps = [t for t in timestamps if t > window_start]

        # Store back
        redis_client.set(key, json.dumps(timestamps), ex=SPAM_WINDOW_SECONDS)

        return len(timestamps) >= SPAM_MESSAGE_THRESHOLD
    except Exception:
        return False


def _cache_report(report: ModerationReport) -> None:
    """Cache a report in Redis for quick admin access."""
    try:
        key = f"mod_report:{report.id}"
        data = {
            "id": report.id,
            "status": report.status,
            "priority": report.priority,
        }
        redis_client.set(key, json.dumps(data), ex=3600)  # 1 hour
    except Exception:
        pass


def _cache_ban(ban: UserBan) -> None:
    """Cache a ban record in Redis for fast lookup."""
    try:
        ban_info = {
            "id": ban.id,
            "user_id": ban.user_id,
            "reason": ban.reason,
            "ban_type": ban.ban_type,
            "expires_at": ban.expires_at.isoformat() if ban.expires_at else None,
        }
        redis_client.set(f"user_ban:{ban.user_id}", json.dumps(ban_info), ex=300)
    except Exception:
        pass
