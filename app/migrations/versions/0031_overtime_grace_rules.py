"""Add overtime grace minutes to work rules and schedule plans

Revision ID: 0031_overtime_grace_rules
Revises: 0030_early_arrival_rules
Create Date: 2026-03-11 18:20:00.000000
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0031_overtime_grace_rules"
down_revision: Union[str, None] = "0030_early_arrival_rules"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "work_rules",
        sa.Column(
            "overtime_grace_minutes",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )
    op.add_column(
        "department_schedule_plans",
        sa.Column("overtime_grace_minutes", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("department_schedule_plans", "overtime_grace_minutes")
    op.drop_column("work_rules", "overtime_grace_minutes")
