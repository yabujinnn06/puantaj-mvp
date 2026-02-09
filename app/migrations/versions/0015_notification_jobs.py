"""Add notification job queue table

Revision ID: 0015_notification_jobs
Revises: 0014_regions
Create Date: 2026-02-09 01:10:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0015_notification_jobs"
down_revision: Union[str, None] = "0014_regions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "notification_jobs",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=True),
        sa.Column("admin_user_id", sa.Integer(), nullable=True),
        sa.Column("job_type", sa.String(length=100), nullable=False),
        sa.Column(
            "payload",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("scheduled_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default=sa.text("'PENDING'")),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("idempotency_key", sa.String(length=255), nullable=False),
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
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["admin_user_id"], ["admin_users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("idempotency_key", name="uq_notification_jobs_idempotency_key"),
    )

    op.create_index("ix_notification_jobs_employee_id", "notification_jobs", ["employee_id"], unique=False)
    op.create_index("ix_notification_jobs_admin_user_id", "notification_jobs", ["admin_user_id"], unique=False)
    op.create_index(
        "ix_notification_jobs_scheduled_at_utc",
        "notification_jobs",
        ["scheduled_at_utc"],
        unique=False,
    )
    op.create_index("ix_notification_jobs_status", "notification_jobs", ["status"], unique=False)
    op.create_index(
        "ix_notification_jobs_idempotency_key",
        "notification_jobs",
        ["idempotency_key"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_notification_jobs_idempotency_key", table_name="notification_jobs")
    op.drop_index("ix_notification_jobs_status", table_name="notification_jobs")
    op.drop_index("ix_notification_jobs_scheduled_at_utc", table_name="notification_jobs")
    op.drop_index("ix_notification_jobs_admin_user_id", table_name="notification_jobs")
    op.drop_index("ix_notification_jobs_employee_id", table_name="notification_jobs")
    op.drop_table("notification_jobs")

