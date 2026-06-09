"""
ROGAN LIVE - Private Show Routes
POST /private-shows/ — Creator starts a private show
POST /private-shows/{show_id}/join — Viewer joins
POST /private-shows/{show_id}/end — Creator ends show
GET /private-shows/active — List active private shows
GET /private-shows/{show_id} — Show details + viewer count
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import User
from app.routes.auth import get_current_user_dependency
from app.schemas import PrivateShowCreate, PrivateShowJoin
from app.services import private_show_service

router = APIRouter(prefix="/private-shows", tags=["Private Shows"])


@router.post("/", status_code=status.HTTP_201_CREATED)
def start_private_show(
    req: PrivateShowCreate,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Start a new private show. Sets price, duration, and optional max viewers.

    Only creators can start private shows. A creator may only have one
    active show at a time.
    """
    show = private_show_service.create_private_show(
        db=db,
        creator_id=current_user.id,
        price_tk=req.price_tk,
        duration_minutes=req.duration_minutes,
        max_viewers=req.max_viewers,
    )
    return _show_response(show, db)


@router.post("/{show_id}/join")
def join_private_show(
    show_id: str,
    req: PrivateShowJoin,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Join a private show. Deducts the entry fee from the viewer's TK balance.

    Viewers cannot join their own show. A viewer can only join once.
    If the show is in 'waiting' status, it transitions to 'live'.
    """
    viewer_entry = private_show_service.join_private_show(
        db=db,
        show_id=show_id,
        viewer_id=current_user.id,
    )
    return {
        "id": viewer_entry.id,
        "show_id": viewer_entry.show_id,
        "viewer_id": viewer_entry.viewer_id,
        "paid_amount": viewer_entry.paid_amount,
        "joined_at": viewer_entry.joined_at.isoformat() if viewer_entry.joined_at else None,
        "message": "Successfully joined the private show",
    }


@router.post("/{show_id}/end")
def end_private_show(
    show_id: str,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """End a private show. Only the creator can end it.

    Triggers final payout calculation and updates show status to 'ended'.
    """
    show = private_show_service.end_private_show(
        db=db,
        show_id=show_id,
        creator_id=current_user.id,
    )
    return {
        "id": show.id,
        "status": show.status,
        "ended_at": show.ended_at.isoformat() if show.ended_at else None,
        "total_revenue": show.total_revenue,
        "message": "Private show has ended",
    }


@router.get("/active")
def get_active_private_shows(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """List all active private shows (waiting or live) with creator info."""
    return private_show_service.get_active_shows(db=db, page=page, limit=limit)


@router.get("/{show_id}")
def get_private_show_details(
    show_id: str,
    db: Session = Depends(get_db),
):
    """Get private show details including viewer count and stream URLs.

    Returns WebRTC and HLS URLs if the show is currently live.
    """
    return private_show_service.get_show_details(db=db, show_id=show_id)


def _show_response(show, db: Session) -> dict:
    """Format a PrivateShow model into a response dict."""
    viewer_count = private_show_service._get_viewer_count(db, show.id)
    return {
        "id": show.id,
        "creator_id": show.creator_id,
        "stream_key": show.stream_key,
        "price_tk": show.price_tk,
        "duration_minutes": show.duration_minutes,
        "max_viewers": show.max_viewers,
        "status": show.status,
        "viewer_count": viewer_count,
        "started_at": show.started_at.isoformat() if show.started_at else None,
        "ended_at": show.ended_at.isoformat() if show.ended_at else None,
        "total_revenue": show.total_revenue,
        "created_at": show.created_at.isoformat() if show.created_at else None,
    }
