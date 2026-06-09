"""
ROGAN LIVE - Subscription Service
Tier CRUD, subscription lifecycle, auto-renewal, and TK deduction via ledger.
"""

import json
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.models import Subscription, SubscriptionTier, User
from app.services.ledger_service import (
    SYSTEM_USER_ID,
    create_transaction,
    get_tk_balance,
    get_tk_balance_with_lock,
)
from app.services.notification_service import create_notification

# Maximum number of tiers a creator can have
MAX_TIERS_PER_CREATOR = 3

# Platform fee rate for subscriptions (20%)
SUBSCRIPTION_PLATFORM_FEE_RATE = 0.20


def create_tier(
    db: Session,
    creator_id: str,
    name: str,
    price_tk: float,
    perks: Optional[List[str]] = None,
    max_subscribers: Optional[int] = None,
) -> SubscriptionTier:
    """Create a new subscription tier for a creator (max 3)."""
    # Verify creator exists and has correct role
    creator = db.query(User).filter(User.id == creator_id).first()
    if not creator:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Creator not found",
        )
    if creator.role not in ("creator", "admin"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is not a creator",
        )

    # Check tier limit
    existing_count = (
        db.query(SubscriptionTier)
        .filter(SubscriptionTier.creator_id == creator_id, SubscriptionTier.is_active == True)
        .count()
    )
    if existing_count >= MAX_TIERS_PER_CREATOR:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Creators can have at most {MAX_TIERS_PER_CREATOR} active tiers",
        )

    tier = SubscriptionTier(
        creator_id=creator_id,
        name=name,
        price_tk=price_tk,
        perks=json.dumps(perks) if perks else None,
        max_subscribers=max_subscribers,
        is_active=True,
    )
    db.add(tier)
    db.commit()
    db.refresh(tier)
    return tier


def get_creator_tiers(db: Session, creator_id: str) -> List[SubscriptionTier]:
    """Get all active subscription tiers for a creator."""
    return (
        db.query(SubscriptionTier)
        .filter(SubscriptionTier.creator_id == creator_id, SubscriptionTier.is_active == True)
        .order_by(SubscriptionTier.price_tk.asc())
        .all()
    )


