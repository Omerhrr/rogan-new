"""
ROGAN LIVE - DM Routes (Phase 2 Enhanced)
GET /dm/conversations — List user's conversations
GET /dm/conversations/{id} — Get conversation messages
POST /dm/conversations/{id}/messages — Send message (free or paid)
POST /dm/conversations/{id}/read — Mark messages as read
PUT /dm/price — Creator sets DM price
"""

import os
import uuid as _uuid

from fastapi import APIRouter, Depends, Query, Request, UploadFile, File, status
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.database import get_db
from app.models.models import User
from app.routes.auth import get_current_user_dependency
from app.schemas import DMMessageCreate, DMPriceUpdate
from app.config import settings
from app.services import dm_service

router = APIRouter(prefix="/dm", tags=["Direct Messages"])

limiter = Limiter(key_func=get_remote_address)

VOICE_DIR = settings.VOICE_DIR  # configurable via VOICE_DIR env var (default: /app/media/voice)
VOICE_MAX_BYTES = 10 * 1024 * 1024  # 10 MB
ALLOWED_AUDIO_TYPES = {"audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav"}


@router.post("/voice-upload")
async def upload_voice_note(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user_dependency),
):
    """Upload a voice note audio file. Returns the public URL."""
    # Browsers append codec params, e.g. "audio/webm;codecs=opus" — strip them
    base_type = (file.content_type or '').split(';')[0].strip().lower()
    if not base_type.startswith('audio/'):
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=f"Unsupported audio type: {file.content_type}")

    os.makedirs(VOICE_DIR, exist_ok=True)
    # Derive extension from content-type when filename isn't reliable
    _ext_map = {'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav'}
    ext = _ext_map.get(base_type) or (file.filename.rsplit('.', 1)[-1] if '.' in (file.filename or '') else 'webm')
    filename = f"{_uuid.uuid4()}.{ext}"
    dest = os.path.join(VOICE_DIR, filename)

    data = await file.read()
    if len(data) > VOICE_MAX_BYTES:
        from fastapi import HTTPException
        raise HTTPException(status_code=413, detail="Voice note too large (max 10 MB)")

    with open(dest, 'wb') as f:
        f.write(data)

    from app.config import settings
    base = getattr(settings, 'PUBLIC_BASE_URL', 'http://localhost:8000')
    return {"audio_url": f"{base}/media/voice/{filename}"}


@router.get("/conversations")
def get_conversations(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user_dependency),
    db=Depends(get_db),
):
    """List user's conversations with last message and unread count.

    Returns paginated list of conversations, sorted by most recent message.
    """
    return dm_service.get_conversations(
        db=db,
        user_id=current_user.id,
        page=page,
        limit=limit,
    )


@router.get("/conversations/{conversation_id}")
def get_conversation_messages(
    conversation_id: str,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    current_user: User = Depends(get_current_user_dependency),
    db=Depends(get_db),
):
    """Get paginated messages in a conversation.

    Only participants can view messages. Messages are returned in
    reverse chronological order (newest first).
    """
    return dm_service.get_conversation_messages(
        db=db,
        conversation_id=conversation_id,
        user_id=current_user.id,
        page=page,
        limit=limit,
    )


@router.post("/conversations/{conversation_id}/messages", status_code=status.HTTP_201_CREATED)
@limiter.limit("5/second")
async def send_message(
    request: Request,
    conversation_id: str,
    msg: DMMessageCreate,
    current_user: User = Depends(get_current_user_dependency),
    db=Depends(get_db),
):
    """Send a message in a conversation. Rate limited: 5/sec.

    If the conversation has a DM price > 0 and the recipient is a creator,
    the sender's TK balance is charged automatically via the ledger.
    After saving, the message is pushed via WebSocket to the other participant.
    """
    from app.websocket.dm_handler import dm_manager

    message = dm_service.send_message(
        db=db,
        conversation_id=conversation_id,
        sender_id=current_user.id,
        content=msg.content or '',
        reply_to_id=msg.reply_to_id,
        message_type=getattr(msg, 'message_type', 'text') or 'text',
        audio_url=getattr(msg, 'audio_url', None),
        audio_duration=getattr(msg, 'audio_duration', None),
    )

    payload = {
        "id": message.id,
        "conversation_id": message.conversation_id,
        "sender_id": message.sender_id,
        "content": message.content,
        "is_paid": message.is_paid,
        "amount_tk": message.amount_tk,
        "read_at": message.read_at.isoformat() if message.read_at else None,
        "created_at": (message.created_at.isoformat() + "Z") if message.created_at else None,
        "reply_to_id": message.reply_to_id,
        "message_type": getattr(message, 'message_type', 'text'),
        "audio_url": getattr(message, 'audio_url', None),
        "audio_duration": getattr(message, 'audio_duration', None),
    }

    # Push to the other participant via DM WebSocket (fire-and-forget)
    await dm_manager.broadcast_to_others(
        conversation_id,
        current_user.id,
        {"type": "new_message", "message": payload},
    )

    # Ping the recipient's global user WS so they get a toast even if
    # they're not currently in the DM view.
    from app.websocket.dm_handler import user_manager
    from app.models.models import DMConversation

    conv = db.query(DMConversation).filter(DMConversation.id == conversation_id).first()
    if conv:
        recipient_id = (
            conv.participant_b_id
            if conv.participant_a_id == current_user.id
            else conv.participant_a_id
        )
        msg_type = getattr(msg, 'message_type', 'text') or 'text'
        if msg_type == 'voice':
            preview = '🎵 Voice note'
        elif msg_type == 'sticker':
            preview = message.content or '🎭'
        elif msg_type == 'photo':
            preview = '📷 Photo'
        else:
            preview = (message.content or '')[:60]

        await user_manager.send_to_user(recipient_id, {
            "type": "new_dm",
            "from_username": current_user.username,
            "preview": preview,
            "conversation_id": conversation_id,
        })

    return payload


