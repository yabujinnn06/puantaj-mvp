"""Add employee index metadata fields to daily report archives

Revision ID: 0020_archive_emp_index
Revises: 0019_admin_push_and_archives
Create Date: 2026-02-15 20:10:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0020_archive_emp_index"
down_revision: Union[str, None] = "0019_admin_push_and_archives"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "admin_daily_report_archives",
        sa.Column("employee_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )
    op.add_column(
        "admin_daily_report_archives",
        sa.Column("employee_ids_index", sa.Text(), nullable=True),
    )
    op.add_column(
        "admin_daily_report_archives",
        sa.Column("employee_names_index", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("admin_daily_report_archives", "employee_names_index")
    op.drop_column("admin_daily_report_archives", "employee_ids_index")
    op.drop_column("admin_daily_report_archives", "employee_count")
