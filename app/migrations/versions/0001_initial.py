"""Initial attendance schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-02-06 00:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

attendance_event_type = postgresql.ENUM(
    "IN",
    "OUT",
    name="attendance_event_type",
    create_type=False,
)
attendance_location_status = postgresql.ENUM(
    "VERIFIED_HOME",
    "UNVERIFIED_LOCATION",
    "NO_LOCATION",
    name="attendance_location_status",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    attendance_event_type.create(bind, checkfirst=True)
    attendance_location_status.create(bind, checkfirst=True)

    op.create_table(
        "departments",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.UniqueConstraint("name", name="uq_departments_name"),
    )

    op.create_table(
        "employees",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("full_name", sa.String(length=255), nullable=False),
        sa.Column("department_id", sa.Integer(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.ForeignKeyConstraint(["department_id"], ["departments.id"], ondelete="SET NULL"),
    )

    op.create_table(
        "devices",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("device_fingerprint", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "ix_devices_device_fingerprint",
        "devices",
        ["device_fingerprint"],
        unique=True,
    )

    op.create_table(
        "employee_locations",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("home_lat", sa.Float(), nullable=False),
        sa.Column("home_lon", sa.Float(), nullable=False),
        sa.Column("radius_m", sa.Integer(), nullable=False, server_default=sa.text("120")),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("employee_id", name="uq_employee_locations_employee_id"),
    )

    op.create_table(
        "work_rules",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("department_id", sa.Integer(), nullable=False),
        sa.Column(
            "daily_minutes_planned",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("540"),
        ),
        sa.Column("break_minutes", sa.Integer(), nullable=False, server_default=sa.text("60")),
        sa.Column("grace_minutes", sa.Integer(), nullable=False, server_default=sa.text("5")),
        sa.ForeignKeyConstraint(["department_id"], ["departments.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("department_id", name="uq_work_rules_department_id"),
    )

    op.create_table(
        "attendance_events",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("device_id", sa.Integer(), nullable=False),
        sa.Column("type", attendance_event_type, nullable=False),
        sa.Column("ts_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("lat", sa.Float(), nullable=True),
        sa.Column("lon", sa.Float(), nullable=True),
        sa.Column("accuracy_m", sa.Float(), nullable=True),
        sa.Column("location_status", attendance_location_status, nullable=False),
        sa.Column(
            "flags",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"], ondelete="CASCADE"),
    )


def downgrade() -> None:
    op.drop_table("attendance_events")
    op.drop_table("work_rules")
    op.drop_table("employee_locations")
    op.drop_index("ix_devices_device_fingerprint", table_name="devices")
    op.drop_table("devices")
    op.drop_table("employees")
    op.drop_table("departments")

    bind = op.get_bind()
    attendance_location_status.drop(bind, checkfirst=True)
    attendance_event_type.drop(bind, checkfirst=True)

