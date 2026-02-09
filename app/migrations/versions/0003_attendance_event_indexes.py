"""Add attendance event indexes

Revision ID: 0003_attendance_event_indexes
Revises: 0002_device_invites
Create Date: 2026-02-06 23:58:00
"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0003_attendance_event_indexes"
down_revision: Union[str, None] = "0002_device_invites"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        "ix_attendance_events_employee_id",
        "attendance_events",
        ["employee_id"],
        unique=False,
    )
    op.create_index(
        "ix_attendance_events_ts_utc",
        "attendance_events",
        ["ts_utc"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_attendance_events_ts_utc", table_name="attendance_events")
    op.drop_index("ix_attendance_events_employee_id", table_name="attendance_events")
