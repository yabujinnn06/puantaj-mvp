"""Add department weekly rules and shift definitions

Revision ID: 0009_weekly_shifts
Revises: 0008_manual_events
Create Date: 2026-02-08 16:40:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0009_weekly_shifts"
down_revision: Union[str, None] = "0008_manual_events"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "department_weekly_rules",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("department_id", sa.Integer(), nullable=False),
        sa.Column("weekday", sa.Integer(), nullable=False),
        sa.Column("is_workday", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("planned_minutes", sa.Integer(), nullable=False, server_default=sa.text("540")),
        sa.Column("break_minutes", sa.Integer(), nullable=False, server_default=sa.text("60")),
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
        sa.ForeignKeyConstraint(["department_id"], ["departments.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "department_id",
            "weekday",
            name="uq_department_weekly_rules_department_weekday",
        ),
    )
    op.create_index(
        "ix_department_weekly_rules_department_id",
        "department_weekly_rules",
        ["department_id"],
        unique=False,
    )

    op.create_table(
        "department_shifts",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("department_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("start_time_local", sa.Time(timezone=False), nullable=False),
        sa.Column("end_time_local", sa.Time(timezone=False), nullable=False),
        sa.Column("break_minutes", sa.Integer(), nullable=False, server_default=sa.text("60")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
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
        sa.ForeignKeyConstraint(["department_id"], ["departments.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("department_id", "name", name="uq_department_shifts_department_name"),
    )
    op.create_index(
        "ix_department_shifts_department_id",
        "department_shifts",
        ["department_id"],
        unique=False,
    )

    op.add_column("employees", sa.Column("shift_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_employees_shift_id_department_shifts",
        "employees",
        "department_shifts",
        ["shift_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_employees_shift_id_department_shifts", "employees", type_="foreignkey")
    op.drop_column("employees", "shift_id")

    op.drop_index("ix_department_shifts_department_id", table_name="department_shifts")
    op.drop_table("department_shifts")

    op.drop_index("ix_department_weekly_rules_department_id", table_name="department_weekly_rules")
    op.drop_table("department_weekly_rules")
