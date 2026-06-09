"""
ROGAN LIVE - OAuth Routes (Phase 4)
Google OAuth2 authorization flow, callback, link/unlink.
"""

from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import User
from app.routes.auth import get_current_user_dependency
from app.schemas import (
    AuthResponse,
    OAuthAuthorizeResponse,
    OAuthLinkRequest,
    UserResponse,
)
from app.services import oauth_service

router = APIRouter(prefix="/oauth", tags=["OAuth"])


@router.get("/google/authorize", response_model=OAuthAuthorizeResponse)
def google_authorize():
    """Redirect to Google OAuth consent screen."""
    result = oauth_service.get_google_authorize_url()
    return OAuthAuthorizeResponse(**result)


@router.get("/google/callback", response_model=AuthResponse)
def google_callback(
    code: str = Query(..., min_length=1),
    state: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
):
    """Handle Google OAuth callback, create/link user, return JWT."""
    user, token = oauth_service.handle_google_callback(
        db=db,
        code=code,
        state=state,
    )
    return AuthResponse(
        user=UserResponse(
            id=user.id,
            email=user.email,
            username=user.username,
            display_name=user.display_name,
            avatar=user.avatar,
            bio=user.bio,
            role=user.role,
            is_live=user.is_live,
            created_at=user.created_at,
        ),
        token=token,
    )


@router.post("/google/link")
def link_google(
    req: OAuthLinkRequest,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Link Google account to existing user (requires password confirmation)."""
    oauth_account = oauth_service.link_google_account(
        db=db,
        user_id=current_user.id,
        google_token=req.google_token,
        password=req.password,
    )
    return {
        "message": "Google account linked successfully",
        "provider": oauth_account.provider,
        "provider_id": oauth_account.provider_id,
    }


@router.delete("/google/unlink")
def unlink_google(
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Unlink Google account."""
    return oauth_service.unlink_google_account(
        db=db,
        user_id=current_user.id,
    )
