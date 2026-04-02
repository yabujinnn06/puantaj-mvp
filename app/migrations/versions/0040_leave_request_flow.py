"""extend leaves for employee request flow

Revision ID: 0040_leave_request_flow
Revises: 0039_early_arrival_tolerance_rules
Create Date: 2026-04-02 17:15:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0040_leave_request_flow"
down_revision = "0039_early_arrival_tolerance_rules"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "leaves",
        sa.Column(
            "requested_by_employee",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "leaves",
        sa.Column("decision_note", sa.String(length=1000), nullable=True),
    )
    op.add_column(
        "leaves",
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("leaves", "decided_at")
    op.drop_column("leaves", "decision_note")
    op.drop_column("leaves", "requested_by_employee")
