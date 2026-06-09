"""
ROGAN LIVE - SQLAlchemy Models
Full database schema matching the architecture spec.
"""

import uuid
from datetime import datetime
from sqlalchemy import (
    Column, String, Integer, Float, Boolean, DateTime, Text, ForeignKey, Enum
)
from sqlalchemy.orm import relationship
from app.database import Base


def generate_uuid():
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=generate_uuid)
    email = Column(String, unique=True, index=True, nullable=False)
    username = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=True)  # Nullable for Google OAuth
    google_id = Column(String, unique=True, nullable=True)
    display_name = Column(String, nullable=True)
    avatar = Column(String, nullable=True)
    bio = Column(Text, nullable=True)
    role = Column(String, default="user")  # user | creator | admin
    is_live = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    wallet = relationship("Wallet", back_populates="user", uselist=False)
    streams = relationship("Stream", back_populates="creator", foreign_keys="Stream.creator_id")
    sent_gifts = relationship("Gift", back_populates="sender", foreign_keys="Gift.sender_id")
    received_gifts = relationship("Gift", back_populates="receiver", foreign_keys="Gift.receiver_id")
    sent_dms = relationship("DirectMessage", back_populates="sender", foreign_keys="DirectMessage.sender_id")
    received_dms = relationship("DirectMessage", back_populates="receiver", foreign_keys="DirectMessage.receiver_id")
    notifications = relationship("Notification", back_populates="user")
    service_listings = relationship("ServiceListing", back_populates="creator")


class Wallet(Base):
    __tablename__ = "wallets"

    id = Column(String, primary_key=True, default=generate_uuid)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    wallet_address = Column(String, nullable=True)
    eth_address = Column(String, unique=True, nullable=True)  # Web3 ETH address
    linked_at = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="wallet")


class Transaction(Base):
    """Double-entry ledger - immutable, audit-safe, no direct balance mutation."""
    __tablename__ = "transactions"

    id = Column(String, primary_key=True, default=generate_uuid)
    type = Column(String, nullable=False, index=True)  # deposit | withdraw | gift_send | gift_receive | dm_payment | subscription | task_payment | platform_fee
    amount = Column(Float, nullable=False)
    from_user_id = Column(String, nullable=False, index=True)
    to_user_id = Column(String, nullable=False, index=True)
    reference_id = Column(String, nullable=True)
    meta_data = Column("metadata", Text, nullable=True)  # JSON string — column name stays "metadata" in DB
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class Stream(Base):
    __tablename__ = "streams"

    id = Column(String, primary_key=True, default=generate_uuid)
    creator_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    thumbnail = Column(String, nullable=True)
    stream_key = Column(String, unique=True, default=generate_uuid)
    is_live = Column(Boolean, default=False, index=True)
    is_private = Column(Boolean, default=False)
    viewer_count = Column(Integer, default=0)
    category = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    ended_at = Column(DateTime, nullable=True)

    creator = relationship("User", back_populates="streams", foreign_keys=[creator_id])
    gifts = relationship("Gift", back_populates="stream")


class Gift(Base):
    __tablename__ = "gifts"

    id = Column(String, primary_key=True, default=generate_uuid)
    stream_id = Column(String, ForeignKey("streams.id"), nullable=False, index=True)
    sender_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    receiver_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    gift_type = Column(String, nullable=False)  # rose | heart | diamond | rocket | crown
    amount = Column(Float, nullable=False)  # TK amount
    message = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    stream = relationship("Stream", back_populates="gifts")
    sender = relationship("User", back_populates="sent_gifts", foreign_keys=[sender_id])
    receiver = relationship("User", back_populates="received_gifts", foreign_keys=[receiver_id])


class DirectMessage(Base):
    __tablename__ = "direct_messages"

    id = Column(String, primary_key=True, default=generate_uuid)
    sender_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    receiver_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    content = Column(Text, nullable=False)
    is_paid = Column(Boolean, default=False)
    price = Column(Float, nullable=True)
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    sender = relationship("User", back_populates="sent_dms", foreign_keys=[sender_id])
    receiver = relationship("User", back_populates="received_dms", foreign_keys=[receiver_id])


