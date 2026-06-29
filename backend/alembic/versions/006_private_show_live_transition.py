"""Add live-to-private-show transition columns

Revision ID: 006
Revises: 005
Create Date: 2026-06-23

Adds:
  streams.active_private_show_id     — ID of the currently active PrivateShow (if any)
  private_shows.live_stream_id       — which live Stream this show was started from
  private_shows.countdown_seconds    — how long the pre-show countdown ran
  private_shows.announced_at         — when the countdown started
"""

from alembic import op
import sqlalchemy as sa

revision = '006'
down_revision = '005'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('streams',
        sa.Column('active_private_show_id', sa.String(), nullable=True)
    )
    op.add_column('private_shows',
        sa.Column('live_stream_id', sa.String(), nullable=True)
    )
    op.add_column('private_shows',
        sa.Column('countdown_seconds', sa.Integer(), nullable=True)
    )
    op.add_column('private_shows',
        sa.Column('announced_at', sa.DateTime(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column('private_shows', 'announced_at')
    op.drop_column('private_shows', 'countdown_seconds')
    op.drop_column('private_shows', 'live_stream_id')
    op.drop_column('streams', 'active_private_show_id')
