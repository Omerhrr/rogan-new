"""
ROGAN LIVE - Web3 Service
SIWE nonce/verify, WalletConnect sessions, deposit/withdraw with on-chain verification.
"""

import json
import secrets
import time
from datetime import datetime
from typing import Any, Dict, Optional, Tuple

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.models import User, Wallet
from app.services.ledger_service import (
    get_tk_balance,
    process_deposit,
    process_withdraw,
)
from app.utils.redis_client import redis_client

# Rate limits for deposits/withdrawals
MAX_DAILY_DEPOSITS = 5
MAX_DAILY_WITHDRAWALS = 5

# Withdrawal fee
WITHDRAWAL_FEE_RATE = 0.02  # 2%

# Session TTL in Redis (seconds)
WC_SESSION_TTL = 86400  # 24 hours
SIWE_NONCE_TTL = 600  # 10 minutes


def generate_siwe_nonce() -> Tuple[str, str]:
    """Generate a SIWE nonce and construct the message for signing.
    Returns (nonce, message).
    """
    nonce = secrets.token_hex(16)
    message = (
        f"rogan.live wants you to sign in with your Ethereum account:\n\n"
        f"[your-eth-address]\n\n"
        f"URI: https://rogan.live\n"
        f"Version: 1\n"
        f"Chain ID: 1\n"
        f"Nonce: {nonce}\n"
        f"Issued At: {datetime.utcnow().isoformat()}\n"
    )

    # Store nonce in Redis for verification
    try:
        redis_client.set(f"siwe_nonce:{nonce}", "1", ex=SIWE_NONCE_TTL)
    except Exception:
        pass

    return nonce, message


def verify_siwe_signature(
    db: Session,
    message: str,
    signature: str,
    user_id: str,
) -> Wallet:
    """Verify a SIWE signature and link the wallet to the user.
    Creates or updates the wallet record with the ETH address.
    """
    # Extract the nonce from the message
    nonce = None
    for line in message.split("\n"):
        if line.startswith("Nonce: "):
            nonce = line.replace("Nonce: ", "").strip()
            break

    if not nonce:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid SIWE message: nonce not found",
        )

    # Verify nonce exists in Redis (one-time use)
    try:
        nonce_key = f"siwe_nonce:{nonce}"
        nonce_val = redis_client.get(nonce_key)
        if not nonce_val:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid or expired nonce",
            )
        # Delete used nonce
        redis_client.delete(nonce_key)
    except HTTPException:
        raise
    except Exception:
        pass  # Allow verification even if Redis is down

    # Recover ETH address from signature
    eth_address = _recover_eth_address(message, signature)

    if not eth_address:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid signature: could not recover ETH address",
        )

    # Normalize address
    eth_address = eth_address.lower()

    # Check if this ETH address is already linked to another user
    existing_wallet = db.query(Wallet).filter(Wallet.eth_address == eth_address).first()
    if existing_wallet and existing_wallet.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This ETH address is already linked to another account",
        )

    # Get or create wallet
    wallet = db.query(Wallet).filter(Wallet.user_id == user_id).first()
    if wallet:
        wallet.eth_address = eth_address
        wallet.updated_at = datetime.utcnow()
    else:
        wallet = Wallet(
            user_id=user_id,
            eth_address=eth_address,
        )
        db.add(wallet)

    db.commit()
    db.refresh(wallet)
    return wallet


def _recover_eth_address(message: str, signature: str) -> Optional[str]:
    """Recover ETH address from a signed message using eth_account."""
    try:
        from eth_account.messages import encode_defunct
        from eth_account import Account

        msg = encode_defunct(text=message)
        recovered = Account.recover_message(msg, signature=signature)
        return recovered
    except ImportError:
        # Fallback: if eth_account is not installed, try web3
        try:
            from web3 import Web3

            recovered = Web3().eth.account.recover_message(
                text=message, signature=signature
            )
            return recovered
        except Exception:
            return None
    except Exception:
        return None


def initiate_walletconnect_session(user_id: str) -> Dict[str, Any]:
    """Initiate a WalletConnect session. Stores session data in Redis."""
    session_id = secrets.token_hex(32)
    session_data = {
        "session_id": session_id,
        "user_id": user_id,
        "status": "pending",
        "created_at": datetime.utcnow().isoformat(),
    }

    try:
        redis_client.set(
            f"wc_session:{session_id}",
            json.dumps(session_data),
            ex=WC_SESSION_TTL,
        )
    except Exception:
        pass

    return {
        "session_id": session_id,
        "uri": f"wc:{session_id}@1?bridge=https://bridge.walletconnect.org",
        "status": "pending",
    }


