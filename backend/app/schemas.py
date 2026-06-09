"""
ROGAN LIVE - Pydantic Schemas
Request/response models for all API endpoints.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# ─── Auth Schemas ────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    email: str
    username: str = Field(..., min_length=3, max_length=30)
    password: str = Field(..., min_length=6)

class LoginRequest(BaseModel):
    email: str
    password: str

class GoogleAuthRequest(BaseModel):
    google_token: str

class UpdateProfileRequest(BaseModel):
    display_name: Optional[str] = Field(None, max_length=100)
    bio: Optional[str] = Field(None, max_length=500)
    avatar: Optional[str] = None

class UserResponse(BaseModel):
    id: str
    email: str
    username: str
    display_name: Optional[str] = None
    avatar: Optional[str] = None
    bio: Optional[str] = None
    role: str
    is_live: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class AuthResponse(BaseModel):
    user: UserResponse
    token: str


# ─── Stream Schemas ──────────────────────────────────────────────

class CreateStreamRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    is_private: bool = False
    category: Optional[str] = None

class StreamResponse(BaseModel):
    id: str
    creator_id: str
    title: str
    description: Optional[str] = None
    thumbnail: Optional[str] = None
    is_live: bool
    is_private: bool
    viewer_count: int
    category: Optional[str] = None
    created_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    creator: Optional[Dict[str, Any]] = None
    stream_key: Optional[str] = None

class StreamListResponse(BaseModel):
    streams: List[Dict[str, Any]]
    total: int
    page: int
    limit: int
    pages: int


# ─── Gift Schemas ────────────────────────────────────────────────

class SendGiftRequest(BaseModel):
    stream_id: str
    gift_type: str
    message: Optional[str] = None

class GiftResponse(BaseModel):
    id: str
    stream_id: str
    sender_id: str
    receiver_id: str
    gift_type: str
    amount: float
    message: Optional[str] = None
    created_at: Optional[datetime] = None

class SendGiftResponse(BaseModel):
    gift: Dict[str, Any]
    sender_balance: float
    receiver_balance: float
    creator_earnings: float


# ─── Wallet Schemas ──────────────────────────────────────────────

class LinkWalletRequest(BaseModel):
    wallet_address: str = Field(..., min_length=10)

class DepositRequest(BaseModel):
    amount: float = Field(..., gt=0)

class WithdrawRequest(BaseModel):
    tk_amount: float = Field(..., gt=0)

class WalletResponse(BaseModel):
    id: Optional[str] = None
    user_id: str
    wallet_address: Optional[str] = None
    linked_at: Optional[str] = None
    tk_balance: float


# ─── DM Schemas ──────────────────────────────────────────────────

class SendDMRequest(BaseModel):
    receiver_id: str
    content: str = Field(..., min_length=1)
    is_paid: bool = False
    price: Optional[float] = None

class DMResponse(BaseModel):
    id: str
    sender_id: str
    receiver_id: str
    content: str
    is_paid: bool
    price: Optional[float] = None
    is_read: bool
    created_at: Optional[datetime] = None


# ─── Notification Schemas ────────────────────────────────────────

class NotificationResponse(BaseModel):
    id: str
    user_id: str
    type: str
    title: str
    message: str
    is_read: bool
    metadata_json: Optional[str] = None
    created_at: Optional[datetime] = None


# ─── Creator Schemas ─────────────────────────────────────────────

class CreatorProfileResponse(BaseModel):
    id: str
    username: str
    display_name: Optional[str] = None
    avatar: Optional[str] = None
    bio: Optional[str] = None
    role: str
    is_live: bool
    total_gifts_received: int
    total_tk_earned: float
    breakdown_by_type: Dict[str, Any]

class CreatorEarningsResponse(BaseModel):
    creator_id: str
    total_tk_earned: float
    total_gifts_received: int
    breakdown_by_type: Dict[str, Any]

class CreatorDashboardResponse(BaseModel):
    user: Dict[str, Any]
    wallet: Dict[str, Any]
    gift_stats: Dict[str, Any]
    recent_streams: List[Dict[str, Any]]
    tk_balance: float


# ─── Transaction Schemas ─────────────────────────────────────────

class TransactionResponse(BaseModel):
    id: str
    type: str
    amount: float
    from_user_id: str
    to_user_id: str
    reference_id: Optional[str] = None
    metadata: Optional[str] = None
    created_at: Optional[datetime] = None


# ─── Report / Moderation Schemas ─────────────────────────────────

class ReportRequest(BaseModel):
    target_id: str = Field(..., min_length=1)
    target_type: str = Field(..., pattern=r"^(user|stream|message)$")
    reason: str = Field(..., min_length=1, max_length=1000)

class ReportResponse(BaseModel):
    id: str
    reporter_id: str
    target_id: str
    target_type: str
    reason: str
    status: str
    created_at: Optional[datetime] = None


# ─── Task Marketplace Schemas ────────────────────────────────────

class CreateServiceListingRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    price: float = Field(..., gt=0)
    category: Optional[str] = None

class CreateTaskRequest(BaseModel):
    service_id: Optional[str] = None
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    price: float = Field(..., gt=0)

class ServiceListingResponse(BaseModel):
    id: str
    creator_id: str
    title: str
    description: Optional[str] = None
    price: float
    category: Optional[str] = None
    is_active: bool
    created_at: Optional[datetime] = None

class TaskRequestResponse(BaseModel):
    id: str
    requester_id: str
    completer_id: Optional[str] = None
    service_id: Optional[str] = None
    title: str
    description: Optional[str] = None
    price: float
    status: str
    created_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


# ─── Subscription Schemas (Phase 3) ────────────────────────────────

class SubscriptionTierCreate(BaseModel):
    """Creator creates a subscription tier."""
    name: str = Field(..., min_length=1, max_length=50)
    price_tk: float = Field(..., gt=0)
    perks: Optional[List[str]] = None
    max_subscribers: Optional[int] = Field(None, gt=0)

class SubscriptionTierResponse(BaseModel):
    id: str
    creator_id: str
    name: str
    price_tk: float
    perks: Optional[str] = None
    max_subscribers: Optional[int] = None
    is_active: bool
    created_at: Optional[datetime] = None

class SubscribeRequest(BaseModel):
    creator_id: str = Field(..., min_length=1)
    tier: str = Field(default="basic", pattern=r"^(basic|premium|vip)$")
    tier_id: Optional[str] = None
    auto_renew: bool = True

class SubscriptionResponse(BaseModel):
    id: str
    subscriber_id: str
    creator_id: str
    tier_id: Optional[str] = None
    tier: str
    price: float
    is_active: bool
    status: str
    auto_renew: bool
    started_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None


# ─── Stream Key Schemas (Phase 1B) ─────────────────────────────────

class StreamKeyCreate(BaseModel):
    label: Optional[str] = Field(None, max_length=100)

class StreamKeyResponse(BaseModel):
    id: str
    user_id: str
    key: str
    label: Optional[str] = None
    is_active: bool
    created_at: Optional[datetime] = None
    last_used_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class StreamKeyRotate(BaseModel):
    label: Optional[str] = Field(None, max_length=100)


# ─── Private Show Schemas (Phase 2) ───────────────────────────────

class PrivateShowCreate(BaseModel):
    price_tk: float = Field(..., gt=0)
    duration_minutes: int = Field(..., gt=0, le=480)
    max_viewers: Optional[int] = Field(None, gt=0)

class PrivateShowJoin(BaseModel):
    """No body needed — entry fee is defined by the show."""
    pass

class PrivateShowResponse(BaseModel):
    id: str
    creator_id: str
    stream_key: Optional[str] = None
    price_tk: float
    duration_minutes: int
    max_viewers: Optional[int] = None
    status: str
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    total_revenue: float
    viewer_count: int = 0
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class PrivateShowList(BaseModel):
    shows: List[Dict[str, Any]]
    total: int
    page: int
    limit: int
    pages: int


# ─── DM Conversation Schemas (Phase 2) ────────────────────────────

class DMConversationResponse(BaseModel):
    id: str
    participant_a_id: str
    participant_b_id: str
    dm_price: float
    created_at: Optional[datetime] = None
    other_user: Optional[Dict[str, Any]] = None
    last_message: Optional[Dict[str, Any]] = None
    unread_count: int = 0

    class Config:
        from_attributes = True

class DMMessageCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=5000)

class DMMessageResponse(BaseModel):
    id: str
    conversation_id: str
    sender_id: str
    content: str
    is_paid: bool
    amount_tk: Optional[float] = None
    read_at: Optional[datetime] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class DMPriceUpdate(BaseModel):
    dm_price: float = Field(..., ge=0)

class DMReadReceipt(BaseModel):
    """Confirm messages marked as read."""
    count: int


# ─── Task Marketplace Schemas (Phase 2) ───────────────────────────

class TaskCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=5000)
    category: Optional[str] = Field(None, max_length=100)
    price_tk: float = Field(..., gt=0)
    deadline: Optional[datetime] = None

class TaskBidCreate(BaseModel):
    amount_tk: float = Field(..., gt=0)
    message: Optional[str] = Field(None, max_length=2000)

class TaskResponse(BaseModel):
    id: str
    creator_id: str
    title: str
    description: Optional[str] = None
    category: Optional[str] = None
    price_tk: float
    deadline: Optional[datetime] = None
    status: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    bid_count: int = 0

    class Config:
        from_attributes = True

class TaskBidResponse(BaseModel):
    id: str
    task_id: str
    bidder_id: str
    amount_tk: float
    message: Optional[str] = None
    status: str
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class TaskList(BaseModel):
    tasks: List[Dict[str, Any]]
    total: int
    page: int
    limit: int
    pages: int

class TaskDispute(BaseModel):
    reason: str = Field(..., min_length=1, max_length=2000)


# ─── MediaMTX Webhook Schemas (Phase 1B) ──────────────────────────

class MediaMTXAuthRequest(BaseModel):
    """MediaMTX authentication webhook payload."""
    ip: Optional[str] = None
    user: Optional[str] = None
    password: Optional[str] = None
    path: Optional[str] = None
    action: Optional[str] = None  # publish | read
    protocol: Optional[str] = None  # rtmp | rtsp | hls | webrtc
    id: Optional[str] = None
    query: Optional[str] = None

class MediaMTXAuthResponse(BaseModel):
    """Response to MediaMTX auth webhook."""
    ok: bool
    error: Optional[str] = None


# ─── Marketplace Schemas (Phase 3) ────────────────────────────────

class MarketplaceProductCreate(BaseModel):
    """Creator lists a product."""
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    price_tk: float = Field(..., gt=0)
    product_type: str = Field(default="digital", pattern=r"^(digital|payperview|custom)$")
    file_url: Optional[str] = None
    thumbnail_url: Optional[str] = None

class MarketplaceProductUpdate(BaseModel):
    """Creator updates a product."""
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    price_tk: Optional[float] = Field(None, gt=0)
    product_type: Optional[str] = Field(None, pattern=r"^(digital|payperview|custom)$")
    file_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    status: Optional[str] = Field(None, pattern=r"^(active|draft|archived)$")

class MarketplaceProductResponse(BaseModel):
    id: str
    creator_id: str
    title: str
    description: Optional[str] = None
    price_tk: float
    product_type: str
    file_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    status: str
    created_at: Optional[datetime] = None

class ProductPurchaseResponse(BaseModel):
    id: str
    product_id: str
    buyer_id: str
    amount_tk: float
    created_at: Optional[datetime] = None


# ─── PK Battle Schemas (Phase 3) ──────────────────────────────────

class PKBattleCreate(BaseModel):
    """Creator challenges another creator."""
    creator_b_id: str = Field(..., min_length=1)
    duration_minutes: int = Field(..., gt=0, le=60)
    entry_gift_requirements: float = Field(default=0.0, ge=0)

class PKBattleAccept(BaseModel):
    """Opponent accepts the challenge."""
    accept: bool = True

class PKBattleGiftCreate(BaseModel):
    """Viewer sends a gift to support a side."""
    amount_tk: float = Field(..., gt=0)
    side: str = Field(..., pattern=r"^(a|b)$")

class PKBattleResponse(BaseModel):
    id: str
    creator_a_id: str
    creator_b_id: str
    duration_minutes: int
    entry_gift_requirements: float
    status: str
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    creator_a_score: float
    creator_b_score: float
    winner_id: Optional[str] = None
    created_at: Optional[datetime] = None


# ─── Web3 Schemas (Phase 4) ──────────────────────────────────────

class SIWENonceResponse(BaseModel):
    nonce: str
    message: str

class SIWEVerifyRequest(BaseModel):
    message: str
    signature: str

class Web3DepositRequest(BaseModel):
    amount: float = Field(..., gt=0)
    tx_hash: Optional[str] = None

class Web3WithdrawRequest(BaseModel):
    tk_amount: float = Field(..., gt=0)

class WalletWeb3Response(BaseModel):
    id: Optional[str] = None
    user_id: str
    eth_address: Optional[str] = None
    wallet_address: Optional[str] = None
    tk_balance: float


# ─── OAuth Schemas (Phase 4) ──────────────────────────────────────

class OAuthAuthorizeResponse(BaseModel):
    authorize_url: str
    state: str

class OAuthLinkRequest(BaseModel):
    """Link Google account to existing user (requires password confirmation)."""
    google_token: str
    password: str = Field(..., min_length=6)


# ─── Moderation Schemas (Phase 4) ─────────────────────────────────

class ModerationReportCreate(BaseModel):
    """User reports content or another user."""
    target_type: str = Field(..., pattern=r"^(stream|message|user)$")
    target_id: str = Field(..., min_length=1)
    reason: str = Field(..., min_length=1, max_length=2000)
    evidence_url: Optional[str] = None

class ModerationReportResponse(BaseModel):
    id: str
    reporter_id: str
    target_type: str
    target_id: str
    reason: str
    evidence_url: Optional[str] = None
    status: str
    priority: int
    created_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    resolver_id: Optional[str] = None

class ModerationActionRequest(BaseModel):
    """Admin takes action on a report."""
    action: str = Field(..., pattern=r"^(warn|mute|ban|dismiss)$")
    reason: Optional[str] = None
    duration_minutes: Optional[int] = None

class BanRequest(BaseModel):
    reason: str = Field(..., min_length=1)
    ban_type: str = Field(default="full_ban", pattern=r"^(chat_mute|full_ban)$")
    duration_minutes: Optional[int] = None

class MuteRequest(BaseModel):
    reason: str = Field(..., min_length=1)
    duration_minutes: int = Field(..., gt=0)

class AutoModCheckRequest(BaseModel):
    """Auto-moderation check for content."""
    content: str = Field(..., min_length=1)
    user_id: Optional[str] = None

class AutoModCheckResponse(BaseModel):
    is_flagged: bool
    reasons: List[str] = []
    severity: str = "none"


# ─── Recommendation Schemas (Phase 4) ────────────────────────────

class StreamRecommendation(BaseModel):
    stream_id: str
    title: str
    creator_id: str
    creator_name: Optional[str] = None
    viewer_count: int
    category: Optional[str] = None
    thumbnail: Optional[str] = None
    score: float = 0.0
    reason: str = ""

class RecommendationResponse(BaseModel):
    streams: List[StreamRecommendation]
    total: int


# ─── Generic ──────────────────────────────────────────────────────

class MessageResponse(BaseModel):
    message: str

class PaginatedResponse(BaseModel):
    total: int
    page: int
    limit: int
    pages: int
