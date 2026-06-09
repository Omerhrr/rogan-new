"""
ROGAN LIVE - Task Service (Phase 2)
Task marketplace with bidding, escrow payments, and dispute handling.

Task lifecycle: open → bidding → in_progress → completed/disputed
- Creator posts a task with price and deadline
- Users place bids (max 10 per task)
- Creator accepts a bid → escrow payment held
- Task completed → escrow released to bidder (minus platform fee)
- Dispute → flagged for admin review

Platform fee: 10% (Phase 2)
Escrow: held in ledger as pending transaction, released on completion
"""

import json
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.models import Task, TaskBid, User
from app.services.ledger_service import (
    SYSTEM_USER_ID,
    create_transaction,
    get_tk_balance,
    get_tk_balance_with_lock,
)
from app.utils.redis_client import redis_client

logger = logging.getLogger(__name__)

# Phase 2 platform fee rate for tasks
TASK_PLATFORM_FEE_RATE = 0.10
# Maximum bids per task
MAX_BIDS_PER_TASK = 10


def create_task(
    db: Session,
    creator_id: str,
    title: str,
    description: Optional[str] = None,
    category: Optional[str] = None,
    price_tk: float = 0.0,
    deadline: Optional[datetime] = None,
) -> Task:
    """Creator posts a new task.

    Args:
        db: Database session.
        creator_id: The creator posting the task.
        title: Task title.
        description: Task description.
        category: Task category.
        price_tk: Budget/price for the task in TK.
        deadline: Optional deadline.

    Returns:
        The newly created Task object.

    Raises:
        HTTPException 404: User not found.
        HTTPException 403: User is not a creator.
    """
    user = db.query(User).filter(User.id == creator_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    if user.role not in ("creator", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only creators can post tasks",
        )

    task = Task(
        creator_id=creator_id,
        title=title,
        description=description,
        category=category,
        price_tk=price_tk,
        deadline=deadline,
        status="open",
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    _publish_task_event("task_created", task)
    return task


def browse_tasks(
    db: Session,
    page: int = 1,
    limit: int = 20,
    category: Optional[str] = None,
    min_price: Optional[float] = None,
    max_price: Optional[float] = None,
    status_filter: Optional[str] = None,
) -> Dict[str, Any]:
    """Browse tasks with pagination and filtering.

    Args:
        db: Database session.
        page: Page number (1-based).
        limit: Items per page.
        category: Filter by category.
        min_price: Minimum price filter.
        max_price: Maximum price filter.
        status_filter: Filter by status (default: open only).

    Returns:
        Paginated list of tasks with bid counts.
    """
    offset = (page - 1) * limit

    query = db.query(Task)

    # Default to showing only open/bidding tasks
    if status_filter:
        query = query.filter(Task.status == status_filter)
    else:
        query = query.filter(Task.status.in_(["open", "bidding"]))

    if category:
        query = query.filter(Task.category == category)

    if min_price is not None:
        query = query.filter(Task.price_tk >= min_price)

    if max_price is not None:
        query = query.filter(Task.price_tk <= max_price)

    query = query.order_by(Task.created_at.desc())

    total = query.count()
    tasks = query.offset(offset).limit(limit).all()

    result = []
    for task in tasks:
        bid_count = _get_bid_count(db, task.id)
        creator = db.query(User).filter(User.id == task.creator_id).first()
        result.append({
            "id": task.id,
            "creator_id": task.creator_id,
            "creator": {
                "id": creator.id,
                "username": creator.username,
                "display_name": creator.display_name,
                "avatar": creator.avatar,
            } if creator else None,
            "title": task.title,
            "description": task.description,
            "category": task.category,
            "price_tk": task.price_tk,
            "deadline": task.deadline.isoformat() if task.deadline else None,
            "status": task.status,
            "bid_count": bid_count,
            "created_at": task.created_at.isoformat() if task.created_at else None,
            "updated_at": task.updated_at.isoformat() if task.updated_at else None,
        })

    return {
        "tasks": result,
        "total": total,
        "page": page,
        "limit": limit,
        "pages": (total + limit - 1) // limit if total > 0 else 0,
    }


def place_bid(
    db: Session,
    task_id: str,
    bidder_id: str,
    amount_tk: float,
    message: Optional[str] = None,
) -> TaskBid:
    """User places a bid on a task.

    Args:
        db: Database session.
        task_id: The task to bid on.
        bidder_id: The bidder's user ID.
        amount_tk: Bid amount in TK.
        message: Optional bid message.

    Returns:
        The created TaskBid object.

    Raises:
        HTTPException 404: Task not found.
        HTTPException 400: Task not open for bidding, max bids reached, or duplicate bid.
        HTTPException 403: Creator cannot bid on own task.
    """
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found",
        )

    # Task must be open for bidding
    if task.status not in ("open", "bidding"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Task is not open for bidding (status: {task.status})",
        )

    # Creator cannot bid on own task
    if task.creator_id == bidder_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot bid on your own task",
        )

    # Check max bids
    bid_count = _get_bid_count(db, task_id)
    if bid_count >= MAX_BIDS_PER_TASK:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Task has reached the maximum of {MAX_BIDS_PER_TASK} bids",
        )

    # Check for duplicate bid from same user
    existing_bid = (
        db.query(TaskBid)
        .filter(
            TaskBid.task_id == task_id,
            TaskBid.bidder_id == bidder_id,
            TaskBid.status == "pending",
        )
        .first()
    )
    if existing_bid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You already have a pending bid on this task",
        )

    # Verify bidder balance (they need to have enough for the bid)
    balance = get_tk_balance(db, bidder_id)
    if balance < amount_tk:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Insufficient TK balance. Current: {balance} TK, Bid: {amount_tk} TK",
        )

    bid = TaskBid(
        task_id=task_id,
        bidder_id=bidder_id,
        amount_tk=amount_tk,
        message=message,
        status="pending",
    )
    db.add(bid)

    # Transition task to bidding if it was open
    if task.status == "open":
        task.status = "bidding"

    db.commit()
    db.refresh(bid)

    _publish_task_event("task_bid_placed", task, bid_id=bid.id)
    return bid


