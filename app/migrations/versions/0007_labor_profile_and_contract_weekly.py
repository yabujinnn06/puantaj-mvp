"""Add labor profile settings and employee contract weekly minutes

Revision ID: 0007_labor_profile
Revises: 0006_manual_day_overrides
Create Date: 2026-02-07 23:10:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0007_labor_profile"
down_revision: Union[str, None] = "0006_manual_day_overrides"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


overtime_rounding_mode = postgresql.ENUM(
    "OFF",
    "REG_HALF_HOUR",
    name="overtime_rounding_mode",
    create_type=False,
)


def upgrade() -> None:
    op.add_column("employees", sa.Column("contract_weekly_minutes", sa.Integer(), nullable=True))

    op.execute(
        sa.text(
            """
            DO $$
            BEGIN
              IF NOT EXISTS (
                SELECT 1 FROM pg_type WHERE typname = 'overtime_rounding_mode'
              ) THEN
                CREATE TYPE overtime_rounding_mode AS ENUM ('OFF', 'REG_HALF_HOUR');
              END IF;
            END
            $$;
            """
        )
    )
    op.create_table(
        "labor_profiles",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column(
            "weekly_normal_minutes_default",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("2700"),
        ),
        sa.Column(
            "daily_max_minutes",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("660"),
        ),
        sa.Column(
            "enforce_min_break_rules",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "night_work_max_minutes_default",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("450"),
        ),
        sa.Column(
            "night_work_exceptions_note_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "overtime_annual_cap_minutes",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("16200"),
        ),
        sa.Column(
            "overtime_premium",
            sa.Float(),
            nullable=False,
            server_default=sa.text("1.5"),
        ),
        sa.Column(
            "extra_work_premium",
            sa.Float(),
            nullable=False,
            server_default=sa.text("1.25"),
        ),
        sa.Column(
            "overtime_rounding_mode",
            overtime_rounding_mode,
            nullable=False,
            server_default=sa.text("'OFF'"),
        ),
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
        sa.UniqueConstraint("name", name="uq_labor_profiles_name"),
    )

    op.execute(
        sa.text(
            """
            INSERT INTO labor_profiles (
              name,
              weekly_normal_minutes_default,
              daily_max_minutes,
              enforce_min_break_rules,
              night_work_max_minutes_default,
              night_work_exceptions_note_enabled,
              overtime_annual_cap_minutes,
              overtime_premium,
              extra_work_premium,
              overtime_rounding_mode
            )
            VALUES (
              'TR_DEFAULT',
              2700,
              660,
              true,
              450,
              true,
              16200,
              1.5,
              1.25,
              'OFF'
            )
            """
        )
    )


def downgrade() -> None:
    op.drop_table("labor_profiles")
    op.execute(sa.text("DROP TYPE IF EXISTS overtime_rounding_mode"))
    op.drop_column("employees", "contract_weekly_minutes")
