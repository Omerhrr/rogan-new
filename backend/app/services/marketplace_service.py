"""
ROGAN LIVE - Marketplace Service
Product CRUD, purchase flow, content access control, Redis caching.
"""

import json
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.models import MarketplaceProduct, ProductPurchase, User
from app.services.ledger_service import (
    SYSTEM_USER_ID,
    create_transaction,
    get_tk_balance,
    get_tk_balance_with_lock,
)
from app.services.notification_service import create_notification
from app.utils.redis_client import redis_client

# Platform fee on marketplace sales
MARKETPLACE_PLATFORM_FEE_RATE = 0.20

# Redis cache TTL for product searches (seconds)
PRODUCT_CACHE_TTL = 300  # 5 minutes


def create_product(
    db: Session,
    creator_id: str,
    title: str,
    description: Optional[str],
    price_tk: float,
    product_type: str = "digital",
    file_url: Optional[str] = None,
    thumbnail_url: Optional[str] = None,
) -> MarketplaceProduct:
    """Create a new marketplace product listing."""
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

    product = MarketplaceProduct(
        creator_id=creator_id,
        title=title,
        description=description,
        price_tk=price_tk,
        product_type=product_type,
        file_url=file_url,
        thumbnail_url=thumbnail_url,
        status="active",
    )
    db.add(product)
    db.commit()
    db.refresh(product)

    # Invalidate cache
    _invalidate_product_cache()
    return product


def get_product(db: Session, product_id: str) -> MarketplaceProduct:
    """Get a product by ID."""
    product = db.query(MarketplaceProduct).filter(MarketplaceProduct.id == product_id).first()
    if not product:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found",
        )
    return product


def list_products(
    db: Session,
    page: int = 1,
    limit: int = 20,
    product_type: Optional[str] = None,
    category: Optional[str] = None,
    search: Optional[str] = None,
) -> Dict[str, Any]:
    """Browse products with pagination, filtering, and search. Uses Redis caching."""
    cache_key = f"products:{page}:{limit}:{product_type}:{category}:{search}"

    # Try cache first
    try:
        cached = redis_client.get(cache_key)
        if cached:
            return json.loads(cached)
    except Exception:
        pass

    query = db.query(MarketplaceProduct).filter(MarketplaceProduct.status == "active")

    if product_type:
        query = query.filter(MarketplaceProduct.product_type == product_type)

    if search:
        search_term = f"%{search}%"
        query = query.filter(
            or_(
                MarketplaceProduct.title.ilike(search_term),
                MarketplaceProduct.description.ilike(search_term),
            )
        )

    total = query.count()
    offset = (page - 1) * limit
    products = query.order_by(MarketplaceProduct.created_at.desc()).offset(offset).limit(limit).all()

    result = {
        "products": [
            {
                "id": p.id,
                "creator_id": p.creator_id,
                "title": p.title,
                "description": p.description,
                "price_tk": p.price_tk,
                "product_type": p.product_type,
                "thumbnail_url": p.thumbnail_url,
                "status": p.status,
                "created_at": p.created_at.isoformat() if p.created_at else None,
            }
            for p in products
        ],
        "total": total,
        "page": page,
        "limit": limit,
        "pages": (total + limit - 1) // limit if total > 0 else 0,
    }

    # Cache result
    try:
        redis_client.set(cache_key, json.dumps(result, default=str), ex=PRODUCT_CACHE_TTL)
    except Exception:
        pass

    return result


def update_product(
    db: Session,
    product_id: str,
    creator_id: str,
    **kwargs,
) -> MarketplaceProduct:
    """Creator updates their product. Only the product owner can update."""
    product = get_product(db, product_id)

    if product.creator_id != creator_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the product creator can update this product",
        )

    for key, value in kwargs.items():
        if value is not None and hasattr(product, key):
            setattr(product, key, value)

    db.commit()
    db.refresh(product)

    _invalidate_product_cache()
    return product


