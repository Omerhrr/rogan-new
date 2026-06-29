"""Add reply_to_id to dm_messages

Revision ID: 003_dm_reply_to
Revises: 002_add_follows
Create Date: 2026-06-10
"""
from alembic import op
import sqlalchemy as sa

revision = '003'
down_revision = '002'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'dm_messages',
        sa.Column('reply_to_id', sa.String(), sa.ForeignKey('dm_messages.id', ondelete='SET NULL'), nullable=True)
    )
    op.create_index('ix_dm_messages_reply_to_id', 'dm_messages', ['reply_to_id'])


def downgrade():
    op.drop_index('ix_dm_messages_reply_to_id', table_name='dm_messages')
    op.drop_column('dm_messages', 'reply_to_id')
