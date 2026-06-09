"""
ROGAN LIVE - Notification Service
Create, list, and manage user notifications.
"""

import json
from typing import Any, Dict, Optional

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.models import Notification


def create_notification(
    db: Session,
    user_id: str,
    type: str,
    title: str,
    message: str,
    metadata: Optional[Dict[str, Any]] = None,
) -> Notification:
    """Create a new notification for a user."""
    notification = Notification(
        user_id=user_id,
        type=type,
        title=title,
        message=message,
        metadata_json=json.dumps(metadata) if metadata else None,
    )
    db.add(notification)
    db.commit()
    db.refresh(notification)
    return notification


def get_notifications(
    db: Session,
    user_id: str,
    page: int = 1,
    limit: int = 20,
) -> Dict[str, Any]:
    """Get paginated notifications for a user."""
    offset = (page - 1) * limit

    query = (
        db.query(Notification)
        .filter(Notification.user_id == user_id)
        .order_by(Notification.created_at.desc())
    )

    total = query.count()
    notifications = query.offset(offset).limit(limit).all()

    return {
        "notifications": notifications,
        "total": total,
        "page": page,
        "limit": limit,
        "pages": (total + limit - 1) // limit if total > 0 else 0,
    }


def mark_notification_read(
    db: Session, notification_id: str, user_id: str
) -> Notification:
    """Mark a notification as read. Only the owner can mark it."""
    notification = (
        db.query(Notification).filter(Notification.id == notification_id).first()
    )
    if not notification:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found",
        )

    if notification.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot mark another user's notification as read",
        )

    notification.is_read = True
    db.commit()
    db.refresh(notification)
    return notification


def get_unread_count(db: Session, user_id: str) -> int:
    """Get count of unread notifications for a user."""
    return (
        db.query(func.count(Notification.id))
        .filter(Notification.user_id == user_id, Notification.is_read == False)
        .scalar()
    )
