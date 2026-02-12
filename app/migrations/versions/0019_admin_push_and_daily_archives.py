"""Add admin push subscriptions, device invites, and daily report archives

Revision ID: 0019_admin_push_and_daily_archives
Revises: 0018_device_push_subscriptions
Create Date: 2026-02-12 23:45:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0019_admin_push_and_daily_archives"
down_revision: Union[str, None] = "0018_device_push_subscriptions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "admin_push_subscriptions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("admin_user_id", sa.Integer(), nullable=True),
        sa.Column("admin_username", sa.String(length=100), nullable=False),
        sa.Column("endpoint", sa.String(length=1024), nullable=False),
        sa.Column("p256dh", sa.String(length=512), nullable=False),
        sa.Column("auth", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("user_agent", sa.String(length=1024), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
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
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(["admin_user_id"], ["admin_users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("endpoint", name="uq_admin_push_subscriptions_endpoint"),
    )
    op.create_index(
        "ix_admin_push_subscriptions_admin_user_id",
        "admin_push_subscriptions",
        ["admin_user_id"],
        unique=False,
    )
    op.create_index(
        "ix_admin_push_subscriptions_admin_username",
        "admin_push_subscriptions",
        ["admin_username"],
        unique=False,
    )
    op.create_index(
        "ix_admin_push_subscriptions_endpoint",
        "admin_push_subscriptions",
        ["endpoint"],
        unique=True,
    )

    op.create_table(
        "admin_device_invites",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("token", sa.String(length=255), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_used", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_by_admin_user_id", sa.Integer(), nullable=True),
        sa.Column("created_by_username", sa.String(length=100), nullable=False),
        sa.Column("used_by_admin_user_id", sa.Integer(), nullable=True),
        sa.Column("used_by_username", sa.String(length=100), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["created_by_admin_user_id"], ["admin_users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["used_by_admin_user_id"], ["admin_users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token", name="uq_admin_device_invites_token"),
    )
    op.create_index("ix_admin_device_invites_token", "admin_device_invites", ["token"], unique=True)
    op.create_index("ix_admin_device_invites_expires_at", "admin_device_invites", ["expires_at"], unique=False)
    op.create_index(
        "ix_admin_device_invites_created_by_admin_user_id",
        "admin_device_invites",
        ["created_by_admin_user_id"],
        unique=False,
    )
    op.create_index(
        "ix_admin_device_invites_used_by_admin_user_id",
        "admin_device_invites",
        ["used_by_admin_user_id"],
        unique=False,
    )

    op.create_table(
        "admin_daily_report_archives",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("report_date", sa.Date(), nullable=False),
        sa.Column("department_id", sa.Integer(), nullable=True),
        sa.Column("region_id", sa.Integer(), nullable=True),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("file_data", sa.LargeBinary(), nullable=False),
        sa.Column("file_size_bytes", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(["department_id"], ["departments.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["region_id"], ["regions.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "report_date",
            "department_id",
            "region_id",
            name="uq_admin_daily_report_archives_scope",
        ),
    )
    op.create_index(
        "ix_admin_daily_report_archives_report_date",
        "admin_daily_report_archives",
        ["report_date"],
        unique=False,
    )
    op.create_index(
        "ix_admin_daily_report_archives_department_id",
        "admin_daily_report_archives",
        ["department_id"],
        unique=False,
    )
    op.create_index(
        "ix_admin_daily_report_archives_region_id",
        "admin_daily_report_archives",
        ["region_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_admin_daily_report_archives_region_id", table_name="admin_daily_report_archives")
    op.drop_index("ix_admin_daily_report_archives_department_id", table_name="admin_daily_report_archives")
    op.drop_index("ix_admin_daily_report_archives_report_date", table_name="admin_daily_report_archives")
    op.drop_table("admin_daily_report_archives")

    op.drop_index("ix_admin_device_invites_used_by_admin_user_id", table_name="admin_device_invites")
    op.drop_index("ix_admin_device_invites_created_by_admin_user_id", table_name="admin_device_invites")
    op.drop_index("ix_admin_device_invites_expires_at", table_name="admin_device_invites")
    op.drop_index("ix_admin_device_invites_token", table_name="admin_device_invites")
    op.drop_table("admin_device_invites")

    op.drop_index("ix_admin_push_subscriptions_endpoint", table_name="admin_push_subscriptions")
    op.drop_index("ix_admin_push_subscriptions_admin_username", table_name="admin_push_subscriptions")
    op.drop_index("ix_admin_push_subscriptions_admin_user_id", table_name="admin_push_subscriptions")
    op.drop_table("admin_push_subscriptions")
