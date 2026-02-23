from __future__ import annotations

from calendar import monthrange
from dataclasses import dataclass
from functools import lru_cache
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    AttendanceEvent,
    AttendanceEventSource,
    AttendanceType,
    Department,
    DepartmentSchedulePlan,
    DepartmentShift,
    DepartmentWeeklyRule,
    Employee,
    LaborProfile,
    Leave,
    LeaveStatus,
    LeaveType,
    ManualDayOverride,
    OvertimeRoundingMode,
    WorkRule,
)
from app.schemas import (
    DepartmentMonthlySummaryItem,
    LaborProfileRead,
    MonthlyEmployeeDay,
    MonthlyEmployeeResponse,
    MonthlyEmployeeTotals,
    MonthlyEmployeeWeek,
)
from app.settings import get_settings
from app.services.monthly_calc import calculate_day_metrics
from app.services.schedule_plans import list_department_plans_in_range, resolve_best_plan_for_day

DEFAULT_DAILY_MINUTES_PLANNED = 540
DEFAULT_BREAK_MINUTES = 60
DEFAULT_WEEKLY_NORMAL_MINUTES = 45 * 60
DEFAULT_DAILY_MAX_MINUTES = 11 * 60
DEFAULT_NIGHT_WORK_MAX_MINUTES = int(7.5 * 60)
DEFAULT_OVERTIME_ANNUAL_CAP_MINUTES = 270 * 60
DEFAULT_OVERTIME_PREMIUM = 1.50
DEFAULT_EXTRA_WORK_PREMIUM = 1.25

_COMPLIANCE_FLAGS = {
    "DAILY_MAX_EXCEEDED",
    "MIN_BREAK_NOT_MET",
    "NIGHT_WORK_EXCEEDED",
    "ANNUAL_OVERTIME_CAP_EXCEEDED",
}


@dataclass
class _InternalDayRecord:
    day_date: date
    status: str
    check_in: datetime | None
    check_out: datetime | None
    check_in_lat: float | None
    check_in_lon: float | None
    check_out_lat: float | None
    check_out_lon: float | None
    worked_minutes: int
    overtime_minutes: int
    missing_minutes: int
    rule_source: str
    applied_planned_minutes: int
    applied_break_minutes: int
    leave_type: LeaveType | None
    shift_id: int | None
    shift_name: str | None
    flags: list[str]


@dataclass
class _InternalWeekSummary:
    week_start: date
    week_end: date
    normal_minutes: int
    extra_work_minutes: int
    overtime_minutes: int
    flags: list[str]


def _build_daily_legal_breakdown(
    day_records: list[_InternalDayRecord],
    *,
    contract_weekly_minutes: int | None,
    weekly_normal_minutes: int,
    weekly_summaries: list[_InternalWeekSummary],
) -> dict[date, tuple[int, int]]:
    _ = (contract_weekly_minutes, weekly_normal_minutes, weekly_summaries)
    result: dict[date, tuple[int, int]] = {}
    for record in day_records:
        plan_overtime_minutes = max(0, int(record.overtime_minutes))
        result[record.day_date] = (0, plan_overtime_minutes)
    return result


def _month_bounds(year: int, month: int) -> tuple[datetime, datetime, int]:
    days_in_month = monthrange(year, month)[1]
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    end = start + timedelta(days=days_in_month)
    return start, end, days_in_month


@lru_cache
def _attendance_timezone() -> ZoneInfo:
    raw_name = (get_settings().attendance_timezone or "").strip() or "Europe/Istanbul"
    try:
        return ZoneInfo(raw_name)
    except Exception:
        return ZoneInfo("Europe/Istanbul")


def _local_date_from_utc(ts_utc: datetime) -> date:
    if ts_utc.tzinfo is None:
        ts_utc = ts_utc.replace(tzinfo=timezone.utc)
    return ts_utc.astimezone(_attendance_timezone()).date()


def _local_date_range_to_utc_bounds(start_date: date, end_date: date) -> tuple[datetime, datetime]:
    tz = _attendance_timezone()
    start_local = datetime.combine(start_date, datetime.min.time(), tzinfo=tz)
    end_local = datetime.combine(end_date + timedelta(days=1), datetime.min.time(), tzinfo=tz)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)


def _resolve_work_rule(db: Session, department_id: int | None) -> tuple[int, int]:
    if department_id is None:
        return DEFAULT_DAILY_MINUTES_PLANNED, DEFAULT_BREAK_MINUTES

    rule = db.scalar(select(WorkRule).where(WorkRule.department_id == department_id))
    if rule is None:
        return DEFAULT_DAILY_MINUTES_PLANNED, DEFAULT_BREAK_MINUTES
    return rule.daily_minutes_planned, rule.break_minutes


def _resolve_weekly_rule_map(db: Session, department_id: int | None) -> dict[int, DepartmentWeeklyRule]:
    if department_id is None:
        return {}
    rows = list(
        db.scalars(
            select(DepartmentWeeklyRule).where(DepartmentWeeklyRule.department_id == department_id)
        ).all()
    )
    return {item.weekday: item for item in rows}


