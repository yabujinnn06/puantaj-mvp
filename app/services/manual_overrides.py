from __future__ import annotations

from functools import lru_cache
from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import DepartmentShift, Employee, ManualDayOverride
from app.schemas import ManualDayOverrideUpsertRequest
from app.settings import get_settings


@lru_cache
def _attendance_timezone() -> ZoneInfo:
    raw_name = (get_settings().attendance_timezone or "").strip() or "Europe/Istanbul"
    try:
        return ZoneInfo(raw_name)
    except Exception:
        return ZoneInfo("Europe/Istanbul")


def _ensure_employee_exists(db: Session, employee_id: int) -> Employee:
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")
    return employee


def _parse_hhmm(value: str) -> time:
    hour_str, minute_str = value.split(":")
    hour = int(hour_str)
    minute = int(minute_str)
    if hour < 0 or hour > 23 or minute < 0 or minute > 59:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid time format")
    return time(hour=hour, minute=minute)


def _combine_utc(day_date: date, hhmm: str | None) -> datetime | None:
    if hhmm is None:
        return None
    parsed_time = _parse_hhmm(hhmm)
    local_dt = datetime.combine(day_date, parsed_time, tzinfo=_attendance_timezone())
    return local_dt.astimezone(timezone.utc)


def upsert_manual_day_override(
    db: Session,
    *,
    employee_id: int,
    payload: ManualDayOverrideUpsertRequest,
    created_by: str,
) -> ManualDayOverride:
    employee = _ensure_employee_exists(db, employee_id)

    if payload.is_absent:
        in_ts = None
        out_ts = None
    else:
        in_ts = _combine_utc(payload.day_date, payload.in_time)
        out_ts = _combine_utc(payload.day_date, payload.out_time)
        if in_ts is not None and out_ts is not None and out_ts < in_ts:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Out time must be greater than or equal to in time",
            )

    override = db.scalar(
        select(ManualDayOverride).where(
            ManualDayOverride.employee_id == employee_id,
            ManualDayOverride.day_date == payload.day_date,
        )
    )
    rule_source_override = None if payload.rule_source_override == "AUTO" else payload.rule_source_override
    rule_shift_id_override: int | None = None
    if payload.rule_shift_id_override is not None:
        shift = db.get(DepartmentShift, payload.rule_shift_id_override)
        if shift is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department shift not found")
        if employee.department_id is None or shift.department_id != employee.department_id:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Shift does not belong to employee department")
        rule_shift_id_override = shift.id
    if rule_source_override != "SHIFT":
        rule_shift_id_override = None
    if override is None:
        override = ManualDayOverride(
            employee_id=employee_id,
            day_date=payload.day_date,
            in_ts=in_ts,
            out_ts=out_ts,
            is_absent=payload.is_absent,
            rule_source_override=rule_source_override,
            rule_shift_id_override=rule_shift_id_override,
            note=payload.note,
            created_by=created_by,
        )
        db.add(override)
    else:
        override.in_ts = in_ts
        override.out_ts = out_ts
        override.is_absent = payload.is_absent
        override.rule_source_override = rule_source_override
        override.rule_shift_id_override = rule_shift_id_override
        override.note = payload.note
        override.created_by = created_by

    db.commit()
    db.refresh(override)
    return override


def list_manual_day_overrides(
    db: Session,
    *,
    employee_id: int,
    year: int,
    month: int,
) -> list[ManualDayOverride]:
    _ensure_employee_exists(db, employee_id)

    start_date = date(year, month, 1)
    if month == 12:
        end_date = date(year + 1, 1, 1)
    else:
        end_date = date(year, month + 1, 1)

    return list(
        db.scalars(
            select(ManualDayOverride)
            .where(
                ManualDayOverride.employee_id == employee_id,
                ManualDayOverride.day_date >= start_date,
                ManualDayOverride.day_date < end_date,
            )
            .order_by(ManualDayOverride.day_date.asc(), ManualDayOverride.id.asc())
        ).all()
    )


def delete_manual_day_override(db: Session, override_id: int) -> None:
    override = db.get(ManualDayOverride, override_id)
    if override is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Manual override not found")
    db.delete(override)
    db.commit()
