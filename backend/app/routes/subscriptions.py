"""
ROGAN LIVE - Subscription Routes (Phase 3)
Full subscription tier management, subscribe/cancel, auto-renewal.
"""

from datetime import datetime
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import User
from app.routes.auth import get_current_user_dependency
from app.schemas import (
    SubscribeRequest,
    SubscriptionResponse,
    SubscriptionTierCreate,
    SubscriptionTierResponse,
)
from app.services import subscription_service

router = APIRouter(prefix="/subscriptions", tags=["Subscriptions"])


def _tier_to_response(tier) -> Dict[str, Any]:
    """Convert a SubscriptionTier model to a response dict."""
    return {
        "id": tier.id,
        "creator_id": tier.creator_id,
        "name": tier.name,
        "price_tk": tier.price_tk,
        "perks": tier.perks,
        "max_subscribers": tier.max_subscribers,
        "is_active": tier.is_active,
        "created_at": tier.created_at.isoformat() if tier.created_at else None,
    }


def _sub_to_response(sub) -> Dict[str, Any]:
    """Convert a Subscription model to a response dict."""
    return {
        "id": sub.id,
        "subscriber_id": sub.subscriber_id,
        "creator_id": sub.creator_id,
        "tier_id": sub.tier_id,
        "tier": sub.tier,
        "price": sub.price,
        "is_active": sub.is_active,
        "status": sub.status,
        "auto_renew": sub.auto_renew,
        "started_at": sub.started_at.isoformat() if sub.started_at else None,
        "created_at": sub.created_at.isoformat() if sub.created_at else None,
        "expires_at": sub.expires_at.isoformat() if sub.expires_at else None,
    }


# ─── Tier Management ─────────────────────────────────────────────


@router.post("/tiers/", status_code=status.HTTP_201_CREATED)
def create_tier(
    req: SubscriptionTierCreate,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Creator creates a subscription tier (max 3 tiers: Basic, Premium, VIP)."""
    tier = subscription_service.create_tier(
        db=db,
        creator_id=current_user.id,
        name=req.name,
        price_tk=req.price_tk,
        perks=req.perks,
        max_subscribers=req.max_subscribers,
    )
    return _tier_to_response(tier)


@router.get("/tiers/{creator_id}")
def list_creator_tiers(
    creator_id: str,
    db: Session = Depends(get_db),
):
    """List a creator's subscription tiers."""
    tiers = subscription_service.get_creator_tiers(db=db, creator_id=creator_id)
    return {"tiers": [_tier_to_response(t) for t in tiers]}


# ─── Subscription Lifecycle ──────────────────────────────────────


@router.post("/subscribe/", status_code=status.HTTP_201_CREATED)
def subscribe(
    req: SubscribeRequest,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """User subscribes to a tier (monthly TK deduction via ledger)."""
    subscription = subscription_service.subscribe_to_tier(
        db=db,
        subscriber_id=current_user.id,
        tier_id=req.tier_id,
        creator_id=req.creator_id,
        tier_name=req.tier,
        auto_renew=req.auto_renew,
    )
    return _sub_to_response(subscription)


@router.delete("/{subscription_id}")
def cancel_subscription(
    subscription_id: str,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Cancel subscription (subscriber only)."""
    subscription = subscription_service.cancel_subscription(
        db=db,
        subscription_id=subscription_id,
        subscriber_id=current_user.id,
    )
    return {**_sub_to_response(subscription), "message": "Subscription cancelled"}


@router.get("/me")
def get_my_subscriptions(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Get current user's active subscriptions."""
    result = subscription_service.get_user_subscriptions(
        db=db, subscriber_id=current_user.id, page=page, limit=limit
    )
    return {
        "subscriptions": [_sub_to_response(s) for s in result["subscriptions"]],
        "total": result["total"],
        "page": result["page"],
        "limit": result["limit"],
        "pages": result["pages"],
    }


@router.get("/creators/me/subscribers")
def get_my_subscribers(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Creator sees their subscribers (creator only)."""
    if current_user.role not in ("creator", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only creators can view subscribers",
        )

    result = subscription_service.get_creator_subscribers(
        db=db, creator_id=current_user.id, page=page, limit=limit
    )
    return {
        "subscribers": [_sub_to_response(s) for s in result["subscribers"]],
        "total": result["total"],
        "page": result["page"],
        "limit": result["limit"],
        "pages": result["pages"],
    }


# ─── Auto-Renewal Trigger (Admin/Internal) ───────────────────────


@router.post("/renewals/process")
def process_renewals(
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Process auto-renewals for all active subscriptions (admin/internal)."""
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can trigger renewal processing",
        )

    stats = subscription_service.process_auto_renewals(db=db)
    return {"message": "Renewals processed", "stats": stats}
