"""Add YabuBird multiplayer arcade tables

Revision ID: 0032_yabubird_arcade
Revises: 0031_overtime_grace_rules
Create Date: 2026-03-14 15:40:00.000000
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0032_yabubird_arcade"
down_revision: Union[str, None] = "0031_overtime_grace_rules"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "yabubird_rooms",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("room_key", sa.String(length=64), nullable=False),
        sa.Column("seed", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False, server_default=sa.text("'OPEN'")),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("room_key"),
    )
    op.create_index(op.f("ix_yabubird_rooms_room_key"), "yabubird_rooms", ["room_key"], unique=True)

    op.create_table(
        "yabubird_presences",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("room_id", sa.Integer(), nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("device_id", sa.Integer(), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("color_hex", sa.String(length=16), nullable=False),
        sa.Column("is_connected", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("is_alive", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("latest_score", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("latest_y", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("latest_velocity", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("flap_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["room_id"], ["yabubird_rooms.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_yabubird_presences_room_id"), "yabubird_presences", ["room_id"], unique=False)
    op.create_index(op.f("ix_yabubird_presences_employee_id"), "yabubird_presences", ["employee_id"], unique=False)
    op.create_index(op.f("ix_yabubird_presences_device_id"), "yabubird_presences", ["device_id"], unique=False)

    op.create_table(
        "yabubird_scores",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("presence_id", sa.Integer(), nullable=True),
        sa.Column("room_id", sa.Integer(), nullable=True),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("device_id", sa.Integer(), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("survived_ms", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("display_name_snapshot", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.ForeignKeyConstraint(["presence_id"], ["yabubird_presences.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["device_id"], ["devices.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["room_id"], ["yabubird_rooms.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_yabubird_scores_presence_id"), "yabubird_scores", ["presence_id"], unique=False)
    op.create_index(op.f("ix_yabubird_scores_room_id"), "yabubird_scores", ["room_id"], unique=False)
    op.create_index(op.f("ix_yabubird_scores_employee_id"), "yabubird_scores", ["employee_id"], unique=False)
    op.create_index(op.f("ix_yabubird_scores_device_id"), "yabubird_scores", ["device_id"], unique=False)
    op.create_index(op.f("ix_yabubird_scores_score"), "yabubird_scores", ["score"], unique=False)
    op.create_index(op.f("ix_yabubird_scores_created_at"), "yabubird_scores", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_yabubird_scores_presence_id"), table_name="yabubird_scores")
    op.drop_index(op.f("ix_yabubird_scores_created_at"), table_name="yabubird_scores")
    op.drop_index(op.f("ix_yabubird_scores_score"), table_name="yabubird_scores")
    op.drop_index(op.f("ix_yabubird_scores_device_id"), table_name="yabubird_scores")
    op.drop_index(op.f("ix_yabubird_scores_employee_id"), table_name="yabubird_scores")
    op.drop_index(op.f("ix_yabubird_scores_room_id"), table_name="yabubird_scores")
    op.drop_table("yabubird_scores")

    op.drop_index(op.f("ix_yabubird_presences_device_id"), table_name="yabubird_presences")
    op.drop_index(op.f("ix_yabubird_presences_employee_id"), table_name="yabubird_presences")
    op.drop_index(op.f("ix_yabubird_presences_room_id"), table_name="yabubird_presences")
    op.drop_table("yabubird_presences")

    op.drop_index(op.f("ix_yabubird_rooms_room_key"), table_name="yabubird_rooms")
    op.drop_table("yabubird_rooms")
