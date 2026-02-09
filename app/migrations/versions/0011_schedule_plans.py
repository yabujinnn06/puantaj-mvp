"""Add department schedule plans and manual override shift selection

Revision ID: 0011_schedule_plans
Revises: 0010_rule_override
Create Date: 2026-02-08 23:10:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0011_schedule_plans"
down_revision: Union[str, None] = "0010_rule_override"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


schedule_plan_target_type = postgresql.ENUM(
    "DEPARTMENT",
    "DEPARTMENT_EXCEPT_EMPLOYEE",
    "ONLY_EMPLOYEE",
    name="schedule_plan_target_type",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    postgresql.ENUM(
        "DEPARTMENT",
        "DEPARTMENT_EXCEPT_EMPLOYEE",
        "ONLY_EMPLOYEE",
        name="schedule_plan_target_type",
    ).create(bind, checkfirst=True)

    op.create_table(
        "department_schedule_plans",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("department_id", sa.Integer(), nullable=False),
        sa.Column("target_type", schedule_plan_target_type, nullable=False),
        sa.Column("target_employee_id", sa.Integer(), nullable=True),
        sa.Column("shift_id", sa.Integer(), nullable=True),
        sa.Column("daily_minutes_planned", sa.Integer(), nullable=True),
        sa.Column("break_minutes", sa.Integer(), nullable=True),
        sa.Column("grace_minutes", sa.Integer(), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("is_locked", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("note", sa.String(length=1000), nullable=True),
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
        sa.ForeignKeyConstraint(["target_employee_id"], ["employees.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["shift_id"], ["department_shifts.id"], ondelete="SET NULL"),
    )
    op.create_index(
        "ix_department_schedule_plans_department_id",
        "department_schedule_plans",
        ["department_id"],
        unique=False,
    )
    op.create_index(
        "ix_department_schedule_plans_target_employee_id",
        "department_schedule_plans",
        ["target_employee_id"],
        unique=False,
    )
    op.create_index(
        "ix_department_schedule_plans_shift_id",
        "department_schedule_plans",
        ["shift_id"],
        unique=False,
    )
    op.create_index(
        "ix_department_schedule_plans_start_date",
        "department_schedule_plans",
        ["start_date"],
        unique=False,
    )
    op.create_index(
        "ix_department_schedule_plans_end_date",
        "department_schedule_plans",
        ["end_date"],
        unique=False,
    )

    op.add_column(
        "manual_day_overrides",
        sa.Column("rule_shift_id_override", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_manual_day_overrides_rule_shift_id_department_shifts",
        "manual_day_overrides",
        "department_shifts",
        ["rule_shift_id_override"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_manual_day_overrides_rule_shift_id_department_shifts",
        "manual_day_overrides",
        type_="foreignkey",
    )
    op.drop_column("manual_day_overrides", "rule_shift_id_override")

    op.drop_index("ix_department_schedule_plans_end_date", table_name="department_schedule_plans")
    op.drop_index("ix_department_schedule_plans_start_date", table_name="department_schedule_plans")
    op.drop_index("ix_department_schedule_plans_shift_id", table_name="department_schedule_plans")
    op.drop_index("ix_department_schedule_plans_target_employee_id", table_name="department_schedule_plans")
    op.drop_index("ix_department_schedule_plans_department_id", table_name="department_schedule_plans")
    op.drop_table("department_schedule_plans")

    bind = op.get_bind()
    postgresql.ENUM(
        "DEPARTMENT",
        "DEPARTMENT_EXCEPT_EMPLOYEE",
        "ONLY_EMPLOYEE",
        name="schedule_plan_target_type",
    ).drop(bind, checkfirst=True)
