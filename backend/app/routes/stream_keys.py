"""
ROGAN LIVE - Stream Key Routes
POST /stream-keys/ — Generate a new stream key
GET /stream-keys/me — Get current user's stream keys
POST /stream-keys/{key_id}/rotate — Rotate a stream key
DELETE /stream-keys/{key_id} — Revoke a stream key
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import User
from app.routes.auth import get_current_user_dependency
from app.schemas import StreamKeyCreate, StreamKeyResponse
from app.services import stream_key_service

router = APIRouter(prefix="/stream-keys", tags=["Stream Keys"])


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_stream_key(
    req: StreamKeyCreate,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Generate a new stream key for the authenticated creator.

    Requires creator or admin role. Optionally provide a label
    (e.g. "OBS", "Phone") to identify the key.
    """
    sk = stream_key_service.create_stream_key(
        db=db,
        user_id=current_user.id,
        label=req.label,
    )
    return _key_response(sk)


@router.get("/me")
def get_my_stream_keys(
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """List all stream keys for the current user, both active and revoked."""
    keys = stream_key_service.get_user_stream_keys(db=db, user_id=current_user.id)
    return {"keys": [_key_response(k) for k in keys]}


@router.post("/{key_id}/rotate")
def rotate_stream_key(
    key_id: str,
    req: StreamKeyCreate = None,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Rotate (regenerate) a stream key. The old key is revoked and a new one is created.

    Only the owner of the key can rotate it.
    """
    label = req.label if req else None
    new_key = stream_key_service.rotate_stream_key(
        db=db,
        key_id=key_id,
        user_id=current_user.id,
        label=label,
    )
    return _key_response(new_key)


@router.delete("/{key_id}")
def revoke_stream_key(
    key_id: str,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Revoke a stream key. It will no longer be accepted for RTMP ingest.

    Only the owner of the key can revoke it.
    """
    revoked = stream_key_service.revoke_stream_key(
        db=db,
        key_id=key_id,
        user_id=current_user.id,
    )
    return {
        "id": revoked.id,
        "is_active": revoked.is_active,
        "message": "Stream key revoked",
    }


def _key_response(sk) -> dict:
    """Format a StreamKey model into a response dict."""
    return {
        "id": sk.id,
        "user_id": sk.user_id,
        "key": sk.key,
        "label": sk.label,
        "is_active": sk.is_active,
        "created_at": sk.created_at.isoformat() if sk.created_at else None,
        "last_used_at": sk.last_used_at.isoformat() if sk.last_used_at else None,
    }
