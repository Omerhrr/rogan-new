"""
ROGAN LIVE - Wallet Routes
GET /wallet/, POST /wallet/link, POST /wallet/deposit,
POST /wallet/withdraw, GET /wallet/transactions
"""

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import User
from app.routes.auth import get_current_user_dependency
from app.schemas import DepositRequest, LinkWalletRequest, WithdrawRequest
from app.services import wallet_service, ledger_service

router = APIRouter(prefix="/wallet", tags=["Wallet"])


@router.get("/")
def get_wallet(
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Get wallet info + TK balance (auth required)."""
    return wallet_service.get_wallet(db=db, user_id=current_user.id)


@router.post("/link")
def link_wallet(
    request: LinkWalletRequest,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Link a Web3 wallet address (auth required)."""
    wallet = wallet_service.link_wallet(
        db=db,
        user_id=current_user.id,
        wallet_address=request.wallet_address,
    )
    return {
        "id": wallet.id,
        "user_id": wallet.user_id,
        "wallet_address": wallet.wallet_address,
        "linked_at": wallet.linked_at.isoformat() if wallet.linked_at else None,
        "message": "Wallet linked successfully",
    }


@router.post("/deposit")
def deposit(
    request: DepositRequest,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Deposit ROGAN (mints TK) (auth required)."""
    return wallet_service.deposit_rogan(
        db=db,
        user_id=current_user.id,
        amount=request.amount,
    )


@router.post("/withdraw")
def withdraw(
    request: WithdrawRequest,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Withdraw ROGAN (burns TK) (auth required)."""
    return wallet_service.withdraw_rogan(
        db=db,
        user_id=current_user.id,
        tk_amount=request.tk_amount,
    )


@router.get("/transactions")
def get_transactions(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Get transaction history (auth required, paginated)."""
    result = ledger_service.get_transaction_history(
        db=db,
        user_id=current_user.id,
        page=page,
        limit=limit,
    )
    return {
        "transactions": [
            {
                "id": t.id,
                "type": t.type,
                "amount": t.amount,
                "from_user_id": t.from_user_id,
                "to_user_id": t.to_user_id,
                "reference_id": t.reference_id,
                "metadata": t.meta_data,
                "created_at": t.created_at.isoformat() if t.created_at else None,
            }
            for t in result["transactions"]
        ],
        "total": result["total"],
        "page": result["page"],
        "limit": result["limit"],
        "pages": result["pages"],
    }
