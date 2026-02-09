"""Add leaves table

Revision ID: 0004_leaves
Revises: 0003_attendance_event_indexes
Create Date: 2026-02-07 00:40:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "0004_leaves"
down_revision: Union[str, None] = "0003_attendance_event_indexes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

leave_type = postgresql.ENUM(
    "ANNUAL",
    "SICK",
    "UNPAID",
    "EXCUSE",
    "PUBLIC_HOLIDAY",
    name="leave_type",
    create_type=False,
)

leave_status = postgresql.ENUM(
    "APPROVED",
    "PENDING",
    "REJECTED",
    name="leave_status",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    leave_type.create(bind, checkfirst=True)
    leave_status.create(bind, checkfirst=True)

    op.create_table(
        "leaves",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("type", leave_type, nullable=False),
        sa.Column(
            "status",
            leave_status,
            nullable=False,
            server_default=sa.text("'APPROVED'"),
        ),
        sa.Column("note", sa.String(length=1000), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_leaves_employee_id", "leaves", ["employee_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_leaves_employee_id", table_name="leaves")
    op.drop_table("leaves")

    bind = op.get_bind()
    leave_status.drop(bind, checkfirst=True)
    leave_type.drop(bind, checkfirst=True)
