"""Add QR code/location mapping tables

Revision ID: 0017_qr_codes_points
Revises: 0016_webauthn_passkeys
Create Date: 2026-02-10 10:00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "0017_qr_codes_points"
down_revision: Union[str, None] = "0016_webauthn_passkeys"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


qr_code_type = postgresql.ENUM(
    "CHECKIN",
    "CHECKOUT",
    "BOTH",
    name="qr_code_type",
    create_type=False,
)


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'qr_code_type') THEN
                CREATE TYPE qr_code_type AS ENUM ('CHECKIN', 'CHECKOUT', 'BOTH');
            END IF;
        END $$;
        """
    )

    op.create_table(
        "qr_codes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=True),
        sa.Column("code_value", sa.String(length=255), nullable=False),
        sa.Column("code_type", qr_code_type, nullable=False, server_default=sa.text("'BOTH'")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
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
        sa.UniqueConstraint("code_value", name="uq_qr_codes_code_value"),
    )
    op.create_index("ix_qr_codes_code_value", "qr_codes", ["code_value"], unique=False)

    op.create_table(
        "qr_points",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lon", sa.Float(), nullable=False),
        sa.Column("radius_m", sa.Integer(), nullable=False, server_default=sa.text("75")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("department_id", sa.Integer(), nullable=True),
        sa.Column("region_id", sa.Integer(), nullable=True),
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
        sa.ForeignKeyConstraint(["department_id"], ["departments.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["region_id"], ["regions.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_qr_points_department_id", "qr_points", ["department_id"], unique=False)
    op.create_index("ix_qr_points_region_id", "qr_points", ["region_id"], unique=False)

    op.create_table(
        "qr_code_points",
        sa.Column("qr_code_id", sa.Integer(), nullable=False),
        sa.Column("qr_point_id", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(["qr_code_id"], ["qr_codes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["qr_point_id"], ["qr_points.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("qr_code_id", "qr_point_id"),
        sa.UniqueConstraint("qr_code_id", "qr_point_id", name="uq_qr_code_points_qr_code_qr_point"),
    )
    op.create_index("ix_qr_code_points_qr_code_id", "qr_code_points", ["qr_code_id"], unique=False)
    op.create_index("ix_qr_code_points_qr_point_id", "qr_code_points", ["qr_point_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_qr_code_points_qr_point_id", table_name="qr_code_points")
    op.drop_index("ix_qr_code_points_qr_code_id", table_name="qr_code_points")
    op.drop_table("qr_code_points")

    op.drop_index("ix_qr_points_region_id", table_name="qr_points")
    op.drop_index("ix_qr_points_department_id", table_name="qr_points")
    op.drop_table("qr_points")

    op.drop_index("ix_qr_codes_code_value", table_name="qr_codes")
    op.drop_table("qr_codes")

    op.execute("DROP TYPE IF EXISTS qr_code_type")
