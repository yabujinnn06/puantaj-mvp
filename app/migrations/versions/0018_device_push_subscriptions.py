"""Add device push subscriptions table

Revision ID: 0018_device_push_subscriptions
Revises: 0017_qr_codes_points
Create Date: 2026-02-12 10:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0018_device_push_subscriptions"
down_revision: Union[str, None] = "0017_qr_codes_points"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "device_push_subscriptions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("device_id", sa.Integer(), nullable=False),
        sa.Column("endpoint", sa.String(length=1024), nullable=False),
        sa.Column("p256dh", sa.String(length=512), nullable=False),
        sa.Column("auth", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("user_agent", sa.String(length=1024), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("endpoint", name="uq_device_push_subscriptions_endpoint"),
    )
    op.create_index(
        "ix_device_push_subscriptions_device_id",
        "device_push_subscriptions",
        ["device_id"],
        unique=False,
    )
    op.create_index(
        "ix_device_push_subscriptions_endpoint",
        "device_push_subscriptions",
        ["endpoint"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_device_push_subscriptions_endpoint", table_name="device_push_subscriptions")
    op.drop_index("ix_device_push_subscriptions_device_id", table_name="device_push_subscriptions")
    op.drop_table("device_push_subscriptions")