def _resolve_department_shift_map(
    db: Session,
    department_id: int | None,
    *,
    include_inactive: bool = False,
) -> dict[int, DepartmentShift]:
    if department_id is None:
        return {}
    stmt = select(DepartmentShift).where(DepartmentShift.department_id == department_id)
    if not include_inactive:
        stmt = stmt.where(DepartmentShift.is_active.is_(True))
    rows = list(db.scalars(stmt).all())
    return {item.id: item for item in rows}


def _shift_planned_minutes(shift: DepartmentShift) -> int:
    start_minutes = shift.start_time_local.hour * 60 + shift.start_time_local.minute
    end_minutes = shift.end_time_local.hour * 60 + shift.end_time_local.minute
    gross = end_minutes - start_minutes
    if gross <= 0:
        gross += 24 * 60
    return max(0, gross - max(0, shift.break_minutes))


def _rule_planned_minutes(planned_minutes: int, break_minutes: int) -> int:
    # WorkRule/weekly plan values are gross minutes; daily target must be net.
    return max(0, max(0, planned_minutes) - max(0, break_minutes))


def _event_shift_id(event: AttendanceEvent | None) -> int | None:
    if event is None or not event.flags:
        return None
    raw = event.flags.get("SHIFT_ID")
    if isinstance(raw, int):
        return raw
    if isinstance(raw, str) and raw.isdigit():
        return int(raw)
    return None


def _resolve_day_shift(
    *,
    employee: Employee,
    first_in: AttendanceEvent | None,
    last_out: AttendanceEvent | None,
    shifts_by_id: dict[int, DepartmentShift],
) -> DepartmentShift | None:
    for event in (first_in, last_out):
        shift_id = _event_shift_id(event)
        if shift_id is not None and shift_id in shifts_by_id:
            return shifts_by_id[shift_id]
    if employee.shift_id is not None and employee.shift_id in shifts_by_id:
        return shifts_by_id[employee.shift_id]
    return None


def _resolve_event_shift(
    *,
    first_in: AttendanceEvent | None,
    last_out: AttendanceEvent | None,
    shifts_by_id: dict[int, DepartmentShift],
) -> DepartmentShift | None:
    for event in (first_in, last_out):
        shift_id = _event_shift_id(event)
        if shift_id is not None and shift_id in shifts_by_id:
            return shifts_by_id[shift_id]
    return None


def _resolve_labor_profile(db: Session) -> LaborProfile | None:
    return db.scalar(select(LaborProfile).order_by(LaborProfile.id.asc()))


def _profile_weekly_normal_minutes(profile: LaborProfile | None) -> int:
    return profile.weekly_normal_minutes_default if profile else DEFAULT_WEEKLY_NORMAL_MINUTES


def _profile_daily_max_minutes(profile: LaborProfile | None) -> int:
    return profile.daily_max_minutes if profile else DEFAULT_DAILY_MAX_MINUTES


def _profile_break_enforced(profile: LaborProfile | None) -> bool:
    return profile.enforce_min_break_rules if profile else False


def _profile_night_work_max_minutes(profile: LaborProfile | None) -> int:
    return profile.night_work_max_minutes_default if profile else DEFAULT_NIGHT_WORK_MAX_MINUTES


def _profile_annual_cap_minutes(profile: LaborProfile | None) -> int:
    return profile.overtime_annual_cap_minutes if profile else DEFAULT_OVERTIME_ANNUAL_CAP_MINUTES


def _profile_rounding_mode(profile: LaborProfile | None) -> OvertimeRoundingMode:
    return profile.overtime_rounding_mode if profile else OvertimeRoundingMode.OFF


def _collect_flag_names(first_in: AttendanceEvent | None, last_out: AttendanceEvent | None) -> list[str]:
    flags: set[str] = set()
    for event in (first_in, last_out):
        if event is None:
            continue
        if event.flags:
            for key, value in event.flags.items():
                if isinstance(value, bool) and value:
                    flags.add(key)
        if event.source == AttendanceEventSource.MANUAL or event.created_by_admin:
            flags.add("MANUAL_EVENT")

    if first_in is None:
        flags.add("MISSING_IN")
    if last_out is None:
        flags.add("MISSING_OUT")
    return sorted(flags)


def _event_is_night_shift(first_in: AttendanceEvent | None, last_out: AttendanceEvent | None) -> bool:
    for event in (first_in, last_out):
        if event is None or not event.flags:
            continue
        if bool(event.flags.get("IS_NIGHT_SHIFT")) or bool(event.flags.get("NIGHT_SHIFT")):
            return True
    return False