class SubscriptionTier(Base):
    """Creator-defined subscription tiers (max 3: Basic, Premium, VIP)."""
    __tablename__ = "subscription_tiers"

    id = Column(String, primary_key=True, default=generate_uuid)
    creator_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String, nullable=False)  # Basic | Premium | VIP
    price_tk = Column(Float, nullable=False)  # TK per month
    perks = Column(Text, nullable=True)  # JSON string of perk descriptions
    max_subscribers = Column(Integer, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    creator = relationship("User", backref="subscription_tiers")


class Subscription(Base):
    __tablename__ = "subscriptions"

    id = Column(String, primary_key=True, default=generate_uuid)
    subscriber_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    creator_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    tier_id = Column(String, ForeignKey("subscription_tiers.id"), nullable=True, index=True)
    tier = Column(String, default="basic")  # basic | premium | vip (legacy field)
    price = Column(Float, nullable=False)
    is_active = Column(Boolean, default=True)
    status = Column(String, default="active")  # active | cancelled | expired
    auto_renew = Column(Boolean, default=True)
    started_at = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)

    tier_ref = relationship("SubscriptionTier", backref="subscriptions")


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(String, primary_key=True, default=generate_uuid)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    type = Column(String, nullable=False)  # gift_received | dm_received | stream_live | task_completed | withdrawal_status
    title = Column(String, nullable=False)
    message = Column(String, nullable=False)
    is_read = Column(Boolean, default=False, index=True)
    metadata_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    user = relationship("User", back_populates="notifications")


class ServiceListing(Base):
    __tablename__ = "service_listings"

    id = Column(String, primary_key=True, default=generate_uuid)
    creator_id = Column(String, ForeignKey("users.id"), nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    price = Column(Float, nullable=False)  # TK
    category = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    creator = relationship("User", back_populates="service_listings")


class TaskRequest(Base):
    __tablename__ = "task_requests"

    id = Column(String, primary_key=True, default=generate_uuid)
    requester_id = Column(String, ForeignKey("users.id"), nullable=False)
    completer_id = Column(String, ForeignKey("users.id"), nullable=True)
    service_id = Column(String, nullable=True)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    price = Column(Float, nullable=False)
    status = Column(String, default="pending")  # pending | in_progress | completed | cancelled
    created_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)


class Report(Base):
    __tablename__ = "reports"

    id = Column(String, primary_key=True, default=generate_uuid)
    reporter_id = Column(String, ForeignKey("users.id"), nullable=False)
    target_id = Column(String, nullable=False)
    target_type = Column(String, nullable=False)  # user | stream | message
    reason = Column(Text, nullable=False)
    status = Column(String, default="pending")  # pending | reviewed | resolved | dismissed
    created_at = Column(DateTime, default=datetime.utcnow)


# ─── Phase 1B: Real Streaming Models ────────────────────────────────

