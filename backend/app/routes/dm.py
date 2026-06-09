"""
ROGAN LIVE - DM Routes (Phase 2 Enhanced)
GET /dm/conversations — List user's conversations
GET /dm/conversations/{id} — Get conversation messages
POST /dm/conversations/{id}/messages — Send message (free or paid)
POST /dm/conversations/{id}/read — Mark messages as read
PUT /dm/price — Creator sets DM price
"""

from fastapi import APIRouter, Depends, Query, Request, status
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.database import get_db
from app.models.models import User
from app.routes.auth import get_current_user_dependency
from app.schemas import DMMessageCreate, DMPriceUpdate
from app.services import dm_service

router = APIRouter(prefix="/dm", tags=["Direct Messages"])

limiter = Limiter(key_func=get_remote_address)


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
def send_message(
    request: Request,
    conversation_id: str,
    msg: DMMessageCreate,
    current_user: User = Depends(get_current_user_dependency),
    db=Depends(get_db),
):
    """Send a message in a conversation. Rate limited: 5/sec.

    If the conversation has a DM price > 0 and the recipient is a creator,
    the sender's TK balance is charged automatically via the ledger.
    """
    message = dm_service.send_message(
        db=db,
        conversation_id=conversation_id,
        sender_id=current_user.id,
        content=msg.content,
    )
    return {
        "id": message.id,
        "conversation_id": message.conversation_id,
        "sender_id": message.sender_id,
        "content": message.content,
        "is_paid": message.is_paid,
        "amount_tk": message.amount_tk,
        "read_at": message.read_at.isoformat() if message.read_at else None,
        "created_at": message.created_at.isoformat() if message.created_at else None,
    }


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
