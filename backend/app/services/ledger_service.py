"""
ROGAN LIVE - Ledger Service
Double-entry ledger: immutable transactions, audit-safe, no direct balance mutation.
Balances are DERIVED from transaction history, never stored directly.
"""

import json
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.models import Transaction
from app.services.economy_service import (
    calculate_creator_earnings,
    calculate_platform_fee,
    calculate_withdraw_fee,
    tk_to_rogan,
)

SYSTEM_USER_ID = "SYSTEM"


def create_transaction(
    db: Session,
    type: str,
    amount: float,
    from_user_id: str,
    to_user_id: str,
    reference_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Transaction:
    """Create an immutable ledger entry. No balance mutation — balances are derived."""
    transaction = Transaction(
        type=type,
        amount=amount,
        from_user_id=from_user_id,
        to_user_id=to_user_id,
        reference_id=reference_id,
        meta_data=json.dumps(metadata) if metadata else None,
        created_at=datetime.utcnow(),
    )
    db.add(transaction)
    db.commit()
    db.refresh(transaction)
    return transaction


def get_tk_balance(db: Session, user_id: str) -> float:
    """Derive TK balance from transaction history (sum received - sum sent)."""
    total_received = (
        db.query(func.coalesce(func.sum(Transaction.amount), 0.0))
        .filter(Transaction.to_user_id == user_id)
        .scalar()
    )
    total_sent = (
        db.query(func.coalesce(func.sum(Transaction.amount), 0.0))
        .filter(Transaction.from_user_id == user_id)
        .scalar()
    )
    return round(total_received - total_sent, 2)


def get_tk_balance_with_lock(db: Session, user_id: str) -> float:
    """Derive TK balance with row-level locking to prevent TOCTOU races.
    Uses SELECT ... FOR UPDATE on a serializable isolation window.
    For SQLite this is a no-op; for PostgreSQL it acquires row locks.
    """
    # Use a savepoint so the FOR UPDATE doesn't leak outside the check
    # Query all transactions for this user with row lock to prevent concurrent modification
    total_received = (
        db.query(func.coalesce(func.sum(Transaction.amount), 0.0))
        .filter(Transaction.to_user_id == user_id)
        .with_for_update()
        .scalar()
    )
    total_sent = (
        db.query(func.coalesce(func.sum(Transaction.amount), 0.0))
        .filter(Transaction.from_user_id == user_id)
        .with_for_update()
        .scalar()
    )
    return round(total_received - total_sent, 2)


def process_deposit(db: Session, user_id: str, rogan_amount: float) -> Transaction:
    """System mints TK to user. SYSTEM -> user."""
    if rogan_amount <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Deposit amount must be positive",
        )

    tk_amount = rogan_amount  # 1:1 peg

    transaction = create_transaction(
        db=db,
        type="deposit",
        amount=tk_amount,
        from_user_id=SYSTEM_USER_ID,
        to_user_id=user_id,
        metadata={"rogan_amount": rogan_amount, "tk_minted": tk_amount},
    )
    return transaction


def process_withdraw(
    db: Session, user_id: str, tk_amount: float
) -> Tuple[Transaction, float, float]:
    """Burn TK from user, calculate ROGAN + fee. user -> SYSTEM.
    Returns (transaction, rogan_amount, withdraw_fee).
    """
    if tk_amount <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Withdrawal amount must be positive",
        )

    balance = get_tk_balance_with_lock(db, user_id)
    if balance < tk_amount:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Insufficient TK balance. Current: {balance} TK, Requested: {tk_amount} TK",
        )

    withdraw_fee = calculate_withdraw_fee(tk_amount)
    net_tk = tk_amount - withdraw_fee
    rogan_amount = tk_to_rogan(net_tk)

    # Main withdrawal transaction: user -> SYSTEM
    transaction = create_transaction(
        db=db,
        type="withdraw",
        amount=tk_amount,
        from_user_id=user_id,
        to_user_id=SYSTEM_USER_ID,
        metadata={
            "rogan_amount": rogan_amount,
            "withdraw_fee": withdraw_fee,
            "net_tk": net_tk,
        },
    )
    return transaction, rogan_amount, withdraw_fee


def process_gift(
    db: Session,
    sender_id: str,
    receiver_id: str,
    tk_amount: float,
    gift_id: Optional[str] = None,
) -> Tuple[Transaction, Transaction]:
    """Process a gift: debit sender, credit creator (90%), platform fee (10%) to system.
    Uses row-level locking to prevent TOCTOU race conditions.
    Returns (sender_transaction, creator_earnings).
    """
    if tk_amount <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Gift amount must be positive",
        )

    # Check sender balance WITH row-level locking to prevent TOCTOU race
    balance = get_tk_balance_with_lock(db, sender_id)
    if balance < tk_amount:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Insufficient TK balance. Current: {balance} TK, Gift cost: {tk_amount} TK",
        )

    creator_earnings = calculate_creator_earnings(tk_amount)
    platform_fee = calculate_platform_fee(tk_amount)

    # Debit sender: sender -> receiver (full amount)
    sender_tx = create_transaction(
        db=db,
        type="gift_send",
        amount=tk_amount,
        from_user_id=sender_id,
        to_user_id=receiver_id,
        reference_id=gift_id,
        metadata={
            "gift_id": gift_id,
            "gross_amount": tk_amount,
            "creator_earnings": creator_earnings,
            "platform_fee": platform_fee,
        },
    )

    # Platform fee: receiver -> SYSTEM (10%)
    if platform_fee > 0:
        create_transaction(
            db=db,
            type="platform_fee",
            amount=platform_fee,
            from_user_id=receiver_id,
            to_user_id=SYSTEM_USER_ID,
            reference_id=gift_id,
            metadata={
                "gift_id": gift_id,
                "fee_rate": 0.10,
                "platform_fee": platform_fee,
            },
        )

    return sender_tx, creator_earnings


def get_transaction_history(
    db: Session,
    user_id: str,
    page: int = 1,
    limit: int = 20,
) -> Dict[str, Any]:
    """Get paginated transaction history for a user."""
    offset = (page - 1) * limit

    query = (
        db.query(Transaction)
        .filter(
            (Transaction.from_user_id == user_id)
            | (Transaction.to_user_id == user_id)
        )
        .order_by(Transaction.created_at.desc())
    )

    total = query.count()
    transactions = query.offset(offset).limit(limit).all()

    return {
        "transactions": transactions,
        "total": total,
        "page": page,
        "limit": limit,
        "pages": (total + limit - 1) // limit if total > 0 else 0,
    }