def _resolve_day_event_pair(
    *,
    day_date: date,
    events_by_day: dict[date, dict[str, list[AttendanceEvent]]],
    consumed_out_event_ids: set[int],
) -> tuple[AttendanceEvent | None, AttendanceEvent | None, bool, bool]:
    day_bucket = events_by_day.get(day_date, {"IN": [], "OUT": []})
    day_in_events = day_bucket["IN"]
    day_out_events = [event for event in day_bucket["OUT"] if event.id not in consumed_out_event_ids]
    day_events = sorted(
        [*day_in_events, *day_out_events],
        key=lambda event: (event.ts_utc, event.id),
    )

    first_in = day_in_events[0] if day_in_events else None
    if first_in is not None:
        eligible_same_day_outs = [event for event in day_out_events if event.ts_utc >= first_in.ts_utc]
        last_out = eligible_same_day_outs[-1] if eligible_same_day_outs else None
    else:
        last_out = day_out_events[-1] if day_out_events else None

    used_cross_midnight_checkout = False
    if first_in is not None and last_out is None:
        next_day = day_date + timedelta(days=1)
        next_day_bucket = events_by_day.get(next_day, {"IN": [], "OUT": []})
        next_day_first_in = next_day_bucket["IN"][0] if next_day_bucket["IN"] else None
        for candidate_out in next_day_bucket["OUT"]:
            if candidate_out.id in consumed_out_event_ids:
                continue
            if candidate_out.ts_utc <= first_in.ts_utc:
                continue
            if next_day_first_in is not None and candidate_out.ts_utc >= next_day_first_in.ts_utc:
                continue
            last_out = candidate_out
            consumed_out_event_ids.add(candidate_out.id)
            used_cross_midnight_checkout = True
            break

    open_shift_active = False
    if day_events:
        latest_event = day_events[-1]
        if latest_event.type == AttendanceType.IN:
            if last_out is None or latest_event.ts_utc > last_out.ts_utc:
                open_shift_active = True

    return first_in, last_out, used_cross_midnight_checkout, open_shift_active


def _to_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _append_compliance_flags(flags: list[str], *, daily_max_exceeded: bool, min_break_not_met: bool, night_work_exceeded: bool) -> list[str]:
    values = list(flags)
    if daily_max_exceeded:
        values.append("DAILY_MAX_EXCEEDED")
    if min_break_not_met:
        values.append("MIN_BREAK_NOT_MET")
    if night_work_exceeded:
        values.append("NIGHT_WORK_EXCEEDED")
    return sorted(set(values))


def _resolve_day_rule_values(
    *,
    base_planned_minutes: int,
    base_break_minutes: int,
    weekday_rule: DepartmentWeeklyRule | None,
    day_shift: DepartmentShift | None,
    manual_rule_source_override: str | None,
    manual_rule_shift: DepartmentShift | None,
) -> tuple[str, int, int, bool, list[str], bool]:
    source_flags: list[str] = []

    weekly_planned_minutes = _rule_planned_minutes(base_planned_minutes, base_break_minutes)
    weekly_break_minutes = base_break_minutes
    weekly_is_workday = True
    if weekday_rule is not None:
        weekly_break_minutes = weekday_rule.break_minutes
        weekly_planned_minutes = _rule_planned_minutes(weekday_rule.planned_minutes, weekly_break_minutes)
        weekly_is_workday = weekday_rule.is_workday

    shift_planned_minutes = _shift_planned_minutes(day_shift) if day_shift is not None else weekly_planned_minutes
    shift_break_minutes = day_shift.break_minutes if day_shift is not None else weekly_break_minutes

    has_shift_weekly_rule_conflict = (
        day_shift is not None
        and weekday_rule is not None
        and (
            (not weekday_rule.is_workday)
            or (_rule_planned_minutes(weekday_rule.planned_minutes, weekday_rule.break_minutes) != shift_planned_minutes)
            or (weekday_rule.break_minutes != shift_break_minutes)
        )
    )

    if day_shift is not None:
        applied_source = "SHIFT"
        applied_planned_minutes = shift_planned_minutes
        applied_break_minutes = shift_break_minutes
        applied_is_workday = True
    elif weekday_rule is not None:
        applied_source = "WEEKLY"
        applied_planned_minutes = weekly_planned_minutes
        applied_break_minutes = weekly_break_minutes
        applied_is_workday = weekly_is_workday
    else:
        applied_source = "WORK_RULE"
        applied_planned_minutes = _rule_planned_minutes(base_planned_minutes, base_break_minutes)
        applied_break_minutes = base_break_minutes
        applied_is_workday = True

    override_source = (manual_rule_source_override or "").strip().upper()
    if override_source:
        if override_source == "SHIFT":
            selected_shift = manual_rule_shift or day_shift
            if selected_shift is None:
                source_flags.append("RULE_OVERRIDE_INVALID")
            else:
                applied_source = "SHIFT"
                applied_planned_minutes = _shift_planned_minutes(selected_shift)
                applied_break_minutes = selected_shift.break_minutes
                applied_is_workday = True
                source_flags.append("RULE_SOURCE_MANUAL_OVERRIDE")
        elif override_source == "WEEKLY":
            if weekday_rule is None:
                source_flags.append("RULE_OVERRIDE_INVALID")
            else:
                applied_source = "WEEKLY"
                applied_planned_minutes = weekly_planned_minutes
                applied_break_minutes = weekly_break_minutes
                applied_is_workday = weekly_is_workday
                source_flags.append("RULE_SOURCE_MANUAL_OVERRIDE")
        elif override_source == "WORK_RULE":
            applied_source = "WORK_RULE"
            applied_planned_minutes = _rule_planned_minutes(base_planned_minutes, base_break_minutes)
            applied_break_minutes = base_break_minutes
            applied_is_workday = True
            source_flags.append("RULE_SOURCE_MANUAL_OVERRIDE")
        else:
            source_flags.append("RULE_OVERRIDE_INVALID")

    return (
        applied_source,
        applied_planned_minutes,
        applied_break_minutes,
        applied_is_workday,
        source_flags,
        has_shift_weekly_rule_conflict,
    )