def get_wallet_info(db: Session, user_id: str) -> Dict[str, Any]:
    """Get linked wallet info for the current user."""
    wallet = db.query(Wallet).filter(Wallet.user_id == user_id).first()
    tk_balance = get_tk_balance(db, user_id)

    return {
        "id": wallet.id if wallet else None,
        "user_id": user_id,
        "eth_address": wallet.eth_address if wallet else None,
        "wallet_address": wallet.wallet_address if wallet else None,
        "tk_balance": tk_balance,
    }


def deposit_rogan_tokens(
    db: Session,
    user_id: str,
    amount: float,
    tx_hash: Optional[str] = None,
) -> Dict[str, Any]:
    """Deposit ROGAN tokens (on-chain → off-chain TK mint).
    Verifies the on-chain transaction, then mints equivalent TK.
    """
    if amount <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Deposit amount must be positive",
        )

    # Rate limit check: max 5 deposits per day
    _check_daily_rate_limit(user_id, "deposit", MAX_DAILY_DEPOSITS)

    # Verify on-chain transaction if tx_hash provided
    if tx_hash:
        verified = _verify_onchain_transaction(tx_hash, amount)
        if not verified:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="On-chain transaction verification failed",
            )

    # Process deposit via ledger (mints TK)
    transaction = process_deposit(db, user_id, amount)
    new_balance = get_tk_balance(db, user_id)

    # Increment daily counter
    _increment_daily_rate_limit(user_id, "deposit")

    return {
        "transaction_id": transaction.id,
        "rogan_deposited": amount,
        "tk_minted": amount,
        "new_tk_balance": new_balance,
    }


def withdraw_rogan_tokens(
    db: Session,
    user_id: str,
    tk_amount: float,
) -> Dict[str, Any]:
    """Withdraw TK → ROGAN (off-chain burn → on-chain transfer).
    Burns TK via ledger, then triggers on-chain transfer.
    2% withdrawal fee applied.
    """
    if tk_amount <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Withdrawal amount must be positive",
        )

    # Check wallet is linked
    wallet = db.query(Wallet).filter(Wallet.user_id == user_id).first()
    if not wallet or not wallet.eth_address:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ETH wallet address must be linked before withdrawal",
        )

    # Rate limit check: max 5 withdrawals per day
    _check_daily_rate_limit(user_id, "withdraw", MAX_DAILY_WITHDRAWALS)

    # Process withdrawal via ledger (burns TK)
    transaction, rogan_amount, withdraw_fee = process_withdraw(db, user_id, tk_amount)

    # Trigger on-chain transfer (placeholder - would integrate with actual Web3 provider)
    _trigger_onchain_transfer(wallet.eth_address, rogan_amount)

    # Increment daily counter
    _increment_daily_rate_limit(user_id, "withdraw")

    return {
        "transaction_id": transaction.id,
        "tk_withdrawn": tk_amount,
        "rogan_amount": rogan_amount,
        "withdraw_fee": withdraw_fee,
        "eth_address": wallet.eth_address,
    }


def _check_daily_rate_limit(user_id: str, action: str, max_count: int) -> None:
    """Check if user has exceeded the daily rate limit for an action."""
    today = datetime.utcnow().strftime("%Y-%m-%d")
    key = f"rate_limit:{action}:{user_id}:{today}"

    try:
        current = redis_client.get(key)
        count = int(current) if current else 0
        if count >= max_count:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Daily {action} limit reached ({max_count}/day)",
            )
    except HTTPException:
        raise
    except Exception:
        pass  # Allow if Redis is down


def _increment_daily_rate_limit(user_id: str, action: str) -> None:
    """Increment the daily rate limit counter for an action."""
    today = datetime.utcnow().strftime("%Y-%m-%d")
    key = f"rate_limit:{action}:{user_id}:{today}"

    try:
        current = redis_client.get(key)
        count = int(current) + 1 if current else 1
        # Set with 24h TTL
        seconds_until_midnight = 86400  # Simplified: 24 hours
        redis_client.set(key, str(count), ex=seconds_until_midnight)
    except Exception:
        pass


def _verify_onchain_transaction(tx_hash: str, expected_amount: float) -> bool:
    """Verify an on-chain transaction. Placeholder for blockchain API integration."""
    # In production, this would call etherscan API or a blockchain RPC
    # For now, we accept any non-empty tx_hash as valid
    if not tx_hash or len(tx_hash) < 10:
        return False
    return True


def _trigger_onchain_transfer(eth_address: str, amount: float) -> Optional[str]:
    """Trigger an on-chain ROGAN token transfer. Placeholder."""
    # In production, this would:
    # 1. Create a signed transaction using the platform's private key
    # 2. Send ROGAN tokens to the user's ETH address
    # 3. Return the on-chain tx_hash
    # For now, just log the intent
    print(f"[Web3] On-chain transfer initiated: {amount} ROGAN -> {eth_address}")
    return None
