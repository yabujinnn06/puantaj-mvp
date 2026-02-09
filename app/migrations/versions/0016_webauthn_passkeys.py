"""Add WebAuthn passkey tables

Revision ID: 0016_webauthn_passkeys
Revises: 0015_notification_jobs
Create Date: 2026-02-09 18:30:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0016_webauthn_passkeys"
down_revision: Union[str, None] = "0015_notification_jobs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "device_passkeys",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("device_id", sa.Integer(), nullable=False),
        sa.Column("credential_id", sa.String(length=512), nullable=False),
        sa.Column("public_key", sa.Text(), nullable=False),
        sa.Column("sign_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column(
            "transports",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_device_passkeys_device_id", "device_passkeys", ["device_id"], unique=False)
    op.create_index("ix_device_passkeys_credential_id", "device_passkeys", ["credential_id"], unique=True)

    op.create_table(
        "webauthn_challenges",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("purpose", sa.String(length=64), nullable=False),
        sa.Column("challenge", sa.String(length=255), nullable=False),
        sa.Column("device_id", sa.Integer(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ip", sa.String(length=128), nullable=True),
        sa.Column("user_agent", sa.String(length=1024), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_webauthn_challenges_purpose", "webauthn_challenges", ["purpose"], unique=False)
    op.create_index("ix_webauthn_challenges_challenge", "webauthn_challenges", ["challenge"], unique=True)
    op.create_index("ix_webauthn_challenges_device_id", "webauthn_challenges", ["device_id"], unique=False)
    op.create_index("ix_webauthn_challenges_expires_at", "webauthn_challenges", ["expires_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_webauthn_challenges_expires_at", table_name="webauthn_challenges")
    op.drop_index("ix_webauthn_challenges_device_id", table_name="webauthn_challenges")
    op.drop_index("ix_webauthn_challenges_challenge", table_name="webauthn_challenges")
    op.drop_index("ix_webauthn_challenges_purpose", table_name="webauthn_challenges")
    op.drop_table("webauthn_challenges")

    op.drop_index("ix_device_passkeys_credential_id", table_name="device_passkeys")
    op.drop_index("ix_device_passkeys_device_id", table_name="device_passkeys")
    op.drop_table("device_passkeys")