def _build_day_records(
    db: Session,
    *,
    employee: Employee,
    start_date: date,
    end_date: date,
    planned_minutes: int,
    break_minutes: int,
    labor_profile: LaborProfile | None,
) -> list[_InternalDayRecord]:
    start_dt, end_dt = _local_date_range_to_utc_bounds(start_date, end_date)

    # Do not hide historical events when a device is later deactivated/replaced.
    # Puantaj is an immutable attendance history; device active state is real-time auth concern.
    events = list(
        db.scalars(
            select(AttendanceEvent)
            .where(
                AttendanceEvent.employee_id == employee.id,
                AttendanceEvent.ts_utc >= start_dt,
                AttendanceEvent.ts_utc < end_dt,
                AttendanceEvent.deleted_at.is_(None),
            )
            .order_by(AttendanceEvent.ts_utc.asc(), AttendanceEvent.id.asc())
        ).all()
    )

    events_by_day: dict[date, dict[str, list[AttendanceEvent]]] = {}
    for event in events:
        event_day = _local_date_from_utc(event.ts_utc)
        day_bucket = events_by_day.setdefault(event_day, {"IN": [], "OUT": []})
        if event.type == AttendanceType.IN:
            day_bucket["IN"].append(event)
        else:
            day_bucket["OUT"].append(event)

    approved_leaves = list(
        db.scalars(
            select(Leave)
            .where(
                Leave.employee_id == employee.id,
                Leave.status == LeaveStatus.APPROVED,
                Leave.start_date <= end_date,
                Leave.end_date >= start_date,
            )
            .order_by(Leave.start_date.asc(), Leave.id.asc())
        ).all()
    )
    leave_type_by_day: dict[date, LeaveType] = {}
    for leave in approved_leaves:
        cursor = leave.start_date
        while cursor <= leave.end_date:
            if start_date <= cursor <= end_date and cursor not in leave_type_by_day:
                leave_type_by_day[cursor] = leave.type
            cursor += timedelta(days=1)

    manual_overrides = list(
        db.scalars(
            select(ManualDayOverride)
            .where(
                ManualDayOverride.employee_id == employee.id,
                ManualDayOverride.day_date >= start_date,
                ManualDayOverride.day_date <= end_date,
            )
            .order_by(ManualDayOverride.day_date.asc(), ManualDayOverride.id.desc())
        ).all()
    )
    manual_override_by_day: dict[date, ManualDayOverride] = {}
    for override in manual_overrides:
        manual_override_by_day[override.day_date] = override

    daily_max_minutes = _profile_daily_max_minutes(labor_profile)
    night_work_max_minutes = _profile_night_work_max_minutes(labor_profile)
    enforce_min_break = _profile_break_enforced(labor_profile)
    weekly_rule_map = _resolve_weekly_rule_map(db, employee.department_id)
    department_shift_map = _resolve_department_shift_map(
        db,
        employee.department_id,
        include_inactive=True,
    )
    department_plans = list_department_plans_in_range(
        db,
        department_id=employee.department_id,
        start_date=start_date,
        end_date=end_date,
    )

    records: list[_InternalDayRecord] = []
    consumed_out_event_ids: set[int] = set()
    cursor = start_date
    while cursor <= end_date:
        leave_type = leave_type_by_day.get(cursor)
        first_in, last_out, used_cross_midnight_checkout, open_shift_active = _resolve_day_event_pair(
            day_date=cursor,
            events_by_day=events_by_day,
            consumed_out_event_ids=consumed_out_event_ids,
        )
        manual_override = manual_override_by_day.get(cursor)
        schedule_plan = resolve_best_plan_for_day(
            department_plans,
            employee_id=employee.id,
            day_date=cursor,
        )
        weekday_rule = weekly_rule_map.get(cursor.weekday())

        base_planned_minutes = (
            schedule_plan.daily_minutes_planned
            if schedule_plan is not None and schedule_plan.daily_minutes_planned is not None
            else planned_minutes
        )
        base_break_minutes = (
            schedule_plan.break_minutes
            if schedule_plan is not None and schedule_plan.break_minutes is not None
            else break_minutes
        )

        event_shift = _resolve_event_shift(
            first_in=first_in,
            last_out=last_out,
            shifts_by_id=department_shift_map,
        )
        default_shift = _resolve_day_shift(
            employee=employee,
            first_in=first_in,
            last_out=last_out,
            shifts_by_id=department_shift_map,
        )
        planned_shift = (
            department_shift_map.get(schedule_plan.shift_id)
            if schedule_plan is not None and schedule_plan.shift_id is not None
            else None
        )
        day_shift = planned_shift or default_shift
        manual_rule_shift = (
            department_shift_map.get(manual_override.rule_shift_id_override)
            if manual_override is not None and manual_override.rule_shift_id_override is not None
            else None
        )
        (
            rule_source,
            day_planned_minutes,
            day_break_minutes,
            is_workday,
            rule_source_flags,
            has_shift_weekly_rule_conflict,
        ) = _resolve_day_rule_values(
            base_planned_minutes=base_planned_minutes,
            base_break_minutes=base_break_minutes,
            weekday_rule=weekday_rule,
            day_shift=day_shift,
            manual_rule_source_override=manual_override.rule_source_override if manual_override else None,
            manual_rule_shift=manual_rule_shift,
        )
        if schedule_plan is not None:
            rule_source_flags.append("SCHEDULE_PLAN_APPLIED")
            if schedule_plan.shift_id is not None:
                rule_source_flags.append("SCHEDULE_PLAN_SHIFT")
            if schedule_plan.daily_minutes_planned is not None or schedule_plan.break_minutes is not None:
                rule_source_flags.append("SCHEDULE_PLAN_RULE")
            if schedule_plan.is_locked:
                rule_source_flags.append("SCHEDULE_PLAN_LOCKED")
                if schedule_plan.shift_id is not None and event_shift is not None and event_shift.id != schedule_plan.shift_id:
                    rule_source_flags.append("PLANNED_SHIFT_VIOLATION")

        if manual_override is not None:
            first_in_ts = _to_utc(manual_override.in_ts)
            last_out_ts = _to_utc(manual_override.out_ts)

            if manual_override.is_absent:
                flags = ["ABSENT_MARKED", "MANUAL_OVERRIDE", "MISSING_IN", "MISSING_OUT", *rule_source_flags]
                if has_shift_weekly_rule_conflict:
                    flags.append("SHIFT_WEEKLY_RULE_OVERRIDE")
                records.append(
                    _InternalDayRecord(
                        day_date=cursor,
                        status="INCOMPLETE",
                        check_in=None,
                        check_out=None,
                        check_in_lat=None,
                        check_in_lon=None,
                        check_out_lat=None,
                        check_out_lon=None,
                        worked_minutes=0,
                        overtime_minutes=0,
                        missing_minutes=(day_planned_minutes if is_workday else 0),
                        rule_source=rule_source,
                        applied_planned_minutes=day_planned_minutes,
                        applied_break_minutes=day_break_minutes,
                        leave_type=None,
                        shift_id=day_shift.id if day_shift else None,
                        shift_name=day_shift.name if day_shift else None,
                        flags=sorted(set(flags)),
                    )
                )
            else:
                metrics = calculate_day_metrics(
                    first_in_ts=first_in_ts,
                    last_out_ts=last_out_ts,
                    planned_minutes=day_planned_minutes,
                    break_minutes=day_break_minutes,
                    daily_max_minutes=daily_max_minutes,
                    night_work_max_minutes=night_work_max_minutes,
                    enforce_min_break=enforce_min_break,
                    is_night_shift=False,
                )
                flags = ["MANUAL_OVERRIDE", *rule_source_flags]
                if first_in_ts is None:
                    flags.append("MISSING_IN")
                if last_out_ts is None:
                    flags.append("MISSING_OUT")
                if has_shift_weekly_rule_conflict:
                    flags.append("SHIFT_WEEKLY_RULE_OVERRIDE")
                missing_minutes = 0
                if (
                    metrics.status == "OK"
                    and is_workday
                    and metrics.worked_minutes_net < day_planned_minutes
                ):
                    missing_minutes = day_planned_minutes - metrics.worked_minutes_net
                    flags.append("UNDERWORKED")
                flags = _append_compliance_flags(
                    flags,
                    daily_max_exceeded=metrics.daily_max_exceeded,
                    min_break_not_met=metrics.min_break_not_met,
                    night_work_exceeded=metrics.night_work_exceeded,
                )
                records.append(
                    _InternalDayRecord(
                        day_date=cursor,
                        status=metrics.status,
                        check_in=first_in_ts,
                        check_out=last_out_ts,
                        check_in_lat=None,
                        check_in_lon=None,
                        check_out_lat=None,
                        check_out_lon=None,
                        worked_minutes=metrics.worked_minutes_net,
                        overtime_minutes=metrics.overtime_minutes,
                        missing_minutes=missing_minutes,
                        rule_source=rule_source,
                        applied_planned_minutes=day_planned_minutes,
                        applied_break_minutes=day_break_minutes,
                        leave_type=None,
                        shift_id=day_shift.id if day_shift else None,
                        shift_name=day_shift.name if day_shift else None,
                        flags=flags,
                    )
                )
        elif leave_type is not None:
            records.append(
                _InternalDayRecord(
                    day_date=cursor,
                    status="LEAVE",
                    check_in=None,
                    check_out=None,
                    check_in_lat=None,
                    check_in_lon=None,
                    check_out_lat=None,
                    check_out_lon=None,
                    worked_minutes=0,
                    overtime_minutes=0,
                    missing_minutes=0,
                    rule_source=rule_source,
                    applied_planned_minutes=day_planned_minutes,
                    applied_break_minutes=day_break_minutes,
                    leave_type=leave_type,
                    shift_id=day_shift.id if day_shift else None,
                    shift_name=day_shift.name if day_shift else None,
                    flags=["LEAVE_DAY"],
                )
            )
        elif not is_workday and first_in is None and last_out is None:
            records.append(
                _InternalDayRecord(
                    day_date=cursor,
                    status="OFF",
                    check_in=None,
                    check_out=None,
                    check_in_lat=None,
                    check_in_lon=None,
                    check_out_lat=None,
                    check_out_lon=None,
                    worked_minutes=0,
                    overtime_minutes=0,
                    missing_minutes=0,
                    rule_source=rule_source,
                    applied_planned_minutes=day_planned_minutes,
                    applied_break_minutes=day_break_minutes,
                    leave_type=None,
                    shift_id=day_shift.id if day_shift else None,
                    shift_name=day_shift.name if day_shift else None,
                    flags=["OFF_DAY"],
                )
            )
        else:
            flags = _collect_flag_names(first_in, last_out) + rule_source_flags
            if not is_workday:
                flags.append("OFF_DAY_WORKED")
            if has_shift_weekly_rule_conflict:
                flags.append("SHIFT_WEEKLY_RULE_OVERRIDE")
            if used_cross_midnight_checkout:
                flags.append("CROSS_MIDNIGHT_CHECKOUT")
            if open_shift_active:
                flags.append("OPEN_SHIFT_ACTIVE")
                flags.append("MISSING_OUT")
            metrics = calculate_day_metrics(
                first_in_ts=first_in.ts_utc if first_in else None,
                last_out_ts=last_out.ts_utc if last_out else None,
                planned_minutes=day_planned_minutes,
                break_minutes=day_break_minutes,
                daily_max_minutes=daily_max_minutes,
                night_work_max_minutes=night_work_max_minutes,
                enforce_min_break=enforce_min_break,
                is_night_shift=(
                    _event_is_night_shift(first_in, last_out)
                    or (
                        first_in is not None
                        and last_out is not None
                        and _local_date_from_utc(first_in.ts_utc) != _local_date_from_utc(last_out.ts_utc)
                    )
                ),
            )
            missing_minutes = 0
            if (
                metrics.status == "OK"
                and is_workday
                and metrics.worked_minutes_net < day_planned_minutes
            ):
                missing_minutes = day_planned_minutes - metrics.worked_minutes_net
                flags.append("UNDERWORKED")
            flags = _append_compliance_flags(
                flags,
                daily_max_exceeded=metrics.daily_max_exceeded,
                min_break_not_met=metrics.min_break_not_met,
                night_work_exceeded=metrics.night_work_exceeded,
            )
            day_status = "INCOMPLETE" if open_shift_active else metrics.status
            check_out_ts = None if open_shift_active else (last_out.ts_utc if last_out else None)
            check_out_lat = (
                None
                if open_shift_active
                else (last_out.lat if last_out and last_out.lat is not None else None)
            )
            check_out_lon = (
                None
                if open_shift_active
                else (last_out.lon if last_out and last_out.lon is not None else None)
            )
            records.append(
                _InternalDayRecord(
                    day_date=cursor,
                    status=day_status,
                    check_in=first_in.ts_utc if first_in else None,
                    check_out=check_out_ts,
                    check_in_lat=(first_in.lat if first_in and first_in.lat is not None else None),
                    check_in_lon=(first_in.lon if first_in and first_in.lon is not None else None),
                    check_out_lat=check_out_lat,
                    check_out_lon=check_out_lon,
                    worked_minutes=metrics.worked_minutes_net,
                    overtime_minutes=metrics.overtime_minutes,
                    missing_minutes=missing_minutes,
                    rule_source=rule_source,
                    applied_planned_minutes=day_planned_minutes,
                    applied_break_minutes=day_break_minutes,
                    leave_type=None,
                    shift_id=day_shift.id if day_shift else None,
                    shift_name=day_shift.name if day_shift else None,
                    flags=flags,
                )
            )

        cursor += timedelta(days=1)

    return records


