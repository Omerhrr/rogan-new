"""
ROGAN LIVE - Authentication Service
Handles registration, login, Google OAuth, and JWT token management.
Uses bcrypt directly (avoiding passlib compatibility issues with bcrypt 5.x).
"""

import secrets as _secrets
from datetime import datetime, timedelta
from typing import Optional, Tuple

import bcrypt
from fastapi import HTTPException, status
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.config import settings
from app.models.models import User
from app.utils.redis_client import redis_client

_RESET_TOKEN_TTL = 900  # 15 minutes
_RESET_KEY_PREFIX = "password_reset:"


def _hash_password(password: str) -> str:
    """Hash password using bcrypt directly."""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(12)).decode("utf-8")


def _verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify password against bcrypt hash."""
    return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))


def _create_jwt_token(user: User) -> str:
    payload = {
        "user_id": user.id,
        "email": user.email,
        "username": user.username,
        "role": user.role,
        "exp": datetime.utcnow() + timedelta(minutes=settings.JWT_EXPIRATION_MINUTES),
        "iat": datetime.utcnow(),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def register_user(
    db: Session, email: str, username: str, password: str
) -> Tuple[User, str]:
    """Register a new user. Returns (user, jwt_token)."""
    # Check for existing email
    existing_email = db.query(User).filter(User.email == email).first()
    if existing_email:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        )

    # Check for existing username
    existing_username = db.query(User).filter(User.username == username).first()
    if existing_username:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username already taken",
        )

    # Create user
    hashed_password = _hash_password(password)
    user = User(
        email=email,
        username=username,
        password_hash=hashed_password,
        display_name=username,
        role="user",
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = _create_jwt_token(user)
    return user, token


def login_user(db: Session, email: str, password: str) -> Tuple[User, str]:
    """Authenticate user by email and password. Returns (user, jwt_token)."""
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    if not user.password_hash:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account was created with Google OAuth. Please use Google login.",
        )

    if not _verify_password(password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated",
        )

    token = _create_jwt_token(user)
    return user, token


def google_oauth(db: Session, google_token: str) -> Tuple[User, str]:
    """Verify Google ID token, create or find user, return JWT token."""
    try:
        from google.oauth2 import id_token
        from google.auth.transport import requests as google_requests

        idinfo_dict = id_token.verify_oauth2_token(
            google_token,
            google_requests.Request(),
            settings.GOOGLE_CLIENT_ID,
        )

        google_id = idinfo_dict.get("sub")
        email = idinfo_dict.get("email")
        name = idinfo_dict.get("name", "")
        picture = idinfo_dict.get("picture", "")

    except Exception:
        # Fallback: use httpx to verify via Google's tokeninfo endpoint
        try:
            import httpx

            response = httpx.get(
                f"https://oauth2.googleapis.com/tokeninfo?id_token={google_token}",
                timeout=10.0,
            )
            if response.status_code != 200:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid Google token",
                )
            idinfo_dict = response.json()
            google_id = idinfo_dict.get("sub")
            email = idinfo_dict.get("email")
            name = idinfo_dict.get("name", "")
            picture = idinfo_dict.get("picture", "")

            if settings.GOOGLE_CLIENT_ID:
                audience = idinfo_dict.get("aud", "")
                if audience != settings.GOOGLE_CLIENT_ID:
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail="Google token audience mismatch",
                    )
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Failed to verify Google token",
            )

    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google account has no email",
        )

    # Find existing user by google_id or email
    user = db.query(User).filter(User.google_id == google_id).first()
    if not user:
        user = db.query(User).filter(User.email == email).first()

    if user:
        if not user.google_id:
            user.google_id = google_id
        if not user.avatar and picture:
            user.avatar = picture
        if not user.display_name and name:
            user.display_name = name
        db.commit()
        db.refresh(user)
    else:
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
        db.commit()
        db.refresh(user)

    token = _create_jwt_token(user)
    return user, token


def request_password_reset(db: Session, email: str) -> str:
    """Generate a 15-minute password reset token and store it in Redis.

    Returns the token so callers can include it in an email or (dev mode)
    return it directly in the API response.

    Raises HTTP 404 if the email is not registered, so callers that want
    to avoid email enumeration should catch and suppress this.
    """
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No account registered with that email address",
        )

    if not user.password_hash:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This account uses Google login — password reset is not available",
        )

    token = _secrets.token_urlsafe(32)
    redis_client.setex(f"{_RESET_KEY_PREFIX}{token}", _RESET_TOKEN_TTL, user.id)
    return token


def reset_password(db: Session, token: str, new_password: str) -> User:
    """Validate a reset token from Redis and update the user's password.

    The token is deleted from Redis on first use (single-use).
    """
    if len(new_password) < 8:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Password must be at least 8 characters",
        )

    user_id: Optional[str] = redis_client.get(f"{_RESET_KEY_PREFIX}{token}")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Reset token is invalid or has expired",
        )

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    user.password_hash = _hash_password(new_password)
    db.commit()
    db.refresh(user)

    # Invalidate token — single use
    redis_client.delete(f"{_RESET_KEY_PREFIX}{token}")
    return user


def get_current_user(db: Session, token: str) -> User:
    """Decode JWT token and return the corresponding user."""
    try:
        payload = jwt.decode(
            token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM]
        )
        user_id: Optional[str] = payload.get("user_id")
        if user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token payload",
            )
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated",
        )

    return user
