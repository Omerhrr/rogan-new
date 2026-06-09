"""
ROGAN LIVE - Marketplace Routes (Phase 3)
Product CRUD, purchases, browse, and access control.
"""

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import MarketplaceProduct, User
from app.routes.auth import get_current_user_dependency
from app.schemas import (
    MarketplaceProductCreate,
    MarketplaceProductResponse,
    MarketplaceProductUpdate,
    ProductPurchaseResponse,
)
from app.services import marketplace_service

router = APIRouter(prefix="/marketplace", tags=["Marketplace"])


def _product_to_response(p: MarketplaceProduct, include_file: bool = False) -> Dict[str, Any]:
    """Convert a product model to a response dict."""
    result = {
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
    if include_file:
        result["file_url"] = p.file_url
    else:
        result["file_url"] = None  # Don't expose file_url to non-buyers
    return result


# ─── Product CRUD ─────────────────────────────────────────────────


@router.post("/products/", status_code=status.HTTP_201_CREATED)
def create_product(
    req: MarketplaceProductCreate,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Creator lists a product (digital/pay-per-view/custom)."""
    product = marketplace_service.create_product(
        db=db,
        creator_id=current_user.id,
        title=req.title,
        description=req.description,
        price_tk=req.price_tk,
        product_type=req.product_type,
        file_url=req.file_url,
        thumbnail_url=req.thumbnail_url,
    )
    return _product_to_response(product, include_file=True)


@router.get("/products/")
def browse_products(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    product_type: Optional[str] = Query(None, pattern=r"^(digital|payperview|custom)$"),
    search: Optional[str] = Query(None, max_length=100),
    db: Session = Depends(get_db),
):
    """Browse products (pagination, type filter, search)."""
    return marketplace_service.list_products(
        db=db,
        page=page,
        limit=limit,
        product_type=product_type,
        search=search,
    )


@router.get("/products/{product_id}")
def get_product(
    product_id: str,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Product detail. file_url is only shown if user has purchased."""
    product = marketplace_service.get_product(db=db, product_id=product_id)
    has_access = marketplace_service.verify_product_access(db, product_id, current_user.id)
    return _product_to_response(product, include_file=has_access)


@router.put("/products/{product_id}")
def update_product(
    product_id: str,
    req: MarketplaceProductUpdate,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Creator updates their product."""
    product = marketplace_service.update_product(
        db=db,
        product_id=product_id,
        creator_id=current_user.id,
        **req.model_dump(exclude_none=True),
    )
    return _product_to_response(product, include_file=True)


@router.delete("/products/{product_id}")
def delete_product(
    product_id: str,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Creator removes (archives) their product."""
    return marketplace_service.delete_product(
        db=db,
        product_id=product_id,
        creator_id=current_user.id,
    )


# ─── Purchases ────────────────────────────────────────────────────


@router.post("/products/{product_id}/purchase", status_code=status.HTTP_201_CREATED)
def purchase_product(
    product_id: str,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Purchase product (TK deduction + access grant)."""
    purchase = marketplace_service.purchase_product(
        db=db,
        product_id=product_id,
        buyer_id=current_user.id,
    )
    return {
        "id": purchase.id,
        "product_id": purchase.product_id,
        "buyer_id": purchase.buyer_id,
        "amount_tk": purchase.amount_tk,
        "created_at": purchase.created_at.isoformat() if purchase.created_at else None,
    }


@router.get("/purchases/me")
def get_my_purchases(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """User's purchased products."""
    return marketplace_service.get_user_purchases(
        db=db,
        buyer_id=current_user.id,
        page=page,
        limit=limit,
    )
