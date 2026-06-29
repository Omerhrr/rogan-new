"""Wallet service — ROGAN on-chain deposits, Stripe purchases, TK withdrawals."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Optional

import httpx
from sqlalchemy.orm import Session

from app.config import settings
from app.models.models import (
    CryptoDeposit,
    StripePayment,
    User,
    Wallet,
    WithdrawalRequest,
)
from app.services.ledger_service import (
    SYSTEM_USER_ID,
    create_transaction,
    get_tk_balance,
    get_tk_balance_with_lock,
)
from app.utils.redis_client import redis_client

logger = logging.getLogger(__name__)


def _gen_id() -> str:
    return str(uuid.uuid4())


def _normalise_address(addr: str) -> str:
    return addr.strip().lower()


# ---------------------------------------------------------------------------
# ROGAN price — admin-controlled, Redis-stored
# ---------------------------------------------------------------------------
# Admin sets price via POST /api/v1/admin/rogan-price.
# Stored in Redis under key "rogan_price_usd" with no expiry (persists until
# updated). Falls back to ROGAN_PRICE_FALLBACK_USD from config (default 0.000001).
# ---------------------------------------------------------------------------

ROGAN_PRICE_CACHE_KEY = "rogan_price_usd"


async def get_rogan_price_usd() -> float:
    """Return current ROGAN/USD price from Redis (admin-set) or config fallback."""
    cached = redis_client.get(ROGAN_PRICE_CACHE_KEY)
    if cached:
        return float(cached)
    return settings.ROGAN_PRICE_FALLBACK_USD


def _get_rogan_price_usd_sync() -> float:
    """Sync version for non-async paths."""
    cached = redis_client.get(ROGAN_PRICE_CACHE_KEY)
    return float(cached) if cached else settings.ROGAN_PRICE_FALLBACK_USD


def admin_set_rogan_price(price_usd: float) -> None:
    """Admin sets ROGAN/USD price. Stored in Redis with no TTL (permanent until updated)."""
    if price_usd <= 0:
        raise ValueError("Price must be greater than zero")
    redis_client.set(ROGAN_PRICE_CACHE_KEY, str(price_usd))
    logger.info(f"ROGAN price manually set to ${price_usd:.10f}")


# ---------------------------------------------------------------------------
# Base chain RPC helpers
# ---------------------------------------------------------------------------

async def _rpc(method: str, params: list) -> dict:
    payload = {"jsonrpc": "2.0", "method": method, "params": params, "id": 1}
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(settings.BASE_RPC_URL, json=payload)
        resp.raise_for_status()
        return resp.json()


async def _get_tx_receipt(tx_hash: str) -> Optional[dict]:
    data = await _rpc("eth_getTransactionReceipt", [tx_hash])
    return data.get("result")


async def _get_tx(tx_hash: str) -> Optional[dict]:
    data = await _rpc("eth_getTransactionByHash", [tx_hash])
    return data.get("result")


ERC20_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"


def _parse_transfer_log(log: dict, expected_to: str) -> Optional[int]:
    """
    If this log is an ERC-20 Transfer to expected_to, return the value (wei); else None.
    topics[0] = Transfer sig, topics[1] = from, topics[2] = to, data = value.
    """
    topics = log.get("topics", [])
    if len(topics) < 3:
        return None
    if topics[0].lower() != ERC20_TRANSFER_TOPIC:
        return None
    log_to = "0x" + topics[2][-40:]
    if _normalise_address(log_to) != _normalise_address(expected_to):
        return None
    try:
        return int(log.get("data", "0x0"), 16)
    except ValueError:
        return None


async def _verify_rogan_transfer(
    tx_hash: str,
    expected_from: str,   # user's linked wallet
    expected_to: str,     # platform wallet
    token_contract: str,  # ROGAN contract
) -> tuple[bool, str, float]:
    """
    Returns (ok, error_msg, amount_rogan_human).
    Strict: tx.from must match expected_from exactly.
    """
    receipt = await _get_tx_receipt(tx_hash)
    if not receipt:
        return False, "Transaction not found on Base chain", 0.0
    if receipt.get("status") != "0x1":
        return False, "Transaction failed on-chain", 0.0
    if not receipt.get("blockNumber"):
        return False, "Transaction not yet confirmed", 0.0

    tx = await _get_tx(tx_hash)
    if not tx:
        return False, "Could not fetch transaction details", 0.0

    tx_from = tx.get("from", "")
    if _normalise_address(tx_from) != _normalise_address(expected_from):
        return (
            False,
            f"Transaction was sent from {tx_from}, but your linked wallet is {expected_from}. "
            "Only transactions sent FROM your linked wallet are accepted.",
            0.0,
        )

    logs = receipt.get("logs", [])
    total_wei = 0
    for log in logs:
        if _normalise_address(log.get("address", "")) != _normalise_address(token_contract):
            continue
        value = _parse_transfer_log(log, expected_to)
        if value is not None:
            total_wei += value

    if total_wei == 0:
        return False, "No ROGAN Transfer to the platform wallet found in this transaction", 0.0

    amount_human = total_wei / (10 ** settings.ROGAN_DECIMALS)
    return True, "", amount_human


# ---------------------------------------------------------------------------
# Wallet address linking
# ---------------------------------------------------------------------------

def link_wallet_address(db: Session, user_id: str, address: str) -> dict:
    address = _normalise_address(address)
    if not address.startswith("0x") or len(address) != 42:
        raise ValueError("Invalid Base wallet address. Must be 0x + 40 hex characters.")

    # Block changes while a withdrawal is in-flight (admin may already be sending ROGAN)
    pending = (
        db.query(WithdrawalRequest)
        .filter(
            WithdrawalRequest.user_id == user_id,
            WithdrawalRequest.status.in_(["pending", "approved"]),
        )
        .first()
    )
    if pending:
        raise ValueError(
            "Cannot change wallet address while a withdrawal is pending or approved. "
            "Wait for it to complete or contact support."
        )

    wallet = db.query(Wallet).filter(Wallet.user_id == user_id).first()
    if wallet:
        wallet.wallet_address = address
        wallet.linked_at = datetime.utcnow()
    else:
        wallet = Wallet(
            id=_gen_id(),
            user_id=user_id,
            wallet_address=address,
            linked_at=datetime.utcnow(),
        )
        db.add(wallet)

    db.commit()
    return {"wallet_address": address, "linked_at": wallet.linked_at.isoformat()}


def get_linked_wallet(db: Session, user_id: str) -> Optional[str]:
    w = db.query(Wallet).filter(Wallet.user_id == user_id).first()
    return w.wallet_address if w else None


# ---------------------------------------------------------------------------
# ROGAN crypto deposit
# ---------------------------------------------------------------------------

async def process_crypto_deposit(db: Session, user_id: str, tx_hash: str) -> dict:
    """
    Full pipeline: verify tx on Base → price check → calculate TK → credit ledger.
    Raises ValueError on any failure (caller converts to HTTP 400).
    """
    if not settings.ROGAN_CONTRACT_ADDRESS or not settings.PLATFORM_WALLET_ADDRESS:
        raise ValueError("Crypto deposits are not configured on this platform yet")

    tx_hash = tx_hash.strip().lower()
    if not tx_hash.startswith("0x"):
        raise ValueError("Invalid transaction hash format")

    # 1. Duplicate hash check (global — one hash can never be used by any user twice)
    existing = db.query(CryptoDeposit).filter(CryptoDeposit.tx_hash == tx_hash).first()
    if existing:
        raise ValueError("This transaction hash has already been used for a deposit")

    # 2. Linked wallet required
    linked_address = get_linked_wallet(db, user_id)
    if not linked_address:
        raise ValueError("Link your wallet address in Settings before making a deposit")

    # 3. On-chain verification (strict sender check inside)
    ok, error_msg, amount_rogan = await _verify_rogan_transfer(
        tx_hash=tx_hash,
        expected_from=linked_address,
        expected_to=settings.PLATFORM_WALLET_ADDRESS,
        token_contract=settings.ROGAN_CONTRACT_ADDRESS,
    )
    if not ok:
        raise ValueError(error_msg)

    # 4. Price lookup
    price_usd = await get_rogan_price_usd()
    amount_usd = amount_rogan * price_usd

    if amount_usd < settings.MIN_DEPOSIT_USD:
        raise ValueError(
            f"Deposit value too small: ${amount_usd:.6f} USD. Minimum is ${settings.MIN_DEPOSIT_USD} USD."
        )

    # 5. TK calculation  →  $1 = 10 TK
    amount_tk = round(amount_usd * settings.TK_PER_USD, 4)

    # 6. Record deposit first (unique constraint prevents double-credit if request retried)
    deposit = CryptoDeposit(
        id=_gen_id(),
        user_id=user_id,
        tx_hash=tx_hash,
        wallet_address=linked_address,
        amount_rogan=amount_rogan,
        amount_usd=round(amount_usd, 6),
        amount_tk=amount_tk,
        rogan_price_usd=price_usd,
        status="confirmed",
        created_at=datetime.utcnow(),
    )
    db.add(deposit)
    db.flush()   # get deposit.id without committing yet

    # 7. Credit TK via double-entry ledger  (SYSTEM → user)
    create_transaction(
        db=db,
        type="deposit",
        amount=amount_tk,
        from_user_id=SYSTEM_USER_ID,
        to_user_id=user_id,
        reference_id=deposit.id,
        metadata={
            "method": "rogan_crypto",
            "tx_hash": tx_hash,
            "amount_rogan": amount_rogan,
            "amount_usd": round(amount_usd, 6),
            "rogan_price_usd": price_usd,
        },
        auto_commit=False,
    )

    db.commit()

    return {
        "tx_hash": tx_hash,
        "amount_rogan": amount_rogan,
        "amount_usd": round(amount_usd, 6),
        "amount_tk": amount_tk,
        "rogan_price_usd": price_usd,
        "status": "confirmed",
    }


# ---------------------------------------------------------------------------
# Stripe
# ---------------------------------------------------------------------------

def create_stripe_payment_intent(user_id: str, amount_usd: float) -> dict:
    """Create Stripe PaymentIntent. Returns client_secret for frontend Elements."""
    if not settings.STRIPE_SECRET_KEY:
        raise ValueError("Stripe payments are not configured yet")
    if amount_usd < 0.50:
        raise ValueError("Minimum Stripe deposit is $0.50")

    import stripe  # type: ignore
    stripe.api_key = settings.STRIPE_SECRET_KEY

    amount_cents = int(round(amount_usd * 100))
    intent = stripe.PaymentIntent.create(
        amount=amount_cents,
        currency="usd",
        metadata={"user_id": user_id, "platform": "roganlive"},
        automatic_payment_methods={"enabled": True},
    )
    amount_tk = round(amount_usd * settings.TK_PER_USD, 4)

    return {
        "client_secret": intent["client_secret"],
        "payment_intent_id": intent["id"],
        "amount_usd": amount_usd,
        "amount_tk": amount_tk,
    }


def confirm_stripe_payment(
    db: Session,
    payment_intent_id: str,
    user_id: str,
    amount_usd: float,
) -> dict:
    """
    Called from Stripe webhook on payment_intent.succeeded.
    Idempotent — safe to receive twice.
    """
    existing = (
        db.query(StripePayment)
        .filter(StripePayment.stripe_payment_intent_id == payment_intent_id)
        .first()
    )
    if existing and existing.status == "succeeded":
        return {"already_processed": True, "amount_tk": existing.amount_tk}

    amount_tk = round(amount_usd * settings.TK_PER_USD, 4)

    if existing:
        existing.status = "succeeded"
        payment = existing
    else:
        payment = StripePayment(
            id=_gen_id(),
            user_id=user_id,
            stripe_payment_intent_id=payment_intent_id,
            amount_usd=amount_usd,
            amount_tk=amount_tk,
            status="succeeded",
            created_at=datetime.utcnow(),
        )
        db.add(payment)
        db.flush()

    create_transaction(
        db=db,
        type="deposit",
        amount=amount_tk,
        from_user_id=SYSTEM_USER_ID,
        to_user_id=user_id,
        reference_id=payment.id,
        metadata={
            "method": "stripe",
            "payment_intent_id": payment_intent_id,
            "amount_usd": amount_usd,
        },
        auto_commit=False,
    )

    db.commit()
    return {"already_processed": False, "amount_tk": amount_tk}


# ---------------------------------------------------------------------------
# Withdrawals
# ---------------------------------------------------------------------------

MIN_WITHDRAWAL_TK = 10.0


def request_withdrawal(db: Session, user_id: str, amount_tk: float) -> dict:
    """User requests withdrawal. TK debited immediately as 'held'."""
    if amount_tk < MIN_WITHDRAWAL_TK:
        raise ValueError(f"Minimum withdrawal is {MIN_WITHDRAWAL_TK} TK")

    linked_address = get_linked_wallet(db, user_id)
    if not linked_address:
        raise ValueError("Link a wallet address before withdrawing")

    balance = get_tk_balance_with_lock(db, user_id)
    if balance < amount_tk:
        raise ValueError(f"Insufficient balance. You have {round(balance, 2)} TK.")

    withdrawal = WithdrawalRequest(
        id=_gen_id(),
        user_id=user_id,
        wallet_address=linked_address,
        amount_tk=amount_tk,
        status="pending",
        requested_at=datetime.utcnow(),
    )
    db.add(withdrawal)
    db.flush()

    # Debit TK immediately  (user → SYSTEM, "withdrawal_hold")
    create_transaction(
        db=db,
        type="withdrawal_hold",
        amount=amount_tk,
        from_user_id=user_id,
        to_user_id=SYSTEM_USER_ID,
        reference_id=withdrawal.id,
        metadata={"wallet_address": linked_address, "status": "pending"},
        auto_commit=False,
    )

    db.commit()
    return {
        "id": withdrawal.id,
        "amount_tk": amount_tk,
        "wallet_address": linked_address,
        "status": "pending",
        "requested_at": withdrawal.requested_at.isoformat(),
    }


def get_user_withdrawals(db: Session, user_id: str, page: int = 1, limit: int = 20) -> dict:
    q = (
        db.query(WithdrawalRequest)
        .filter(WithdrawalRequest.user_id == user_id)
        .order_by(WithdrawalRequest.requested_at.desc())
    )
    total = q.count()
    items = q.offset((page - 1) * limit).limit(limit).all()
    return {
        "total": total,
        "page": page,
        "items": [
            {
                "id": w.id,
                "amount_tk": w.amount_tk,
                "amount_rogan": w.amount_rogan,
                "rogan_price_usd": w.rogan_price_usd,
                "wallet_address": w.wallet_address,
                "status": w.status,
                "tx_hash": w.tx_hash,
                "rejection_reason": w.rejection_reason,
                "requested_at": w.requested_at.isoformat() if w.requested_at else None,
                "processed_at": w.processed_at.isoformat() if w.processed_at else None,
            }
            for w in items
        ],
    }


def get_user_deposit_history(db: Session, user_id: str, limit: int = 30) -> dict:
    crypto = db.query(CryptoDeposit).filter(
        CryptoDeposit.user_id == user_id
    ).order_by(CryptoDeposit.created_at.desc()).limit(limit).all()

    stripe_pays = db.query(StripePayment).filter(
        StripePayment.user_id == user_id,
        StripePayment.status == "succeeded",
    ).order_by(StripePayment.created_at.desc()).limit(limit).all()

    items = []
    for d in crypto:
        items.append({
            "id": d.id,
            "type": "rogan",
            "amount_tk": d.amount_tk,
            "amount_usd": d.amount_usd,
            "amount_rogan": d.amount_rogan,
            "tx_hash": d.tx_hash,
            "status": d.status,
            "created_at": d.created_at.isoformat() if d.created_at else None,
        })
    for p in stripe_pays:
        items.append({
            "id": p.id,
            "type": "stripe",
            "amount_tk": p.amount_tk,
            "amount_usd": p.amount_usd,
            "status": p.status,
            "created_at": p.created_at.isoformat() if p.created_at else None,
        })

    items.sort(key=lambda x: x["created_at"] or "", reverse=True)
    return {"items": items[:limit]}



# ---------------------------------------------------------------------------
# P2P TK Send
# ---------------------------------------------------------------------------

MIN_SEND_TK = 1.0


def send_tk(db: Session, sender_id: str, recipient_username: str, amount_tk: float) -> dict:
    """Transfer TK from sender to another user by username."""
    if amount_tk < MIN_SEND_TK:
        raise ValueError(f"Minimum send amount is {MIN_SEND_TK} TK")

    recipient_username = recipient_username.strip().lstrip("@")

    recipient = db.query(User).filter(User.username.ilike(recipient_username)).first()
    if not recipient:
        raise ValueError(f"User @{recipient_username} not found")
    if recipient.id == sender_id:
        raise ValueError("You cannot send TK to yourself")

    balance = get_tk_balance_with_lock(db, sender_id)
    if balance < amount_tk:
        raise ValueError(f"Insufficient balance. You have {round(balance, 2)} TK.")

    create_transaction(
        db=db,
        type="p2p_send",
        amount=amount_tk,
        from_user_id=sender_id,
        to_user_id=recipient.id,
        metadata={"note": f"P2P send to @{recipient_username}"},
        auto_commit=True,
    )

    return {
        "recipient_username": recipient_username,
        "recipient_id": recipient.id,
        "amount_tk": amount_tk,
        "new_balance": round(get_tk_balance(db, sender_id), 2),
    }



def get_user_send_history(db: Session, user_id: str, limit: int = 30) -> dict:
    """Return p2p_send transactions where user is sender or receiver."""
    from app.models.models import Transaction
    from sqlalchemy import or_

    rows = (
        db.query(Transaction)
        .filter(
            Transaction.type == "p2p_send",
            or_(Transaction.from_user_id == user_id, Transaction.to_user_id == user_id),
        )
        .order_by(Transaction.created_at.desc())
        .limit(limit)
        .all()
    )

    items = []
    for tx in rows:
        direction = "sent" if tx.from_user_id == user_id else "received"
        other_id = tx.to_user_id if direction == "sent" else tx.from_user_id
        other = db.query(User).filter(User.id == other_id).first()
        items.append({
            "id": tx.id,
            "direction": direction,
            "amount_tk": tx.amount,
            "other_user_id": other_id,
            "other_username": other.username if other else "unknown",
            "other_avatar": other.avatar if other else None,
            "created_at": tx.created_at.isoformat() if tx.created_at else None,
        })

    return {"items": items}


# ---------------------------------------------------------------------------
# Admin — withdrawal management
# ---------------------------------------------------------------------------

def admin_list_withdrawals(
    db: Session,
    status_filter: Optional[str] = None,
    page: int = 1,
    limit: int = 50,
) -> dict:
    q = db.query(WithdrawalRequest)
    if status_filter:
        q = q.filter(WithdrawalRequest.status == status_filter)
    q = q.order_by(WithdrawalRequest.requested_at.desc())

    total = q.count()
    items = q.offset((page - 1) * limit).limit(limit).all()

    result = []
    for w in items:
        user = db.query(User).filter(User.id == w.user_id).first()
        result.append({
            "id": w.id,
            "user_id": w.user_id,
            "username": user.username if user else "unknown",
            "amount_tk": w.amount_tk,
            "amount_rogan": w.amount_rogan,
            "rogan_price_usd": w.rogan_price_usd,
            "wallet_address": w.wallet_address,
            "status": w.status,
            "tx_hash": w.tx_hash,
            "rejection_reason": w.rejection_reason,
            "requested_at": w.requested_at.isoformat() if w.requested_at else None,
            "processed_at": w.processed_at.isoformat() if w.processed_at else None,
        })
    return {"total": total, "page": page, "items": result}


def admin_approve_withdrawal(db: Session, withdrawal_id: str) -> dict:
    """Mark approved — tells admin how much ROGAN to send."""
    w = db.query(WithdrawalRequest).filter(WithdrawalRequest.id == withdrawal_id).first()
    if not w:
        raise ValueError("Withdrawal not found")
    if w.status != "pending":
        raise ValueError(f"Cannot approve a withdrawal with status '{w.status}'")

    price = _get_rogan_price_usd_sync()
    amount_usd = w.amount_tk / settings.TK_PER_USD
    amount_rogan = amount_usd / price if price > 0 else 0

    w.status = "approved"
    w.amount_rogan = round(amount_rogan, 2)
    w.rogan_price_usd = price
    w.processed_at = datetime.utcnow()
    db.commit()

    return {
        "id": w.id,
        "status": "approved",
        "amount_rogan": round(amount_rogan, 2),
        "rogan_price_usd": price,
        "wallet_address": w.wallet_address,
    }


def admin_complete_withdrawal(db: Session, withdrawal_id: str, tx_hash: str) -> dict:
    """Mark completed after admin manually sent ROGAN."""
    w = db.query(WithdrawalRequest).filter(WithdrawalRequest.id == withdrawal_id).first()
    if not w:
        raise ValueError("Withdrawal not found")
    if w.status not in ("approved", "pending"):
        raise ValueError(f"Cannot complete withdrawal with status '{w.status}'")

    if not w.amount_rogan:
        price = _get_rogan_price_usd_sync()
        amount_usd = w.amount_tk / settings.TK_PER_USD
        w.amount_rogan = round(amount_usd / price, 2) if price > 0 else 0
        w.rogan_price_usd = price

    w.status = "completed"
    w.tx_hash = tx_hash.strip().lower()
    w.processed_at = datetime.utcnow()
    db.commit()

    return {"id": w.id, "status": "completed", "tx_hash": w.tx_hash}


def admin_reject_withdrawal(db: Session, withdrawal_id: str, reason: str) -> dict:
    """Reject and refund TK to user via ledger."""
    w = db.query(WithdrawalRequest).filter(WithdrawalRequest.id == withdrawal_id).first()
    if not w:
        raise ValueError("Withdrawal not found")
    if w.status not in ("pending", "approved"):
        raise ValueError(f"Cannot reject withdrawal with status '{w.status}'")

    w.status = "rejected"
    w.rejection_reason = reason
    w.processed_at = datetime.utcnow()
    db.flush()

    # Refund TK via ledger  (SYSTEM → user)
    create_transaction(
        db=db,
        type="withdrawal_refund",
        amount=w.amount_tk,
        from_user_id=SYSTEM_USER_ID,
        to_user_id=w.user_id,
        reference_id=w.id,
        metadata={"reason": reason or "rejected by admin"},
    )

    db.commit()
    return {
        "id": w.id,
        "status": w.status,
        "rejection_reason": w.rejection_reason,
    }
