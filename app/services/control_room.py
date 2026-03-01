from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta, timezone
from math import ceil
from statistics import mean
from typing import Any, Literal

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    AttendanceEvent,
    AttendanceType,
    AuditActorType,
    AuditLog,
    DepartmentSchedulePlan,
    DepartmentShift,
    DepartmentWeeklyRule,
    Employee,
    LocationStatus,
    WorkRule,
)
from app.schemas import (
    ControlRoomActiveFiltersRead,
    ControlRoomAuditEntryRead,
    ControlRoomDepartmentMetricRead,
    ControlRoomEmployeeAlertRead,
    ControlRoomEmployeeDetailResponse,
    ControlRoomEmployeeStateRead,
    ControlRoomHistogramBucketRead,
    ControlRoomMapPointRead,
    ControlRoomMeasureRead,
    ControlRoomNoteRead,
    ControlRoomOverviewResponse,
    ControlRoomRecentEventRead,
    ControlRoomRiskFactorRead,
    ControlRoomRiskFormulaItemRead,
    ControlRoomSummaryRead,
    ControlRoomTooltipRead,
    ControlRoomTrendPointRead,
    DashboardEmployeeLastEventRead,
    DashboardEmployeeMonthMetricsRead,
    EmployeeLiveLocationRead,
    EmployeeRead,
)
from app.services.attendance import _attendance_timezone
from app.services.monthly import calculate_employee_monthly
from app.services.schedule_plans import resolve_best_plan_for_day

CONTROL_ROOM_ACTION_AUDIT = "CONTROL_ROOM_EMPLOYEE_ACTION"
CONTROL_ROOM_NOTE_AUDIT = "CONTROL_ROOM_NOTE_CREATED"
CONTROL_ROOM_OVERRIDE_AUDIT = "CONTROL_ROOM_RISK_OVERRIDE"

CONTROL_ROOM_ACTION_LABELS: dict[str, str] = {
    "SUSPEND": "Askiya Al",
    "DISABLE_TEMP": "Gecici Devre Disi",
    "REVIEW": "Incelemeye Al",
    "RISK_OVERRIDE": "Risk Override",
}

CONTROL_ROOM_AUDIT_LABELS: dict[str, str] = {
    CONTROL_ROOM_ACTION_AUDIT: "Operasyon islemi",
    CONTROL_ROOM_NOTE_AUDIT: "Inceleme notu",
    CONTROL_ROOM_OVERRIDE_AUDIT: "Risk override",
}

RISK_FORMULA_ITEMS = [
    ControlRoomRiskFormulaItemRead(code="LATE_CHECKIN", label="Gec giris", max_score=24, description="Son 7 gundeki gec giris sayisi x8, ust sinir 24 puan."),
    ControlRoomRiskFormulaItemRead(code="EARLY_CHECKOUT", label="Erken cikis", max_score=16, description="Son 7 gundeki erken cikis sayisi x8, ust sinir 16 puan."),
    ControlRoomRiskFormulaItemRead(code="IP_VARIATION", label="IP degisimi", max_score=15, description="Son 7 gundeki ek farkli IP kumeleri x10, ust sinir 15 puan."),
    ControlRoomRiskFormulaItemRead(code="LOCATION_DEVIATION", label="Lokasyon sapmasi", max_score=20, description="Dogrulanamayan konum gunu x10, ust sinir 20 puan."),
    ControlRoomRiskFormulaItemRead(code="OFF_HOURS_ACTIVITY", label="Mesai disi aktivite", max_score=12, description="Mesai penceresi disindaki aktivite gunu x6, ust sinir 12 puan."),
    ControlRoomRiskFormulaItemRead(code="VIOLATION_DENSITY", label="Ihlal yogunlugu", max_score=20, description="Son 7 gun toplam ihlal sayisi x4, ust sinir 20 puan."),
    ControlRoomRiskFormulaItemRead(code="ABSENCE_MINUTES", label="Devamsizlik suresi", max_score=18, description="Son 7 gun eksik/devamsiz sure icin saat bazli puanlama, ust sinir 18 puan."),
]


class ScheduleContext:
    def __init__(
        self,
        *,
        shift_name: str | None,
        shift_window_label: str | None,
        shift_start_local: datetime | None,
        shift_end_local: datetime | None,
        planned_minutes: int,
        break_minutes: int,
        grace_minutes: int,
        is_workday: bool,
    ) -> None:
        self.shift_name = shift_name
        self.shift_window_label = shift_window_label
        self.shift_start_local = shift_start_local
        self.shift_end_local = shift_end_local
        self.planned_minutes = planned_minutes
        self.break_minutes = break_minutes
        self.grace_minutes = grace_minutes
        self.is_workday = is_workday


class IntervalRecord:
    def __init__(
        self,
        *,
        start_event: AttendanceEvent,
        end_event: AttendanceEvent | None,
        start_utc: datetime,
        end_utc: datetime,
    ) -> None:
        self.start_event = start_event
        self.end_event = end_event
        self.start_utc = start_utc
        self.end_utc = end_utc


def _normalize_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _to_employee_read(employee: Employee) -> EmployeeRead:
    return EmployeeRead(
        id=employee.id,
        full_name=employee.full_name,
        region_id=employee.region_id,
        region_name=employee.region.name if employee.region else None,
        department_id=employee.department_id,
        shift_id=employee.shift_id,
        is_active=employee.is_active,
        contract_weekly_minutes=employee.contract_weekly_minutes,
    )


def _event_to_dashboard(event: AttendanceEvent | None) -> DashboardEmployeeLastEventRead | None:
    if event is None:
        return None
    return DashboardEmployeeLastEventRead(
        event_id=event.id,
        event_type=event.type,
        ts_utc=event.ts_utc,
        location_status=event.location_status,
        device_id=event.device_id,
        lat=event.lat,
        lon=event.lon,
        accuracy_m=event.accuracy_m,
    )


def _event_to_live_location(event: AttendanceEvent | None) -> EmployeeLiveLocationRead | None:
    if event is None or event.lat is None or event.lon is None:
        return None
    return EmployeeLiveLocationRead(
        lat=event.lat,
        lon=event.lon,
        accuracy_m=event.accuracy_m,
        ts_utc=event.ts_utc,
        location_status=event.location_status,
        event_type=event.type,
        device_id=event.device_id,
    )


def _today_status_from_events(today_events: list[AttendanceEvent]) -> Literal["NOT_STARTED", "IN_PROGRESS", "FINISHED"]:
    today_last_in: datetime | None = None
    today_last_out: datetime | None = None
    for event in today_events:
        if event.type == AttendanceType.IN:
            today_last_in = event.ts_utc
        elif event.type == AttendanceType.OUT:
            today_last_out = event.ts_utc
    if today_last_in is None and today_last_out is None:
        return "NOT_STARTED"
    if today_last_in is not None and (today_last_out is None or today_last_out < today_last_in):
        return "IN_PROGRESS"
    return "FINISHED"


def _control_room_location_state(latest_location_event: AttendanceEvent | None, *, now_utc: datetime) -> Literal["LIVE", "STALE", "DORMANT", "NONE"]:
    if latest_location_event is None or latest_location_event.lat is None or latest_location_event.lon is None:
        return "NONE"
    location_ts = _normalize_utc(latest_location_event.ts_utc)
    if location_ts is None:
        return "NONE"
    age = now_utc - location_ts
    if age <= timedelta(minutes=30):
        return "LIVE"
    if age <= timedelta(hours=6):
        return "STALE"
    return "DORMANT"


