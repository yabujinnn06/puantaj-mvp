"""Add encrypted recovery vault fields on devices

Revision ID: 0022_device_recovery_vault
Revises: 0021_device_recovery_codes
Create Date: 2026-02-21 19:15:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0022_device_recovery_vault"
down_revision: Union[str, None] = "0021_device_recovery_codes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("devices", sa.Column("recovery_admin_vault", sa.Text(), nullable=True))
    op.add_column("devices", sa.Column("recovery_admin_vault_updated_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("devices", "recovery_admin_vault_updated_at")
    op.drop_column("devices", "recovery_admin_vault")
