"""Harden device invite claims with attempt limits and context binding

Revision ID: 0023_invite_claim_hardening
Revises: 0022_device_recovery_vault
Create Date: 2026-02-21 23:10:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0023_invite_claim_hardening"
down_revision: Union[str, None] = "0022_device_recovery_vault"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("device_invites", sa.Column("attempt_count", sa.Integer(), nullable=False, server_default=sa.text("0")))
    op.add_column("device_invites", sa.Column("max_attempts", sa.Integer(), nullable=False, server_default=sa.text("5")))
    op.add_column("device_invites", sa.Column("bound_ip", sa.String(length=128), nullable=True))
    op.add_column("device_invites", sa.Column("bound_user_agent_hash", sa.String(length=64), nullable=True))
    op.add_column("device_invites", sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True))

    op.add_column("admin_device_invites", sa.Column("attempt_count", sa.Integer(), nullable=False, server_default=sa.text("0")))
    op.add_column("admin_device_invites", sa.Column("max_attempts", sa.Integer(), nullable=False, server_default=sa.text("5")))
    op.add_column("admin_device_invites", sa.Column("bound_ip", sa.String(length=128), nullable=True))
    op.add_column("admin_device_invites", sa.Column("bound_user_agent_hash", sa.String(length=64), nullable=True))
    op.add_column("admin_device_invites", sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("admin_device_invites", "last_attempt_at")
    op.drop_column("admin_device_invites", "bound_user_agent_hash")
    op.drop_column("admin_device_invites", "bound_ip")
    op.drop_column("admin_device_invites", "max_attempts")
    op.drop_column("admin_device_invites", "attempt_count")

    op.drop_column("device_invites", "last_attempt_at")
    op.drop_column("device_invites", "bound_user_agent_hash")
    op.drop_column("device_invites", "bound_ip")
    op.drop_column("device_invites", "max_attempts")
    op.drop_column("device_invites", "attempt_count")