def _risk_status(score: int) -> Literal["NORMAL", "WATCH", "CRITICAL"]:
    if score >= 70:
        return "CRITICAL"
    if score >= 35:
        return "WATCH"
    return "NORMAL"


def _format_hour_bucket(hour_value: int | None) -> str | None:
    if hour_value is None:
        return None
    start = max(0, min(23, int(hour_value)))
    end = (start + 1) % 24
    return f"{start:02d}:00-{end:02d}:00"


def _format_minutes_hhmm(total_minutes: int | None) -> str | None:
    if total_minutes is None:
        return None
    normalized = max(0, int(total_minutes))
    return f"{normalized // 60:02d}:{normalized % 60:02d}"


def _measure_from_audit(log_item: AuditLog) -> ControlRoomMeasureRead:
    details = log_item.details if isinstance(log_item.details, dict) else {}
    duration_days = details.get("duration_days")
    expires_at_raw = details.get("expires_at")
    expires_at = _normalize_utc(expires_at_raw) if isinstance(expires_at_raw, datetime) else None
    action_type = str(details.get("action_type") or "REVIEW")
    return ControlRoomMeasureRead(
        action_type=action_type,
        label=str(details.get("action_label") or CONTROL_ROOM_ACTION_LABELS.get(action_type, "Inceleme")),
        reason=str(details.get("reason") or ""),
        note=str(details.get("note") or ""),
        duration_days=(duration_days if isinstance(duration_days, int) else None),
        expires_at=expires_at,
        created_at=log_item.ts_utc,
        created_by=str(log_item.actor_id or "admin"),
        ip=log_item.ip,
        override_score=(details.get("override_score") if isinstance(details.get("override_score"), int) else None),
    )


def _note_from_audit(log_item: AuditLog) -> ControlRoomNoteRead:
    details = log_item.details if isinstance(log_item.details, dict) else {}
    return ControlRoomNoteRead(
        note=str(details.get("note") or ""),
        created_at=log_item.ts_utc,
        created_by=str(log_item.actor_id or "admin"),
        ip=log_item.ip,
    )


def _audit_entry_from_log(log_item: AuditLog) -> ControlRoomAuditEntryRead:
    return ControlRoomAuditEntryRead(
        audit_id=log_item.id,
        action=log_item.action,
        label=CONTROL_ROOM_AUDIT_LABELS.get(log_item.action, log_item.action),
        ts_utc=log_item.ts_utc,
        actor_id=str(log_item.actor_id or "admin"),
        ip=log_item.ip,
        details=log_item.details if isinstance(log_item.details, dict) else {},
    )


def _duration_expired(expires_at: datetime | None, now_utc: datetime) -> bool:
    if expires_at is None:
        return False
    value = _normalize_utc(expires_at)
    return value is not None and value <= now_utc


def _latest_by_type(db: Session, *, employee_ids: list[int], event_type: AttendanceType | None = None, require_location: bool = False) -> dict[int, AttendanceEvent]:
    if not employee_ids:
        return {}
    conditions: list[Any] = [AttendanceEvent.employee_id.in_(employee_ids), AttendanceEvent.deleted_at.is_(None)]
    if event_type is not None:
        conditions.append(AttendanceEvent.type == event_type)
    if require_location:
        conditions.extend([AttendanceEvent.lat.is_not(None), AttendanceEvent.lon.is_not(None)])
    subq = (
        select(AttendanceEvent.employee_id.label("employee_id"), func.max(AttendanceEvent.ts_utc).label("max_ts"))
        .where(*conditions)
        .group_by(AttendanceEvent.employee_id)
        .subquery()
    )
    rows = list(
        db.scalars(
            select(AttendanceEvent)
            .join(subq, and_(AttendanceEvent.employee_id == subq.c.employee_id, AttendanceEvent.ts_utc == subq.c.max_ts))
            .where(*conditions)
            .order_by(AttendanceEvent.employee_id.asc(), AttendanceEvent.id.desc())
        ).all()
    )
    result: dict[int, AttendanceEvent] = {}
    for row in rows:
        current = result.get(row.employee_id)
        if current is None or (row.ts_utc, row.id) > (current.ts_utc, current.id):
            result[row.employee_id] = row
    return result


def _latest_audit_by_actor(db: Session, *, actor_ids: list[str], require_ip: bool = False) -> dict[str, AuditLog]:
    if not actor_ids:
        return {}
    conditions: list[Any] = [AuditLog.actor_type == AuditActorType.SYSTEM, AuditLog.actor_id.in_(actor_ids)]
    if require_ip:
        conditions.append(AuditLog.ip.is_not(None))
    subq = (
        select(AuditLog.actor_id.label("actor_id"), func.max(AuditLog.ts_utc).label("max_ts"))
        .where(*conditions)
        .group_by(AuditLog.actor_id)
        .subquery()
    )
    rows = list(
        db.scalars(
            select(AuditLog)
            .join(subq, and_(AuditLog.actor_id == subq.c.actor_id, AuditLog.ts_utc == subq.c.max_ts))
            .where(*conditions)
            .order_by(AuditLog.actor_id.asc(), AuditLog.id.desc())
        ).all()
    )
    result: dict[str, AuditLog] = {}
    for row in rows:
        current = result.get(row.actor_id)
        if current is None or (row.ts_utc, row.id) > (current.ts_utc, current.id):
            result[row.actor_id] = row
    return result


def _build_intervals(events: list[AttendanceEvent], *, now_utc: datetime) -> list[IntervalRecord]:
    result: list[IntervalRecord] = []
    open_event: AttendanceEvent | None = None
    for event in sorted(events, key=lambda item: (_normalize_utc(item.ts_utc) or now_utc, item.id)):
        event_ts = _normalize_utc(event.ts_utc)
        if event_ts is None:
            continue
        if event.type == AttendanceType.IN:
            open_event = event
            continue
        if open_event is None:
            continue
        open_ts = _normalize_utc(open_event.ts_utc)
        if open_ts is None or event_ts <= open_ts:
            continue
        result.append(IntervalRecord(start_event=open_event, end_event=event, start_utc=open_ts, end_utc=event_ts))
        open_event = None
    if open_event is not None:
        open_ts = _normalize_utc(open_event.ts_utc)
        if open_ts is not None and open_ts < now_utc:
            result.append(IntervalRecord(start_event=open_event, end_event=None, start_utc=open_ts, end_utc=now_utc))
    return result


def _sum_interval_minutes(intervals: list[IntervalRecord], *, window_start_utc: datetime, window_end_utc: datetime) -> int:
    total_seconds = 0.0
    for interval in intervals:
        start_utc = max(interval.start_utc, window_start_utc)
        end_utc = min(interval.end_utc, window_end_utc)
        if end_utc <= start_utc:
            continue
        total_seconds += (end_utc - start_utc).total_seconds()
    return max(0, int(round(total_seconds / 60)))


