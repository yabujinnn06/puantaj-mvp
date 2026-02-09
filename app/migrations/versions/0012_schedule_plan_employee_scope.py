"""Add multi-employee scope table for schedule plans

Revision ID: 0012_plan_emp_scope
Revises: 0011_schedule_plans
Create Date: 2026-02-08 18:20:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0012_plan_emp_scope"
down_revision: Union[str, None] = "0011_schedule_plans"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "department_schedule_plan_employees",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("schedule_plan_id", sa.Integer(), nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(
            ["schedule_plan_id"],
            ["department_schedule_plans.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["employee_id"],
            ["employees.id"],
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "schedule_plan_id",
            "employee_id",
            name="uq_department_schedule_plan_employees_plan_employee",
        ),
    )
    op.create_index(
        "ix_department_schedule_plan_employees_schedule_plan_id",
        "department_schedule_plan_employees",
        ["schedule_plan_id"],
        unique=False,
    )
    op.create_index(
        "ix_department_schedule_plan_employees_employee_id",
        "department_schedule_plan_employees",
        ["employee_id"],
        unique=False,
    )

    op.execute(
        """
        INSERT INTO department_schedule_plan_employees (schedule_plan_id, employee_id, created_at)
        SELECT id, target_employee_id, CURRENT_TIMESTAMP
        FROM department_schedule_plans
        WHERE target_employee_id IS NOT NULL
          AND target_type IN ('DEPARTMENT_EXCEPT_EMPLOYEE', 'ONLY_EMPLOYEE')
        ON CONFLICT (schedule_plan_id, employee_id) DO NOTHING
        """
    )


def downgrade() -> None:
    op.drop_index(
        "ix_department_schedule_plan_employees_employee_id",
        table_name="department_schedule_plan_employees",
    )
    op.drop_index(
        "ix_department_schedule_plan_employees_schedule_plan_id",
        table_name="department_schedule_plan_employees",
    )
    op.drop_table("department_schedule_plan_employees")
