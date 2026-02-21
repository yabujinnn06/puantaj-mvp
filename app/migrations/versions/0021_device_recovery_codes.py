"""Add device recovery pin and recovery code table

Revision ID: 0021_device_recovery_codes
Revises: 0020_archive_emp_index
Create Date: 2026-02-21 17:50:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0021_device_recovery_codes"
down_revision: Union[str, None] = "0020_archive_emp_index"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("devices", sa.Column("recovery_pin_hash", sa.String(length=255), nullable=True))
    op.add_column("devices", sa.Column("recovery_pin_updated_at", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        "device_recovery_codes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("device_id", sa.Integer(), nullable=False),
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
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_device_recovery_codes_device_id", "device_recovery_codes", ["device_id"], unique=False)
    op.create_index("ix_device_recovery_codes_expires_at", "device_recovery_codes", ["expires_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_device_recovery_codes_expires_at", table_name="device_recovery_codes")
    op.drop_index("ix_device_recovery_codes_device_id", table_name="device_recovery_codes")
    op.drop_table("device_recovery_codes")
    op.drop_column("devices", "recovery_pin_updated_at")
    op.drop_column("devices", "recovery_pin_hash")
