"""Add manual attendance metadata and soft delete fields

Revision ID: 0008_manual_events
Revises: 0007_labor_profile
Create Date: 2026-02-07 23:55:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0008_manual_events"
down_revision: Union[str, None] = "0007_labor_profile"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


attendance_event_source = postgresql.ENUM(
    "DEVICE",
    "MANUAL",
    name="attendance_event_source",
    create_type=False,
)


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            DO $$
            BEGIN
              IF NOT EXISTS (
                SELECT 1 FROM pg_type WHERE typname = 'attendance_event_source'
              ) THEN
                CREATE TYPE attendance_event_source AS ENUM ('DEVICE', 'MANUAL');
              END IF;
            END
            $$;
            """
        )
    )

    op.add_column(
        "attendance_events",
        sa.Column(
            "source",
            attendance_event_source,
            nullable=False,
            server_default=sa.text("'DEVICE'"),
        ),
    )
    op.add_column(
        "attendance_events",
        sa.Column(
            "created_by_admin",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "attendance_events",
        sa.Column("note", sa.String(length=1000), nullable=True),
    )
    op.add_column(
        "attendance_events",
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
    op.add_column(
        "attendance_events",
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
    op.add_column(
        "attendance_events",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "attendance_events",
        sa.Column(
            "deleted_by_admin",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.create_index(
        "ix_attendance_events_deleted_at",
        "attendance_events",
        ["deleted_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_attendance_events_deleted_at", table_name="attendance_events")
    op.drop_column("attendance_events", "deleted_by_admin")
    op.drop_column("attendance_events", "deleted_at")
    op.drop_column("attendance_events", "updated_at")
    op.drop_column("attendance_events", "created_at")
    op.drop_column("attendance_events", "note")
    op.drop_column("attendance_events", "created_by_admin")
    op.drop_column("attendance_events", "source")
    op.execute(sa.text("DROP TYPE IF EXISTS attendance_event_source"))
