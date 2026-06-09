"""
ROGAN LIVE - Notification Routes
GET /notifications/, GET /notifications/unread-count,
POST /notifications/{notification_id}/read
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import User
from app.routes.auth import get_current_user_dependency
from app.services import notification_service

router = APIRouter(prefix="/notifications", tags=["Notifications"])


@router.get("/")
def get_notifications(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """List notifications (auth required, paginated)."""
    result = notification_service.get_notifications(
        db=db,
        user_id=current_user.id,
        page=page,
        limit=limit,
    )
    return {
        "notifications": [
            {
                "id": n.id,
                "user_id": n.user_id,
                "type": n.type,
                "title": n.title,
                "message": n.message,
                "is_read": n.is_read,
                "metadata_json": n.metadata_json,
                "created_at": n.created_at.isoformat() if n.created_at else None,
            }
            for n in result["notifications"]
        ],
        "total": result["total"],
        "page": result["page"],
        "limit": result["limit"],
        "pages": result["pages"],
    }


@router.get("/unread-count")
def get_unread_count(
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Get unread notification count (auth required)."""
    count = notification_service.get_unread_count(db=db, user_id=current_user.id)
    return {"unread_count": count}


@router.post("/{notification_id}/read")
def mark_notification_read(
    notification_id: str,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Mark a notification as read (auth required)."""
    notification = notification_service.mark_notification_read(
        db=db,
        notification_id=notification_id,
        user_id=current_user.id,
    )
    return {
        "id": notification.id,
        "is_read": notification.is_read,
        "message": "Notification marked as read",
    }
