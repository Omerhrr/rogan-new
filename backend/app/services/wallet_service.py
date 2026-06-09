"""
ROGAN LIVE - Wallet Service
Web3 wallet linking + deposit/withdraw operations via the ledger.
"""

from typing import Any, Dict, Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.models import User, Wallet
from app.services.ledger_service import (
    get_tk_balance,
    process_deposit,
    process_withdraw,
)


def link_wallet(db: Session, user_id: str, wallet_address: str) -> Wallet:
    """Link a Web3 wallet address to a Web2 user account."""
    # Validate wallet address format (basic check)
    if not wallet_address or len(wallet_address) < 10:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid wallet address",
        )

    # Check if wallet address is already linked to another user
    existing_wallet = (
        db.query(Wallet).filter(Wallet.wallet_address == wallet_address).first()
    )
    if existing_wallet and existing_wallet.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Wallet address is already linked to another account",
        )

    # Get or create wallet for user
    wallet = db.query(Wallet).filter(Wallet.user_id == user_id).first()
    if wallet:
        wallet.wallet_address = wallet_address
    else:
        wallet = Wallet(
            user_id=user_id,
            wallet_address=wallet_address,
        )
        db.add(wallet)

    db.commit()
    db.refresh(wallet)
    return wallet


def get_wallet(db: Session, user_id: str) -> Dict[str, Any]:
    """Get wallet info + derived TK balance."""
    wallet = db.query(Wallet).filter(Wallet.user_id == user_id).first()
    tk_balance = get_tk_balance(db, user_id)

    if wallet:
        return {
            "id": wallet.id,
            "user_id": wallet.user_id,
            "wallet_address": wallet.wallet_address,
            "linked_at": wallet.linked_at.isoformat() if wallet.linked_at else None,
            "tk_balance": tk_balance,
        }
    else:
        return {
            "id": None,
            "user_id": user_id,
            "wallet_address": None,
            "linked_at": None,
            "tk_balance": tk_balance,
        }


def deposit_rogan(db: Session, user_id: str, amount: float) -> Dict[str, Any]:
    """Deposit ROGAN — mints TK to user via ledger. Returns new TK balance."""
    if amount <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Deposit amount must be positive",
        )

    transaction = process_deposit(db, user_id, amount)
    new_balance = get_tk_balance(db, user_id)

    return {
        "transaction_id": transaction.id,
        "rogan_deposited": amount,
        "tk_minted": amount,  # 1:1 peg
        "new_tk_balance": new_balance,
    }


def withdraw_rogan(db: Session, user_id: str, tk_amount: float) -> Dict[str, Any]:
    """Withdraw ROGAN — burns TK via ledger. Returns ROGAN amount + fee."""
    if tk_amount <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Withdrawal amount must be positive",
        )

    # Check wallet is linked
    wallet = db.query(Wallet).filter(Wallet.user_id == user_id).first()
    if not wallet or not wallet.wallet_address:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Wallet address must be linked before withdrawal",
        )

    transaction, rogan_amount, withdraw_fee = process_withdraw(db, user_id, tk_amount)

    return {
        "transaction_id": transaction.id,
        "tk_withdrawn": tk_amount,
        "rogan_amount": rogan_amount,
        "withdraw_fee": withdraw_fee,
        "wallet_address": wallet.wallet_address,
    }
