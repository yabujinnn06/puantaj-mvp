"""Add attendance extra check-in approval workflow table

Revision ID: 0025_extra_checkin_approval
Revises: 0024_admin_user_mfa_per_user
Create Date: 2026-02-22 13:20:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0025_extra_checkin_approval"
down_revision: Union[str, None] = "0024_admin_user_mfa_per_user"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "attendance_extra_checkin_approvals",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("device_id", sa.Integer(), nullable=True),
        sa.Column("local_day", sa.Date(), nullable=False),
        sa.Column("approval_token", sa.String(length=255), nullable=False),
        sa.Column(
            "status",
            sa.String(length=20),
            nullable=False,
            server_default=sa.text("'PENDING'"),
        ),
        sa.Column(
            "requested_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_by_admin_user_id", sa.Integer(), nullable=True),
        sa.Column("approved_by_username", sa.String(length=100), nullable=True),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("consumed_by_event_id", sa.Integer(), nullable=True),
        sa.Column("push_total_targets", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("push_sent", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("push_failed", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("last_push_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["approved_by_admin_user_id"], ["admin_users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["consumed_by_event_id"], ["attendance_events.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("approval_token", name="uq_attendance_extra_checkin_approvals_token"),
    )
    op.create_index(
        "ix_attendance_extra_checkin_approvals_employee_id",
        "attendance_extra_checkin_approvals",
        ["employee_id"],
        unique=False,
    )
    op.create_index(
        "ix_attendance_extra_checkin_approvals_device_id",
        "attendance_extra_checkin_approvals",
        ["device_id"],
        unique=False,
    )
    op.create_index(
        "ix_attendance_extra_checkin_approvals_local_day",
        "attendance_extra_checkin_approvals",
        ["local_day"],
        unique=False,
    )
    op.create_index(
        "ix_attendance_extra_checkin_approvals_status",
        "attendance_extra_checkin_approvals",
        ["status"],
        unique=False,
    )
    op.create_index(
        "ix_attendance_extra_checkin_approvals_expires_at",
        "attendance_extra_checkin_approvals",
        ["expires_at"],
        unique=False,
    )
    op.create_index(
        "ix_attendance_extra_checkin_approvals_approved_by_admin_user_id",
        "attendance_extra_checkin_approvals",
        ["approved_by_admin_user_id"],
        unique=False,
    )
    op.create_index(
        "ix_attendance_extra_checkin_approvals_consumed_by_event_id",
        "attendance_extra_checkin_approvals",
        ["consumed_by_event_id"],
        unique=False,
    )
    op.create_index(
        "ix_attendance_extra_checkin_approvals_approval_token",
        "attendance_extra_checkin_approvals",
        ["approval_token"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_attendance_extra_checkin_approvals_approval_token",
        table_name="attendance_extra_checkin_approvals",
    )
    op.drop_index(
        "ix_attendance_extra_checkin_approvals_consumed_by_event_id",
        table_name="attendance_extra_checkin_approvals",
    )
    op.drop_index(
        "ix_attendance_extra_checkin_approvals_approved_by_admin_user_id",
        table_name="attendance_extra_checkin_approvals",
    )
    op.drop_index(
        "ix_attendance_extra_checkin_approvals_expires_at",
        table_name="attendance_extra_checkin_approvals",
    )
    op.drop_index(
        "ix_attendance_extra_checkin_approvals_status",
        table_name="attendance_extra_checkin_approvals",
    )
    op.drop_index(
        "ix_attendance_extra_checkin_approvals_local_day",
        table_name="attendance_extra_checkin_approvals",
    )
    op.drop_index(
        "ix_attendance_extra_checkin_approvals_device_id",
        table_name="attendance_extra_checkin_approvals",
    )
    op.drop_index(
        "ix_attendance_extra_checkin_approvals_employee_id",
        table_name="attendance_extra_checkin_approvals",
    )
    op.drop_table("attendance_extra_checkin_approvals")
