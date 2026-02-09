"""Add manual day overrides table

Revision ID: 0006_manual_day_overrides
Revises: 0005_admin_auth_audit
Create Date: 2026-02-07 18:20:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0006_manual_day_overrides"
down_revision: Union[str, None] = "0005_admin_auth_audit"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "manual_day_overrides",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("day_date", sa.Date(), nullable=False),
        sa.Column("in_ts", sa.DateTime(timezone=True), nullable=True),
        sa.Column("out_ts", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_absent", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("note", sa.String(length=1000), nullable=True),
        sa.Column("created_by", sa.String(length=255), nullable=False, server_default=sa.text("'admin'")),
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
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("employee_id", "day_date", name="uq_manual_day_overrides_employee_day"),
    )
    op.create_index(
        "ix_manual_day_overrides_employee_id",
        "manual_day_overrides",
        ["employee_id"],
        unique=False,
    )
    op.create_index(
        "ix_manual_day_overrides_day_date",
        "manual_day_overrides",
        ["day_date"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_manual_day_overrides_day_date", table_name="manual_day_overrides")
    op.drop_index("ix_manual_day_overrides_employee_id", table_name="manual_day_overrides")
    op.drop_table("manual_day_overrides")