def _resolve_shift_context(*, employee: Employee, day_date: date, work_rule_map: dict[int, WorkRule], weekly_rule_map: dict[int, dict[int, DepartmentWeeklyRule]], shift_map: dict[int, dict[int, DepartmentShift]], plan_map: dict[int, list[DepartmentSchedulePlan]]) -> ScheduleContext:
    department_id = employee.department_id or 0
    department_work_rule = work_rule_map.get(department_id)
    department_weekly_rule = weekly_rule_map.get(department_id, {}).get(day_date.weekday())
    department_shift_map = shift_map.get(department_id, {})
    department_plans = plan_map.get(department_id, [])
    effective_plan = resolve_best_plan_for_day(department_plans, employee_id=employee.id, day_date=day_date)
    shift: DepartmentShift | None = None
    if effective_plan is not None and effective_plan.shift_id is not None:
        shift = department_shift_map.get(effective_plan.shift_id)
    if shift is None and employee.shift_id is not None:
        shift = department_shift_map.get(employee.shift_id) or employee.shift
    if shift is None:
        shift = employee.shift
    grace_minutes = max(0, int(department_work_rule.grace_minutes)) if department_work_rule is not None else 5
    if effective_plan is not None and effective_plan.grace_minutes is not None:
        grace_minutes = max(0, int(effective_plan.grace_minutes))
    planned_minutes = 0
    break_minutes = 0
    is_workday = True
    shift_start_local: datetime | None = None
    shift_end_local: datetime | None = None
    shift_name: str | None = None
    shift_window_label: str | None = None
    if shift is not None:
        shift_name = shift.name
        shift_start_local = datetime.combine(day_date, shift.start_time_local)
        shift_end_local = datetime.combine(day_date, shift.end_time_local)
        if shift_end_local <= shift_start_local:
            shift_end_local += timedelta(days=1)
        break_minutes = max(0, int(shift.break_minutes))
        planned_minutes = max(0, int(round((shift_end_local - shift_start_local).total_seconds() / 60)) - break_minutes)
        shift_window_label = f"{shift.start_time_local:%H:%M} - {shift.end_time_local:%H:%M}"
        is_workday = True
    elif effective_plan is not None and effective_plan.daily_minutes_planned is not None:
        break_minutes = max(0, int(effective_plan.break_minutes or 0))
        planned_minutes = max(0, int(effective_plan.daily_minutes_planned) - break_minutes)
        is_workday = planned_minutes > 0
    elif department_weekly_rule is not None:
        break_minutes = max(0, int(department_weekly_rule.break_minutes))
        planned_minutes = max(0, int(department_weekly_rule.planned_minutes) - break_minutes)
        is_workday = bool(department_weekly_rule.is_workday)
    elif department_work_rule is not None:
        break_minutes = max(0, int(department_work_rule.break_minutes))
        planned_minutes = max(0, int(department_work_rule.daily_minutes_planned) - break_minutes)
    return ScheduleContext(
        shift_name=shift_name,
        shift_window_label=shift_window_label,
        shift_start_local=shift_start_local,
        shift_end_local=shift_end_local,
        planned_minutes=planned_minutes,
        break_minutes=break_minutes,
        grace_minutes=grace_minutes,
        is_workday=is_workday,
    )


def _load_control_logs(db: Session, *, employee_ids: list[int], limit_days: int = 180) -> dict[int, list[AuditLog]]:
    if not employee_ids:
        return {}
    threshold_utc = datetime.now(timezone.utc) - timedelta(days=limit_days)
    rows = list(
        db.scalars(
            select(AuditLog)
            .where(
                AuditLog.entity_type == "employee",
                AuditLog.entity_id.in_([str(item) for item in employee_ids]),
                AuditLog.action.in_([CONTROL_ROOM_ACTION_AUDIT, CONTROL_ROOM_NOTE_AUDIT, CONTROL_ROOM_OVERRIDE_AUDIT]),
                AuditLog.ts_utc >= threshold_utc,
            )
            .order_by(AuditLog.ts_utc.desc(), AuditLog.id.desc())
        ).all()
    )
    result: dict[int, list[AuditLog]] = defaultdict(list)
    for row in rows:
        try:
            entity_id = int(row.entity_id or 0)
        except ValueError:
            continue
        result[entity_id].append(row)
    return result


def _build_filter_payload(*, q: str | None, region_id: int | None, department_id: int | None, start_date: date | None, end_date: date | None, map_date: date | None, include_inactive: bool, risk_min: int | None, risk_max: int | None, risk_status: Literal["NORMAL", "WATCH", "CRITICAL"] | None, sort_by: str, sort_dir: Literal["asc", "desc"], limit: int, offset: int) -> ControlRoomActiveFiltersRead:
    return ControlRoomActiveFiltersRead(q=q, region_id=region_id, department_id=department_id, start_date=start_date, end_date=end_date, map_date=map_date, include_inactive=include_inactive, risk_min=risk_min, risk_max=risk_max, risk_status=risk_status, sort_by=sort_by, sort_dir=sort_dir, limit=limit, offset=offset)


def _dashboard_month_metrics_from_report(report: Any) -> DashboardEmployeeMonthMetricsRead:
    return DashboardEmployeeMonthMetricsRead(
        year=report.year,
        month=report.month,
        worked_minutes=int(report.totals.worked_minutes),
        plan_overtime_minutes=int(report.totals.plan_overtime_minutes),
        extra_work_minutes=int(report.totals.legal_extra_work_minutes),
        overtime_minutes=int(report.totals.legal_overtime_minutes),
        incomplete_days=int(report.totals.incomplete_days),
    )


def _normalize_query_text(value: str | None) -> str:
    return " ".join((value or "").strip().split())


def _local_day(dt_value: datetime | None, tz: Any) -> date | None:
    normalized = _normalize_utc(dt_value)
    if normalized is None:
        return None
    return normalized.astimezone(tz).date()


def _minutes_since_midnight(dt_value: datetime | None, tz: Any) -> int | None:
    normalized = _normalize_utc(dt_value)
    if normalized is None:
        return None
    local_value = normalized.astimezone(tz)
    return local_value.hour * 60 + local_value.minute


def _location_label(event: AttendanceEvent | None) -> str | None:
    if event is None or event.lat is None or event.lon is None:
        return None
    if event.location_status == LocationStatus.VERIFIED_HOME:
        status_label = "Dogrulanmis konum"
    elif event.location_status == LocationStatus.UNVERIFIED_LOCATION:
        status_label = "Konum sapmasi"
    else:
        status_label = "Konum verisi"
    return f"{status_label} ({event.lat:.5f}, {event.lon:.5f})"


def _risk_factor(
    *,
    code: str,
    label: str,
    value: str,
    impact_score: int,
    description: str,
) -> ControlRoomRiskFactorRead:
    return ControlRoomRiskFactorRead(
        code=code,
        label=label,
        value=value,
        impact_score=max(0, int(impact_score)),
        description=description,
    )


