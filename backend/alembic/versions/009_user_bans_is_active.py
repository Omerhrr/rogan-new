"""Add is_active column to user_bans

Revision ID: 009
Revises: 008
Create Date: 2026-06-25
"""
from alembic import op
import sqlalchemy as sa

revision = '009'
down_revision = '008'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('user_bans', sa.Column('is_active', sa.Boolean(), nullable=True, server_default='true'))
    op.create_index('ix_user_bans_is_active', 'user_bans', ['is_active'])


def downgrade():
    op.drop_index('ix_user_bans_is_active', 'user_bans')
    op.drop_column('user_bans', 'is_active')