def _build_weekly_summaries(
    day_records: list[_InternalDayRecord],
    *,
    contract_weekly_minutes: int | None,
    legal_weekly_minutes: int,
    rounding_mode: OvertimeRoundingMode,
) -> list[_InternalWeekSummary]:
    _ = (contract_weekly_minutes, legal_weekly_minutes, rounding_mode)
    week_buckets: dict[date, dict[str, object]] = {}
    for day in day_records:
        week_start = day.day_date - timedelta(days=day.day_date.weekday())
        bucket = week_buckets.setdefault(
            week_start,
            {"worked": 0, "plan_overtime": 0, "flags": set()},
        )
        bucket["worked"] = int(bucket["worked"]) + day.worked_minutes
        bucket["plan_overtime"] = int(bucket["plan_overtime"]) + max(0, int(day.overtime_minutes))
        bucket_flags = bucket["flags"]
        if isinstance(bucket_flags, set):
            for flag in day.flags:
                if flag in _COMPLIANCE_FLAGS:
                    bucket_flags.add(flag)

    summaries: list[_InternalWeekSummary] = []
    for week_start in sorted(week_buckets):
        bucket = week_buckets[week_start]
        worked = int(bucket["worked"])
        overtime = int(bucket["plan_overtime"])
        normal = max(0, worked - overtime)
        extra_work = 0
        flags = sorted(bucket["flags"]) if isinstance(bucket["flags"], set) else []
        summaries.append(
            _InternalWeekSummary(
                week_start=week_start,
                week_end=week_start + timedelta(days=6),
                normal_minutes=normal,
                extra_work_minutes=extra_work,
                overtime_minutes=overtime,
                flags=flags,
            )
        )
    return summaries


