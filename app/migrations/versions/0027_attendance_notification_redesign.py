"""Add structured attendance notification metadata and delivery logs

Revision ID: 0027_attendance_notification_redesign
Revises: 0026_admin_notification_email
Create Date: 2026-03-01 19:20:00
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0027_attendance_notification_redesign"
down_revision: Union[str, None] = "0026_admin_notification_email"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("notification_jobs", sa.Column("notification_type", sa.String(length=100), nullable=True))
    op.add_column("notification_jobs", sa.Column("audience", sa.String(length=20), nullable=True))
    op.add_column("notification_jobs", sa.Column("risk_level", sa.String(length=20), nullable=True))
    op.add_column("notification_jobs", sa.Column("event_id", sa.String(length=255), nullable=True))
    op.add_column("notification_jobs", sa.Column("event_hash", sa.String(length=255), nullable=True))
    op.add_column("notification_jobs", sa.Column("local_day", sa.Date(), nullable=True))
    op.add_column("notification_jobs", sa.Column("event_ts_utc", sa.DateTime(timezone=True), nullable=True))
    op.add_column("notification_jobs", sa.Column("title", sa.String(length=255), nullable=True))
    op.add_column("notification_jobs", sa.Column("description", sa.Text(), nullable=True))
    op.add_column("notification_jobs", sa.Column("shift_summary", sa.String(length=255), nullable=True))
    op.add_column("notification_jobs", sa.Column("actual_time_summary", sa.String(length=255), nullable=True))
    op.add_column("notification_jobs", sa.Column("suggested_action", sa.Text(), nullable=True))
    op.add_column("notification_jobs", sa.Column("admin_note", sa.Text(), nullable=True))

    op.create_index("ix_notification_jobs_notification_type", "notification_jobs", ["notification_type"], unique=False)
    op.create_index("ix_notification_jobs_audience", "notification_jobs", ["audience"], unique=False)
    op.create_index("ix_notification_jobs_risk_level", "notification_jobs", ["risk_level"], unique=False)
    op.create_index("ix_notification_jobs_event_id", "notification_jobs", ["event_id"], unique=False)
    op.create_index("ix_notification_jobs_event_hash", "notification_jobs", ["event_hash"], unique=True)
    op.create_index("ix_notification_jobs_local_day", "notification_jobs", ["local_day"], unique=False)
    op.create_index("ix_notification_jobs_event_ts_utc", "notification_jobs", ["event_ts_utc"], unique=False)

    op.create_table(
        "notification_delivery_logs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("notification_job_id", sa.Integer(), nullable=True),
        sa.Column("event_id", sa.String(length=255), nullable=False),
        sa.Column("notification_type", sa.String(length=100), nullable=True),
        sa.Column("audience", sa.String(length=20), nullable=True),
        sa.Column("channel", sa.String(length=20), nullable=False),
        sa.Column("recipient_type", sa.String(length=20), nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=True),
        sa.Column("admin_user_id", sa.Integer(), nullable=True),
        sa.Column("recipient_address", sa.String(length=1024), nullable=True),
        sa.Column("endpoint", sa.String(length=1024), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["admin_user_id"], ["admin_users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["notification_job_id"], ["notification_jobs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_notification_delivery_logs_notification_job_id",
        "notification_delivery_logs",
        ["notification_job_id"],
        unique=False,
    )
    op.create_index("ix_notification_delivery_logs_event_id", "notification_delivery_logs", ["event_id"], unique=False)
    op.create_index(
        "ix_notification_delivery_logs_notification_type",
        "notification_delivery_logs",
        ["notification_type"],
        unique=False,
    )
    op.create_index("ix_notification_delivery_logs_audience", "notification_delivery_logs", ["audience"], unique=False)
    op.create_index("ix_notification_delivery_logs_channel", "notification_delivery_logs", ["channel"], unique=False)
    op.create_index(
        "ix_notification_delivery_logs_recipient_type",
        "notification_delivery_logs",
        ["recipient_type"],
        unique=False,
    )
    op.create_index("ix_notification_delivery_logs_employee_id", "notification_delivery_logs", ["employee_id"], unique=False)
    op.create_index(
        "ix_notification_delivery_logs_admin_user_id",
        "notification_delivery_logs",
        ["admin_user_id"],
        unique=False,
    )
    op.create_index("ix_notification_delivery_logs_status", "notification_delivery_logs", ["status"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_notification_delivery_logs_status", table_name="notification_delivery_logs")
    op.drop_index("ix_notification_delivery_logs_admin_user_id", table_name="notification_delivery_logs")
    op.drop_index("ix_notification_delivery_logs_employee_id", table_name="notification_delivery_logs")
    op.drop_index("ix_notification_delivery_logs_recipient_type", table_name="notification_delivery_logs")
    op.drop_index("ix_notification_delivery_logs_channel", table_name="notification_delivery_logs")
    op.drop_index("ix_notification_delivery_logs_audience", table_name="notification_delivery_logs")
    op.drop_index("ix_notification_delivery_logs_notification_type", table_name="notification_delivery_logs")
    op.drop_index("ix_notification_delivery_logs_event_id", table_name="notification_delivery_logs")
    op.drop_index("ix_notification_delivery_logs_notification_job_id", table_name="notification_delivery_logs")
    op.drop_table("notification_delivery_logs")

    op.drop_index("ix_notification_jobs_event_ts_utc", table_name="notification_jobs")
    op.drop_index("ix_notification_jobs_local_day", table_name="notification_jobs")
    op.drop_index("ix_notification_jobs_event_hash", table_name="notification_jobs")
    op.drop_index("ix_notification_jobs_event_id", table_name="notification_jobs")
    op.drop_index("ix_notification_jobs_risk_level", table_name="notification_jobs")
    op.drop_index("ix_notification_jobs_audience", table_name="notification_jobs")
    op.drop_index("ix_notification_jobs_notification_type", table_name="notification_jobs")

    op.drop_column("notification_jobs", "admin_note")
    op.drop_column("notification_jobs", "suggested_action")
    op.drop_column("notification_jobs", "actual_time_summary")
    op.drop_column("notification_jobs", "shift_summary")
    op.drop_column("notification_jobs", "description")
    op.drop_column("notification_jobs", "title")
    op.drop_column("notification_jobs", "event_ts_utc")
    op.drop_column("notification_jobs", "local_day")
    op.drop_column("notification_jobs", "event_hash")
    op.drop_column("notification_jobs", "event_id")
    op.drop_column("notification_jobs", "risk_level")
    op.drop_column("notification_jobs", "audience")
    op.drop_column("notification_jobs", "notification_type")
