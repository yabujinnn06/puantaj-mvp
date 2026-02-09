from __future__ import annotations

from calendar import monthrange
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Employee, Leave
from app.schemas import LeaveCreateRequest


def create_leave(db: Session, payload: LeaveCreateRequest) -> Leave:
    employee = db.get(Employee, payload.employee_id)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")

    if payload.end_date < payload.start_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="end_date must be greater than or equal to start_date",
        )

    leave = Leave(
        employee_id=payload.employee_id,
        start_date=payload.start_date,
        end_date=payload.end_date,
        type=payload.type,
        status=payload.status,
        note=payload.note,
    )
    db.add(leave)
    db.commit()
    db.refresh(leave)
    return leave


def list_leaves(
    db: Session,
    *,
    employee_id: int | None,
    year: int | None,
    month: int | None,
) -> list[Leave]:
    if (year is None) != (month is None):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="year and month must be provided together",
        )

    stmt = select(Leave).order_by(Leave.start_date.asc(), Leave.id.asc())
    if employee_id is not None:
        stmt = stmt.where(Leave.employee_id == employee_id)

    if year is not None and month is not None:
        days_in_month = monthrange(year, month)[1]
        start = date(year, month, 1)
        end = date(year, month, days_in_month)
        stmt = stmt.where(
            Leave.start_date <= end,
            Leave.end_date >= start,
        )

    return list(db.scalars(stmt).all())


def delete_leave(db: Session, leave_id: int) -> None:
    leave = db.get(Leave, leave_id)
    if leave is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Leave not found")

    db.delete(leave)
    db.commit()