def accept_bid(
    db: Session,
    task_id: str,
    bid_id: str,
    creator_id: str,
) -> TaskBid:
    """Creator accepts a bid. Holds escrow payment.

    When a bid is accepted:
    1. All other pending bids are rejected
    2. The task transitions to in_progress
    3. Escrow payment is held via ledger (creator → bidder, pending release)

    Args:
        db: Database session.
        task_id: The task ID.
        bid_id: The bid ID to accept.
        creator_id: The creator accepting (for authorization).

    Returns:
        The accepted TaskBid object.

    Raises:
        HTTPException 404: Task or bid not found.
        HTTPException 403: Not the task creator.
        HTTPException 400: Task/bid not in correct state.
    """
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found",
        )

    if task.creator_id != creator_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the task creator can accept bids",
        )

    if task.status not in ("open", "bidding"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Task is not in a state that allows accepting bids",
        )

    bid = db.query(TaskBid).filter(TaskBid.id == bid_id, TaskBid.task_id == task_id).first()
    if not bid:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Bid not found",
        )

    if bid.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Bid is not pending",
        )

    # Verify creator has enough balance for escrow
    balance = get_tk_balance_with_lock(db, creator_id)
    if balance < bid.amount_tk:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Insufficient TK balance for escrow. Current: {balance} TK, Bid: {bid.amount_tk} TK",
        )

    # Hold escrow: creator → bidder (held until task completion)
    create_transaction(
        db=db,
        type="task_escrow",
        amount=bid.amount_tk,
        from_user_id=creator_id,
        to_user_id=bid.bidder_id,
        reference_id=task_id,
        metadata={
            "task_id": task_id,
            "bid_id": bid_id,
            "escrow_amount": bid.amount_tk,
            "status": "held",
        },
    )

    # Accept the winning bid
    bid.status = "accepted"

    # Reject all other pending bids
    other_bids = (
        db.query(TaskBid)
        .filter(
            TaskBid.task_id == task_id,
            TaskBid.id != bid_id,
            TaskBid.status == "pending",
        )
        .all()
    )
    for other in other_bids:
        other.status = "rejected"

    # Transition task to in_progress
    task.status = "in_progress"
    task.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(bid)

    _publish_task_event("task_bid_accepted", task, bid_id=bid.id)
    return bid


def complete_task(
    db: Session,
    task_id: str,
    completer_id: str,
) -> Task:
    """Mark a task as complete. Releases escrow payment.

    Releases the held escrow minus platform fee:
    - Bidder receives (amount - platform_fee)
    - Platform receives platform_fee (10%)

    Args:
        db: Database session.
        task_id: The task to complete.
        completer_id: The user marking as complete (creator or bidder).

    Returns:
        The completed Task object.

    Raises:
        HTTPException 404: Task not found.
        HTTPException 403: Not authorized to complete.
        HTTPException 400: Task not in progress.
    """
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found",
        )

    # Only the creator or the accepted bidder can mark as complete
    accepted_bid = (
        db.query(TaskBid)
        .filter(TaskBid.task_id == task_id, TaskBid.status == "accepted")
        .first()
    )

    if not accepted_bid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No accepted bid found for this task",
        )

    if completer_id != task.creator_id and completer_id != accepted_bid.bidder_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the task creator or accepted bidder can mark as complete",
        )

    if task.status != "in_progress":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Task is not in progress",
        )

    # Release escrow: platform fee from bidder to system
    platform_fee = round(accepted_bid.amount_tk * TASK_PLATFORM_FEE_RATE, 2)
    if platform_fee > 0:
        create_transaction(
            db=db,
            type="platform_fee",
            amount=platform_fee,
            from_user_id=accepted_bid.bidder_id,
            to_user_id=SYSTEM_USER_ID,
            reference_id=task_id,
            metadata={
                "task_id": task_id,
                "bid_id": accepted_bid.id,
                "fee_rate": TASK_PLATFORM_FEE_RATE,
                "platform_fee": platform_fee,
            },
        )

    # Mark task complete
    task.status = "completed"
    task.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(task)

    _publish_task_event("task_completed", task, bid_id=accepted_bid.id)
    return task