def _mark_annual_overtime_cap(
    weekly_summaries: list[_InternalWeekSummary],
    *,
    annual_cap_minutes: int,
) -> None:
    cumulative = 0
    for week in weekly_summaries:
        cumulative += week.overtime_minutes
        if cumulative > annual_cap_minutes and "ANNUAL_OVERTIME_CAP_EXCEEDED" not in week.flags:
            week.flags.append("ANNUAL_OVERTIME_CAP_EXCEEDED")
            week.flags.sort()


def _to_labor_profile_read(profile: LaborProfile | None) -> LaborProfileRead:
    now_utc = datetime.now(timezone.utc)
    if profile is None:
        return LaborProfileRead(
            id=0,
            name="TR_DEFAULT",
            weekly_normal_minutes_default=DEFAULT_WEEKLY_NORMAL_MINUTES,
            daily_max_minutes=DEFAULT_DAILY_MAX_MINUTES,
            enforce_min_break_rules=False,
            night_work_max_minutes_default=DEFAULT_NIGHT_WORK_MAX_MINUTES,
            night_work_exceptions_note_enabled=True,
            overtime_annual_cap_minutes=DEFAULT_OVERTIME_ANNUAL_CAP_MINUTES,
            overtime_premium=DEFAULT_OVERTIME_PREMIUM,
            extra_work_premium=DEFAULT_EXTRA_WORK_PREMIUM,
            overtime_rounding_mode=OvertimeRoundingMode.OFF,
            created_at=now_utc,
            updated_at=now_utc,
        )
    return LaborProfileRead.model_validate(profile)


