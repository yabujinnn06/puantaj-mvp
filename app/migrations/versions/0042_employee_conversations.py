"""employee conversations

Revision ID: 0042_employee_conversations
Revises: 0041_leave_threads_and_attachments
Create Date: 2026-04-05 23:30:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0042_employee_conversations"
down_revision = "0041_leave_threads_and_attachments"
branch_labels = None
depends_on = None


employee_conversation_category = sa.Enum(
    "ATTENDANCE",
    "SHIFT",
    "DEVICE",
    "DOCUMENT",
    "OTHER",
    name="employee_conversation_category",
)

employee_conversation_status = sa.Enum(
    "OPEN",
    "CLOSED",
    name="employee_conversation_status",
)


def upgrade() -> None:
    employee_conversation_category.create(op.get_bind(), checkfirst=True)
    employee_conversation_status.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "employee_conversations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("category", employee_conversation_category, nullable=False),
        sa.Column("subject", sa.String(length=160), nullable=False),
        sa.Column(
            "status",
            employee_conversation_status,
            nullable=False,
            server_default=sa.text("'OPEN'"),
        ),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_employee_conversations_employee_id"), "employee_conversations", ["employee_id"], unique=False)

    op.create_table(
        "employee_conversation_messages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("conversation_id", sa.Integer(), nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("sender_actor", sa.String(length=20), nullable=False, server_default=sa.text("'EMPLOYEE'")),
        sa.Column("sender_admin_user_id", sa.Integer(), nullable=True),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.ForeignKeyConstraint(["conversation_id"], ["employee_conversations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sender_admin_user_id"], ["admin_users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_employee_conversation_messages_conversation_id"),
        "employee_conversation_messages",
        ["conversation_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_employee_conversation_messages_employee_id"),
        "employee_conversation_messages",
        ["employee_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_employee_conversation_messages_sender_admin_user_id"),
        "employee_conversation_messages",
        ["sender_admin_user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_employee_conversation_messages_sender_admin_user_id"),
        table_name="employee_conversation_messages",
    )
    op.drop_index(
        op.f("ix_employee_conversation_messages_employee_id"),
        table_name="employee_conversation_messages",
    )
    op.drop_index(
        op.f("ix_employee_conversation_messages_conversation_id"),
        table_name="employee_conversation_messages",
    )
    op.drop_table("employee_conversation_messages")

    op.drop_index(op.f("ix_employee_conversations_employee_id"), table_name="employee_conversations")
    op.drop_table("employee_conversations")

    employee_conversation_status.drop(op.get_bind(), checkfirst=True)
    employee_conversation_category.drop(op.get_bind(), checkfirst=True)
