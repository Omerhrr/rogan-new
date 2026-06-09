"""
ROGAN LIVE - Stream Key Service
Generate, validate, rotate, and revoke cryptographically secure stream keys.
Keys follow the format: rl_{32_random_hex_chars}
"""

import secrets
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.models import StreamKey, User


def _generate_stream_key() -> str:
    """Generate a cryptographically secure stream key in format rl_{random32}."""
    random_part = secrets.token_hex(16)  # 32 hex chars
    return f"rl_{random_part}"


def create_stream_key(
    db: Session,
    user_id: str,
    label: Optional[str] = None,
) -> StreamKey:
    """Generate a new stream key for a creator.

    Args:
        db: Database session.
        user_id: Owner of the stream key.
        label: Optional human-readable label (e.g. "OBS", "Phone").

    Returns:
        The newly created StreamKey object.

    Raises:
        HTTPException 404: User not found.
        HTTPException 403: User is not a creator or admin.
    """
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    if user.role not in ("creator", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only creators can generate stream keys",
        )

    key_str = _generate_stream_key()

    stream_key = StreamKey(
        user_id=user_id,
        key=key_str,
        label=label,
        is_active=True,
    )
    db.add(stream_key)
    db.commit()
    db.refresh(stream_key)
    return stream_key


def get_user_stream_keys(db: Session, user_id: str) -> List[StreamKey]:
    """Get all stream keys belonging to a user.

    Args:
        db: Database session.
        user_id: Owner of the keys.

    Returns:
        List of StreamKey objects (both active and revoked).
    """
    return (
        db.query(StreamKey)
        .filter(StreamKey.user_id == user_id)
        .order_by(StreamKey.created_at.desc())
        .all()
    )


def rotate_stream_key(
    db: Session,
    key_id: str,
    user_id: str,
    label: Optional[str] = None,
) -> StreamKey:
    """Rotate (regenerate) a stream key. The old key is revoked and a new one is created.

    Args:
        db: Database session.
        key_id: ID of the existing key to rotate.
        user_id: Owner of the key (for authorization).
        label: Optional new label.

    Returns:
        The newly created StreamKey object.

    Raises:
        HTTPException 404: Key not found.
        HTTPException 403: User does not own this key.
    """
    existing = db.query(StreamKey).filter(StreamKey.id == key_id).first()
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Stream key not found",
        )

    if existing.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not own this stream key",
        )

    # Revoke old key
    existing.is_active = False
    db.commit()

    # Generate new key
    new_key_str = _generate_stream_key()
    new_key = StreamKey(
        user_id=user_id,
        key=new_key_str,
        label=label or existing.label,
        is_active=True,
    )
    db.add(new_key)
    db.commit()
    db.refresh(new_key)
    return new_key


def revoke_stream_key(db: Session, key_id: str, user_id: str) -> StreamKey:
    """Revoke (soft-delete) a stream key.

    Args:
        db: Database session.
        key_id: ID of the key to revoke.
        user_id: Owner of the key (for authorization).

    Returns:
        The revoked StreamKey object.

    Raises:
        HTTPException 404: Key not found.
        HTTPException 403: User does not own this key.
        HTTPException 400: Key is already revoked.
    """
    stream_key = db.query(StreamKey).filter(StreamKey.id == key_id).first()
    if not stream_key:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Stream key not found",
        )

    if stream_key.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not own this stream key",
        )

    if not stream_key.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Stream key is already revoked",
        )

    stream_key.is_active = False
    db.commit()
    db.refresh(stream_key)
    return stream_key


def validate_stream_key(db: Session, key_str: str) -> Optional[StreamKey]:
    """Validate a stream key for RTMP ingest authentication.

    Args:
        db: Database session.
        key_str: The raw stream key string (e.g. rl_abc123...).

    Returns:
        The StreamKey object if valid and active, None otherwise.
    """
    stream_key = (
        db.query(StreamKey)
        .filter(StreamKey.key == key_str, StreamKey.is_active == True)
        .first()
    )
    if not stream_key:
        return None

    # Update last_used_at
    stream_key.last_used_at = datetime.utcnow()
    db.commit()
    db.refresh(stream_key)
    return stream_key


def validate_stream_key_for_path(db: Session, path: str) -> Optional[Dict[str, Any]]:
    """Validate a stream key extracted from a MediaMTX path.

    MediaMTX paths are formatted as: rl_<stream_key>
    This extracts the key and validates it.

    Args:
        db: Database session.
        path: The stream path from MediaMTX (e.g. "rl_abc123...").

    Returns:
        Dict with validation result containing user_id and key info,
        or None if invalid.
    """
    if not path or not path.startswith("rl_"):
        return None

    stream_key = validate_stream_key(db, path)
    if not stream_key:
        return None

    return {
        "user_id": stream_key.user_id,
        "key_id": stream_key.id,
        "key": stream_key.key,
        "label": stream_key.label,
    }
