"""Wallet routes — ROGAN crypto deposits, Stripe purchases, withdrawals."""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.config import settings
from app.models.models import User
from app.routes.auth import get_current_user_dependency as get_current_user
from app.services.ledger_service import get_tk_balance
from app.services.wallet_service import (
    admin_approve_withdrawal,
    admin_set_rogan_price,
    get_user_send_history,
    send_tk,
    admin_complete_withdrawal,
    admin_list_withdrawals,
    admin_reject_withdrawal,
    confirm_stripe_payment,
    create_stripe_payment_intent,
    get_linked_wallet,
    get_user_deposit_history,
    get_user_withdrawals,
    get_rogan_price_usd,
    link_wallet_address,
    process_crypto_deposit,
    request_withdrawal,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/wallet", tags=["wallet"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class LinkWalletRequest(BaseModel):
    wallet_address: str


class CryptoDepositRequest(BaseModel):
    tx_hash: str


class StripeIntentRequest(BaseModel):
    amount_usd: float = Field(..., gt=0)


class WithdrawRequest(BaseModel):
    amount_tk: float = Field(..., gt=0)


class SendTKRequest(BaseModel):
    recipient_username: str = Field(..., min_length=1)
    amount_tk: float = Field(..., gt=0)


class AdminApproveRequest(BaseModel):
    pass  # no body needed


class AdminCompleteRequest(BaseModel):
    tx_hash: str


class AdminRejectRequest(BaseModel):
    reason: str = Field(..., min_length=3)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _require_admin(current_user: User):
    if current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")


# ---------------------------------------------------------------------------
# User wallet info
# ---------------------------------------------------------------------------

@router.get("/me")
async def get_wallet_info(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return TK balance, linked wallet address, and current ROGAN price."""
    balance = get_tk_balance(db, current_user.id)
    linked = get_linked_wallet(db, current_user.id)
    price = await get_rogan_price_usd()

    return {
        "tk_balance": round(balance, 2),
        "wallet_address": linked,
        "rogan_price_usd": price,
        "platform_wallet": settings.PLATFORM_WALLET_ADDRESS or None,
        "rogan_contract": settings.ROGAN_CONTRACT_ADDRESS or None,
        "tk_per_usd": settings.TK_PER_USD,
        "min_deposit_usd": settings.MIN_DEPOSIT_USD,
    }


@router.post("/link-address")
async def link_address(
    body: LinkWalletRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        result = link_wallet_address(db, current_user.id, body.wallet_address)
        return {"success": True, **result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------------------------------------------------------
# ROGAN crypto deposit
# ---------------------------------------------------------------------------

@router.post("/deposit/crypto")
async def deposit_crypto(
    body: CryptoDepositRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Verify an on-chain ROGAN transfer and credit TK.
    tx.from must match the user's linked wallet address.
    """
    try:
        result = await process_crypto_deposit(db, current_user.id, body.tx_hash)
        return {"success": True, **result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------------------------------------------------------
# Stripe deposit
# ---------------------------------------------------------------------------

@router.post("/deposit/stripe/create-intent")
async def stripe_create_intent(
    body: StripeIntentRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a Stripe PaymentIntent. Returns client_secret for frontend."""
    try:
        result = create_stripe_payment_intent(current_user.id, body.amount_usd)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/deposit/stripe/webhook")
async def stripe_webhook(
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Stripe sends payment_intent.succeeded events here.
    Verify webhook signature then credit TK.
    """
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    if not settings.STRIPE_WEBHOOK_SECRET:
        # Dev mode — skip signature verification
        logger.warning("STRIPE_WEBHOOK_SECRET not set — skipping webhook signature check")
        import json
        event = json.loads(payload)
    else:
        try:
            import stripe  # type: ignore
            stripe.api_key = settings.STRIPE_SECRET_KEY
            event = stripe.Webhook.construct_event(
                payload, sig_header, settings.STRIPE_WEBHOOK_SECRET
            )
        except Exception as e:
            logger.error(f"Stripe webhook verification failed: {e}")
            raise HTTPException(status_code=400, detail="Webhook verification failed")

    if event["type"] == "payment_intent.succeeded":
        intent = event["data"]["object"]
        user_id = intent.get("metadata", {}).get("user_id")
        if not user_id:
            logger.error("No user_id in Stripe PaymentIntent metadata")
            return {"received": True}

        amount_usd = intent["amount"] / 100.0   # cents → dollars

        result = confirm_stripe_payment(
            db=db,
            payment_intent_id=intent["id"],
            user_id=user_id,
            amount_usd=amount_usd,
        )
        logger.info(f"Stripe payment confirmed: {intent['id']} → {result}")

    return {"received": True}


# ---------------------------------------------------------------------------
# Stripe publishable key (frontend needs this to initialise Stripe.js)
# ---------------------------------------------------------------------------

@router.get("/stripe/config")
async def stripe_config():
    return {
        "publishable_key": settings.STRIPE_PUBLISHABLE_KEY or None,
        "enabled": bool(settings.STRIPE_SECRET_KEY),
    }


# ---------------------------------------------------------------------------
# Withdrawals
# ---------------------------------------------------------------------------

@router.post("/withdraw")
async def withdraw(
    body: WithdrawRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        result = request_withdrawal(db, current_user.id, body.amount_tk)
        return {"success": True, **result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/sends")
async def list_my_sends(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return p2p send/receive history for the current user."""
    return get_user_send_history(db, current_user.id)


@router.get("/withdrawals")
async def list_my_withdrawals(
    page: int = 1,
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return get_user_withdrawals(db, current_user.id, page=page, limit=limit)


@router.get("/deposits")
async def list_my_deposits(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return get_user_deposit_history(db, current_user.id)


# ---------------------------------------------------------------------------
# Admin — withdrawal management
# ---------------------------------------------------------------------------

@router.post("/send")
async def send_tk_to_user(
    body: SendTKRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Send TK to another user by username."""
    try:
        result = send_tk(db, current_user.id, body.recipient_username, body.amount_tk)
        return {"success": True, **result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/admin/withdrawals")
async def admin_get_withdrawals(
    status: Optional[str] = None,
    page: int = 1,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    return admin_list_withdrawals(db, status_filter=status, page=page, limit=limit)


@router.post("/admin/withdrawals/{withdrawal_id}/approve")
async def admin_approve(
    withdrawal_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    try:
        return admin_approve_withdrawal(db, withdrawal_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/admin/withdrawals/{withdrawal_id}/complete")
async def admin_complete(
    withdrawal_id: str,
    body: AdminCompleteRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    try:
        return admin_complete_withdrawal(db, withdrawal_id, body.tx_hash)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/admin/withdrawals/{withdrawal_id}/reject")
async def admin_reject(
    withdrawal_id: str,
    body: AdminRejectRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    try:
        return admin_reject_withdrawal(db, withdrawal_id, body.reason)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------------------------------------------------------
# Admin: ROGAN price management
# ---------------------------------------------------------------------------

class SetRoganPriceRequest(BaseModel):
    price_usd: float = Field(..., gt=0, description="ROGAN price in USD")


@router.post("/admin/rogan-price")
async def admin_set_price(
    body: SetRoganPriceRequest,
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    try:
        admin_set_rogan_price(body.price_usd)
        return {"price_usd": body.price_usd, "message": "ROGAN price updated"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/admin/rogan-price")
async def admin_get_price(current_user: User = Depends(get_current_user)):
    _require_admin(current_user)
    price = await get_rogan_price_usd()
    return {"price_usd": price, "fallback": settings.ROGAN_PRICE_FALLBACK_USD}