def build_control_room_overview(
    db: Session,
    *,
    q: str | None = None,
    employee_id: int | None = None,
    region_id: int | None = None,
    department_id: int | None = None,
    today_status: Literal["NOT_STARTED", "IN_PROGRESS", "FINISHED"] | None = None,
    location_state: Literal["LIVE", "STALE", "DORMANT", "NONE"] | None = None,
    map_date: date | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    include_inactive: bool = False,
    risk_min: int | None = None,
    risk_max: int | None = None,
    risk_status: Literal["NORMAL", "WATCH", "CRITICAL"] | None = None,
    sort_by: str = "risk_score",
    sort_dir: Literal["asc", "desc"] = "desc",
    offset: int = 0,
    limit: int = 24,
) -> ControlRoomOverviewResponse:
    normalized_q = _normalize_query_text(q)
    offset = max(0, int(offset))
    limit = max(1, min(int(limit), 100))
    sort_by = sort_by or "risk_score"
    sort_dir = "asc" if sort_dir == "asc" else "desc"

    now_utc = datetime.now(timezone.utc)
    tz = _attendance_timezone()
    now_local = now_utc.astimezone(tz)
    today_local_date = now_local.date()

    effective_start_date = start_date
    effective_end_date = end_date
    if effective_start_date is None and effective_end_date is not None:
        effective_start_date = effective_end_date - timedelta(days=6)
    if effective_end_date is None and effective_start_date is not None:
        effective_end_date = max(effective_start_date, today_local_date)
    if effective_start_date is None:
        effective_start_date = today_local_date - timedelta(days=6)
    if effective_end_date is None:
        effective_end_date = today_local_date
    if effective_end_date < effective_start_date:
        effective_start_date, effective_end_date = effective_end_date, effective_start_date

    risk_window_start = today_local_date - timedelta(days=6)
    week_window_start = today_local_date - timedelta(days=today_local_date.weekday())
    selected_map_date = map_date or effective_end_date or today_local_date
    batch_start_date = min(effective_start_date, risk_window_start, week_window_start, selected_map_date)
    batch_end_date = max(effective_end_date, today_local_date, selected_map_date)

    batch_start_utc = datetime.combine(batch_start_date, time.min, tzinfo=tz).astimezone(timezone.utc)
    batch_end_utc = datetime.combine(batch_end_date + timedelta(days=1), time.min, tzinfo=tz).astimezone(timezone.utc)
    today_start_utc = datetime.combine(today_local_date, time.min, tzinfo=tz).astimezone(timezone.utc)
    tomorrow_start_utc = datetime.combine(today_local_date + timedelta(days=1), time.min, tzinfo=tz).astimezone(timezone.utc)
    week_start_utc = datetime.combine(week_window_start, time.min, tzinfo=tz).astimezone(timezone.utc)
    analysis_start_utc = datetime.combine(effective_start_date, time.min, tzinfo=tz).astimezone(timezone.utc)
    analysis_end_utc = datetime.combine(effective_end_date + timedelta(days=1), time.min, tzinfo=tz).astimezone(timezone.utc)

    employee_filters: list[Any] = []
    if employee_id is not None:
        employee_filters.append(Employee.id == employee_id)
    if not include_inactive:
        employee_filters.append(Employee.is_active.is_(True))
    if region_id is not None:
        employee_filters.append(Employee.region_id == region_id)
    if department_id is not None:
        employee_filters.append(Employee.department_id == department_id)
    if normalized_q:
        search_filters = [Employee.full_name.ilike(f"%{normalized_q}%")]
        normalized_numeric = normalized_q.replace("#", "").strip()
        if normalized_numeric.isdigit():
            search_filters.append(Employee.id == int(normalized_numeric))
        employee_filters.append(or_(*search_filters))

    employees = list(
        db.scalars(
            select(Employee)
            .options(
                selectinload(Employee.region),
                selectinload(Employee.department),
                selectinload(Employee.shift),
                selectinload(Employee.devices),
            )
            .where(*employee_filters)
            .order_by(Employee.full_name.asc(), Employee.id.asc())
        ).all()
    )

    active_filters = _build_filter_payload(
        q=normalized_q or None,
        region_id=region_id,
        department_id=department_id,
        start_date=effective_start_date,
        end_date=effective_end_date,
        map_date=selected_map_date,
        include_inactive=include_inactive,
        risk_min=risk_min,
        risk_max=risk_max,
        risk_status=risk_status,
        sort_by=sort_by,
        sort_dir=sort_dir,
        limit=limit,
        offset=offset,
    )
    if not employees:
        return ControlRoomOverviewResponse(
            generated_at_utc=now_utc,
            total=0,
            offset=offset,
            limit=limit,
            summary=ControlRoomSummaryRead(),
            active_filters=active_filters,
            risk_formula=RISK_FORMULA_ITEMS,
            items=[],
            map_points=[],
            recent_events=[],
        )

    employee_ids = [item.id for item in employees]
    actor_ids = [str(item) for item in employee_ids]
    employees_by_id = {item.id: item for item in employees}
    department_ids = sorted({item.department_id for item in employees if item.department_id is not None})

    work_rule_rows = list(db.scalars(select(WorkRule).where(WorkRule.department_id.in_(department_ids))).all()) if department_ids else []
    weekly_rule_rows = list(db.scalars(select(DepartmentWeeklyRule).where(DepartmentWeeklyRule.department_id.in_(department_ids))).all()) if department_ids else []
    shift_rows = list(db.scalars(select(DepartmentShift).where(DepartmentShift.department_id.in_(department_ids))).all()) if department_ids else []
    plan_rows = list(db.scalars(select(DepartmentSchedulePlan).where(DepartmentSchedulePlan.department_id.in_(department_ids), DepartmentSchedulePlan.is_active.is_(True))).all()) if department_ids else []

    work_rule_map = {item.department_id: item for item in work_rule_rows}
    weekly_rule_map: dict[int, dict[int, DepartmentWeeklyRule]] = defaultdict(dict)
    for item in weekly_rule_rows:
        weekly_rule_map[item.department_id][item.weekday] = item
    shift_map: dict[int, dict[int, DepartmentShift]] = defaultdict(dict)
    for item in shift_rows:
        shift_map[item.department_id][item.id] = item
    plan_map: dict[int, list[DepartmentSchedulePlan]] = defaultdict(list)
    for item in sorted(plan_rows, key=lambda row: (row.start_date, row.end_date, row.id)):
        plan_map[item.department_id].append(item)

    event_rows = list(
        db.scalars(
            select(AttendanceEvent)
            .where(
                AttendanceEvent.employee_id.in_(employee_ids),
                AttendanceEvent.deleted_at.is_(None),
                AttendanceEvent.ts_utc >= batch_start_utc,
                AttendanceEvent.ts_utc < batch_end_utc,
            )
            .order_by(AttendanceEvent.employee_id.asc(), AttendanceEvent.ts_utc.asc(), AttendanceEvent.id.asc())
        ).all()
    )
    events_by_employee: dict[int, list[AttendanceEvent]] = defaultdict(list)
    for row in event_rows:
        events_by_employee[row.employee_id].append(row)

    system_audit_rows = list(
        db.scalars(
            select(AuditLog)
            .where(
                AuditLog.actor_type == AuditActorType.SYSTEM,
                AuditLog.actor_id.in_(actor_ids),
                AuditLog.ts_utc >= batch_start_utc,
            )
            .order_by(AuditLog.actor_id.asc(), AuditLog.ts_utc.desc(), AuditLog.id.desc())
        ).all()
    )
    system_audits_by_actor: dict[str, list[AuditLog]] = defaultdict(list)
    for row in system_audit_rows:
        system_audits_by_actor[row.actor_id].append(row)

    control_logs_by_employee = _load_control_logs(db, employee_ids=employee_ids)
    latest_event_by_employee = _latest_by_type(db, employee_ids=employee_ids)
    latest_checkin_by_employee = _latest_by_type(db, employee_ids=employee_ids, event_type=AttendanceType.IN)
    latest_checkout_by_employee = _latest_by_type(db, employee_ids=employee_ids, event_type=AttendanceType.OUT)
    latest_location_by_employee = _latest_by_type(db, employee_ids=employee_ids, require_location=True)
    latest_system_activity = _latest_audit_by_actor(db, actor_ids=actor_ids)

    risk_trend_counter: Counter[date] = Counter()
    violation_hour_counter: Counter[int] = Counter()
    filtered_rows: list[dict[str, Any]] = []

    for employee in employees:
        employee_events = events_by_employee.get(employee.id, [])
        employee_intervals = _build_intervals(employee_events, now_utc=now_utc)
        employee_today_events = [event for event in employee_events if _local_day(event.ts_utc, tz) == today_local_date]
        employee_today_status = _today_status_from_events(employee_today_events)

        last_event = latest_event_by_employee.get(employee.id)
        last_checkin = latest_checkin_by_employee.get(employee.id)
        last_checkout = latest_checkout_by_employee.get(employee.id)
        latest_location = latest_location_by_employee.get(employee.id)
        location_state_value = _control_room_location_state(latest_location, now_utc=now_utc)
        latest_system_log = latest_system_activity.get(str(employee.id))
        last_portal_seen_utc = latest_system_log.ts_utc if latest_system_log is not None else None
        last_activity_candidates = [
            item
            for item in [
                _normalize_utc(last_event.ts_utc) if last_event is not None else None,
                _normalize_utc(last_portal_seen_utc),
            ]
            if item is not None
        ]
        last_activity_utc = max(last_activity_candidates) if last_activity_candidates else None
        recent_logs_for_employee = system_audits_by_actor.get(str(employee.id), [])
        recent_ip = next((item.ip for item in recent_logs_for_employee if item.ip), None)

        active_devices = sum(1 for item in (employee.devices or []) if item.is_active)
        total_devices = len(employee.devices or [])
        worked_today_minutes = _sum_interval_minutes(
            employee_intervals,
            window_start_utc=today_start_utc,
            window_end_utc=min(tomorrow_start_utc, now_utc),
        )
        weekly_total_minutes = _sum_interval_minutes(
            employee_intervals,
            window_start_utc=week_start_utc,
            window_end_utc=now_utc,
        )
        analysis_total_minutes = _sum_interval_minutes(
            employee_intervals,
            window_start_utc=analysis_start_utc,
            window_end_utc=min(analysis_end_utc, now_utc),
        )

        risk_daily_events: dict[date, list[AttendanceEvent]] = defaultdict(list)
        analysis_has_activity = False
        for event in employee_events:
            event_day = _local_day(event.ts_utc, tz)
            if event_day is None:
                continue
            if effective_start_date <= event_day <= effective_end_date:
                analysis_has_activity = True
            if risk_window_start <= event_day <= today_local_date:
                risk_daily_events[event_day].append(event)

        late_days = 0
        early_days = 0
        off_hours_days = 0
        location_deviation_days = 0
        violation_count_7d = 0
        absence_minutes_7d = 0
        late_observations = 0
        checkin_minutes_samples: list[int] = []
        tooltip_items: list[ControlRoomTooltipRead] = []
        attention_flags: list[ControlRoomEmployeeAlertRead] = []
        risk_factors: list[ControlRoomRiskFactorRead] = []
        seen_tooltips: set[str] = set()
        seen_alerts: set[str] = set()

        def add_tooltip(title: str, body: str) -> None:
            key = f"{title}:{body}"
            if key in seen_tooltips:
                return
            seen_tooltips.add(key)
            tooltip_items.append(ControlRoomTooltipRead(title=title, body=body))

        def add_alert(code: str, label: str, severity: Literal["info", "warning", "critical"]) -> None:
            if code in seen_alerts:
                return
            seen_alerts.add(code)
            attention_flags.append(ControlRoomEmployeeAlertRead(code=code, label=label, severity=severity))

        for day_index in range(7):
            day_date = risk_window_start + timedelta(days=day_index)
            day_events = risk_daily_events.get(day_date, [])
            schedule = _resolve_shift_context(
                employee=employee,
                day_date=day_date,
                work_rule_map=work_rule_map,
                weekly_rule_map=weekly_rule_map,
                shift_map=shift_map,
                plan_map=plan_map,
            )
            day_start_local = datetime.combine(day_date, time.min, tzinfo=tz)
            day_end_local = day_start_local + timedelta(days=1)
            day_start_utc = day_start_local.astimezone(timezone.utc)
            day_end_utc = day_end_local.astimezone(timezone.utc)
            worked_day_minutes = _sum_interval_minutes(
                employee_intervals,
                window_start_utc=day_start_utc,
                window_end_utc=day_end_utc,
            )
            first_in = next((item for item in day_events if item.type == AttendanceType.IN), None)
            last_out = next((item for item in reversed(day_events) if item.type == AttendanceType.OUT), None)
            if first_in is not None:
                checkin_value = _minutes_since_midnight(first_in.ts_utc, tz)
                if checkin_value is not None:
                    checkin_minutes_samples.append(checkin_value)

            day_violation_count = 0
            if schedule.is_workday and schedule.shift_start_local is not None and first_in is not None:
                late_cutoff = schedule.shift_start_local + timedelta(minutes=schedule.grace_minutes)
                first_in_local = _normalize_utc(first_in.ts_utc)
                if first_in_local is not None:
                    first_in_local = first_in_local.astimezone(tz)
                    late_observations += 1
                    if first_in_local > late_cutoff:
                        late_days += 1
                        violation_count_7d += 1
                        day_violation_count += 1
                        violation_hour_counter[first_in_local.hour] += 1
                        add_tooltip("Gec giris", f"{day_date:%d.%m.%Y} tarihinde vardiya baslangicindan sonra giris yapildi.")

            if schedule.is_workday and schedule.shift_end_local is not None and last_out is not None:
                last_out_local = _normalize_utc(last_out.ts_utc)
                if last_out_local is not None:
                    last_out_local = last_out_local.astimezone(tz)
                    early_cutoff = schedule.shift_end_local - timedelta(minutes=schedule.grace_minutes)
                    if last_out_local < early_cutoff:
                        early_days += 1
                        violation_count_7d += 1
                        day_violation_count += 1
                        violation_hour_counter[last_out_local.hour] += 1
                        add_tooltip("Erken cikis", f"{day_date:%d.%m.%Y} tarihinde planli bitis saatinden once cikis goruldu.")

            if schedule.is_workday and schedule.planned_minutes > 0:
                absence_minutes_7d += max(0, schedule.planned_minutes - min(schedule.planned_minutes, worked_day_minutes))

            has_in = any(item.type == AttendanceType.IN for item in day_events)
            has_out = any(item.type == AttendanceType.OUT for item in day_events)
            if has_out and not has_in:
                violation_count_7d += 1
                day_violation_count += 1
                add_alert("MISSING_CHECKIN", "Giris kaydi eksik", "critical")
                add_tooltip("Giris kaydi eksik", f"{day_date:%d.%m.%Y} tarihinde cikis var ancak giris kaydi gorunmuyor.")
                if last_out is not None:
                    last_out_local = _normalize_utc(last_out.ts_utc)
                    if last_out_local is not None:
                        violation_hour_counter[last_out_local.astimezone(tz).hour] += 1
            if has_in and not has_out and day_date < today_local_date:
                violation_count_7d += 1
                day_violation_count += 1
                add_alert("MISSING_CHECKOUT", "Cikis kaydi eksik", "warning")
                add_tooltip("Cikis kaydi eksik", f"{day_date:%d.%m.%Y} tarihinde giris var ancak vardiya kapanisi gorunmuyor.")
                if first_in is not None:
                    first_in_local = _normalize_utc(first_in.ts_utc)
                    if first_in_local is not None:
                        violation_hour_counter[first_in_local.astimezone(tz).hour] += 1

            if any(item.location_status == LocationStatus.UNVERIFIED_LOCATION for item in day_events):
                location_deviation_days += 1
                violation_count_7d += 1
                day_violation_count += 1
                flagged_location = next((item for item in day_events if item.location_status == LocationStatus.UNVERIFIED_LOCATION), None)
                if flagged_location is not None:
                    flagged_local = _normalize_utc(flagged_location.ts_utc)
                    if flagged_local is not None:
                        violation_hour_counter[flagged_local.astimezone(tz).hour] += 1
                add_tooltip("Lokasyon sapmasi", f"{day_date:%d.%m.%Y} tarihinde dogrulanamayan konum bildirimi alindi.")

            off_hours_event: AttendanceEvent | None = None
            if schedule.shift_start_local is not None and schedule.shift_end_local is not None:
                off_hours_start = schedule.shift_start_local - timedelta(minutes=schedule.grace_minutes)
                off_hours_end = schedule.shift_end_local + timedelta(minutes=schedule.grace_minutes)
                for item in day_events:
                    item_local = _normalize_utc(item.ts_utc)
                    if item_local is None:
                        continue
                    item_local = item_local.astimezone(tz)
                    if item_local < off_hours_start or item_local > off_hours_end:
                        off_hours_event = item
                        break
            elif not schedule.is_workday and day_events:
                off_hours_event = day_events[0]
            if off_hours_event is not None:
                off_hours_days += 1
                violation_count_7d += 1
                day_violation_count += 1
                off_hours_local = _normalize_utc(off_hours_event.ts_utc)
                if off_hours_local is not None:
                    violation_hour_counter[off_hours_local.astimezone(tz).hour] += 1
                add_tooltip("Mesai disi aktivite", f"{day_date:%d.%m.%Y} tarihinde planli vardiya penceresi disinda islem alindi.")

            if any(bool(item.flags) for item in day_events):
                violation_count_7d += 1
                day_violation_count += 1
                flagged_event = next((item for item in day_events if bool(item.flags)), None)
                if flagged_event is not None:
                    flagged_local = _normalize_utc(flagged_event.ts_utc)
                    if flagged_local is not None:
                        violation_hour_counter[flagged_local.astimezone(tz).hour] += 1
                add_tooltip("Kural uyarisi", f"{day_date:%d.%m.%Y} tarihinde kural veya olay bayragi uretildi.")

            if day_violation_count:
                risk_trend_counter[day_date] += day_violation_count

        if total_devices == 0:
            add_alert("NO_DEVICE", "Kayitli cihaz yok", "critical")
            add_tooltip("Kayitli cihaz yok", "Calisan icin aktif bir cihaz kaydi bulunmuyor.")
        elif active_devices == 0:
            add_alert("NO_ACTIVE_DEVICE", "Aktif cihaz gorunmuyor", "warning")
            add_tooltip("Aktif cihaz yok", "Kayitli cihazlar var ancak hicbiri aktif gorunmuyor.")
        if employee_today_status == "NOT_STARTED" and employee.is_active and now_local.hour >= 10:
            add_alert("MISSING_TODAY_CHECKIN", "Bugun giris gorunmuyor", "warning")
            add_tooltip("Bugun giris gorunmuyor", "Bugun icin henuz bir giris kaydi olusmadi.")
        if employee_today_status == "IN_PROGRESS" and worked_today_minutes >= 10 * 60:
            add_alert("LONG_OPEN_SHIFT", "Acik vardiya 10 saati asti", "critical")
            add_tooltip("Uzun acik vardiya", "Bugun acik kalan vardiya 10 saatin uzerine cikti.")
        if latest_location is not None and latest_location.location_status == LocationStatus.UNVERIFIED_LOCATION:
            add_alert("UNVERIFIED_LOCATION", "Son lokasyon dogrulanamadi", "warning")

        recent_ip_set = {
            item.ip.strip()
            for item in recent_logs_for_employee
            if item.ip and (day_value := _local_day(item.ts_utc, tz)) is not None and risk_window_start <= day_value <= today_local_date
        }
        ip_variation_count = max(0, len(recent_ip_set) - 1)
        late_score = min(late_days * 8, 24)
        early_score = min(early_days * 8, 16)
        ip_score = min(ip_variation_count * 10, 15)
        location_score = min(location_deviation_days * 10, 20)
        off_hours_score = min(off_hours_days * 6, 12)
        violation_density_score = min(violation_count_7d * 4, 20)
        absence_score = min(max(0, ceil(absence_minutes_7d / 60)) * 3, 18)
        raw_risk_score = min(100, late_score + early_score + ip_score + location_score + off_hours_score + violation_density_score + absence_score)

        risk_factors.extend(
            [
                _risk_factor(code="LATE_CHECKIN", label="Gec giris", value=f"{late_days} gun", impact_score=late_score, description="Son 7 gundeki gec giris sayisi risk skoruna dogrudan yansitilir."),
                _risk_factor(code="EARLY_CHECKOUT", label="Erken cikis", value=f"{early_days} gun", impact_score=early_score, description="Planli bitis oncesi cikis gorulen gunler skor uretir."),
                _risk_factor(code="IP_VARIATION", label="IP degisimi", value=f"{len(recent_ip_set)} farkli IP", impact_score=ip_score, description="Son 7 gunde farkli IP kaynaklari arttikca risk skoru yukselir."),
                _risk_factor(code="LOCATION_DEVIATION", label="Lokasyon sapmasi", value=f"{location_deviation_days} gun", impact_score=location_score, description="Dogrulanamayan konum bildirimi olan gunler risk uretir."),
                _risk_factor(code="OFF_HOURS_ACTIVITY", label="Mesai disi aktivite", value=f"{off_hours_days} gun", impact_score=off_hours_score, description="Mesai disi zamanlarda gorulen aktivite risk puani ekler."),
                _risk_factor(code="VIOLATION_DENSITY", label="Ihlal yogunlugu", value=f"{violation_count_7d} ihlal", impact_score=violation_density_score, description="Son 7 gundeki toplam ihlal yogunlugu risk skorunu yukselten bir carpandir."),
                _risk_factor(code="ABSENCE_MINUTES", label="Devamsizlik suresi", value=_format_minutes_hhmm(absence_minutes_7d) or "00:00", impact_score=absence_score, description="Planlanan sureye gore eksik kalan toplam sure puanlandirilir."),
            ]
        )

        active_measure: ControlRoomMeasureRead | None = None
        latest_note: ControlRoomNoteRead | None = None
        control_logs = control_logs_by_employee.get(employee.id, [])
        for log_item in control_logs:
            if latest_note is None and log_item.action == CONTROL_ROOM_NOTE_AUDIT:
                latest_note = _note_from_audit(log_item)
            if log_item.action not in {CONTROL_ROOM_ACTION_AUDIT, CONTROL_ROOM_OVERRIDE_AUDIT}:
                continue
            candidate_measure = _measure_from_audit(log_item)
            if active_measure is None and not _duration_expired(candidate_measure.expires_at, now_utc):
                active_measure = candidate_measure
            if (
                log_item.action == CONTROL_ROOM_OVERRIDE_AUDIT
                and candidate_measure.override_score is not None
                and not _duration_expired(candidate_measure.expires_at, now_utc)
            ):
                raw_risk_score = candidate_measure.override_score
                risk_factors.append(
                    _risk_factor(
                        code="MANUAL_OVERRIDE",
                        label="Risk override",
                        value=f"{candidate_measure.override_score}/100",
                        impact_score=0,
                        description="Yetkili admin tarafindan tanimlanmis gecici risk override uygulanmis.",
                    )
                )
                add_tooltip("Risk override aktif", "Bu personel kaydinda zaman sinirli manuel risk override uygulanmis.")
                break

        risk_score = max(0, min(100, int(raw_risk_score)))
        risk_status_value = _risk_status(risk_score)
        if risk_status_value == "CRITICAL":
            add_alert("RISK_CRITICAL", "Risk skoru kritik esikte", "critical")
        elif risk_status_value == "WATCH":
            add_alert("RISK_WATCH", "Risk skoru izleme seviyesinde", "warning")
        else:
            add_alert("RISK_NORMAL", "Risk profili normal", "info")
        if active_measure is not None:
            add_tooltip(f"{active_measure.label} aktif", active_measure.note or active_measure.reason)

        if start_date is not None or end_date is not None:
            range_logs = [
                item
                for item in recent_logs_for_employee
                if (day_value := _local_day(item.ts_utc, tz)) is not None and effective_start_date <= day_value <= effective_end_date
            ]
            if not analysis_has_activity and not range_logs:
                continue

        row = {
            "employee": employee,
            "department_name": employee.department.name if employee.department else None,
            "shift_name": employee.shift.name if employee.shift else None,
            "shift_window_label": (
                f"{employee.shift.start_time_local:%H:%M} - {employee.shift.end_time_local:%H:%M}"
                if employee.shift is not None
                else None
            ),
            "today_status": employee_today_status,
            "location_state": location_state_value,
            "last_event": last_event,
            "last_checkin": last_checkin,
            "last_checkout": last_checkout,
            "latest_location": latest_location,
            "last_portal_seen_utc": last_portal_seen_utc,
            "last_activity_utc": last_activity_utc,
            "recent_ip": recent_ip,
            "location_label": _location_label(latest_location),
            "active_devices": active_devices,
            "total_devices": total_devices,
            "worked_today_minutes": worked_today_minutes,
            "weekly_total_minutes": weekly_total_minutes,
            "analysis_total_minutes": analysis_total_minutes,
            "violation_count_7d": violation_count_7d,
            "risk_score": risk_score,
            "risk_status": risk_status_value,
            "absence_minutes_7d": absence_minutes_7d,
            "active_measure": active_measure,
            "latest_note": latest_note,
            "attention_flags": attention_flags,
            "tooltip_items": tooltip_items,
            "risk_factors": sorted(risk_factors, key=lambda item: (-item.impact_score, item.label)),
            "average_checkin_minutes": int(round(mean(checkin_minutes_samples))) if checkin_minutes_samples else None,
            "late_observations": late_observations,
            "late_days": late_days,
        }

        if today_status is not None and row["today_status"] != today_status:
            continue
        if location_state is not None and row["location_state"] != location_state:
            continue
        if risk_min is not None and row["risk_score"] < risk_min:
            continue
        if risk_max is not None and row["risk_score"] > risk_max:
            continue
        if risk_status is not None and row["risk_status"] != risk_status:
            continue
        filtered_rows.append(row)

    def _sort_key(row: dict[str, Any]) -> tuple[Any, ...]:
        department_name_value = (row["department_name"] or "").lower()
        employee_name_value = row["employee"].full_name.lower()
        last_activity_value = _normalize_utc(row["last_activity_utc"]) or datetime.min.replace(tzinfo=timezone.utc)
        last_checkin_value = _normalize_utc(row["last_checkin"].ts_utc) if row["last_checkin"] is not None else datetime.min.replace(tzinfo=timezone.utc)
        last_checkout_value = _normalize_utc(row["last_checkout"].ts_utc) if row["last_checkout"] is not None else datetime.min.replace(tzinfo=timezone.utc)
        primary_map: dict[str, Any] = {
            "risk_score": row["risk_score"],
            "last_activity": last_activity_value,
            "last_checkin": last_checkin_value,
            "last_checkout": last_checkout_value,
            "worked_today": row["worked_today_minutes"],
            "weekly_total": row["weekly_total_minutes"],
            "violation_count_7d": row["violation_count_7d"],
            "employee_name": employee_name_value,
            "department_name": department_name_value,
        }
        return (
            primary_map.get(sort_by, row["risk_score"]),
            row["risk_score"],
            last_activity_value,
            employee_name_value,
            row["employee"].id,
        )

    filtered_rows.sort(key=_sort_key, reverse=(sort_dir == "desc"))
    total_filtered = len(filtered_rows)
    paged_rows = filtered_rows[offset : offset + limit]

    current_year = now_local.year
    current_month = now_local.month
    month_metrics_cache: dict[int, DashboardEmployeeMonthMetricsRead] = {}
    items: list[ControlRoomEmployeeStateRead] = []
    for row in paged_rows:
        employee = row["employee"]
        if employee.id not in month_metrics_cache:
            report = calculate_employee_monthly(db, employee_id=employee.id, year=current_year, month=current_month)
            month_metrics_cache[employee.id] = _dashboard_month_metrics_from_report(report)
        items.append(
            ControlRoomEmployeeStateRead(
                employee=_to_employee_read(employee),
                department_name=row["department_name"],
                shift_name=row["shift_name"],
                shift_window_label=row["shift_window_label"],
                today_status=row["today_status"],
                location_state=row["location_state"],
                last_event=_event_to_dashboard(row["last_event"]),
                last_checkin_utc=row["last_checkin"].ts_utc if row["last_checkin"] is not None else None,
                last_checkout_utc=row["last_checkout"].ts_utc if row["last_checkout"] is not None else None,
                latest_location=_event_to_live_location(row["latest_location"]),
                last_portal_seen_utc=row["last_portal_seen_utc"],
                last_activity_utc=row["last_activity_utc"],
                recent_ip=row["recent_ip"],
                location_label=row["location_label"],
                active_devices=row["active_devices"],
                total_devices=row["total_devices"],
                current_month=month_metrics_cache[employee.id],
                worked_today_minutes=row["worked_today_minutes"],
                weekly_total_minutes=row["weekly_total_minutes"],
                violation_count_7d=row["violation_count_7d"],
                risk_score=row["risk_score"],
                risk_status=row["risk_status"],
                absence_minutes_7d=row["absence_minutes_7d"],
                active_measure=row["active_measure"],
                latest_note=row["latest_note"],
                attention_flags=row["attention_flags"],
                tooltip_items=row["tooltip_items"],
                risk_factors=row["risk_factors"],
            )
        )

    map_points: list[ControlRoomMapPointRead] = []
    for row in filtered_rows:
        employee = row["employee"]
        day_events = [
            item
            for item in events_by_employee.get(employee.id, [])
            if _local_day(item.ts_utc, tz) == selected_map_date and item.lat is not None and item.lon is not None
        ]
        if not day_events:
            continue
        event = day_events[-1]
        map_points.append(
            ControlRoomMapPointRead(
                employee_id=employee.id,
                employee_name=employee.full_name,
                department_name=row["department_name"],
                lat=float(event.lat),
                lon=float(event.lon),
                ts_utc=event.ts_utc,
                accuracy_m=event.accuracy_m,
                today_status=row["today_status"],
                location_state=row["location_state"],
                label=f"{employee.full_name} / {row['department_name'] or 'Departman yok'}",
            )
        )

    recent_events_rows = list(
        db.scalars(
            select(AttendanceEvent)
            .where(
                AttendanceEvent.employee_id.in_([row["employee"].id for row in filtered_rows]),
                AttendanceEvent.deleted_at.is_(None),
            )
            .order_by(AttendanceEvent.ts_utc.desc(), AttendanceEvent.id.desc())
            .limit(80)
        ).all()
    ) if filtered_rows else []
    recent_events = [
        ControlRoomRecentEventRead(
            event_id=item.id,
            employee_id=item.employee_id,
            employee_name=employees_by_id[item.employee_id].full_name,
            department_name=employees_by_id[item.employee_id].department.name if employees_by_id[item.employee_id].department else None,
            event_type=item.type,
            ts_utc=item.ts_utc,
            location_status=item.location_status,
            device_id=item.device_id,
            lat=item.lat,
            lon=item.lon,
            accuracy_m=item.accuracy_m,
        )
        for item in recent_events_rows
    ]

    risk_histogram = [
        ControlRoomHistogramBucketRead(label="0-19", min_score=0, max_score=19, count=sum(1 for row in filtered_rows if 0 <= row["risk_score"] <= 19)),
        ControlRoomHistogramBucketRead(label="20-39", min_score=20, max_score=39, count=sum(1 for row in filtered_rows if 20 <= row["risk_score"] <= 39)),
        ControlRoomHistogramBucketRead(label="40-59", min_score=40, max_score=59, count=sum(1 for row in filtered_rows if 40 <= row["risk_score"] <= 59)),
        ControlRoomHistogramBucketRead(label="60-79", min_score=60, max_score=79, count=sum(1 for row in filtered_rows if 60 <= row["risk_score"] <= 79)),
        ControlRoomHistogramBucketRead(label="80-100", min_score=80, max_score=100, count=sum(1 for row in filtered_rows if 80 <= row["risk_score"] <= 100)),
    ]
    weekly_trend = [
        ControlRoomTrendPointRead(label=(risk_window_start + timedelta(days=index)).strftime("%d.%m"), value=int(risk_trend_counter.get(risk_window_start + timedelta(days=index), 0)))
        for index in range(7)
    ]

    department_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in filtered_rows:
        department_groups[row["department_name"] or "Departman tanimsiz"].append(row)
    department_metrics: list[ControlRoomDepartmentMetricRead] = []
    for department_name_value, rows in sorted(department_groups.items(), key=lambda item: item[0].lower()):
        checkin_values = [row["average_checkin_minutes"] for row in rows if row["average_checkin_minutes"] is not None]
        late_observation_total = sum(row["late_observations"] for row in rows)
        late_day_total = sum(row["late_days"] for row in rows)
        department_metrics.append(
            ControlRoomDepartmentMetricRead(
                department_name=department_name_value,
                employee_count=len(rows),
                average_checkin_minutes=int(round(mean(checkin_values))) if checkin_values else None,
                late_rate_percent=round((late_day_total / late_observation_total) * 100, 1) if late_observation_total else 0,
                average_active_minutes=int(round(mean([row["analysis_total_minutes"] for row in rows]))) if rows else 0,
            )
        )

    checkin_values = [row["average_checkin_minutes"] for row in filtered_rows if row["average_checkin_minutes"] is not None]
    late_observation_total = sum(row["late_observations"] for row in filtered_rows)
    late_day_total = sum(row["late_days"] for row in filtered_rows)
    summary = ControlRoomSummaryRead(
        total_employees=total_filtered,
        active_employees=sum(1 for row in filtered_rows if row["employee"].is_active),
        not_started_count=sum(1 for row in filtered_rows if row["today_status"] == "NOT_STARTED"),
        in_progress_count=sum(1 for row in filtered_rows if row["today_status"] == "IN_PROGRESS"),
        finished_count=sum(1 for row in filtered_rows if row["today_status"] == "FINISHED"),
        normal_count=sum(1 for row in filtered_rows if row["risk_status"] == "NORMAL"),
        watch_count=sum(1 for row in filtered_rows if row["risk_status"] == "WATCH"),
        critical_count=sum(1 for row in filtered_rows if row["risk_status"] == "CRITICAL"),
        average_checkin_minutes=int(round(mean(checkin_values))) if checkin_values else None,
        late_rate_percent=round((late_day_total / late_observation_total) * 100, 1) if late_observation_total else 0,
        average_active_minutes=int(round(mean([row["analysis_total_minutes"] for row in filtered_rows]))) if filtered_rows else 0,
        most_common_violation_window=_format_hour_bucket(violation_hour_counter.most_common(1)[0][0]) if violation_hour_counter else None,
        risk_histogram=risk_histogram,
        weekly_trend=weekly_trend,
        department_metrics=department_metrics,
    )

    return ControlRoomOverviewResponse(
        generated_at_utc=now_utc,
        total=total_filtered,
        offset=offset,
        limit=limit,
        summary=summary,
        active_filters=active_filters,
        risk_formula=RISK_FORMULA_ITEMS,
        items=items,
        map_points=map_points,
        recent_events=recent_events,
    )


