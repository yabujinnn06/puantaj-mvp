"""add normalized employee location events

Revision ID: 0038_location_events_refactor
Revises: 0037_remove_game_modules
Create Date: 2026-03-16 14:30:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0038_location_events_refactor"
down_revision = "0037_remove_game_modules"
branch_labels = None
depends_on = None


LOCATION_STATUS_VALUES = (
    "LOW_ACCURACY",
    "STALE_LOCATION",
    "OUTSIDE_GEOFENCE",
    "INSIDE_GEOFENCE",
    "SUSPICIOUS_JUMP",
    "MOCK_GPS_SUSPECTED",
    "VERIFIED",
)


def upgrade() -> None:
    for value in LOCATION_STATUS_VALUES:
        op.execute(sa.text(f"ALTER TYPE attendance_location_status ADD VALUE IF NOT EXISTS '{value}'"))

    location_event_source = postgresql.ENUM(
        "CHECKIN",
        "CHECKOUT",
        "APP_OPEN",
        "APP_CLOSE",
        "DEMO_START",
        "DEMO_END",
        "LOCATION_PING",
        name="location_event_source",
    )
    location_geofence_status = postgresql.ENUM(
        "NOT_CONFIGURED",
        "INSIDE",
        "OUTSIDE",
        "UNKNOWN",
        name="location_geofence_status",
    )
    location_trust_status = postgresql.ENUM(
        "NO_DATA",
        "LOW",
        "MEDIUM",
        "HIGH",
        "SUSPICIOUS",
        name="location_trust_status",
    )
    bind = op.get_bind()
    location_event_source.create(bind, checkfirst=True)
    location_geofence_status.create(bind, checkfirst=True)
    location_trust_status.create(bind, checkfirst=True)

    op.create_table(
        "employee_location_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("device_id", sa.Integer(), nullable=True),
        sa.Column("attendance_event_id", sa.Integer(), nullable=True),
        sa.Column("audit_log_id", sa.Integer(), nullable=True),
        sa.Column("source", location_event_source, nullable=False),
        sa.Column("ts_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("lat", sa.Float(), nullable=True),
        sa.Column("lon", sa.Float(), nullable=True),
        sa.Column("accuracy_m", sa.Float(), nullable=True),
        sa.Column("speed_mps", sa.Float(), nullable=True),
        sa.Column("heading_deg", sa.Float(), nullable=True),
        sa.Column("altitude_m", sa.Float(), nullable=True),
        sa.Column("provider", sa.String(length=40), nullable=True),
        sa.Column("ip", sa.String(length=128), nullable=True),
        sa.Column("network_type", sa.String(length=40), nullable=True),
        sa.Column("battery_level", sa.Float(), nullable=True),
        sa.Column("is_mocked", sa.Boolean(), nullable=True),
        sa.Column("geofence_status", location_geofence_status, nullable=False, server_default=sa.text("'UNKNOWN'")),
        sa.Column("trust_status", location_trust_status, nullable=False, server_default=sa.text("'NO_DATA'")),
        sa.Column("trust_score", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("distance_to_geofence_m", sa.Float(), nullable=True),
        sa.Column(
            "location_status",
            sa.Enum(name="attendance_location_status", create_type=False),
            nullable=False,
            server_default=sa.text("'NO_LOCATION'"),
        ),
        sa.Column("details", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.ForeignKeyConstraint(["attendance_event_id"], ["attendance_events.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["audit_log_id"], ["audit_logs.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("attendance_event_id"),
        sa.UniqueConstraint("audit_log_id"),
    )
    op.create_index("ix_employee_location_events_employee_id", "employee_location_events", ["employee_id"], unique=False)
    op.create_index("ix_employee_location_events_device_id", "employee_location_events", ["device_id"], unique=False)
    op.create_index("ix_employee_location_events_ts_utc", "employee_location_events", ["ts_utc"], unique=False)
    op.create_index("ix_employee_location_events_source", "employee_location_events", ["source"], unique=False)
    op.create_index(
        "ix_employee_location_events_employee_ts",
        "employee_location_events",
        ["employee_id", "ts_utc"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_employee_location_events_employee_ts", table_name="employee_location_events")
    op.drop_index("ix_employee_location_events_source", table_name="employee_location_events")
    op.drop_index("ix_employee_location_events_ts_utc", table_name="employee_location_events")
    op.drop_index("ix_employee_location_events_device_id", table_name="employee_location_events")
    op.drop_index("ix_employee_location_events_employee_id", table_name="employee_location_events")
    op.drop_table("employee_location_events")

    bind = op.get_bind()
    postgresql.ENUM(name="location_trust_status").drop(bind, checkfirst=True)
    postgresql.ENUM(name="location_geofence_status").drop(bind, checkfirst=True)
    postgresql.ENUM(name="location_event_source").drop(bind, checkfirst=True)
