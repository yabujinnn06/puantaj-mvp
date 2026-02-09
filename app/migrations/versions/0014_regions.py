"""Add regions and region references

Revision ID: 0014_regions
Revises: 0013_admin_users_rbac
Create Date: 2026-02-09 00:15:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0014_regions"
down_revision: Union[str, None] = "0013_admin_users_rbac"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "regions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
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
        sa.UniqueConstraint("name", name="uq_regions_name"),
    )
    op.create_index("ix_regions_name", "regions", ["name"], unique=True)

    op.add_column("departments", sa.Column("region_id", sa.Integer(), nullable=True))
    op.add_column("employees", sa.Column("region_id", sa.Integer(), nullable=True))

    op.create_index("ix_departments_region_id", "departments", ["region_id"], unique=False)
    op.create_index("ix_employees_region_id", "employees", ["region_id"], unique=False)

    op.create_foreign_key(
        "fk_departments_region_id",
        "departments",
        "regions",
        ["region_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_employees_region_id",
        "employees",
        "regions",
        ["region_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_employees_region_id", "employees", type_="foreignkey")
    op.drop_constraint("fk_departments_region_id", "departments", type_="foreignkey")

    op.drop_index("ix_employees_region_id", table_name="employees")
    op.drop_index("ix_departments_region_id", table_name="departments")

    op.drop_column("employees", "region_id")
    op.drop_column("departments", "region_id")

    op.drop_index("ix_regions_name", table_name="regions")
    op.drop_table("regions")