def delete_product(
    db: Session,
    product_id: str,
    creator_id: str,
) -> Dict[str, str]:
    """Creator removes their product (archives it)."""
    product = get_product(db, product_id)

    if product.creator_id != creator_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the product creator can delete this product",
        )

    product.status = "archived"
    db.commit()

    _invalidate_product_cache()
    return {"message": "Product archived", "product_id": product_id}


def purchase_product(
    db: Session,
    product_id: str,
    buyer_id: str,
) -> ProductPurchase:
    """Purchase a product. Deducts TK via ledger, creates access record."""
    product = get_product(db, product_id)

    if product.status != "active":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Product is not available for purchase",
        )

    if product.creator_id == buyer_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot purchase your own product",
        )

    # Check if already purchased
    existing = (
        db.query(ProductPurchase)
        .filter(
            ProductPurchase.product_id == product_id,
            ProductPurchase.buyer_id == buyer_id,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You have already purchased this product",
        )

    # Check balance and deduct
    balance = get_tk_balance_with_lock(db, buyer_id)
    if balance < product.price_tk:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Insufficient TK balance. Current: {balance}, Required: {product.price_tk}",
        )

    # Create purchase record
    purchase = ProductPurchase(
        product_id=product_id,
        buyer_id=buyer_id,
        amount_tk=product.price_tk,
    )
    db.add(purchase)
    db.flush()

    # Double-entry: buyer debit -> creator credit (minus platform fee)
    platform_fee = round(product.price_tk * MARKETPLACE_PLATFORM_FEE_RATE, 2)
    creator_credit = round(product.price_tk - platform_fee, 2)

    create_transaction(
        db=db,
        type="marketplace_purchase",
        amount=product.price_tk,
        from_user_id=buyer_id,
        to_user_id=product.creator_id,
        reference_id=purchase.id,
        metadata={
            "product_id": product_id,
            "product_title": product.title,
            "creator_credit": creator_credit,
            "platform_fee": platform_fee,
        },
    )

    if platform_fee > 0:
        create_transaction(
            db=db,
            type="platform_fee",
            amount=platform_fee,
            from_user_id=product.creator_id,
            to_user_id=SYSTEM_USER_ID,
            reference_id=purchase.id,
            metadata={
                "fee_type": "marketplace",
                "product_id": product_id,
            },
        )

    db.commit()
    db.refresh(purchase)

    # Notify creator
    create_notification(
        db=db,
        user_id=product.creator_id,
        type="marketplace_purchase",
        title="Product Purchased!",
        message=f"Your product '{product.title}' was purchased!",
        metadata={"product_id": product_id, "purchase_id": purchase.id, "buyer_id": buyer_id},
    )

    return purchase


def get_user_purchases(
    db: Session, buyer_id: str, page: int = 1, limit: int = 20
) -> Dict[str, Any]:
    """Get a user's purchased products."""
    query = (
        db.query(ProductPurchase)
        .filter(ProductPurchase.buyer_id == buyer_id)
        .order_by(ProductPurchase.created_at.desc())
    )

    total = query.count()
    offset = (page - 1) * limit
    purchases = query.offset(offset).limit(limit).all()

    return {
        "purchases": [
            {
                "id": p.id,
                "product_id": p.product_id,
                "buyer_id": p.buyer_id,
                "amount_tk": p.amount_tk,
                "created_at": p.created_at.isoformat() if p.created_at else None,
            }
            for p in purchases
        ],
        "total": total,
        "page": page,
        "limit": limit,
        "pages": (total + limit - 1) // limit if total > 0 else 0,
    }


def verify_product_access(db: Session, product_id: str, user_id: str) -> bool:
    """Verify that a user has purchased a product and can access its content."""
    purchase = (
        db.query(ProductPurchase)
        .filter(
            ProductPurchase.product_id == product_id,
            ProductPurchase.buyer_id == user_id,
        )
        .first()
    )
    return purchase is not None


def _invalidate_product_cache():
    """Invalidate all product search caches."""
    try:
        # Best-effort cache invalidation
        redis_client.delete("products:*")
    except Exception:
        pass
