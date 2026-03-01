from __future__ import annotations

from collections import defaultdict
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import DepartmentShift, DepartmentWeekdayShiftAssignment, Employee


def normalize_shift_ids(raw_shift_ids: list[int] | None) -> list[int]:
    normalized: list[int] = []
    seen: set[int] = set()
    for raw_shift_id in raw_shift_ids or []:
        shift_id = int(raw_shift_id)
        if shift_id <= 0 or shift_id in seen:
            continue
        seen.add(shift_id)
        normalized.append(shift_id)
    return normalized


def list_department_weekday_shift_assignments(
    db: Session,
    *,
    department_id: int | None = None,
    department_ids: list[int] | None = None,
    weekday: int | None = None,
    active_only: bool = True,
) -> list[DepartmentWeekdayShiftAssignment]:
    stmt = (
        select(DepartmentWeekdayShiftAssignment)
        .options(selectinload(DepartmentWeekdayShiftAssignment.shift))
        .order_by(
            DepartmentWeekdayShiftAssignment.department_id.asc(),
            DepartmentWeekdayShiftAssignment.weekday.asc(),
            DepartmentWeekdayShiftAssignment.sort_order.asc(),
            DepartmentWeekdayShiftAssignment.id.asc(),
        )
    )
    if department_id is not None:
        stmt = stmt.where(DepartmentWeekdayShiftAssignment.department_id == department_id)
    if department_ids:
        stmt = stmt.where(DepartmentWeekdayShiftAssignment.department_id.in_(department_ids))
    if weekday is not None:
        stmt = stmt.where(DepartmentWeekdayShiftAssignment.weekday == weekday)
    if active_only:
        stmt = stmt.where(DepartmentWeekdayShiftAssignment.is_active.is_(True))
    return list(db.scalars(stmt).all())


def build_department_weekday_shift_map(
    assignments: list[DepartmentWeekdayShiftAssignment],
) -> dict[int, dict[int, list[DepartmentShift]]]:
    department_map: dict[int, dict[int, list[DepartmentShift]]] = defaultdict(lambda: defaultdict(list))
    for assignment in assignments:
        shift = assignment.shift
        if shift is None or not assignment.is_active or not shift.is_active:
            continue
        department_map[assignment.department_id][assignment.weekday].append(shift)
    return department_map


def resolve_department_weekday_shifts(
    db: Session,
    *,
    department_id: int | None,
    weekday: int,
) -> list[DepartmentShift]:
    if department_id is None:
        return []
    assignments = list_department_weekday_shift_assignments(
        db,
        department_id=department_id,
        weekday=weekday,
        active_only=True,
    )
    shifts: list[DepartmentShift] = []
    for assignment in assignments:
        shift = assignment.shift
        if shift is None or not shift.is_active:
            continue
        shifts.append(shift)
    return shifts


def resolve_employee_day_shift_candidates(
    db: Session,
    *,
    employee: Employee,
    day_date: date,
) -> list[DepartmentShift]:
    return resolve_department_weekday_shifts(
        db,
        department_id=employee.department_id,
        weekday=day_date.weekday(),
    )


def select_employee_preferred_shift(
    *,
    employee: Employee,
    shifts: list[DepartmentShift],
) -> DepartmentShift | None:
    if not shifts:
        return None
    if employee.shift_id is not None:
        for shift in shifts:
            if shift.id == employee.shift_id:
                return shift
    if len(shifts) == 1:
        return shifts[0]
    return None
