"""004 - add edited_at and is_deleted to dm_messages

Revision ID: 004
Revises: 003
Create Date: 2026-06-10
"""
from alembic import op
import sqlalchemy as sa

revision = '004'
down_revision = '003'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('dm_messages', sa.Column('edited_at', sa.DateTime(), nullable=True))
    op.add_column('dm_messages', sa.Column('is_deleted', sa.Boolean(), nullable=False, server_default='false'))


def downgrade():
    op.drop_column('dm_messages', 'is_deleted')
    op.drop_column('dm_messages', 'edited_at')
