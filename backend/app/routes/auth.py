"""
ROGAN LIVE - Auth Routes
POST /auth/register, /auth/login, /auth/google, GET /auth/me, PUT /auth/me
"""

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import User
from app.schemas import (
    AuthResponse,
    ForgotPasswordRequest,
    GoogleAuthRequest,
    LoginRequest,
    RegisterRequest,
    ResetPasswordRequest,
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

@router.get("/users/search")
@limiter.limit("30/minute")
def search_users(
    request: Request,
    q: str,
    limit: int = 10,
    db: Session = Depends(get_db),
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    """Search users by username or display_name.
    NOTE: This route must be registered before /users/{user_id} so FastAPI
    matches the literal path /users/search before treating 'search' as a user_id.
    """
    from sqlalchemy import or_
    if not q or len(q.strip()) < 1:
        return {"users": []}
    term = f"%{q.strip()}%"
    users = (
        db.query(User)
        .filter(
            User.is_active != False,   # NULL counts as active (legacy rows have NULL)
            or_(User.username.ilike(term), User.display_name.ilike(term)),
        )
        .limit(min(limit, 20))
        .all()
    )
    return {
        "users": [
            {
                "id": u.id,
                "username": u.username,
                "display_name": u.display_name,
                "avatar": u.avatar,
                "banner_url": getattr(u, "banner_url", None),
                "role": u.role,
                "is_live": u.is_live,
            }
            for u in users
        ]
    }



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


@router.post("/forgot-password")
@limiter.limit("3/minute")
def forgot_password(request: Request, body: ForgotPasswordRequest, db: Session = Depends(get_db)):
    """Request a password reset token.

    Always returns the same success message regardless of whether the email exists,
    to prevent user enumeration attacks.

    In DEBUG mode only, the reset token is included in the response for local testing.
    In production: wire an email provider and keep DEBUG=false so the token is never exposed.

    Rate limited: 3/min (tighter than default to slow brute-force enumeration).
    """
    from app.config import settings as _settings

    reset_token: str | None = None
    try:
        reset_token = auth_service.request_password_reset(db=db, email=body.email)
    except Exception:
        pass  # Swallow 404/any error — do not leak whether the email is registered

    response: dict = {
        "message": "If that email is registered, you will receive a password reset link shortly.",
    }

    if _settings.DEBUG and reset_token:
        # DEV ONLY — never expose the token when DEBUG is False (production default)
        response["reset_token"] = reset_token
        response["expires_in"] = 900

    return response


@router.post("/reset-password")
@limiter.limit("5/minute")
def reset_password(request: Request, body: ResetPasswordRequest, db: Session = Depends(get_db)):
    """Reset a password using a token obtained from /forgot-password. Rate limited: 5/min."""
    auth_service.reset_password(db=db, token=body.token, new_password=body.new_password)
    return {"message": "Password updated successfully. You can now log in with your new password."}


@router.post("/google", response_model=AuthResponse)
@limiter.limit("10/minute")
def google_auth(request: Request, body: GoogleAuthRequest, db: Session = Depends(get_db)):
    """Authenticate with Google OAuth token. Rate limited: 10/min."""
    user, token = auth_service.google_oauth(
        db=db,
        google_token=body.google_token,
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
    """Get any user's public profile by ID.
    FIX: email is intentionally omitted — it is private and must not be exposed
    on an unauthenticated public endpoint.
    """
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )
    return {
        "id": user.id,
        # email deliberately omitted — private field
        "username": user.username,
        "display_name": user.display_name,
        "avatar": user.avatar,
            "banner_url": getattr(user, "banner_url", None),
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


@router.post("/me/upgrade-creator")
def upgrade_to_creator(
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Upgrade the current user's role to creator.
    Any authenticated user can self-upgrade. In production you may want
    to gate this behind an application/approval flow.
    """
    if current_user.role in ("creator", "admin"):
        return {
            "message": "Already a creator",
            "role": current_user.role,
        }
    current_user.role = "creator"
    db.commit()
    db.refresh(current_user)
    return {
        "message": "Congratulations! You are now a creator.",
        "role": current_user.role,
        "id": current_user.id,
        "username": current_user.username,
    }


# ─── Follow System ───────────────────────────────────────────────────────────

@router.post("/users/{user_id}/follow", status_code=201)
def follow_user(
    user_id: str,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Follow a user (auth required)."""
    from app.models.models import Follow
    if user_id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot follow yourself")
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    existing = db.query(Follow).filter(
        Follow.follower_id == current_user.id, Follow.following_id == user_id
    ).first()
    if existing:
        return {"message": "Already following", "following": True}
    follow = Follow(follower_id=current_user.id, following_id=user_id)
    db.add(follow)
    db.commit()
    return {"message": "Now following", "following": True}


@router.delete("/users/{user_id}/follow")
def unfollow_user(
    user_id: str,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Unfollow a user (auth required)."""
    from app.models.models import Follow
    follow = db.query(Follow).filter(
        Follow.follower_id == current_user.id, Follow.following_id == user_id
    ).first()
    if not follow:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not following this user")
    db.delete(follow)
    db.commit()
    return {"message": "Unfollowed", "following": False}


@router.get("/users/{user_id}/follow-status")
def get_follow_status(
    user_id: str,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Check if current user follows the given user + get follower/following counts."""
    from app.models.models import Follow
    from sqlalchemy import func
    is_following = db.query(Follow).filter(
        Follow.follower_id == current_user.id, Follow.following_id == user_id
    ).first() is not None
    followers = db.query(func.count(Follow.id)).filter(Follow.following_id == user_id).scalar() or 0
    following = db.query(func.count(Follow.id)).filter(Follow.follower_id == user_id).scalar() or 0
    return {"is_following": is_following, "followers": followers, "following": following}


@router.get("/users/{user_id}/followers")
def get_user_followers(user_id: str, db: Session = Depends(get_db)):
    """List users who follow user_id."""
    from app.models.models import Follow
    rows = db.query(Follow).filter(Follow.following_id == user_id).order_by(Follow.created_at.desc()).limit(200).all()
    users = db.query(User).filter(User.id.in_([r.follower_id for r in rows])).all()
    user_map = {u.id: u for u in users}
    return {
        "users": [
            {
                "id": user_map[r.follower_id].id,
                "username": user_map[r.follower_id].username,
                "display_name": user_map[r.follower_id].display_name,
                "avatar": user_map[r.follower_id].avatar,
                "is_live": user_map[r.follower_id].is_live,
                "role": user_map[r.follower_id].role,
            }
            for r in rows if r.follower_id in user_map
        ]
    }


@router.get("/users/{user_id}/following")
def get_user_following(user_id: str, db: Session = Depends(get_db)):
    """List users that user_id follows."""
    from app.models.models import Follow
    rows = db.query(Follow).filter(Follow.follower_id == user_id).order_by(Follow.created_at.desc()).limit(200).all()
    users = db.query(User).filter(User.id.in_([r.following_id for r in rows])).all()
    user_map = {u.id: u for u in users}
    return {
        "users": [
            {
                "id": user_map[r.following_id].id,
                "username": user_map[r.following_id].username,
                "display_name": user_map[r.following_id].display_name,
                "avatar": user_map[r.following_id].avatar,
                "is_live": user_map[r.following_id].is_live,
                "role": user_map[r.following_id].role,
            }
            for r in rows if r.following_id in user_map
        ]
    }


@router.get("/users/{user_id}/stats")
def get_user_stats(user_id: str, db: Session = Depends(get_db)):
    """Public follower/following counts for a user."""
    from app.models.models import Follow
    from sqlalchemy import func
    followers = db.query(func.count(Follow.id)).filter(Follow.following_id == user_id).scalar() or 0
    following = db.query(func.count(Follow.id)).filter(Follow.follower_id == user_id).scalar() or 0
    return {"user_id": user_id, "followers": followers, "following": following}


# ─── Avatar / Banner Upload ───────────────────────────────────────────────────

_IMAGE_MAX_BYTES = 8 * 1024 * 1024  # 8 MB
_ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}


def _save_image(file, directory: str, base_url: str, prefix: str = "img") -> str:
    """Save an uploaded image file to disk and return its public URL."""
    import shutil, uuid, os
    os.makedirs(directory, exist_ok=True)
    ext = file.filename.rsplit(".", 1)[-1].lower() if file.filename and "." in file.filename else "jpg"
    filename = f"{prefix}_{uuid.uuid4().hex}.{ext}"
    dest = os.path.join(directory, filename)
    with open(dest, "wb") as out:
        shutil.copyfileobj(file.file, out)
    return f"{base_url.rstrip('/')}/{filename}"


@router.post("/users/me/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    from fastapi import UploadFile, File
    if file.content_type not in _ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Invalid image type")
    contents = await file.read()
    if len(contents) > _IMAGE_MAX_BYTES:
        raise HTTPException(status_code=400, detail="Image too large (max 8 MB)")
    await file.seek(0)
    url = _save_image(file, settings.IMAGES_DIR, settings.PUBLIC_BASE_URL + "/media/images", "avatar")
    current_user.avatar = url
    db.commit()
    return {"avatar": url}


@router.post("/users/me/banner")
async def upload_banner(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    from fastapi import UploadFile, File
    if file.content_type not in _ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Invalid image type")
    contents = await file.read()
    if len(contents) > _IMAGE_MAX_BYTES:
        raise HTTPException(status_code=400, detail="Image too large (max 8 MB)")
    await file.seek(0)
    url = _save_image(file, settings.IMAGES_DIR, settings.PUBLIC_BASE_URL + "/media/images", "banner")
    if hasattr(file, 'filename') and not url:
        raise HTTPException(status_code=500, detail="Failed to save banner")
    current_user.banner = url
    db.commit()
    return {"banner": url}
