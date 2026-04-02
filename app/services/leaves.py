from __future__ import annotations

from calendar import monthrange
from datetime import date, datetime, timezone
import logging

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Device, Employee, Leave, LeaveStatus, LeaveType
from app.schemas import (
    EmployeeLeaveRequestCreate,
    LeaveCreateRequest,
    LeaveDecisionRequest,
)
from app.services.push_notifications import send_push_to_admins, send_push_to_employees

logger = logging.getLogger("app.leaves")

_LEAVE_TYPE_LABELS: dict[LeaveType, str] = {
    LeaveType.ANNUAL: "yillik izin",
    LeaveType.SICK: "rapor",
    LeaveType.UNPAID: "ucretsiz izin",
    LeaveType.EXCUSE: "mazeret izni",
    LeaveType.PUBLIC_HOLIDAY: "resmi tatil",
}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _validate_leave_range(*, start_date: date, end_date: date) -> None:
    if end_date < start_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="end_date must be greater than or equal to start_date",
        )


def _leave_type_label(value: LeaveType) -> str:
    return _LEAVE_TYPE_LABELS.get(value, value.value.lower())


def _trimmed_text(value: str | None) -> str | None:
    normalized = (value or "").strip()
    return normalized or None


def _get_employee_or_404(db: Session, *, employee_id: int) -> Employee:
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")
    return employee


def _get_active_employee_by_device(db: Session, *, device_fingerprint: str) -> tuple[Employee, Device]:
    device = db.scalar(
        select(Device).where(
            Device.device_fingerprint == device_fingerprint,
            Device.is_active.is_(True),
        )
    )
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not claimed")

    employee = device.employee or db.get(Employee, device.employee_id)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")
    if not employee.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Inactive employee cannot request leave",
        )
    return employee, device


def _find_overlapping_leave(
    db: Session,
    *,
    employee_id: int,
    start_date: date,
    end_date: date,
    exclude_leave_id: int | None = None,
) -> Leave | None:
    stmt = select(Leave).where(
        Leave.employee_id == employee_id,
        Leave.start_date <= end_date,
        Leave.end_date >= start_date,
        Leave.status.in_([LeaveStatus.PENDING, LeaveStatus.APPROVED]),
    )
    if exclude_leave_id is not None:
        stmt = stmt.where(Leave.id != exclude_leave_id)
    return db.scalar(stmt)


def _notify_admins_about_leave_request(db: Session, *, leave: Leave, employee: Employee) -> None:
    start_text = leave.start_date.isoformat()
    end_text = leave.end_date.isoformat()
    type_label = _leave_type_label(leave.type)
    body = f"{employee.full_name} {start_text} - {end_text} tarihleri icin {type_label} talebi gonderdi."
    try:
        send_push_to_admins(
            db,
            title="Yeni izin talebi",
            body=body,
            data={
                "type": "LEAVE_REQUEST",
                "leave_id": leave.id,
                "employee_id": employee.id,
                "url": "/admin-panel/leaves",
            },
        )
    except Exception:
        logger.exception("leave_request_admin_push_failed", extra={"leave_id": leave.id, "employee_id": employee.id})


def _notify_employee_about_leave_decision(db: Session, *, leave: Leave, employee: Employee) -> None:
    start_text = leave.start_date.isoformat()
    end_text = leave.end_date.isoformat()
    type_label = _leave_type_label(leave.type)
    if leave.status == LeaveStatus.APPROVED:
        title = "Izin talebin onaylandi"
        body = f"{start_text} - {end_text} tarihleri icin {type_label} talebin onaylandi."
    else:
        title = "Izin talebin reddedildi"
        reason = _trimmed_text(leave.decision_note)
        reason_text = f" Sebep: {reason}." if reason else ""
        body = f"{start_text} - {end_text} tarihleri icin {type_label} talebin reddedildi.{reason_text}"

    try:
        send_push_to_employees(
            db,
            employee_ids=[employee.id],
            title=title,
            body=body,
            data={
                "type": "LEAVE_DECISION",
                "leave_id": leave.id,
                "employee_id": employee.id,
                "status": leave.status.value,
                "url": "/employee/",
            },
        )
    except Exception:
        logger.exception(
            "leave_decision_employee_push_failed",
            extra={"leave_id": leave.id, "employee_id": employee.id, "status": leave.status.value},
        )