@router.post("/conversations/{conversation_id}/read")
def mark_messages_read(
    conversation_id: str,
    current_user: User = Depends(get_current_user_dependency),
    db=Depends(get_db),
):
    """Mark all unread messages in a conversation as read.

    Returns the count of messages marked as read.
    """
    count = dm_service.mark_messages_read(
        db=db,
        conversation_id=conversation_id,
        user_id=current_user.id,
    )
    return {
        "conversation_id": conversation_id,
        "count": count,
        "message": f"{count} messages marked as read",
    }


@router.put("/conversations/{conversation_id}/messages/{message_id}")
async def edit_message(
    conversation_id: str,
    message_id: str,
    req: dict,
    current_user: User = Depends(get_current_user_dependency),
    db=Depends(get_db),
):
    """Edit a message. Only the sender can edit."""
    from fastapi import HTTPException as _HTTPException
    from app.websocket.dm_handler import dm_manager
    content = (req.get("content") or "").strip()
    if not content:
        raise _HTTPException(status_code=400, detail="Content required")
    message = dm_service.edit_message(db, message_id, current_user.id, content)
    edited_at = (message.edited_at.isoformat() + "Z") if message.edited_at else None
    await dm_manager.broadcast_to_others(
        conversation_id, current_user.id,
        {"type": "message_edited", "message_id": message_id, "content": content, "edited_at": edited_at},
    )
    return {"id": message.id, "content": message.content, "edited_at": edited_at}


@router.delete("/conversations/{conversation_id}/messages/{message_id}", status_code=200)
async def delete_single_message(
    conversation_id: str,
    message_id: str,
    current_user: User = Depends(get_current_user_dependency),
    db=Depends(get_db),
):
    """Soft-delete a single message. Only the sender can delete."""
    from app.websocket.dm_handler import dm_manager
    dm_service.delete_message(db, message_id, current_user.id)
    await dm_manager.broadcast_to_others(
        conversation_id, current_user.id,
        {"type": "message_deleted", "message_id": message_id},
    )
    return {"deleted": True}


@router.delete("/conversations/{conversation_id}/messages", status_code=200)
def clear_conversation(
    conversation_id: str,
    current_user: User = Depends(get_current_user_dependency),
    db=Depends(get_db),
):
    """Delete all messages in a conversation. Both participants can do this."""
    count = dm_service.clear_conversation_messages(
        db=db,
        conversation_id=conversation_id,
        user_id=current_user.id,
    )
    return {"conversation_id": conversation_id, "deleted": count}


@router.delete("/conversations/{conversation_id}", status_code=200)
def delete_conversation(
    conversation_id: str,
    current_user: User = Depends(get_current_user_dependency),
    db=Depends(get_db),
):
    """Delete a conversation and all its messages entirely."""
    dm_service.delete_conversation(
        db=db,
        conversation_id=conversation_id,
        user_id=current_user.id,
    )
    return {"conversation_id": conversation_id, "deleted": True}


@router.put("/price")
def set_dm_price(
    req: DMPriceUpdate,
    current_user: User = Depends(get_current_user_dependency),
    db=Depends(get_db),
):
    """Set DM price for a creator. 0 = free, >0 = paid per message.

    Only creators/admins can set DM prices. The price applies to
    all existing and future conversations.
    """
    dm_service.set_dm_price(
        db=db,
        user_id=current_user.id,
        dm_price=req.dm_price,
    )
    return {
        "user_id": current_user.id,
        "dm_price": req.dm_price,
        "message": f"DM price set to {req.dm_price} TK",
    }


@router.post("/conversations/new", status_code=201)
def start_conversation(
    req: dict,
    current_user: User = Depends(get_current_user_dependency),
    db=Depends(get_db),
):
    """Start or retrieve a DM conversation with another user by their user_id."""
    from app.schemas import DMMessageCreate
    other_user_id = req.get("user_id")
    if not other_user_id:
        from fastapi import HTTPException, status as http_status
        raise HTTPException(status_code=http_status.HTTP_400_BAD_REQUEST, detail="user_id required")
    conversation = dm_service.get_or_create_conversation(
        db=db, user_a_id=current_user.id, user_b_id=other_user_id
    )
    return {
        "id": conversation.id,
        "participant_a_id": conversation.participant_a_id,
        "participant_b_id": conversation.participant_b_id,
        "dm_price": conversation.dm_price,
        "created_at": conversation.created_at.isoformat() if conversation.created_at else None,
    }