def dispute_task(
    db: Session,
    task_id: str,
    disputer_id: str,
    reason: str,
) -> Task:
    """File a dispute on a task. Flags for admin review.

    Args:
        db: Database session.
        task_id: The task to dispute.
        disputer_id: The user filing the dispute.
        reason: Reason for the dispute.

    Returns:
        The disputed Task object.

    Raises:
        HTTPException 404: Task not found.
        HTTPException 403: Not authorized to dispute.
        HTTPException 400: Task not in progress.
    """
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found",
        )

    # Only creator or accepted bidder can dispute
    accepted_bid = (
        db.query(TaskBid)
        .filter(TaskBid.task_id == task_id, TaskBid.status == "accepted")
        .first()
    )

    if not accepted_bid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No accepted bid found for this task",
        )

    if disputer_id != task.creator_id and disputer_id != accepted_bid.bidder_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the task creator or accepted bidder can file a dispute",
        )

    if task.status != "in_progress":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only tasks in progress can be disputed",
        )

    task.status = "disputed"
    task.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(task)

    # Publish dispute event for admin notification
    _publish_task_event("task_disputed", task, extra={
        "disputer_id": disputer_id,
        "reason": reason,
    })

    return task


def get_task_details(db: Session, task_id: str) -> Dict[str, Any]:
    """Get task details with bids.

    Args:
        db: Database session.
        task_id: The task ID.

    Returns:
        Task details dictionary with bids.

    Raises:
        HTTPException 404: Task not found.
    """
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found",
        )

    bids = (
        db.query(TaskBid)
        .filter(TaskBid.task_id == task_id)
        .order_by(TaskBid.created_at.desc())
        .all()
    )

    creator = db.query(User).filter(User.id == task.creator_id).first()

    return {
        "id": task.id,
        "creator_id": task.creator_id,
        "creator": {
            "id": creator.id,
            "username": creator.username,
            "display_name": creator.display_name,
            "avatar": creator.avatar,
        } if creator else None,
        "title": task.title,
        "description": task.description,
        "category": task.category,
        "price_tk": task.price_tk,
        "deadline": task.deadline.isoformat() if task.deadline else None,
        "status": task.status,
        "created_at": task.created_at.isoformat() if task.created_at else None,
        "updated_at": task.updated_at.isoformat() if task.updated_at else None,
        "bids": [
            {
                "id": b.id,
                "task_id": b.task_id,
                "bidder_id": b.bidder_id,
                "amount_tk": b.amount_tk,
                "message": b.message,
                "status": b.status,
                "created_at": b.created_at.isoformat() if b.created_at else None,
            }
            for b in bids
        ],
        "bid_count": len(bids),
    }


def _get_bid_count(db: Session, task_id: str) -> int:
    """Get the number of bids for a task.

    Args:
        db: Database session.
        task_id: The task ID.

    Returns:
        Number of bids.
    """
    return (
        db.query(func.count(TaskBid.id))
        .filter(TaskBid.task_id == task_id)
        .scalar()
    ) or 0


def _publish_task_event(
    event_type: str,
    task: Task,
    bid_id: Optional[str] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> None:
    """Publish a task event via Redis PubSub.

    Args:
        event_type: The event type.
        task: The Task object.
        bid_id: Optional bid ID.
        extra: Additional event data.
    """
    event = {
        "type": event_type,
        "data": {
            "task_id": task.id,
            "creator_id": task.creator_id,
            "title": task.title,
            "status": task.status,
            "price_tk": task.price_tk,
            "bid_id": bid_id,
            **(extra or {}),
        },
        "timestamp": datetime.utcnow().isoformat(),
    }
    try:
        redis_client.publish(f"task:{task.id}", json.dumps(event))
        redis_client.publish("tasks", json.dumps(event))
    except Exception as e:
        logger.warning(f"Failed to publish task event via Redis: {e}")
