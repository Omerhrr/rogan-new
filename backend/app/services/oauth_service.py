"""
ROGAN LIVE - OAuth Service
Google OAuth2 flow using httpx, user creation, JWT generation, account linking.
"""

import secrets
from datetime import datetime, timedelta
from typing import Any, Dict, Optional, Tuple

import bcrypt
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.config import settings
from app.models.models import OAuthAccount, User
from app.services.auth_service import _create_jwt_token

# Google OAuth2 endpoints
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"


def get_google_authorize_url(state: Optional[str] = None) -> Dict[str, str]:
    """Generate the Google OAuth2 authorization URL.
    Returns the authorize_url and state parameter.
    """
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Google OAuth is not configured (missing GOOGLE_CLIENT_ID)",
        )

    if not state:
        state = secrets.token_urlsafe(32)

    # Store state in a way we can verify later (in production, use Redis)
    params = {
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": _get_redirect_uri(),
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "offline",
        "prompt": "consent",
    }

    query_string = "&".join(f"{k}={v}" for k, v in params.items())
    authorize_url = f"{GOOGLE_AUTH_URL}?{query_string}"

    return {"authorize_url": authorize_url, "state": state}


def handle_google_callback(
    db: Session,
    code: str,
    state: str,
) -> Tuple[User, str]:
    """Handle Google OAuth2 callback. Exchange code for tokens, create/link user.
    Returns (user, jwt_token).
    """
    # Exchange code for tokens
    token_data = _exchange_code_for_tokens(code)
    if not token_data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Failed to exchange authorization code for tokens",
        )

    access_token = token_data.get("access_token")
    refresh_token = token_data.get("refresh_token")

    # Get user info from Google
    user_info = _get_google_user_info(access_token)
    if not user_info:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Failed to retrieve Google user info",
        )

    google_id = user_info.get("id")
    email = user_info.get("email")
    name = user_info.get("name", "")
    picture = user_info.get("picture", "")

    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google account has no email",
        )

    # Find existing OAuth account
    oauth_account = db.query(OAuthAccount).filter(
        OAuthAccount.provider == "google",
        OAuthAccount.provider_id == google_id,
    ).first()

    if oauth_account:
        # Update tokens
        oauth_account.access_token = access_token
        if refresh_token:
            oauth_account.refresh_token = refresh_token
        db.commit()

        user = db.query(User).filter(User.id == oauth_account.user_id).first()
        if not user:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Linked user account not found",
            )
    else:
        # Check if user with this email exists
        user = db.query(User).filter(User.email == email).first()

        if user:
            # Link OAuth to existing user
            oauth_account = OAuthAccount(
                user_id=user.id,
                provider="google",
                provider_id=google_id,
                access_token=access_token,
                refresh_token=refresh_token,
            )
            db.add(oauth_account)

            # Update user info
            if not user.avatar and picture:
                user.avatar = picture
            if not user.display_name and name:
                user.display_name = name
            if not user.google_id:
                user.google_id = google_id
        else:
            # Create new user
            username = name.replace(" ", "_").lower() if name else email.split("@")[0]
            base_username = username
            counter = 1
            while db.query(User).filter(User.username == username).first():
                username = f"{base_username}_{counter}"
                counter += 1

            user = User(
                email=email,
                username=username,
                password_hash=None,
                google_id=google_id,
                display_name=name or username,
                avatar=picture or None,
                role="user",
            )
            db.add(user)
            db.flush()

            # Create OAuth account
            oauth_account = OAuthAccount(
                user_id=user.id,
                provider="google",
                provider_id=google_id,
                access_token=access_token,
                refresh_token=refresh_token,
            )
            db.add(oauth_account)

        db.commit()
        db.refresh(user)

    # Generate JWT token
    token = _create_jwt_token(user)
    return user, token


def link_google_account(
    db: Session,
    user_id: str,
    google_token: str,
    password: str,
) -> OAuthAccount:
    """Link a Google account to an existing user. Requires password confirmation."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    # Verify password
    if not user.password_hash:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Account has no password set. Cannot link Google account.",
        )

    if not bcrypt.checkpw(password.encode("utf-8"), user.password_hash.encode("utf-8")):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid password",
        )

    # Verify Google token and get user info
    user_info = _verify_google_token(google_token)
    if not user_info:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Google token",
        )

    google_id = user_info.get("sub")

    # Check if this Google account is already linked
    existing_oauth = db.query(OAuthAccount).filter(
        OAuthAccount.provider == "google",
        OAuthAccount.provider_id == google_id,
    ).first()
    if existing_oauth:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This Google account is already linked to another user",
        )

    # Create OAuth account link
    oauth_account = OAuthAccount(
        user_id=user_id,
        provider="google",
        provider_id=google_id,
        access_token=google_token,
    )
    db.add(oauth_account)

    # Update user's google_id if not set
    if not user.google_id:
        user.google_id = google_id

    db.commit()
    db.refresh(oauth_account)
    return oauth_account


def unlink_google_account(
    db: Session,
    user_id: str,
) -> Dict[str, str]:
    """Unlink Google account from user."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    # Must have a password to unlink (can't be locked out)
    if not user.password_hash:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot unlink Google account: you must set a password first",
        )

    oauth_accounts = db.query(OAuthAccount).filter(
        OAuthAccount.user_id == user_id,
        OAuthAccount.provider == "google",
    ).all()

    if not oauth_accounts:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No Google account linked",
        )

    for account in oauth_accounts:
        db.delete(account)

    # Clear google_id on user
    user.google_id = None
    db.commit()

    return {"message": "Google account unlinked successfully"}


def _get_redirect_uri() -> str:
    """Get the OAuth redirect URI."""
    # In production, this should be configurable
    return "http://localhost:5173/oauth/google/callback"


def _exchange_code_for_tokens(code: str) -> Optional[Dict[str, Any]]:
    """Exchange an authorization code for access/refresh tokens."""
    try:
        import httpx

        response = httpx.post(
            GOOGLE_TOKEN_URL,
            data={
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "code": code,
                "redirect_uri": _get_redirect_uri(),
                "grant_type": "authorization_code",
            },
            timeout=10.0,
        )
        if response.status_code == 200:
            return response.json()
        return None
    except Exception:
        return None


def _get_google_user_info(access_token: str) -> Optional[Dict[str, Any]]:
    """Get user info from Google using access token."""
    try:
        import httpx

        response = httpx.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10.0,
        )
        if response.status_code == 200:
            return response.json()
        return None
    except Exception:
        return None


def _verify_google_token(google_token: str) -> Optional[Dict[str, Any]]:
    """Verify a Google ID token or access token."""
    # Try Google's tokeninfo endpoint
    try:
        import httpx

        # Try as ID token first
        response = httpx.get(
            f"https://oauth2.googleapis.com/tokeninfo?id_token={google_token}",
            timeout=10.0,
        )
        if response.status_code == 200:
            data = response.json()
            if settings.GOOGLE_CLIENT_ID:
                audience = data.get("aud", "")
                if audience != settings.GOOGLE_CLIENT_ID:
                    return None
            return data
    except Exception:
        pass

    # Try as access token
    try:
        import httpx

        response = httpx.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {google_token}"},
            timeout=10.0,
        )
        if response.status_code == 200:
            data = response.json()
            # Map to ID token format
            return {
                "sub": data.get("id"),
                "email": data.get("email"),
                "name": data.get("name"),
                "picture": data.get("picture"),
            }
    except Exception:
        pass

    return None