def _employee_monthly_from_model(
    db: Session,
    employee: Employee,
    year: int,
    month: int,
) -> MonthlyEmployeeResponse:
    _, _, days_in_month = _month_bounds(year, month)
    month_start_date = date(year, month, 1)
    month_end_date = date(year, month, days_in_month)
    year_start_date = date(year, 1, 1)

    planned_minutes, break_minutes = _resolve_work_rule(db, employee.department_id)
    labor_profile = _resolve_labor_profile(db)

    year_day_records = _build_day_records(
        db,
        employee=employee,
        start_date=year_start_date,
        end_date=month_end_date,
        planned_minutes=planned_minutes,
        break_minutes=break_minutes,
        labor_profile=labor_profile,
    )
    month_day_records = [
        record
        for record in year_day_records
        if month_start_date <= record.day_date <= month_end_date
    ]

    legal_weekly_minutes = _profile_weekly_normal_minutes(labor_profile)
    effective_contract_weekly = employee.contract_weekly_minutes
    if effective_contract_weekly is None:
        effective_contract_weekly = legal_weekly_minutes
    effective_contract_weekly = min(effective_contract_weekly, legal_weekly_minutes)

    year_weekly = _build_weekly_summaries(
        year_day_records,
        contract_weekly_minutes=effective_contract_weekly,
        legal_weekly_minutes=legal_weekly_minutes,
        rounding_mode=_profile_rounding_mode(labor_profile),
    )
    daily_legal_breakdown = _build_daily_legal_breakdown(
        year_day_records,
        contract_weekly_minutes=effective_contract_weekly,
        weekly_normal_minutes=legal_weekly_minutes,
        weekly_summaries=year_weekly,
    )
    annual_cap_minutes = _profile_annual_cap_minutes(labor_profile)
    _mark_annual_overtime_cap(year_weekly, annual_cap_minutes=annual_cap_minutes)

    annual_overtime_used_minutes = sum(item.overtime_minutes for item in year_weekly)
    annual_overtime_remaining_minutes = max(0, annual_cap_minutes - annual_overtime_used_minutes)
    annual_overtime_cap_exceeded = annual_overtime_used_minutes > annual_cap_minutes

    monthly_weeks = [
        item
        for item in year_weekly
        if item.week_end >= month_start_date and item.week_start <= month_end_date
    ]
    annual_cap_week_starts = {
        item.week_start
        for item in monthly_weeks
        if "ANNUAL_OVERTIME_CAP_EXCEEDED" in item.flags
    }

    days: list[MonthlyEmployeeDay] = []
    incomplete_days = 0
    total_worked = 0
    total_plan_overtime = 0
    total_legal_extra_work = 0
    total_legal_overtime = 0
    for record in month_day_records:
        week_start = record.day_date - timedelta(days=record.day_date.weekday())
        day_flags = list(record.flags)
        if week_start in annual_cap_week_starts and "ANNUAL_OVERTIME_CAP_EXCEEDED" not in day_flags:
            day_flags.append("ANNUAL_OVERTIME_CAP_EXCEEDED")
            day_flags.sort()

        if record.status == "INCOMPLETE":
            incomplete_days += 1
        total_worked += record.worked_minutes
        total_plan_overtime += record.overtime_minutes
        legal_extra_work_minutes, legal_overtime_minutes = daily_legal_breakdown.get(record.day_date, (0, 0))
        total_legal_extra_work += legal_extra_work_minutes
        total_legal_overtime += legal_overtime_minutes

        days.append(
            MonthlyEmployeeDay(
                date=record.day_date,
                status=record.status,  # type: ignore[arg-type]
                check_in=record.check_in,
                check_out=record.check_out,
                check_in_lat=record.check_in_lat,
                check_in_lon=record.check_in_lon,
                check_out_lat=record.check_out_lat,
                check_out_lon=record.check_out_lon,
                worked_minutes=record.worked_minutes,
                overtime_minutes=record.overtime_minutes,
                plan_overtime_minutes=record.overtime_minutes,
                legal_extra_work_minutes=legal_extra_work_minutes,
                legal_overtime_minutes=legal_overtime_minutes,
                missing_minutes=record.missing_minutes,
                rule_source=record.rule_source,  # type: ignore[arg-type]
                applied_planned_minutes=record.applied_planned_minutes,
                applied_break_minutes=record.applied_break_minutes,
                leave_type=record.leave_type,
                shift_id=record.shift_id,
                shift_name=record.shift_name,
                flags=day_flags,
            )
        )

    return MonthlyEmployeeResponse(
        employee_id=employee.id,
        year=year,
        month=month,
        days=days,
        totals=MonthlyEmployeeTotals(
            worked_minutes=total_worked,
            overtime_minutes=total_plan_overtime,
            plan_overtime_minutes=total_plan_overtime,
            legal_extra_work_minutes=total_legal_extra_work,
            legal_overtime_minutes=total_legal_overtime,
            incomplete_days=incomplete_days,
        ),
        worked_minutes_net=total_worked,
        weekly_totals=[
            MonthlyEmployeeWeek(
                week_start=item.week_start,
                week_end=item.week_end,
                normal_minutes=item.normal_minutes,
                extra_work_minutes=item.extra_work_minutes,
                overtime_minutes=item.overtime_minutes,
                flags=item.flags,
            )
            for item in monthly_weeks
        ],
        annual_overtime_used_minutes=annual_overtime_used_minutes,
        annual_overtime_remaining_minutes=annual_overtime_remaining_minutes,
        annual_overtime_cap_exceeded=annual_overtime_cap_exceeded,
        labor_profile=_to_labor_profile_read(labor_profile),
    )