def build_control_room_employee_detail(db: Session, *, employee_id: int) -> ControlRoomEmployeeDetailResponse:
    overview = build_control_room_overview(db, employee_id=employee_id, include_inactive=True, offset=0, limit=1)
    if not overview.items:
        raise ValueError("Employee not found")
    audit_rows = list(
        db.scalars(
            select(AuditLog)
            .where(
                AuditLog.entity_type == "employee",
                AuditLog.entity_id == str(employee_id),
                AuditLog.action.in_([CONTROL_ROOM_ACTION_AUDIT, CONTROL_ROOM_NOTE_AUDIT, CONTROL_ROOM_OVERRIDE_AUDIT]),
            )
            .order_by(AuditLog.ts_utc.desc(), AuditLog.id.desc())
            .limit(24)
        ).all()
    )
    return ControlRoomEmployeeDetailResponse(
        generated_at_utc=overview.generated_at_utc,
        employee_state=overview.items[0],
        risk_formula=RISK_FORMULA_ITEMS,
        recent_measures=[_measure_from_audit(item) for item in audit_rows if item.action in {CONTROL_ROOM_ACTION_AUDIT, CONTROL_ROOM_OVERRIDE_AUDIT}],
        recent_notes=[_note_from_audit(item) for item in audit_rows if item.action == CONTROL_ROOM_NOTE_AUDIT],
        recent_audit_entries=[_audit_entry_from_log(item) for item in audit_rows],
    )
