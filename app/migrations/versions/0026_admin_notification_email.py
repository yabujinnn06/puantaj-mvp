"""Add admin notification email targets table

Revision ID: 0026_admin_notification_email
Revises: 0025_extra_checkin_approval
Create Date: 2026-02-23 13:05:00
"""

from __future__ import annotations

import os
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0026_admin_notification_email"
down_revision: Union[str, None] = "0025_extra_checkin_approval"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _normalize_email(value: str) -> str | None:
    normalized = " ".join((value or "").strip().lower().split())
    if not normalized or "@" not in normalized:
        return None
    local_part, _, domain_part = normalized.partition("@")
    if (not local_part) or (not domain_part) or ("." not in domain_part):
        return None
    return normalized


def upgrade() -> None:
    op.create_table(
        "admin_notification_email_targets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
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
        sa.UniqueConstraint("email", name="uq_admin_notification_email_targets_email"),
    )
    op.create_index(
        "ix_admin_notification_email_targets_email",
        "admin_notification_email_targets",
        ["email"],
        unique=True,
    )
    op.create_index(
        "ix_admin_notification_email_targets_is_active",
        "admin_notification_email_targets",
        ["is_active"],
        unique=False,
    )

    bind = op.get_bind()
    targets: set[str] = set()

    configured = (os.getenv("ADMIN_NOTIFICATION_EMAILS") or "").strip()
    if configured:
        for raw_item in configured.split(","):
            normalized = _normalize_email(raw_item)
            if normalized:
                targets.add(normalized)

    rows = bind.execute(sa.text("SELECT username FROM admin_users WHERE is_active IS TRUE")).fetchall()
    for row in rows:
        username = _normalize_email(str(row[0] or ""))
        if username:
            targets.add(username)

    if targets:
        table = sa.table(
            "admin_notification_email_targets",
            sa.column("email", sa.String(length=320)),
            sa.column("is_active", sa.Boolean()),
            sa.column("created_by_username", sa.String(length=100)),
            sa.column("updated_by_username", sa.String(length=100)),
        )
        op.bulk_insert(
            table,
            [
                {
                    "email": value,
                    "is_active": True,
                    "created_by_username": "migration",
                    "updated_by_username": "migration",
                }
                for value in sorted(targets)
            ],
        )


def downgrade() -> None:
    op.drop_index(
        "ix_admin_notification_email_targets_is_active",
        table_name="admin_notification_email_targets",
    )
    op.drop_index(
        "ix_admin_notification_email_targets_email",
        table_name="admin_notification_email_targets",
    )
    op.drop_table("admin_notification_email_targets")