def calculate_employee_monthly(
    db: Session,
    *,
    employee_id: int,
    year: int,
    month: int,
) -> MonthlyEmployeeResponse:
    employee = db.scalar(select(Employee).where(Employee.id == employee_id))
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")

    return _employee_monthly_from_model(db, employee, year, month)


def calculate_department_monthly_summary(
    db: Session,
    *,
    year: int,
    month: int,
    department_id: int | None = None,
    region_id: int | None = None,
    include_inactive: bool = False,
) -> list[DepartmentMonthlySummaryItem]:
    department_stmt = select(Department).order_by(Department.id)
    if department_id is not None:
        department_stmt = department_stmt.where(Department.id == department_id)
    if region_id is not None:
        department_stmt = department_stmt.where(Department.region_id == region_id)

    departments = list(db.scalars(department_stmt).all())
    summary: list[DepartmentMonthlySummaryItem] = []

    for department in departments:
        employee_stmt = (
            select(Employee)
            .where(Employee.department_id == department.id)
            .order_by(Employee.id.asc())
        )
        if not include_inactive:
            employee_stmt = employee_stmt.where(Employee.is_active.is_(True))

        employees = list(
            db.scalars(employee_stmt).all()
        )

        worked_minutes = 0
        plan_overtime_minutes = 0
        legal_extra_work_minutes = 0
        legal_overtime_minutes = 0
        for employee in employees:
            employee_result = _employee_monthly_from_model(db, employee, year, month)
            worked_minutes += employee_result.totals.worked_minutes
            plan_overtime_minutes += employee_result.totals.plan_overtime_minutes
            legal_extra_work_minutes += employee_result.totals.legal_extra_work_minutes
            legal_overtime_minutes += employee_result.totals.legal_overtime_minutes

        summary.append(
            DepartmentMonthlySummaryItem(
                department_id=department.id,
                department_name=department.name,
                region_id=department.region_id,
                worked_minutes=worked_minutes,
                overtime_minutes=legal_overtime_minutes,
                plan_overtime_minutes=plan_overtime_minutes,
                legal_extra_work_minutes=legal_extra_work_minutes,
                legal_overtime_minutes=legal_overtime_minutes,
                employee_count=len(employees),
            )
        )

    return summary
