"""Add scheduled notification tasks

Revision ID: 0028_manual_notification_tasks
Revises: 0027_attendance_notification_redesign
Create Date: 2026-03-02 00:20:00.000000
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0028_manual_notification_tasks"
down_revision: Union[str, None] = "0027_attendance_notification_redesign"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "scheduled_notification_tasks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("target", sa.String(length=20), nullable=False),
        sa.Column("employee_scope", sa.String(length=20), nullable=True),
        sa.Column("admin_scope", sa.String(length=20), nullable=True),
        sa.Column(
            "employee_ids",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "admin_user_ids",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("schedule_kind", sa.String(length=20), nullable=False),
        sa.Column("run_date_local", sa.Date(), nullable=True),
        sa.Column("run_time_local", sa.Time(), nullable=False),
        sa.Column(
            "timezone_name",
            sa.String(length=64),
            nullable=False,
            server_default=sa.text("'Europe/Istanbul'"),
        ),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("last_enqueued_local_date", sa.Date(), nullable=True),
        sa.Column("last_enqueued_at_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_username", sa.String(length=100), nullable=True),
        sa.Column("updated_by_username", sa.String(length=100), nullable=True),
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
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_scheduled_notification_tasks_target",
        "scheduled_notification_tasks",
        ["target"],
        unique=False,
    )
    op.create_index(
        "ix_scheduled_notification_tasks_schedule_kind",
        "scheduled_notification_tasks",
        ["schedule_kind"],
        unique=False,
    )
    op.create_index(
        "ix_scheduled_notification_tasks_run_date_local",
        "scheduled_notification_tasks",
        ["run_date_local"],
        unique=False,
    )
    op.create_index(
        "ix_scheduled_notification_tasks_is_active",
        "scheduled_notification_tasks",
        ["is_active"],
        unique=False,
    )
    op.create_index(
        "ix_scheduled_notification_tasks_last_enqueued_local_date",
        "scheduled_notification_tasks",
        ["last_enqueued_local_date"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_scheduled_notification_tasks_last_enqueued_local_date", table_name="scheduled_notification_tasks")
    op.drop_index("ix_scheduled_notification_tasks_is_active", table_name="scheduled_notification_tasks")
    op.drop_index("ix_scheduled_notification_tasks_run_date_local", table_name="scheduled_notification_tasks")
    op.drop_index("ix_scheduled_notification_tasks_schedule_kind", table_name="scheduled_notification_tasks")
    op.drop_index("ix_scheduled_notification_tasks_target", table_name="scheduled_notification_tasks")
    op.drop_table("scheduled_notification_tasks")
