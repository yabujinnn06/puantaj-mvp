"""Add early arrival and off-shift tolerance fields

Revision ID: 0030_early_arrival_rules
Revises: 0029_weekday_shift_assignments
Create Date: 2026-03-03 04:20:00.000000
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0030_early_arrival_rules"
down_revision: Union[str, None] = "0029_weekday_shift_assignments"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "work_rules",
        sa.Column(
            "off_shift_tolerance_minutes",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )
    op.add_column(
        "department_schedule_plans",
        sa.Column("off_shift_tolerance_minutes", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("department_schedule_plans", "off_shift_tolerance_minutes")
    op.drop_column("work_rules", "off_shift_tolerance_minutes")