def subscribe_to_tier(
    db: Session,
    subscriber_id: str,
    tier_id: Optional[str] = None,
    creator_id: Optional[str] = None,
    tier_name: str = "basic",
    auto_renew: bool = True,
) -> Subscription:
    """Subscribe a user to a creator's tier. Deducts TK via ledger (double-entry)."""
    # Cannot subscribe to yourself
    if subscriber_id == creator_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot subscribe to yourself",
        )

    # Determine tier and price
    price: float = 0.0
    resolved_tier_id: Optional[str] = tier_id
    resolved_creator_id: Optional[str] = creator_id

    if tier_id:
        tier_obj = db.query(SubscriptionTier).filter(SubscriptionTier.id == tier_id).first()
        if not tier_obj:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Subscription tier not found",
            )
        if not tier_obj.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This tier is not active",
            )
        price = tier_obj.price_tk
        resolved_creator_id = tier_obj.creator_id
        tier_name = tier_obj.name
    elif creator_id:
        # Fallback: use tier_name to find matching tier
        tier_obj = (
            db.query(SubscriptionTier)
            .filter(
                SubscriptionTier.creator_id == creator_id,
                SubscriptionTier.name.ilike(tier_name),
                SubscriptionTier.is_active == True,
            )
            .first()
        )
        if tier_obj:
            price = tier_obj.price_tk
            resolved_tier_id = tier_obj.id
        else:
            # Use default pricing
            DEFAULT_PRICES = {"basic": 5.0, "premium": 15.0, "vip": 50.0}
            price = DEFAULT_PRICES.get(tier_name, 5.0)
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Must provide either tier_id or creator_id",
        )

    # Verify creator exists
    creator = db.query(User).filter(User.id == resolved_creator_id).first()
    if not creator:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Creator not found",
        )

    # Check for existing active subscription
    existing = (
        db.query(Subscription)
        .filter(
            Subscription.subscriber_id == subscriber_id,
            Subscription.creator_id == resolved_creator_id,
            Subscription.is_active == True,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Already subscribed to this creator",
        )

    # Check max_subscribers for tier
    if resolved_tier_id and tier_obj and tier_obj.max_subscribers:
        current_count = (
            db.query(Subscription)
            .filter(
                Subscription.tier_id == resolved_tier_id,
                Subscription.is_active == True,
            )
            .count()
        )
        if current_count >= tier_obj.max_subscribers:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This tier has reached its subscriber limit",
            )

    # Check balance and deduct TK via ledger (double-entry)
    balance = get_tk_balance_with_lock(db, subscriber_id)
    if balance < price:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Insufficient TK balance. Current: {balance}, Required: {price}",
        )

    # Create subscription record
    now = datetime.utcnow()
    subscription = Subscription(
        subscriber_id=subscriber_id,
        creator_id=resolved_creator_id,
        tier_id=resolved_tier_id,
        tier=tier_name,
        price=price,
        is_active=True,
        status="active",
        auto_renew=auto_renew,
        started_at=now,
        expires_at=now + timedelta(days=30),
    )
    db.add(subscription)
    db.flush()  # Get the ID before commit

    # Double-entry: subscriber debit -> creator credit (minus platform fee)
    platform_fee = round(price * SUBSCRIPTION_PLATFORM_FEE_RATE, 2)
    creator_credit = round(price - platform_fee, 2)

    # Debit subscriber: subscriber -> creator
    create_transaction(
        db=db,
        type="subscription",
        amount=price,
        from_user_id=subscriber_id,
        to_user_id=resolved_creator_id,
        reference_id=subscription.id,
        metadata={
            "tier_id": resolved_tier_id,
            "tier_name": tier_name,
            "creator_credit": creator_credit,
            "platform_fee": platform_fee,
        },
    )

    # Platform fee: creator -> SYSTEM
    if platform_fee > 0:
        create_transaction(
            db=db,
            type="platform_fee",
            amount=platform_fee,
            from_user_id=resolved_creator_id,
            to_user_id=SYSTEM_USER_ID,
            reference_id=subscription.id,
            metadata={
                "fee_type": "subscription",
                "fee_rate": SUBSCRIPTION_PLATFORM_FEE_RATE,
                "subscription_id": subscription.id,
            },
        )

    db.commit()
    db.refresh(subscription)

    # Notify creator
    create_notification(
        db=db,
        user_id=resolved_creator_id,
        type="subscription",
        title="New Subscriber!",
        message=f"You have a new subscriber on your {tier_name} tier!",
        metadata={"subscription_id": subscription.id, "subscriber_id": subscriber_id},
    )

    return subscription


def cancel_subscription(db: Session, subscription_id: str, subscriber_id: str) -> Subscription:
    """Cancel a subscription. Only the subscriber can cancel."""
    subscription = db.query(Subscription).filter(Subscription.id == subscription_id).first()
    if not subscription:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Subscription not found",
        )

    if subscription.subscriber_id != subscriber_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the subscriber can cancel this subscription",
        )

    if not subscription.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Subscription is already cancelled",
        )

    subscription.is_active = False
    subscription.status = "cancelled"
    subscription.auto_renew = False
    db.commit()
    db.refresh(subscription)

    # Notify creator
    create_notification(
        db=db,
        user_id=subscription.creator_id,
        type="subscription",
        title="Subscription Cancelled",
        message="A subscriber has cancelled their subscription",
        metadata={"subscription_id": subscription.id},
    )

    return subscription


def get_user_subscriptions(
    db: Session, subscriber_id: str, page: int = 1, limit: int = 20
) -> Dict[str, Any]:
    """Get a user's active subscriptions (paginated)."""
    query = (
        db.query(Subscription)
        .filter(Subscription.subscriber_id == subscriber_id)
        .order_by(Subscription.created_at.desc())
    )

    total = query.count()
    offset = (page - 1) * limit
    subscriptions = query.offset(offset).limit(limit).all()

    return {
        "subscriptions": subscriptions,
        "total": total,
        "page": page,
        "limit": limit,
        "pages": (total + limit - 1) // limit if total > 0 else 0,
    }


