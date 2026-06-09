"""
ROGAN LIVE - Stream Routes
POST /streams/, GET /streams/live, GET /streams/{stream_id},
POST /streams/{stream_id}/go-live, POST /streams/{stream_id}/end,
GET /streams/{stream_id}/viewers
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import User
from app.routes.auth import get_current_user_dependency
from app.schemas import CreateStreamRequest
from app.services import auth_service, stream_service

# Optional security — allows unauthenticated access to GET /streams/{id}
_optional_security = HTTPBearer(auto_error=False)

router = APIRouter(prefix="/streams", tags=["Streams"])


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_stream(
    request: CreateStreamRequest,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Create a new stream (auth required)."""
    result = stream_service.create_stream(
        db=db,
        creator_id=current_user.id,
        title=request.title,
        description=request.description,
        is_private=request.is_private,
        category=request.category,
    )
    stream = result["stream"]
    return {
        "id": stream.id,
        "creator_id": stream.creator_id,
        "title": stream.title,
        "description": stream.description,
        "stream_key": result["stream_key"],
        "is_live": stream.is_live,
        "is_private": stream.is_private,
        "viewer_count": stream.viewer_count,
        "category": stream.category,
        "created_at": stream.created_at.isoformat() if stream.created_at else None,
    }


@router.get("/live")
def get_live_streams(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """Get paginated live streams with creator info."""
    return stream_service.get_live_streams(db=db, page=page, limit=limit)


@router.get("/{stream_id}")
def get_stream(
    stream_id: str,
    credentials: HTTPAuthorizationCredentials = Depends(_optional_security),
    db: Session = Depends(get_db),
):
    """Get stream details. stream_key is only visible to the creator."""
    stream_data = stream_service.get_stream(db=db, stream_id=stream_id)

    # Determine if requester is the creator (strip stream_key for non-creators)
    current_user = None
    if credentials:
        try:
            current_user = auth_service.get_current_user(db, credentials.credentials)
        except Exception:
            pass  # Invalid token — treat as anonymous

    if not current_user or current_user.id != stream_data["creator_id"]:
        stream_data.pop("stream_key", None)

    return stream_data


@router.post("/{stream_id}/go-live")
def go_live(
    stream_id: str,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """Go live with a stream (auth required, creator only)."""
    # Verify the user owns this stream
    stream_data = stream_service.get_stream(db=db, stream_id=stream_id)
    if stream_data["creator_id"] != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the stream creator can go live",
        )

    stream = stream_service.go_live(db=db, stream_id=stream_id)
    return {
        "id": stream.id,
        "is_live": stream.is_live,
        "message": "Stream is now live",
    }


@router.post("/{stream_id}/end")
def end_stream(
    stream_id: str,
    current_user: User = Depends(get_current_user_dependency),
    db: Session = Depends(get_db),
):
    """End a live stream (auth required)."""
    # Verify the user owns this stream
    stream_data = stream_service.get_stream(db=db, stream_id=stream_id)
    if stream_data["creator_id"] != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the stream creator can end the stream",
        )

    stream = stream_service.end_stream(db=db, stream_id=stream_id)
    return {
        "id": stream.id,
        "is_live": stream.is_live,
        "ended_at": stream.ended_at.isoformat() if stream.ended_at else None,
        "message": "Stream has ended",
    }


@router.get("/{stream_id}/viewers")
def get_viewer_count(stream_id: str, db: Session = Depends(get_db)):
    """Get current viewer count for a stream."""
    stream_data = stream_service.get_stream(db=db, stream_id=stream_id)
    return {
        "stream_id": stream_id,
        "viewer_count": stream_data["viewer_count"],
    }
