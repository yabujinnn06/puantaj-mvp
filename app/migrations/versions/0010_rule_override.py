"""Add manual day rule source override and disable legal break enforcement default

Revision ID: 0010_rule_override
Revises: 0009_weekly_shifts
Create Date: 2026-02-08 22:20:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0010_rule_override"
down_revision: Union[str, None] = "0009_weekly_shifts"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "manual_day_overrides",
        sa.Column("rule_source_override", sa.String(length=20), nullable=True),
    )

    op.alter_column(
        "labor_profiles",
        "enforce_min_break_rules",
        existing_type=sa.Boolean(),
        server_default=sa.text("false"),
    )
    op.execute("UPDATE labor_profiles SET enforce_min_break_rules = false")


def downgrade() -> None:
    op.alter_column(
        "labor_profiles",
        "enforce_min_break_rules",
        existing_type=sa.Boolean(),
        server_default=sa.text("true"),
    )

    op.drop_column("manual_day_overrides", "rule_source_override")
