"""leave threads and attachments

Revision ID: 0041_leave_threads_and_attachments
Revises: 0040_leave_request_flow
Create Date: 2026-04-05 21:45:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0041_leave_threads_and_attachments"
down_revision = "0040_leave_request_flow"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "leave_attachments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("leave_id", sa.Integer(), nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("uploaded_by_actor", sa.String(length=20), nullable=False, server_default=sa.text("'EMPLOYEE'")),
        sa.Column("uploaded_by_admin_user_id", sa.Integer(), nullable=True),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=255), nullable=False),
        sa.Column("file_size_bytes", sa.Integer(), nullable=False),
        sa.Column("file_data", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["leave_id"], ["leaves.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uploaded_by_admin_user_id"], ["admin_users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_leave_attachments_leave_id"), "leave_attachments", ["leave_id"], unique=False)
    op.create_index(op.f("ix_leave_attachments_employee_id"), "leave_attachments", ["employee_id"], unique=False)
    op.create_index(
        op.f("ix_leave_attachments_uploaded_by_admin_user_id"),
        "leave_attachments",
        ["uploaded_by_admin_user_id"],
        unique=False,
    )

    op.create_table(
        "leave_messages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("leave_id", sa.Integer(), nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("sender_actor", sa.String(length=20), nullable=False, server_default=sa.text("'EMPLOYEE'")),
        sa.Column("sender_admin_user_id", sa.Integer(), nullable=True),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["leave_id"], ["leaves.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sender_admin_user_id"], ["admin_users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_leave_messages_leave_id"), "leave_messages", ["leave_id"], unique=False)
    op.create_index(op.f("ix_leave_messages_employee_id"), "leave_messages", ["employee_id"], unique=False)
    op.create_index(
        op.f("ix_leave_messages_sender_admin_user_id"),
        "leave_messages",
        ["sender_admin_user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_leave_messages_sender_admin_user_id"), table_name="leave_messages")
    op.drop_index(op.f("ix_leave_messages_employee_id"), table_name="leave_messages")
    op.drop_index(op.f("ix_leave_messages_leave_id"), table_name="leave_messages")
    op.drop_table("leave_messages")

    op.drop_index(op.f("ix_leave_attachments_uploaded_by_admin_user_id"), table_name="leave_attachments")
    op.drop_index(op.f("ix_leave_attachments_employee_id"), table_name="leave_attachments")
    op.drop_index(op.f("ix_leave_attachments_leave_id"), table_name="leave_attachments")
    op.drop_table("leave_attachments")
