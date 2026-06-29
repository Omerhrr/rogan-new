"""005 - add voice note fields to dm_messages

Revision ID: 005
Revises: 004
Create Date: 2026-06-10
"""
from alembic import op
import sqlalchemy as sa

revision = '005'
down_revision = '004'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('dm_messages', sa.Column('message_type', sa.String(), nullable=False, server_default='text'))
    op.add_column('dm_messages', sa.Column('audio_url', sa.String(), nullable=True))
    op.add_column('dm_messages', sa.Column('audio_duration', sa.Float(), nullable=True))


def downgrade():
    op.drop_column('dm_messages', 'audio_duration')
    op.drop_column('dm_messages', 'audio_url')
    op.drop_column('dm_messages', 'message_type')
