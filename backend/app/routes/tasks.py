"""
ROGAN LIVE - Task Marketplace Routes (Phase 2)
POST /tasks/ — Creator posts a task
GET /tasks/ — Browse tasks (pagination, filtering)
POST /tasks/{task_id}/bid — User places a bid
POST /tasks/{task_id}/accept/{bid_id} — Creator accepts a bid
POST /tasks/{task_id}/complete — Mark task complete
POST /tasks/{task_id}/dispute — File a dispute
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import User
from app.routes.auth import get_current_user_dependency
from app.schemas import TaskBidCreate, TaskCreate, TaskDispute
from app.services import task_service

router = APIRouter(prefix="/tasks", tags=["Task Marketplace"])


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_task(
    req: TaskCreate,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Post a new task. Only creators can post tasks.

    Tasks have a title, description, category, price (TK budget),
    and optional deadline. The task starts in 'open' status.
    """
    task = task_service.create_task(
        db=db,
        creator_id=current_user.id,
        title=req.title,
        description=req.description,
        category=req.category,
        price_tk=req.price_tk,
        deadline=req.deadline,
    )
    return _task_response(task, db)


@router.get("/")
def browse_tasks(
    category: Optional[str] = Query(None),
    min_price: Optional[float] = Query(None, ge=0),
    max_price: Optional[float] = Query(None, ge=0),
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """Browse tasks with pagination and filtering.

    By default shows only open and bidding tasks. Use the 'status'
    query parameter to filter by a specific status.
    """
    return task_service.browse_tasks(
        db=db,
        page=page,
        limit=limit,
        category=category,
        min_price=min_price,
        max_price=max_price,
        status_filter=status,
    )


@router.get("/{task_id}")
def get_task(
    task_id: str,
    db: Session = Depends(get_db),
):
    """Get task details including all bids."""
    return task_service.get_task_details(db=db, task_id=task_id)


@router.post("/{task_id}/bid", status_code=status.HTTP_201_CREATED)
def place_bid(
    task_id: str,
    req: TaskBidCreate,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Place a bid on a task. Maximum 10 bids per task.

    Users cannot bid on their own tasks. Each user can have at most
    one pending bid per task. The bid amount must not exceed the
    bidder's TK balance.
    """
    bid = task_service.place_bid(
        db=db,
        task_id=task_id,
        bidder_id=current_user.id,
        amount_tk=req.amount_tk,
        message=req.message,
    )
    return {
        "id": bid.id,
        "task_id": bid.task_id,
        "bidder_id": bid.bidder_id,
        "amount_tk": bid.amount_tk,
        "message": bid.message,
        "status": bid.status,
        "created_at": bid.created_at.isoformat() if bid.created_at else None,
    }


@router.post("/{task_id}/accept/{bid_id}")
def accept_bid(
    task_id: str,
    bid_id: str,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Accept a bid on a task. Only the task creator can accept bids.

    When a bid is accepted:
    - Other pending bids are automatically rejected
    - The task transitions to 'in_progress'
    - Escrow payment is held from the creator to the bidder
    """
    bid = task_service.accept_bid(
        db=db,
        task_id=task_id,
        bid_id=bid_id,
        creator_id=current_user.id,
    )
    return {
        "id": bid.id,
        "task_id": bid.task_id,
        "bidder_id": bid.bidder_id,
        "amount_tk": bid.amount_tk,
        "status": bid.status,
        "message": "Bid accepted — task is now in progress",
    }


@router.post("/{task_id}/complete")
def complete_task(
    task_id: str,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Mark a task as completed. Triggers escrow payment release.

    Only the task creator or accepted bidder can mark a task as complete.
    Upon completion, the escrowed TK is released to the bidder
    minus the platform fee (10%).
    """
    task = task_service.complete_task(
        db=db,
        task_id=task_id,
        completer_id=current_user.id,
    )
    return {
        "id": task.id,
        "status": task.status,
        "updated_at": task.updated_at.isoformat() if task.updated_at else None,
        "message": "Task completed — escrow payment released",
    }


@router.post("/{task_id}/dispute")
def dispute_task(
    task_id: str,
    req: TaskDispute,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """File a dispute on a task. Flags for admin review.

    Only the task creator or accepted bidder can file a dispute.
    The task must be in 'in_progress' status. Upon dispute,
    the escrow is held until an admin resolves it.
    """
    task = task_service.dispute_task(
        db=db,
        task_id=task_id,
        disputer_id=current_user.id,
        reason=req.reason,
    )
    return {
        "id": task.id,
        "status": task.status,
        "updated_at": task.updated_at.isoformat() if task.updated_at else None,
        "message": "Dispute filed — task flagged for admin review",
    }


def _task_response(task, db: Session) -> dict:
    """Format a Task model into a response dict."""
    bid_count = task_service._get_bid_count(db, task.id)
    return {
        "id": task.id,
        "creator_id": task.creator_id,
        "title": task.title,
        "description": task.description,
        "category": task.category,
        "price_tk": task.price_tk,
        "deadline": task.deadline.isoformat() if task.deadline else None,
        "status": task.status,
        "bid_count": bid_count,
        "created_at": task.created_at.isoformat() if task.created_at else None,
        "updated_at": task.updated_at.isoformat() if task.updated_at else None,
    }
