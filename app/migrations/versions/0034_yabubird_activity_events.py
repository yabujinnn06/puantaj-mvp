"""Add structured activity events and YabuBird reactions

Revision ID: 0034_yabubird_activity_events
Revises: 0033_yabubird_presence_locations
Create Date: 2026-03-14 20:10:00.000000
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0034_yabubird_activity_events"
down_revision: Union[str, None] = "0033_yabubird_presence_locations"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "audit_logs",
        sa.Column("module", sa.String(length=40), nullable=False, server_default=sa.text("'CORE'")),
    )
    op.add_column("audit_logs", sa.Column("event_type", sa.String(length=100), nullable=True))
    op.add_column("audit_logs", sa.Column("employee_id", sa.Integer(), nullable=True))
    op.add_column("audit_logs", sa.Column("device_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_audit_logs_employee_id_employees",
        "audit_logs",
        "employees",
        ["employee_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_audit_logs_device_id_devices",
        "audit_logs",
        "devices",
        ["device_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_audit_logs_module", "audit_logs", ["module"], unique=False)
    op.create_index("ix_audit_logs_event_type", "audit_logs", ["event_type"], unique=False)
    op.create_index("ix_audit_logs_employee_id", "audit_logs", ["employee_id"], unique=False)
    op.create_index("ix_audit_logs_device_id", "audit_logs", ["device_id"], unique=False)

    op.execute(
        """
        UPDATE audit_logs
        SET employee_id = actor_id::integer
        WHERE employee_id IS NULL
          AND actor_type = 'SYSTEM'
          AND actor_id ~ '^[0-9]+$'
        """
    )
    op.execute(
        """
        UPDATE audit_logs
        SET device_id = entity_id::integer
        WHERE device_id IS NULL
          AND entity_type = 'device'
          AND entity_id ~ '^[0-9]+$'
        """
    )
    op.execute(
        """
        UPDATE audit_logs
        SET module = 'GAME',
            event_type = 'game_login'
        WHERE action = 'EMPLOYEE_APP_LOCATION_PING'
          AND COALESCE(details ->> 'source', '') = 'YABUBIRD_ENTER'
        """
    )
    op.execute(
        """
        UPDATE audit_logs
        SET module = 'APP',
            event_type = 'app_login'
        WHERE action = 'EMPLOYEE_APP_LOCATION_PING'
          AND COALESCE(details ->> 'source', 'APP_OPEN') <> 'YABUBIRD_ENTER'
        """
    )
    op.execute(
        """
        UPDATE audit_logs
        SET module = 'GAME',
            event_type = 'game_session_start'
        WHERE action = 'YABUBIRD_JOINED'
        """
    )
    op.execute(
        """
        UPDATE audit_logs
        SET module = 'GAME',
            event_type = 'game_session_end'
        WHERE action = 'YABUBIRD_FINISHED'
        """
    )
    op.execute(
        """
        UPDATE audit_logs
        SET module = 'GAME',
            event_type = 'game_logout'
        WHERE action = 'YABUBIRD_LEFT'
        """
    )

    op.create_table(
        "yabubird_reactions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("room_id", sa.Integer(), nullable=False),
        sa.Column("presence_id", sa.Integer(), nullable=True),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("device_id", sa.Integer(), nullable=False),
        sa.Column("emoji", sa.String(length=8), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["presence_id"], ["yabubird_presences.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["room_id"], ["yabubird_rooms.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_yabubird_reactions_room_id", "yabubird_reactions", ["room_id"], unique=False)
    op.create_index("ix_yabubird_reactions_presence_id", "yabubird_reactions", ["presence_id"], unique=False)
    op.create_index("ix_yabubird_reactions_employee_id", "yabubird_reactions", ["employee_id"], unique=False)
    op.create_index("ix_yabubird_reactions_device_id", "yabubird_reactions", ["device_id"], unique=False)
    op.create_index("ix_yabubird_reactions_emoji", "yabubird_reactions", ["emoji"], unique=False)
    op.create_index("ix_yabubird_reactions_created_at", "yabubird_reactions", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_yabubird_reactions_created_at", table_name="yabubird_reactions")
    op.drop_index("ix_yabubird_reactions_emoji", table_name="yabubird_reactions")
    op.drop_index("ix_yabubird_reactions_device_id", table_name="yabubird_reactions")
    op.drop_index("ix_yabubird_reactions_employee_id", table_name="yabubird_reactions")
    op.drop_index("ix_yabubird_reactions_presence_id", table_name="yabubird_reactions")
    op.drop_index("ix_yabubird_reactions_room_id", table_name="yabubird_reactions")
    op.drop_table("yabubird_reactions")

    op.drop_index("ix_audit_logs_device_id", table_name="audit_logs")
    op.drop_index("ix_audit_logs_employee_id", table_name="audit_logs")
    op.drop_index("ix_audit_logs_event_type", table_name="audit_logs")
    op.drop_index("ix_audit_logs_module", table_name="audit_logs")
    op.drop_constraint("fk_audit_logs_device_id_devices", "audit_logs", type_="foreignkey")
    op.drop_constraint("fk_audit_logs_employee_id_employees", "audit_logs", type_="foreignkey")
    op.drop_column("audit_logs", "device_id")
    op.drop_column("audit_logs", "employee_id")
    op.drop_column("audit_logs", "event_type")
    op.drop_column("audit_logs", "module")