def get_creator_subscribers(
    db: Session, creator_id: str, page: int = 1, limit: int = 20
) -> Dict[str, Any]:
    """Get a creator's active subscribers (paginated)."""
    query = (
        db.query(Subscription)
        .filter(Subscription.creator_id == creator_id, Subscription.is_active == True)
        .order_by(Subscription.created_at.desc())
    )

    total = query.count()
    offset = (page - 1) * limit
    subscriptions = query.offset(offset).limit(limit).all()

    return {
        "subscribers": subscriptions,
        "total": total,
        "page": page,
        "limit": limit,
        "pages": (total + limit - 1) // limit if total > 0 else 0,
    }


def process_auto_renewals(db: Session) -> Dict[str, int]:
    """Process auto-renewals for all active subscriptions.
    Checks daily: deducts monthly TK, cancels if insufficient balance.
    Returns stats: renewed, cancelled, expired.
    """
    now = datetime.utcnow()
    stats = {"renewed": 0, "cancelled": 0, "expired": 0}

    # Find active subscriptions that have expired
    expired_subs = (
        db.query(Subscription)
        .filter(
            Subscription.is_active == True,
            Subscription.expires_at <= now,
        )
        .all()
    )

    for sub in expired_subs:
        if sub.auto_renew:
            # Try to renew
            balance = get_tk_balance_with_lock(db, sub.subscriber_id)
            if balance >= sub.price:
                # Deduct and extend
                platform_fee = round(sub.price * SUBSCRIPTION_PLATFORM_FEE_RATE, 2)
                creator_credit = round(sub.price - platform_fee, 2)

                create_transaction(
                    db=db,
                    type="subscription",
                    amount=sub.price,
                    from_user_id=sub.subscriber_id,
                    to_user_id=sub.creator_id,
                    reference_id=sub.id,
                    metadata={
                        "auto_renewal": True,
                        "tier": sub.tier,
                        "creator_credit": creator_credit,
                        "platform_fee": platform_fee,
                    },
                )

                if platform_fee > 0:
                    create_transaction(
                        db=db,
                        type="platform_fee",
                        amount=platform_fee,
                        from_user_id=sub.creator_id,
                        to_user_id=SYSTEM_USER_ID,
                        reference_id=sub.id,
                        metadata={
                            "fee_type": "subscription_auto_renewal",
                            "subscription_id": sub.id,
                        },
                    )

                sub.expires_at = now + timedelta(days=30)
                sub.started_at = now
                stats["renewed"] += 1
            else:
                # Insufficient balance, cancel
                sub.is_active = False
                sub.status = "cancelled"
                sub.auto_renew = False
                stats["cancelled"] += 1

                create_notification(
                    db=db,
                    user_id=sub.subscriber_id,
                    type="subscription",
                    title="Subscription Cancelled",
                    message=f"Your subscription was cancelled due to insufficient TK balance.",
                    metadata={"subscription_id": sub.id},
                )
        else:
            # Auto-renew disabled, just expire
            sub.is_active = False
            sub.status = "expired"
            stats["expired"] += 1

    db.commit()
    return stats


def check_subscriber_benefits(db: Session, subscriber_id: str, creator_id: str) -> Dict[str, Any]:
    """Check if a user has an active subscription to a creator and return benefits."""
    sub = (
        db.query(Subscription)
        .filter(
            Subscription.subscriber_id == subscriber_id,
            Subscription.creator_id == creator_id,
            Subscription.is_active == True,
        )
        .first()
    )

    if not sub:
        return {"is_subscriber": False, "tier": None, "perks": []}

    perks = []
    if sub.tier_id:
        tier = db.query(SubscriptionTier).filter(SubscriptionTier.id == sub.tier_id).first()
        if tier and tier.perks:
            try:
                perks = json.loads(tier.perks)
            except (json.JSONDecodeError, TypeError):
                perks = []

    return {
        "is_subscriber": True,
        "tier": sub.tier,
        "tier_id": sub.tier_id,
        "perks": perks,
        "expires_at": sub.expires_at.isoformat() if sub.expires_at else None,
    }
