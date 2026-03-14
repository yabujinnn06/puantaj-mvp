"""Add YabuBird room owner tracking

Revision ID: 0035_yabubird_room_owners
Revises: 0034_yabubird_activity_events
Create Date: 2026-03-14 22:20:00.000000
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0035_yabubird_room_owners"
down_revision: Union[str, None] = "0034_yabubird_activity_events"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("yabubird_rooms", sa.Column("owner_employee_id", sa.Integer(), nullable=True))
    op.add_column("yabubird_rooms", sa.Column("owner_device_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_yabubird_rooms_owner_employee_id",
        "yabubird_rooms",
        "employees",
        ["owner_employee_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_yabubird_rooms_owner_device_id",
        "yabubird_rooms",
        "devices",
        ["owner_device_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_yabubird_rooms_owner_employee_id", "yabubird_rooms", ["owner_employee_id"], unique=False)
    op.create_index("ix_yabubird_rooms_owner_device_id", "yabubird_rooms", ["owner_device_id"], unique=False)

    op.execute(
        """
        UPDATE yabubird_rooms AS room
        SET owner_employee_id = presence.employee_id,
            owner_device_id = presence.device_id
        FROM (
            SELECT DISTINCT ON (room_id)
                room_id,
                employee_id,
                device_id
            FROM yabubird_presences
            ORDER BY room_id, started_at ASC, id ASC
        ) AS presence
        WHERE room.id = presence.room_id
          AND room.owner_employee_id IS NULL
        """
    )


def downgrade() -> None:
    op.drop_index("ix_yabubird_rooms_owner_device_id", table_name="yabubird_rooms")
    op.drop_index("ix_yabubird_rooms_owner_employee_id", table_name="yabubird_rooms")
    op.drop_constraint("fk_yabubird_rooms_owner_device_id", "yabubird_rooms", type_="foreignkey")
    op.drop_constraint("fk_yabubird_rooms_owner_employee_id", "yabubird_rooms", type_="foreignkey")
    op.drop_column("yabubird_rooms", "owner_device_id")
    op.drop_column("yabubird_rooms", "owner_employee_id")
