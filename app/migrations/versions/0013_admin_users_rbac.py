"""Add admin users and refresh token ownership

Revision ID: 0013_admin_users_rbac
Revises: 0012_plan_emp_scope
Create Date: 2026-02-08 23:40:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0013_admin_users_rbac"
down_revision: Union[str, None] = "0012_plan_emp_scope"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "admin_users",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("username", sa.String(length=100), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("full_name", sa.String(length=255), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("is_super_admin", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column(
            "permissions",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
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
        sa.UniqueConstraint("username", name="uq_admin_users_username"),
    )
    op.create_index("ix_admin_users_username", "admin_users", ["username"], unique=True)

    op.add_column("admin_refresh_tokens", sa.Column("admin_user_id", sa.Integer(), nullable=True))
    op.add_column(
        "admin_refresh_tokens",
        sa.Column("subject", sa.String(length=255), nullable=False, server_default=sa.text("'admin'")),
    )
    op.create_index(
        "ix_admin_refresh_tokens_admin_user_id",
        "admin_refresh_tokens",
        ["admin_user_id"],
        unique=False,
    )
    op.create_foreign_key(
        "fk_admin_refresh_tokens_admin_user_id",
        "admin_refresh_tokens",
        "admin_users",
        ["admin_user_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.execute(
        """
        UPDATE admin_refresh_tokens
        SET subject = COALESCE(subject, 'admin')
        """
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_admin_refresh_tokens_admin_user_id",
        "admin_refresh_tokens",
        type_="foreignkey",
    )
    op.drop_index("ix_admin_refresh_tokens_admin_user_id", table_name="admin_refresh_tokens")
    op.drop_column("admin_refresh_tokens", "subject")
    op.drop_column("admin_refresh_tokens", "admin_user_id")

    op.drop_index("ix_admin_users_username", table_name="admin_users")
    op.drop_table("admin_users")
