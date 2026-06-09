"""
ROGAN LIVE - Web3 Routes (Phase 4)
SIWE nonce/verify, WalletConnect, deposit/withdraw. Web3 is ONLY for
deposit/withdraw — Web2 login stays primary.
"""

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import User
from app.routes.auth import get_current_user_dependency
from app.schemas import (
    SIWENonceResponse,
    SIWEVerifyRequest,
    WalletWeb3Response,
    Web3DepositRequest,
    Web3WithdrawRequest,
)
from app.services import web3_service

router = APIRouter(prefix="/web3", tags=["Web3"])


@router.post("/siwe/nonce", response_model=SIWENonceResponse)
def generate_nonce(
    current_user: User = Depends(get_current_user_dependency),
):
    """Generate SIWE nonce for wallet login/signing."""
    nonce, message = web3_service.generate_siwe_nonce()
    return SIWENonceResponse(nonce=nonce, message=message)


@router.post("/siwe/verify")
def verify_siwe(
    req: SIWEVerifyRequest,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Verify SIWE signature, create/link wallet to user."""
    wallet = web3_service.verify_siwe_signature(
        db=db,
        message=req.message,
        signature=req.signature,
        user_id=current_user.id,
    )
    return {
        "message": "Wallet linked successfully",
        "eth_address": wallet.eth_address,
    }


@router.post("/walletconnect/session")
def initiate_walletconnect(
    current_user: User = Depends(get_current_user_dependency),
):
    """Initiate WalletConnect session."""
    session = web3_service.initiate_walletconnect_session(user_id=current_user.id)
    return session


@router.get("/wallet/me", response_model=WalletWeb3Response)
def get_wallet(
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Get linked wallet address and balance."""
    wallet_info = web3_service.get_wallet_info(db=db, user_id=current_user.id)
    return WalletWeb3Response(**wallet_info)


@router.post("/deposit")
def deposit_tokens(
    req: Web3DepositRequest,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Deposit ROGAN tokens (on-chain → off-chain TK mint). Max 5/day."""
    result = web3_service.deposit_rogan_tokens(
        db=db,
        user_id=current_user.id,
        amount=req.amount,
        tx_hash=req.tx_hash,
    )
    return result


@router.post("/withdraw")
def withdraw_tokens(
    req: Web3WithdrawRequest,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Withdraw TK → ROGAN (off-chain burn → on-chain transfer). 2% fee. Max 5/day."""
    result = web3_service.withdraw_rogan_tokens(
        db=db,
        user_id=current_user.id,
        tk_amount=req.tk_amount,
    )
    return result
