"""Add per-admin MFA secret and recovery codes

Revision ID: 0024_admin_user_mfa_per_user
Revises: 0023_invite_claim_hardening
Create Date: 2026-02-22 01:40:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0024_admin_user_mfa_per_user"
down_revision: Union[str, None] = "0023_invite_claim_hardening"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("admin_users", sa.Column("mfa_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("admin_users", sa.Column("mfa_secret_enc", sa.Text(), nullable=True))
    op.add_column("admin_users", sa.Column("mfa_secret_updated_at", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        "admin_mfa_recovery_codes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("admin_user_id", sa.Integer(), nullable=False),
        sa.Column("code_hash", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(["admin_user_id"], ["admin_users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_admin_mfa_recovery_codes_admin_user_id",
        "admin_mfa_recovery_codes",
        ["admin_user_id"],
        unique=False,
    )
    op.create_index(
        "ix_admin_mfa_recovery_codes_expires_at",
        "admin_mfa_recovery_codes",
        ["expires_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_admin_mfa_recovery_codes_expires_at", table_name="admin_mfa_recovery_codes")
    op.drop_index("ix_admin_mfa_recovery_codes_admin_user_id", table_name="admin_mfa_recovery_codes")
    op.drop_table("admin_mfa_recovery_codes")

    op.drop_column("admin_users", "mfa_secret_updated_at")
    op.drop_column("admin_users", "mfa_secret_enc")
    op.drop_column("admin_users", "mfa_enabled")
