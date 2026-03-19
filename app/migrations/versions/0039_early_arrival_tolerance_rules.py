"""add early arrival tolerance rules

Revision ID: 0039_early_arrival_tolerance_rules
Revises: 0038_location_events_refactor
Create Date: 2026-03-20 02:30:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0039_early_arrival_tolerance_rules"
down_revision = "0038_location_events_refactor"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "work_rules",
        sa.Column(
            "early_arrival_tolerance_minutes",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )
    op.add_column(
        "department_schedule_plans",
        sa.Column(
            "early_arrival_tolerance_minutes",
            sa.Integer(),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("department_schedule_plans", "early_arrival_tolerance_minutes")
    op.drop_column("work_rules", "early_arrival_tolerance_minutes")
