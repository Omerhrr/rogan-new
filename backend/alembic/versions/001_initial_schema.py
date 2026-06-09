"""Initial schema — all Rogan Live tables

Revision ID: 001_initial
Revises: None
Create Date: 2025-01-01 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ─── Core: Users ─────────────────────────────────────────────────
    op.create_table(
        "users",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("username", sa.String(), nullable=False),
        sa.Column("password_hash", sa.String(), nullable=True),
        sa.Column("google_id", sa.String(), nullable=True),
        sa.Column("display_name", sa.String(), nullable=True),
        sa.Column("avatar", sa.String(), nullable=True),
        sa.Column("bio", sa.Text(), nullable=True),
        sa.Column("role", sa.String(), nullable=True),
        sa.Column("is_live", sa.Boolean(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_index("ix_users_username", "users", ["username"], unique=True)
    op.create_index("ix_users_google_id", "users", ["google_id"], unique=True)

    # ─── Wallets ─────────────────────────────────────────────────────
    op.create_table(
        "wallets",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("wallet_address", sa.String(), nullable=True),
        sa.Column("eth_address", sa.String(), nullable=True),
        sa.Column("linked_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_wallets_user_id", "wallets", ["user_id"], unique=True)
    op.create_index("ix_wallets_eth_address", "wallets", ["eth_address"], unique=True)

    # ─── Transactions (immutable ledger) ──────────────────────────────
    op.create_table(
        "transactions",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("type", sa.String(), nullable=False),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("from_user_id", sa.String(), nullable=False),
        sa.Column("to_user_id", sa.String(), nullable=False),
        sa.Column("reference_id", sa.String(), nullable=True),
        sa.Column("metadata", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_transactions_type", "transactions", ["type"], unique=False)
    op.create_index("ix_transactions_from_user_id", "transactions", ["from_user_id"], unique=False)
    op.create_index("ix_transactions_to_user_id", "transactions", ["to_user_id"], unique=False)
    op.create_index("ix_transactions_created_at", "transactions", ["created_at"], unique=False)

    # ─── Streams ─────────────────────────────────────────────────────
    op.create_table(
        "streams",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("creator_id", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("thumbnail", sa.String(), nullable=True),
        sa.Column("stream_key", sa.String(), nullable=True),
        sa.Column("is_live", sa.Boolean(), nullable=True),
        sa.Column("is_private", sa.Boolean(), nullable=True),
        sa.Column("viewer_count", sa.Integer(), nullable=True),
        sa.Column("category", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("ended_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["creator_id"], ["users.id"]),
    )
    op.create_index("ix_streams_creator_id", "streams", ["creator_id"], unique=False)
    op.create_index("ix_streams_stream_key", "streams", ["stream_key"], unique=True)
    op.create_index("ix_streams_is_live", "streams", ["is_live"], unique=False)

    # ─── Gifts ───────────────────────────────────────────────────────
    op.create_table(
        "gifts",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("stream_id", sa.String(), nullable=False),
        sa.Column("sender_id", sa.String(), nullable=False),
        sa.Column("receiver_id", sa.String(), nullable=False),
        sa.Column("gift_type", sa.String(), nullable=False),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("message", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["stream_id"], ["streams.id"]),
        sa.ForeignKeyConstraint(["sender_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["receiver_id"], ["users.id"]),
    )
    op.create_index("ix_gifts_stream_id", "gifts", ["stream_id"], unique=False)
    op.create_index("ix_gifts_sender_id", "gifts", ["sender_id"], unique=False)
    op.create_index("ix_gifts_receiver_id", "gifts", ["receiver_id"], unique=False)
    op.create_index("ix_gifts_created_at", "gifts", ["created_at"], unique=False)

    # ─── Direct Messages (legacy) ────────────────────────────────────
    op.create_table(
        "direct_messages",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("sender_id", sa.String(), nullable=False),
        sa.Column("receiver_id", sa.String(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("is_paid", sa.Boolean(), nullable=True),
        sa.Column("price", sa.Float(), nullable=True),
        sa.Column("is_read", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["sender_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["receiver_id"], ["users.id"]),
    )
    op.create_index("ix_direct_messages_sender_id", "direct_messages", ["sender_id"], unique=False)
    op.create_index("ix_direct_messages_receiver_id", "direct_messages", ["receiver_id"], unique=False)
    op.create_index("ix_direct_messages_created_at", "direct_messages", ["created_at"], unique=False)

    # ─── Subscription Tiers ──────────────────────────────────────────
    op.create_table(
        "subscription_tiers",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("creator_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("price_tk", sa.Float(), nullable=False),
        sa.Column("perks", sa.Text(), nullable=True),
        sa.Column("max_subscribers", sa.Integer(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["creator_id"], ["users.id"]),
    )
    op.create_index("ix_subscription_tiers_creator_id", "subscription_tiers", ["creator_id"], unique=False)

    # ─── Subscriptions ───────────────────────────────────────────────
    op.create_table(
        "subscriptions",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("subscriber_id", sa.String(), nullable=False),
        sa.Column("creator_id", sa.String(), nullable=False),
        sa.Column("tier_id", sa.String(), nullable=True),
        sa.Column("tier", sa.String(), nullable=True),
        sa.Column("price", sa.Float(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=True),
        sa.Column("status", sa.String(), nullable=True),
        sa.Column("auto_renew", sa.Boolean(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["subscriber_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["creator_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["tier_id"], ["subscription_tiers.id"]),
    )
    op.create_index("ix_subscriptions_subscriber_id", "subscriptions", ["subscriber_id"], unique=False)
    op.create_index("ix_subscriptions_creator_id", "subscriptions", ["creator_id"], unique=False)
    op.create_index("ix_subscriptions_tier_id", "subscriptions", ["tier_id"], unique=False)

    # ─── Notifications ───────────────────────────────────────────────
    op.create_table(
        "notifications",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("type", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("message", sa.String(), nullable=False),
        sa.Column("is_read", sa.Boolean(), nullable=True),
        sa.Column("metadata_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_notifications_user_id", "notifications", ["user_id"], unique=False)
    op.create_index("ix_notifications_is_read", "notifications", ["is_read"], unique=False)
    op.create_index("ix_notifications_created_at", "notifications", ["created_at"], unique=False)

    # ─── Service Listings ────────────────────────────────────────────
    op.create_table(
        "service_listings",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("creator_id", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("price", sa.Float(), nullable=False),
        sa.Column("category", sa.String(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["creator_id"], ["users.id"]),
    )

    # ─── Task Requests (legacy) ──────────────────────────────────────
    op.create_table(
        "task_requests",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("requester_id", sa.String(), nullable=False),
        sa.Column("completer_id", sa.String(), nullable=True),
        sa.Column("service_id", sa.String(), nullable=True),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("price", sa.Float(), nullable=False),
        sa.Column("status", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["requester_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["completer_id"], ["users.id"]),
    )

    # ─── Reports (legacy) ────────────────────────────────────────────
    op.create_table(
        "reports",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("reporter_id", sa.String(), nullable=False),
        sa.Column("target_id", sa.String(), nullable=False),
        sa.Column("target_type", sa.String(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("status", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["reporter_id"], ["users.id"]),
    )

    # ─── Phase 1B: Stream Keys ──────────────────────────────────────
    op.create_table(
        "stream_keys",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("label", sa.String(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("last_used_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_stream_keys_user_id", "stream_keys", ["user_id"], unique=False)
    op.create_index("ix_stream_keys_key", "stream_keys", ["key"], unique=True)
    op.create_index("ix_stream_keys_is_active", "stream_keys", ["is_active"], unique=False)

    # ─── Phase 2: Private Shows ─────────────────────────────────────
    op.create_table(
        "private_shows",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("creator_id", sa.String(), nullable=False),
        sa.Column("stream_key", sa.String(), nullable=True),
        sa.Column("price_tk", sa.Float(), nullable=False),
        sa.Column("duration_minutes", sa.Integer(), nullable=False),
        sa.Column("max_viewers", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("ended_at", sa.DateTime(), nullable=True),
        sa.Column("total_revenue", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["creator_id"], ["users.id"]),
    )
    op.create_index("ix_private_shows_creator_id", "private_shows", ["creator_id"], unique=False)
    op.create_index("ix_private_shows_status", "private_shows", ["status"], unique=False)

    op.create_table(
        "private_show_viewers",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("show_id", sa.String(), nullable=False),
        sa.Column("viewer_id", sa.String(), nullable=False),
        sa.Column("joined_at", sa.DateTime(), nullable=True),
        sa.Column("paid_amount", sa.Float(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["show_id"], ["private_shows.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["viewer_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_private_show_viewers_show_id", "private_show_viewers", ["show_id"], unique=False)
    op.create_index("ix_private_show_viewers_viewer_id", "private_show_viewers", ["viewer_id"], unique=False)

    # ─── Phase 2: Enhanced DM ───────────────────────────────────────
    op.create_table(
        "dm_conversations",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("participant_a_id", sa.String(), nullable=False),
        sa.Column("participant_b_id", sa.String(), nullable=False),
        sa.Column("dm_price", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["participant_a_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["participant_b_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_dm_conversations_participant_a_id", "dm_conversations", ["participant_a_id"], unique=False)
    op.create_index("ix_dm_conversations_participant_b_id", "dm_conversations", ["participant_b_id"], unique=False)

    op.create_table(
        "dm_messages",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("conversation_id", sa.String(), nullable=False),
        sa.Column("sender_id", sa.String(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("is_paid", sa.Boolean(), nullable=True),
        sa.Column("amount_tk", sa.Float(), nullable=True),
        sa.Column("read_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["conversation_id"], ["dm_conversations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sender_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_dm_messages_conversation_id", "dm_messages", ["conversation_id"], unique=False)
    op.create_index("ix_dm_messages_sender_id", "dm_messages", ["sender_id"], unique=False)
    op.create_index("ix_dm_messages_created_at", "dm_messages", ["created_at"], unique=False)

    # ─── Phase 2: Task Marketplace ──────────────────────────────────
    op.create_table(
        "tasks",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("creator_id", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("category", sa.String(), nullable=True),
        sa.Column("price_tk", sa.Float(), nullable=False),
        sa.Column("deadline", sa.DateTime(), nullable=True),
        sa.Column("status", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["creator_id"], ["users.id"]),
    )
    op.create_index("ix_tasks_creator_id", "tasks", ["creator_id"], unique=False)
    op.create_index("ix_tasks_category", "tasks", ["category"], unique=False)
    op.create_index("ix_tasks_status", "tasks", ["status"], unique=False)

    op.create_table(
        "task_bids",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("task_id", sa.String(), nullable=False),
        sa.Column("bidder_id", sa.String(), nullable=False),
        sa.Column("amount_tk", sa.Float(), nullable=False),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("status", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["bidder_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_task_bids_task_id", "task_bids", ["task_id"], unique=False)
    op.create_index("ix_task_bids_bidder_id", "task_bids", ["bidder_id"], unique=False)
    op.create_index("ix_task_bids_status", "task_bids", ["status"], unique=False)

    # ─── Phase 3: Marketplace ───────────────────────────────────────
    op.create_table(
        "marketplace_products",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("creator_id", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("price_tk", sa.Float(), nullable=False),
        sa.Column("product_type", sa.String(), nullable=True),
        sa.Column("file_url", sa.String(), nullable=True),
        sa.Column("thumbnail_url", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["creator_id"], ["users.id"]),
    )
    op.create_index("ix_marketplace_products_creator_id", "marketplace_products", ["creator_id"], unique=False)
    op.create_index("ix_marketplace_products_status", "marketplace_products", ["status"], unique=False)

    op.create_table(
        "product_purchases",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("product_id", sa.String(), nullable=False),
        sa.Column("buyer_id", sa.String(), nullable=False),
        sa.Column("amount_tk", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["product_id"], ["marketplace_products.id"]),
        sa.ForeignKeyConstraint(["buyer_id"], ["users.id"]),
    )
    op.create_index("ix_product_purchases_product_id", "product_purchases", ["product_id"], unique=False)
    op.create_index("ix_product_purchases_buyer_id", "product_purchases", ["buyer_id"], unique=False)

    # ─── Phase 3: PK Battles ────────────────────────────────────────
    op.create_table(
        "pk_battles",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("creator_a_id", sa.String(), nullable=False),
        sa.Column("creator_b_id", sa.String(), nullable=False),
        sa.Column("duration_minutes", sa.Integer(), nullable=False),
        sa.Column("entry_gift_requirements", sa.Float(), nullable=True),
        sa.Column("status", sa.String(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("ended_at", sa.DateTime(), nullable=True),
        sa.Column("creator_a_score", sa.Float(), nullable=True),
        sa.Column("creator_b_score", sa.Float(), nullable=True),
        sa.Column("winner_id", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["creator_a_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["creator_b_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["winner_id"], ["users.id"]),
    )
    op.create_index("ix_pk_battles_creator_a_id", "pk_battles", ["creator_a_id"], unique=False)
    op.create_index("ix_pk_battles_creator_b_id", "pk_battles", ["creator_b_id"], unique=False)
    op.create_index("ix_pk_battles_status", "pk_battles", ["status"], unique=False)

    op.create_table(
        "pk_battle_gifts",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("battle_id", sa.String(), nullable=False),
        sa.Column("sender_id", sa.String(), nullable=False),
        sa.Column("receiver_id", sa.String(), nullable=False),
        sa.Column("amount_tk", sa.Float(), nullable=False),
        sa.Column("side", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["battle_id"], ["pk_battles.id"]),
        sa.ForeignKeyConstraint(["sender_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["receiver_id"], ["users.id"]),
    )
    op.create_index("ix_pk_battle_gifts_battle_id", "pk_battle_gifts", ["battle_id"], unique=False)
    op.create_index("ix_pk_battle_gifts_sender_id", "pk_battle_gifts", ["sender_id"], unique=False)
    op.create_index("ix_pk_battle_gifts_receiver_id", "pk_battle_gifts", ["receiver_id"], unique=False)

    # ─── Phase 4: OAuth ─────────────────────────────────────────────
    op.create_table(
        "oauth_accounts",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("provider_id", sa.String(), nullable=False),
        sa.Column("access_token", sa.Text(), nullable=True),
        sa.Column("refresh_token", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_oauth_accounts_user_id", "oauth_accounts", ["user_id"], unique=False)
    op.create_index("ix_oauth_accounts_provider", "oauth_accounts", ["provider"], unique=False)

    # ─── Phase 4: Moderation ────────────────────────────────────────
    op.create_table(
        "moderation_reports",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("reporter_id", sa.String(), nullable=False),
        sa.Column("target_type", sa.String(), nullable=False),
        sa.Column("target_id", sa.String(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("evidence_url", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=True),
        sa.Column("priority", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.Column("resolver_id", sa.String(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["reporter_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["resolver_id"], ["users.id"]),
    )
    op.create_index("ix_moderation_reports_reporter_id", "moderation_reports", ["reporter_id"], unique=False)
    op.create_index("ix_moderation_reports_target_type", "moderation_reports", ["target_type"], unique=False)
    op.create_index("ix_moderation_reports_status", "moderation_reports", ["status"], unique=False)

    op.create_table(
        "user_bans",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("ban_type", sa.String(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
    )
    op.create_index("ix_user_bans_user_id", "user_bans", ["user_id"], unique=False)

    op.create_table(
        "user_strikes",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
    )
    op.create_index("ix_user_strikes_user_id", "user_strikes", ["user_id"], unique=False)


def downgrade() -> None:
    # Drop in reverse dependency order (leaf tables first, users last)
    op.drop_table("user_strikes")
    op.drop_table("user_bans")
    op.drop_table("moderation_reports")
    op.drop_table("oauth_accounts")
    op.drop_table("pk_battle_gifts")
    op.drop_table("pk_battles")
    op.drop_table("product_purchases")
    op.drop_table("marketplace_products")
    op.drop_table("task_bids")
    op.drop_table("tasks")
    op.drop_table("dm_messages")
    op.drop_table("dm_conversations")
    op.drop_table("private_show_viewers")
    op.drop_table("private_shows")
    op.drop_table("stream_keys")
    op.drop_table("reports")
    op.drop_table("task_requests")
    op.drop_table("service_listings")
    op.drop_table("notifications")
    op.drop_table("subscriptions")
    op.drop_table("subscription_tiers")
    op.drop_table("direct_messages")
    op.drop_table("gifts")
    op.drop_table("streams")
    op.drop_table("transactions")
    op.drop_table("wallets")
    op.drop_table("users")
