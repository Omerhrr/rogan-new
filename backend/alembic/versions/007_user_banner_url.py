"""Add banner_url to users

Revision ID: 007_user_banner_url
Revises: 006_private_show_live_transition
Create Date: 2026-06-25
"""
from alembic import op
import sqlalchemy as sa

revision = '007_user_banner_url'
down_revision = '006'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('users', sa.Column('banner_url', sa.String(), nullable=True))


def downgrade():
    op.drop_column('users', 'banner_url')
