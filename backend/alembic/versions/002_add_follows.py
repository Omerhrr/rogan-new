"""Add follows table for the follow/unfollow social graph.

Revision ID: 002
Revises: 001_initial
Create Date: 2026-06-09
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '002'
down_revision: Union[str, None] = '001_initial'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Use inspector to make this migration idempotent.
    # The follows table may already exist if Base.metadata.create_all() ran
    # before Alembic took over schema management (e.g. on first dev boot).
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = inspector.get_table_names()

    if "follows" not in existing_tables:
        op.create_table(
            "follows",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("follower_id", sa.String(), nullable=False),
            sa.Column("following_id", sa.String(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["follower_id"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["following_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_follows_follower_id", "follows", ["follower_id"])
        op.create_index("ix_follows_following_id", "follows", ["following_id"])
    else:
        # Table already exists — ensure indexes are present.
        existing_indexes = {idx["name"] for idx in inspector.get_indexes("follows")}
        if "ix_follows_follower_id" not in existing_indexes:
            op.create_index("ix_follows_follower_id", "follows", ["follower_id"])
        if "ix_follows_following_id" not in existing_indexes:
            op.create_index("ix_follows_following_id", "follows", ["following_id"])


def downgrade() -> None:
    op.drop_index("ix_follows_following_id", table_name="follows")
    op.drop_index("ix_follows_follower_id", table_name="follows")
    op.drop_table("follows")
