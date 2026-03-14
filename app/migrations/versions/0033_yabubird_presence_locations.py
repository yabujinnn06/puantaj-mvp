"""Add YabuBird presence location tracking

Revision ID: 0033_yabubird_presence_locations
Revises: 0032_yabubird_arcade
Create Date: 2026-03-14 18:20:00.000000
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0033_yabubird_presence_locations"
down_revision: Union[str, None] = "0032_yabubird_arcade"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("yabubird_presences", sa.Column("latest_lat", sa.Float(), nullable=True))
    op.add_column("yabubird_presences", sa.Column("latest_lon", sa.Float(), nullable=True))
    op.add_column("yabubird_presences", sa.Column("latest_accuracy_m", sa.Float(), nullable=True))
    op.add_column("yabubird_presences", sa.Column("latest_location_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("yabubird_presences", "latest_location_at")
    op.drop_column("yabubird_presences", "latest_accuracy_m")
    op.drop_column("yabubird_presences", "latest_lon")
    op.drop_column("yabubird_presences", "latest_lat")