class StreamKey(Base):
    """Cryptographic stream key for RTMP ingest authentication."""
    __tablename__ = "stream_keys"

    id = Column(String, primary_key=True, default=generate_uuid)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    key = Column(String, unique=True, nullable=False, index=True)
    label = Column(String, nullable=True)  # e.g. "OBS", "Phone"
    is_active = Column(Boolean, default=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_used_at = Column(DateTime, nullable=True)

    user = relationship("User", backref="stream_keys")


# ─── Phase 2: Private Show Models ──────────────────────────────────

class PrivateShow(Base):
    """Private show with entry fee, capacity, and timer-based lifecycle."""
    __tablename__ = "private_shows"

    id = Column(String, primary_key=True, default=generate_uuid)
    creator_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    stream_key = Column(String, nullable=True)  # MediaMTX stream key for the private show
    price_tk = Column(Float, nullable=False)  # Entry fee per viewer
    duration_minutes = Column(Integer, nullable=False)  # Scheduled duration
    max_viewers = Column(Integer, nullable=True)  # Capacity cap (None = unlimited)
    status = Column(String, default="waiting", index=True)  # waiting | live | ended
    started_at = Column(DateTime, nullable=True)
    ended_at = Column(DateTime, nullable=True)
    total_revenue = Column(Float, default=0.0)
    created_at = Column(DateTime, default=datetime.utcnow)

    creator = relationship("User", backref="private_shows", foreign_keys=[creator_id])
    viewers = relationship("PrivateShowViewer", back_populates="show", cascade="all, delete-orphan")


class PrivateShowViewer(Base):
    """Viewer participation record for a private show."""
    __tablename__ = "private_show_viewers"

    id = Column(String, primary_key=True, default=generate_uuid)
    show_id = Column(String, ForeignKey("private_shows.id", ondelete="CASCADE"), nullable=False, index=True)
    viewer_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    joined_at = Column(DateTime, default=datetime.utcnow)
    paid_amount = Column(Float, nullable=False)

    show = relationship("PrivateShow", back_populates="viewers")
    viewer = relationship("User", backref="private_show_entries")


# ─── Phase 2: Enhanced DM Models ───────────────────────────────────

class DMConversation(Base):
    """Conversation thread between two users with configurable DM price."""
    __tablename__ = "dm_conversations"

    id = Column(String, primary_key=True, default=generate_uuid)
    participant_a_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    participant_b_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    dm_price = Column(Float, default=0.0)  # Price to message (0 = free, >0 = paid)
    created_at = Column(DateTime, default=datetime.utcnow)

    participant_a = relationship("User", foreign_keys=[participant_a_id], backref="conversations_as_a")
    participant_b = relationship("User", foreign_keys=[participant_b_id], backref="conversations_as_b")
    messages = relationship("DMMessage", back_populates="conversation", cascade="all, delete-orphan")


class DMMessage(Base):
    """Individual message within a DM conversation, supporting paid messages."""
    __tablename__ = "dm_messages"

    id = Column(String, primary_key=True, default=generate_uuid)
    conversation_id = Column(String, ForeignKey("dm_conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    sender_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    content = Column(Text, nullable=False)
    is_paid = Column(Boolean, default=False)
    amount_tk = Column(Float, nullable=True)
    read_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    conversation = relationship("DMConversation", back_populates="messages")
    sender = relationship("User", backref="dm_messages_sent")


# ─── Phase 2: Task Marketplace Models ──────────────────────────────

class Task(Base):
    """Task posted by a creator with bidding, escrow, and dispute flow."""
    __tablename__ = "tasks"

    id = Column(String, primary_key=True, default=generate_uuid)
    creator_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String, nullable=True, index=True)
    price_tk = Column(Float, nullable=False)
    deadline = Column(DateTime, nullable=True)
    status = Column(String, default="open", index=True)  # open | bidding | in_progress | completed | disputed
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    creator = relationship("User", backref="tasks_created", foreign_keys=[creator_id])
    bids = relationship("TaskBid", back_populates="task", cascade="all, delete-orphan")


class TaskBid(Base):
    """Bid placed on a task by a user."""
    __tablename__ = "task_bids"

    id = Column(String, primary_key=True, default=generate_uuid)
    task_id = Column(String, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    bidder_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    amount_tk = Column(Float, nullable=False)
    message = Column(Text, nullable=True)
    status = Column(String, default="pending", index=True)  # pending | accepted | rejected | withdrawn
    created_at = Column(DateTime, default=datetime.utcnow)

    task = relationship("Task", back_populates="bids")
    bidder = relationship("User", backref="task_bids")


# ─── Phase 3: Marketplace Models ──────────────────────────────────

class MarketplaceProduct(Base):
    """Digital product listing by a creator (digital, pay-per-view, custom)."""
    __tablename__ = "marketplace_products"

    id = Column(String, primary_key=True, default=generate_uuid)
    creator_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    price_tk = Column(Float, nullable=False)
    product_type = Column(String, default="digital")  # digital | payperview | custom
    file_url = Column(String, nullable=True)
    thumbnail_url = Column(String, nullable=True)
    status = Column(String, default="active", index=True)  # active | draft | archived
    created_at = Column(DateTime, default=datetime.utcnow)

    creator_rel = relationship("User", backref="marketplace_products", foreign_keys=[creator_id])
    purchases = relationship("ProductPurchase", back_populates="product", cascade="all, delete-orphan")


class ProductPurchase(Base):
    """Record of a user purchasing a marketplace product."""
    __tablename__ = "product_purchases"

    id = Column(String, primary_key=True, default=generate_uuid)
    product_id = Column(String, ForeignKey("marketplace_products.id"), nullable=False, index=True)
    buyer_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    amount_tk = Column(Float, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    product = relationship("MarketplaceProduct", back_populates="purchases")
    buyer = relationship("User", backref="product_purchases", foreign_keys=[buyer_id])


# ─── Phase 3: PK Battle Models ────────────────────────────────────

class PKBattle(Base):
    """PK battle between two creators with real-time scoring."""
    __tablename__ = "pk_battles"

    id = Column(String, primary_key=True, default=generate_uuid)
    creator_a_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    creator_b_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    duration_minutes = Column(Integer, nullable=False)
    entry_gift_requirements = Column(Float, default=0.0)  # Minimum gift to participate
    status = Column(String, default="pending", index=True)  # pending | active | ended
    started_at = Column(DateTime, nullable=True)
    ended_at = Column(DateTime, nullable=True)
    creator_a_score = Column(Float, default=0.0)
    creator_b_score = Column(Float, default=0.0)
    winner_id = Column(String, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    creator_a = relationship("User", foreign_keys=[creator_a_id], backref="pk_battles_as_a")
    creator_b = relationship("User", foreign_keys=[creator_b_id], backref="pk_battles_as_b")
    winner = relationship("User", foreign_keys=[winner_id], backref="pk_battles_won")
    gifts = relationship("PKBattleGift", back_populates="battle", cascade="all, delete-orphan")


class PKBattleGift(Base):
    """Gift sent to support a side in a PK battle."""
    __tablename__ = "pk_battle_gifts"

    id = Column(String, primary_key=True, default=generate_uuid)
    battle_id = Column(String, ForeignKey("pk_battles.id"), nullable=False, index=True)
    sender_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    receiver_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    amount_tk = Column(Float, nullable=False)
    side = Column(String, nullable=False)  # a | b
    created_at = Column(DateTime, default=datetime.utcnow)

    battle = relationship("PKBattle", back_populates="gifts")
    sender = relationship("User", foreign_keys=[sender_id], backref="pk_battle_gifts_sent")
    receiver = relationship("User", foreign_keys=[receiver_id], backref="pk_battle_gifts_received")


# ─── Phase 4: OAuth / Web3 Models ────────────────────────────────

class OAuthAccount(Base):
    """Linked OAuth provider account for a user."""
    __tablename__ = "oauth_accounts"

    id = Column(String, primary_key=True, default=generate_uuid)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    provider = Column(String, nullable=False, index=True)  # google | discord
    provider_id = Column(String, nullable=False)
    access_token = Column(Text, nullable=True)
    refresh_token = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", backref="oauth_accounts")


# ─── Phase 4: Moderation Models ───────────────────────────────────

class ModerationReport(Base):
    """User report with priority, evidence, and resolution tracking."""
    __tablename__ = "moderation_reports"

    id = Column(String, primary_key=True, default=generate_uuid)
    reporter_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    target_type = Column(String, nullable=False, index=True)  # stream | message | user
    target_id = Column(String, nullable=False)
    reason = Column(Text, nullable=False)
    evidence_url = Column(String, nullable=True)
    status = Column(String, default="pending", index=True)  # pending | reviewing | resolved | dismissed
    priority = Column(Integer, default=0)  # Higher = more urgent
    created_at = Column(DateTime, default=datetime.utcnow)
    resolved_at = Column(DateTime, nullable=True)
    resolver_id = Column(String, ForeignKey("users.id"), nullable=True)

    reporter = relationship("User", foreign_keys=[reporter_id], backref="moderation_reports_filed")
    resolver = relationship("User", foreign_keys=[resolver_id], backref="moderation_reports_resolved")


class UserBan(Base):
    """Ban or mute record for a user."""
    __tablename__ = "user_bans"

    id = Column(String, primary_key=True, default=generate_uuid)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    reason = Column(Text, nullable=False)
    ban_type = Column(String, default="full_ban")  # chat_mute | full_ban
    expires_at = Column(DateTime, nullable=True)  # None = permanent
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", backref="bans")


class UserStrike(Base):
    """Strike record for a user (3 strikes → auto-ban)."""
    __tablename__ = "user_strikes"

    id = Column(String, primary_key=True, default=generate_uuid)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    reason = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", backref="strikes")
