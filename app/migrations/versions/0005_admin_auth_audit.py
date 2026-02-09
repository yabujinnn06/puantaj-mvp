"""Add admin refresh token and audit log tables

Revision ID: 0005_admin_auth_audit
Revises: 0004_leaves
Create Date: 2026-02-07 01:20:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0005_admin_auth_audit"
down_revision: Union[str, None] = "0004_leaves"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

audit_actor_type = postgresql.ENUM(
    "ADMIN",
    "SYSTEM",
    name="audit_actor_type",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    audit_actor_type.create(bind, checkfirst=True)

    op.create_table(
        "admin_refresh_tokens",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("jti", sa.String(length=64), nullable=False),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_ip", sa.String(length=128), nullable=True),
        sa.Column("last_user_agent", sa.String(length=1024), nullable=True),
        sa.UniqueConstraint("jti", name="uq_admin_refresh_tokens_jti"),
    )
    op.create_index(
        "ix_admin_refresh_tokens_jti",
        "admin_refresh_tokens",
        ["jti"],
        unique=True,
    )

    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column(
            "ts_utc",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column("actor_type", audit_actor_type, nullable=False),
        sa.Column("actor_id", sa.String(length=255), nullable=False),
        sa.Column("action", sa.String(length=255), nullable=False),
        sa.Column("entity_type", sa.String(length=255), nullable=True),
        sa.Column("entity_id", sa.String(length=255), nullable=True),
        sa.Column("ip", sa.String(length=128), nullable=True),
        sa.Column("user_agent", sa.String(length=1024), nullable=True),
        sa.Column("success", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "details",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )
    op.create_index("ix_audit_logs_ts_utc", "audit_logs", ["ts_utc"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_audit_logs_ts_utc", table_name="audit_logs")
    op.drop_table("audit_logs")

    op.drop_index("ix_admin_refresh_tokens_jti", table_name="admin_refresh_tokens")
    op.drop_table("admin_refresh_tokens")

    bind = op.get_bind()
    audit_actor_type.drop(bind, checkfirst=True)
