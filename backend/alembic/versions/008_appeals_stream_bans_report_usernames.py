"""Add Appeal, StreamBan tables + reporter/target usernames on moderation_reports

Revision ID: 008
Revises: 007_user_banner_url
Create Date: 2026-06-25
"""
from alembic import op
import sqlalchemy as sa

revision = '008'
down_revision = '007_user_banner_url'
branch_labels = None
depends_on = None


def upgrade():
    # appeals
    op.create_table(
        'appeals',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('ban_id', sa.String(), sa.ForeignKey('user_bans.id', ondelete='SET NULL'), nullable=True),
        sa.Column('reason', sa.Text(), nullable=False),
        sa.Column('status', sa.String(), default='pending', nullable=False),
        sa.Column('reviewer_id', sa.String(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('reviewer_note', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('reviewed_at', sa.DateTime(), nullable=True),
    )

    # stream_bans
    op.create_table(
        'stream_bans',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('creator_id', sa.String(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('banned_user_id', sa.String(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('reason', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
    )

    # Add denormalised username columns to moderation_reports
    op.add_column('moderation_reports', sa.Column('reporter_username', sa.String(), nullable=True))
    op.add_column('moderation_reports', sa.Column('target_username', sa.String(), nullable=True))


def downgrade():
    op.drop_column('moderation_reports', 'target_username')
    op.drop_column('moderation_reports', 'reporter_username')
    op.drop_table('stream_bans')
    op.drop_table('appeals')
