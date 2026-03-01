"""Add department weekday shift assignments

Revision ID: 0029_weekday_shift_assignments
Revises: 0028_manual_notification_tasks
Create Date: 2026-03-02 01:30:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0029_weekday_shift_assignments"
down_revision = "0028_manual_notification_tasks"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "department_weekday_shift_assignments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("department_id", sa.Integer(), nullable=False),
        sa.Column("weekday", sa.Integer(), nullable=False),
        sa.Column("shift_id", sa.Integer(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.ForeignKeyConstraint(["department_id"], ["departments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["shift_id"], ["department_shifts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "department_id",
            "weekday",
            "shift_id",
            name="uq_department_weekday_shift_assignments_dep_weekday_shift",
        ),
    )
    op.create_index(
        op.f("ix_department_weekday_shift_assignments_department_id"),
        "department_weekday_shift_assignments",
        ["department_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_department_weekday_shift_assignments_shift_id"),
        "department_weekday_shift_assignments",
        ["shift_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_department_weekday_shift_assignments_shift_id"),
        table_name="department_weekday_shift_assignments",
    )
    op.drop_index(
        op.f("ix_department_weekday_shift_assignments_department_id"),
        table_name="department_weekday_shift_assignments",
    )
    op.drop_table("department_weekday_shift_assignments")
