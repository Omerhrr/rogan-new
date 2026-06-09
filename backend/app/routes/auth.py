"""
ROGAN LIVE - Auth Routes
POST /auth/register, /auth/login, /auth/google, GET /auth/me, PUT /auth/me
"""

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import User
from app.schemas import (
    AuthResponse,
    GoogleAuthRequest,
    LoginRequest,
    RegisterRequest,
    UpdateProfileRequest,
    UserResponse,
)
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["Authentication"])
security = HTTPBearer()

# Rate limiter for auth routes
limiter = Limiter(key_func=get_remote_address)


@router.get("/google-client-id")
def get_google_client_id():
    """Return the Google OAuth Client ID for frontend initialization."""
    from app.config import settings
    return {"client_id": settings.GOOGLE_CLIENT_ID}


def get_current_user_dependency(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
):
    """FastAPI dependency to extract and validate current user from Bearer token."""
    return auth_service.get_current_user(db, credentials.credentials)


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
def register(request: Request, req: RegisterRequest, db: Session = Depends(get_db)):
    """Register a new user with email, username, and password. Rate limited: 5/min."""
    user, token = auth_service.register_user(
        db=db,
        email=req.email,
        username=req.username,
        password=req.password,
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


@router.post("/login", response_model=AuthResponse)
@limiter.limit("5/minute")
def login(request: Request, req: LoginRequest, db: Session = Depends(get_db)):
    """Authenticate with email and password. Rate limited: 5/min."""
    user, token = auth_service.login_user(
        db=db,
        email=req.email,
        password=req.password,
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


@router.post("/google", response_model=AuthResponse)
def google_auth(request: GoogleAuthRequest, db: Session = Depends(get_db)):
    """Authenticate with Google OAuth token."""
    user, token = auth_service.google_oauth(
        db=db,
        google_token=request.google_token,
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


@router.get("/me", response_model=UserResponse)
def get_me(current_user=Depends(get_current_user_dependency)):
    """Get the current authenticated user's profile."""
    return UserResponse(
        id=current_user.id,
        email=current_user.email,
        username=current_user.username,
        display_name=current_user.display_name,
        avatar=current_user.avatar,
        bio=current_user.bio,
        role=current_user.role,
        is_live=current_user.is_live,
        created_at=current_user.created_at,
    )


@router.get("/users/{user_id}")
def get_user_by_id(user_id: str, db: Session = Depends(get_db)):
    """Get any user's public profile by ID."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )
    return {
        "id": user.id,
        "email": user.email,
        "username": user.username,
        "display_name": user.display_name,
        "avatar": user.avatar,
        "bio": user.bio,
        "role": user.role,
        "is_live": user.is_live,
        "created_at": user.created_at.isoformat() if user.created_at else None,
    }


@router.put("/me", response_model=UserResponse)
def update_profile(
    req: UpdateProfileRequest,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Update the current authenticated user's profile (display_name, bio, avatar)."""
    if req.display_name is not None:
        current_user.display_name = req.display_name
    if req.bio is not None:
        current_user.bio = req.bio
    if req.avatar is not None:
        current_user.avatar = req.avatar

    db.commit()
    db.refresh(current_user)

    return UserResponse(
        id=current_user.id,
        email=current_user.email,
        username=current_user.username,
        display_name=current_user.display_name,
        avatar=current_user.avatar,
        bio=current_user.bio,
        role=current_user.role,
        is_live=current_user.is_live,
        created_at=current_user.created_at,
    )
