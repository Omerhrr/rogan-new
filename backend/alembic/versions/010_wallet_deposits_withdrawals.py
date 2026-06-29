"""Add crypto_deposits, stripe_payments, withdrawal_requests tables

Revision ID: 010
Revises: 009
Create Date: 2026-06-25
"""
from alembic import op
import sqlalchemy as sa

revision = '010'
down_revision = '009'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'crypto_deposits',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('tx_hash', sa.String(), nullable=False, unique=True, index=True),
        sa.Column('wallet_address', sa.String(), nullable=False),   # tx.from — the sender
        sa.Column('amount_rogan', sa.Float(), nullable=False),       # human-readable ROGAN
        sa.Column('amount_usd', sa.Float(), nullable=False),         # USD value at deposit time
        sa.Column('amount_tk', sa.Float(), nullable=False),          # TK credited
        sa.Column('rogan_price_usd', sa.Float(), nullable=False),    # price snapshot
        sa.Column('status', sa.String(), nullable=False, default='confirmed'),
        sa.Column('created_at', sa.DateTime(), nullable=True),
    )

    op.create_table(
        'stripe_payments',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('stripe_payment_intent_id', sa.String(), nullable=False, unique=True, index=True),
        sa.Column('amount_usd', sa.Float(), nullable=False),
        sa.Column('amount_tk', sa.Float(), nullable=False),
        sa.Column('currency', sa.String(), nullable=False, default='usd'),
        sa.Column('status', sa.String(), nullable=False, default='pending'),  # pending | succeeded | failed
        sa.Column('created_at', sa.DateTime(), nullable=True),
    )

    op.create_table(
        'withdrawal_requests',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('wallet_address', sa.String(), nullable=False),
        sa.Column('amount_tk', sa.Float(), nullable=False),
        sa.Column('amount_rogan', sa.Float(), nullable=True),        # filled at processing time
        sa.Column('rogan_price_usd', sa.Float(), nullable=True),     # price at processing time
        sa.Column('status', sa.String(), nullable=False, default='pending'),  # pending|approved|rejected|completed
        sa.Column('rejection_reason', sa.String(), nullable=True),
        sa.Column('tx_hash', sa.String(), nullable=True),            # outgoing tx when completed
        sa.Column('requested_at', sa.DateTime(), nullable=True),
        sa.Column('processed_at', sa.DateTime(), nullable=True),
    )


def downgrade():
    op.drop_table('withdrawal_requests')
    op.drop_table('stripe_payments')
    op.drop_table('crypto_deposits')