def create_leave(db: Session, payload: LeaveCreateRequest) -> Leave:
    _get_employee_or_404(db, employee_id=payload.employee_id)
    _validate_leave_range(start_date=payload.start_date, end_date=payload.end_date)

    leave = Leave(
        employee_id=payload.employee_id,
        start_date=payload.start_date,
        end_date=payload.end_date,
        type=payload.type,
        status=payload.status,
        note=_trimmed_text(payload.note),
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
    status_filter: LeaveStatus | None = None,
    requested_by_employee: bool | None = None,
) -> list[Leave]:
    if (year is None) != (month is None):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="year and month must be provided together",
        )

    stmt = select(Leave).order_by(Leave.start_date.asc(), Leave.id.asc())
    if employee_id is not None:
        stmt = stmt.where(Leave.employee_id == employee_id)
    if status_filter is not None:
        stmt = stmt.where(Leave.status == status_filter)
    if requested_by_employee is not None:
        stmt = stmt.where(Leave.requested_by_employee.is_(requested_by_employee))

    if year is not None and month is not None:
        days_in_month = monthrange(year, month)[1]
        start = date(year, month, 1)
        end = date(year, month, days_in_month)
        stmt = stmt.where(
            Leave.start_date <= end,
            Leave.end_date >= start,
        )

    return list(db.scalars(stmt).all())


def create_employee_leave_request(db: Session, payload: EmployeeLeaveRequestCreate) -> Leave:
    _validate_leave_range(start_date=payload.start_date, end_date=payload.end_date)
    employee, _device = _get_active_employee_by_device(
        db,
        device_fingerprint=payload.device_fingerprint,
    )
    overlapping_leave = _find_overlapping_leave(
        db,
        employee_id=employee.id,
        start_date=payload.start_date,
        end_date=payload.end_date,
    )
    if overlapping_leave is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="There is already an overlapping approved or pending leave for this employee.",
        )

    leave = Leave(
        employee_id=employee.id,
        start_date=payload.start_date,
        end_date=payload.end_date,
        type=payload.type,
        status=LeaveStatus.PENDING,
        note=_trimmed_text(payload.note),
        requested_by_employee=True,
    )
    db.add(leave)
    db.commit()
    db.refresh(leave)
    _notify_admins_about_leave_request(db, leave=leave, employee=employee)
    return leave


def decide_leave(
    db: Session,
    *,
    leave_id: int,
    payload: LeaveDecisionRequest,
) -> Leave:
    leave = db.get(Leave, leave_id)
    if leave is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Leave not found")

    _validate_leave_range(start_date=leave.start_date, end_date=leave.end_date)
    if payload.status == LeaveStatus.APPROVED:
        overlapping_leave = _find_overlapping_leave(
            db,
            employee_id=leave.employee_id,
            start_date=leave.start_date,
            end_date=leave.end_date,
            exclude_leave_id=leave.id,
        )
        if overlapping_leave is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This leave overlaps with another approved or pending leave.",
            )

    leave.status = payload.status
    leave.decision_note = _trimmed_text(payload.decision_note)
    leave.decided_at = _utcnow()
    db.commit()
    db.refresh(leave)

    employee = leave.employee or _get_employee_or_404(db, employee_id=leave.employee_id)
    _notify_employee_about_leave_decision(db, leave=leave, employee=employee)
    return leave


def delete_leave(db: Session, leave_id: int) -> None:
    leave = db.get(Leave, leave_id)
    if leave is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Leave not found")

    db.delete(leave)
    db.commit()
