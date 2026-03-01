from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
import hashlib
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import (
    AttendanceEvent,
    AttendanceEventSource,
    AttendanceType,
    Department,
    DepartmentSchedulePlan,
    DepartmentShift,
    Employee,
    LocationStatus,
    ManualDayOverride,
    NotificationJob,
    WorkRule,
)
from app.services.attendance import (
    _attendance_timezone,
    _extract_shift_id_from_flags,
    _local_day_bounds_utc,
    _normalize_ts,
    _resolve_active_open_shift_event,
)
from app.services.schedule_plans import resolve_effective_plan_for_employee_day

JOB_TYPE_ATTENDANCE_MONITOR = "ATTENDANCE_MONITOR"

AUDIENCE_EMPLOYEE = "employee"
AUDIENCE_ADMIN = "admin"

RISK_INFO = "Bilgi"
RISK_WARNING = "Uyari"
RISK_CRITICAL = "Kritik"

TYPE_EARLY_CHECKOUT = "erken_cikis"
TYPE_MISSING_CHECKOUT = "eksik_cikis"
TYPE_LATE_CHECKIN = "gec_giris"
TYPE_OVERTIME_STARTED = "mesai_basladi"
TYPE_OVERTIME_3H = "mesai_3_saat_uyari"
TYPE_OVERTIME_6H_CLOSED = "mesai_6_saat_kapatildi"
TYPE_ABSENCE = "devamsizlik"
TYPE_OVERRIDE_INFO = "vardiya_override_bilgi"
TYPE_OFF_SHIFT_ACTIVITY = "vardiya_disinda_aktivite"

DEFAULT_DAILY_MINUTES_PLANNED = 540
DEFAULT_GRACE_MINUTES = 5
OVERTIME_WARNING_HOURS = 3
OVERTIME_MAX_HOURS = 6


@dataclass(frozen=True, slots=True)
class DayAssessment:
    employee: Employee
    local_day: date
    department_name: str | None
    plan: DepartmentSchedulePlan | None
    shift: DepartmentShift | None
    default_shift: DepartmentShift | None
    first_checkin_ts_utc: datetime | None
    first_checkin_source: str | None
    checkout_ts_utc: datetime | None
    checkout_source: str | None
    checkout_is_manual: bool
    checkout_is_auto: bool
    shift_start_local_dt: datetime | None
    shift_end_local_dt: datetime
    default_shift_end_local_dt: datetime | None
    grace_minutes: int
    planned_minutes: int
    override_active: bool
    override_note: str | None
    has_any_activity: bool
    checkin_outside_shift: bool | None

    @property
    def shift_window_local(self) -> str:
        start_text = self.shift_start_local_dt.strftime("%H:%M") if self.shift_start_local_dt is not None else "-"
        end_text = self.shift_end_local_dt.strftime("%H:%M")
        return f"{start_text}-{end_text}"

    @property
    def shift_label(self) -> str:
        if self.shift is None:
            return self.shift_window_local
        return f"{self.shift.name} ({self.shift_window_local})"


def _minutes_between(later: datetime, earlier: datetime) -> int:
    return max(0, int((later - earlier).total_seconds() // 60))


def _format_local_dt(value: datetime | None) -> str:
    if value is None:
        return "-"
    return value.astimezone(_attendance_timezone()).strftime("%Y-%m-%d %H:%M")


def _format_time(value: datetime | None) -> str:
    if value is None:
        return "-"
    return value.astimezone(_attendance_timezone()).strftime("%H:%M")


def _format_minutes_label(minutes: int) -> str:
    return f"{minutes} dk"


def _build_event_identity(
    *,
    employee_id: int,
    local_day: date,
    notification_type: str,
    audience: str,
) -> tuple[str, str]:
    raw = f"{employee_id}:{local_day.isoformat()}:{notification_type}:{audience}"
    event_hash = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    event_id = f"ATT-{local_day.strftime('%Y%m%d')}-{employee_id}-{notification_type.upper()}-{audience.upper()}"
    return event_id, event_hash


def _resolve_department_name(session: Session, employee: Employee) -> str | None:
    if employee.department is not None and employee.department.name:
        return employee.department.name
    if employee.department_id is None:
        return None
    department = session.get(Department, employee.department_id)
    if department is None or not department.name:
        return None
    return department.name


def _resolve_department_work_rule(session: Session, employee: Employee) -> WorkRule | None:
    if employee.department_id is None:
        return None
    return session.scalar(select(WorkRule).where(WorkRule.department_id == employee.department_id))


def _resolve_shift_end_local_dt(
    *,
    local_day: date,
    shift: DepartmentShift | None,
    reference_ts_utc: datetime,
    planned_minutes: int,
) -> datetime:
    tz = _attendance_timezone()
    if shift is not None:
        shift_end_day = local_day + timedelta(days=1) if shift.end_time_local <= shift.start_time_local else local_day
        return datetime.combine(shift_end_day, shift.end_time_local, tzinfo=tz)

    reference_local = _normalize_ts(reference_ts_utc).astimezone(tz)
    return reference_local + timedelta(minutes=max(0, planned_minutes))


def _resolve_shift_start_local_dt(
    *,
    local_day: date,
    shift: DepartmentShift | None,
    shift_end_local_dt: datetime,
    planned_minutes: int,
) -> datetime | None:
    tz = _attendance_timezone()
    if shift is not None:
        return datetime.combine(local_day, shift.start_time_local, tzinfo=tz)
    if planned_minutes <= 0:
        return None
    return shift_end_local_dt - timedelta(minutes=planned_minutes)


def _resolve_shift_for_day(
    session: Session,
    *,
    employee: Employee,
    local_day: date,
    first_checkin_event: AttendanceEvent | None,
) -> tuple[DepartmentSchedulePlan | None, DepartmentShift | None, DepartmentShift | None, int, int, bool, str | None]:
    planned_minutes = DEFAULT_DAILY_MINUTES_PLANNED
    grace_minutes = DEFAULT_GRACE_MINUTES
    work_rule = _resolve_department_work_rule(session, employee)
    if work_rule is not None:
        planned_minutes = max(1, int(work_rule.daily_minutes_planned))
        grace_minutes = max(0, int(work_rule.grace_minutes))

    plan = resolve_effective_plan_for_employee_day(session, employee=employee, day_date=local_day)
    if plan is not None:
        if plan.daily_minutes_planned is not None:
            planned_minutes = max(1, int(plan.daily_minutes_planned))
        if plan.grace_minutes is not None:
            grace_minutes = max(0, int(plan.grace_minutes))

    default_shift = session.get(DepartmentShift, employee.shift_id) if employee.shift_id is not None else None
    effective_shift: DepartmentShift | None = None
    if plan is not None and plan.shift_id is not None:
        effective_shift = session.get(DepartmentShift, plan.shift_id)
    if effective_shift is None and default_shift is not None:
        effective_shift = default_shift
    if effective_shift is None and first_checkin_event is not None:
        shift_id = _extract_shift_id_from_flags(first_checkin_event.flags)
        if shift_id is not None:
            effective_shift = session.get(DepartmentShift, shift_id)

    override_active = plan is not None and (
        plan.shift_id is not None
        or plan.daily_minutes_planned is not None
        or plan.break_minutes is not None
        or plan.grace_minutes is not None
        or bool((plan.note or "").strip())
    )
    override_note = (plan.note or "").strip() if plan is not None and (plan.note or "").strip() else None
    return plan, effective_shift, default_shift, planned_minutes, grace_minutes, override_active, override_note


def _is_checkin_outside_shift(first_checkin_ts_utc: datetime, shift: DepartmentShift | None) -> bool | None:
    if shift is None:
        return None
    checkin_local = _normalize_ts(first_checkin_ts_utc).astimezone(_attendance_timezone())
    checkin_minutes = (checkin_local.hour * 60) + checkin_local.minute
    start_minutes = (shift.start_time_local.hour * 60) + shift.start_time_local.minute
    end_minutes = (shift.end_time_local.hour * 60) + shift.end_time_local.minute
    if end_minutes > start_minutes:
        in_window = start_minutes <= checkin_minutes <= end_minutes
    elif end_minutes < start_minutes:
        in_window = checkin_minutes >= start_minutes or checkin_minutes <= end_minutes
    else:
        in_window = True
    return not in_window


def _find_first_event_for_day(
    session: Session,
    *,
    employee_id: int,
    local_day: date,
    event_type: AttendanceType,
) -> AttendanceEvent | None:
    tz = _attendance_timezone()
    reference_utc = datetime.combine(local_day, time(12, 0), tzinfo=tz).astimezone(timezone.utc)
    day_start_utc, day_end_utc = _local_day_bounds_utc(reference_utc)
    return session.scalar(
        select(AttendanceEvent)
        .where(
            AttendanceEvent.employee_id == employee_id,
            AttendanceEvent.type == event_type,
            AttendanceEvent.ts_utc >= day_start_utc,
            AttendanceEvent.ts_utc < day_end_utc,
            AttendanceEvent.deleted_at.is_(None),
        )
        .order_by(AttendanceEvent.ts_utc.asc(), AttendanceEvent.id.asc())
    )


def _has_any_event_for_day(session: Session, *, employee_id: int, local_day: date) -> bool:
    tz = _attendance_timezone()
    reference_utc = datetime.combine(local_day, time(12, 0), tzinfo=tz).astimezone(timezone.utc)
    day_start_utc, day_end_utc = _local_day_bounds_utc(reference_utc)
    return (
        session.scalar(
            select(AttendanceEvent.id)
            .where(
                AttendanceEvent.employee_id == employee_id,
                AttendanceEvent.ts_utc >= day_start_utc,
                AttendanceEvent.ts_utc < day_end_utc,
                AttendanceEvent.deleted_at.is_(None),
            )
            .limit(1)
        )
        is not None
    )


def _resolve_manual_override(session: Session, *, employee_id: int, local_day: date) -> ManualDayOverride | None:
    return session.scalar(
        select(ManualDayOverride).where(
            ManualDayOverride.employee_id == employee_id,
            ManualDayOverride.day_date == local_day,
        )
    )


def _resolve_checkout_event_after_checkin(
    session: Session,
    *,
    employee_id: int,
    first_checkin_ts_utc: datetime,
    search_until_utc: datetime,
) -> AttendanceEvent | None:
    return session.scalar(
        select(AttendanceEvent)
        .where(
            AttendanceEvent.employee_id == employee_id,
            AttendanceEvent.type == AttendanceType.OUT,
            AttendanceEvent.ts_utc >= first_checkin_ts_utc,
            AttendanceEvent.ts_utc <= search_until_utc,
            AttendanceEvent.deleted_at.is_(None),
        )
        .order_by(AttendanceEvent.ts_utc.asc(), AttendanceEvent.id.asc())
    )


def _event_is_manual(event: AttendanceEvent | None) -> bool:
    if event is None:
        return False
    flags = event.flags if isinstance(event.flags, dict) else {}
    return bool(
        event.source == AttendanceEventSource.MANUAL
        or event.created_by_admin
        or flags.get("MANUAL_EVENT") is True
        or flags.get("MANUAL_CHECKOUT") is True
    )


def _event_is_auto(event: AttendanceEvent | None) -> bool:
    if event is None:
        return False
    flags = event.flags if isinstance(event.flags, dict) else {}
    return bool(flags.get("AUTO_OVERTIME_CLOSE") is True or flags.get("AUTO_CHECKOUT_AT_MIDNIGHT") is True)


def _build_day_assessment(
    session: Session,
    *,
    employee: Employee,
    local_day: date,
) -> DayAssessment | None:
    manual_override = _resolve_manual_override(session, employee_id=employee.id, local_day=local_day)
    if manual_override is not None and manual_override.is_absent:
        return None

    first_checkin_event = _find_first_event_for_day(
        session,
        employee_id=employee.id,
        local_day=local_day,
        event_type=AttendanceType.IN,
    )
    plan, shift, default_shift, planned_minutes, grace_minutes, override_active, override_note = _resolve_shift_for_day(
        session,
        employee=employee,
        local_day=local_day,
        first_checkin_event=first_checkin_event,
    )

    if first_checkin_event is not None:
        first_checkin_ts_utc = _normalize_ts(first_checkin_event.ts_utc)
        first_checkin_source = "event"
    elif manual_override is not None and manual_override.in_ts is not None:
        first_checkin_ts_utc = _normalize_ts(manual_override.in_ts)
        first_checkin_source = "manual_override"
    else:
        first_checkin_ts_utc = None
        first_checkin_source = None

    reference_ts_utc = first_checkin_ts_utc or datetime.combine(
        local_day,
        time(12, 0),
        tzinfo=_attendance_timezone(),
    ).astimezone(timezone.utc)

    shift_end_local_dt = _resolve_shift_end_local_dt(
        local_day=local_day,
        shift=shift,
        reference_ts_utc=reference_ts_utc,
        planned_minutes=planned_minutes,
    )
    shift_start_local_dt = _resolve_shift_start_local_dt(
        local_day=local_day,
        shift=shift,
        shift_end_local_dt=shift_end_local_dt,
        planned_minutes=planned_minutes,
    )
    default_shift_end_local_dt = None
    if default_shift is not None:
        default_shift_end_local_dt = _resolve_shift_end_local_dt(
            local_day=local_day,
            shift=default_shift,
            reference_ts_utc=reference_ts_utc,
            planned_minutes=planned_minutes,
        )

    checkout_event: AttendanceEvent | None = None
    if first_checkin_ts_utc is not None:
        checkout_event = _resolve_checkout_event_after_checkin(
            session,
            employee_id=employee.id,
            first_checkin_ts_utc=first_checkin_ts_utc,
            search_until_utc=shift_end_local_dt.astimezone(timezone.utc) + timedelta(hours=OVERTIME_MAX_HOURS, minutes=1),
        )

    if manual_override is not None and manual_override.out_ts is not None:
        checkout_ts_utc = _normalize_ts(manual_override.out_ts)
        checkout_source = "manual_override"
        checkout_is_manual = True
        checkout_is_auto = False
    elif checkout_event is not None:
        checkout_ts_utc = _normalize_ts(checkout_event.ts_utc)
        checkout_source = "event"
        checkout_is_manual = _event_is_manual(checkout_event)
        checkout_is_auto = _event_is_auto(checkout_event)
    else:
        checkout_ts_utc = None
        checkout_source = None
        checkout_is_manual = False
        checkout_is_auto = False

    has_any_activity = _has_any_event_for_day(session, employee_id=employee.id, local_day=local_day)
    if manual_override is not None and (manual_override.in_ts is not None or manual_override.out_ts is not None):
        has_any_activity = True

    department_name = _resolve_department_name(session, employee)
    checkin_outside_shift = (
        _is_checkin_outside_shift(first_checkin_ts_utc, shift)
        if first_checkin_ts_utc is not None
        else None
    )

    return DayAssessment(
        employee=employee,
        local_day=local_day,
        department_name=department_name,
        plan=plan,
        shift=shift,
        default_shift=default_shift,
        first_checkin_ts_utc=first_checkin_ts_utc,
        first_checkin_source=first_checkin_source,
        checkout_ts_utc=checkout_ts_utc,
        checkout_source=checkout_source,
        checkout_is_manual=checkout_is_manual,
        checkout_is_auto=checkout_is_auto,
        shift_start_local_dt=shift_start_local_dt,
        shift_end_local_dt=shift_end_local_dt,
        default_shift_end_local_dt=default_shift_end_local_dt,
        grace_minutes=grace_minutes,
        planned_minutes=planned_minutes,
        override_active=override_active,
        override_note=override_note,
        has_any_activity=has_any_activity,
        checkin_outside_shift=checkin_outside_shift,
    )


def _monitor_payload(
    *,
    assessment: DayAssessment,
    notification_type: str,
    audience: str,
    risk_level: str,
    title: str,
    description: str,
    event_ts_utc: datetime,
    actual_time_summary: str,
    suggested_action: str,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "employee_id": assessment.employee.id,
        "employee_full_name": assessment.employee.full_name,
        "department_name": assessment.department_name,
        "shift_date": assessment.local_day.isoformat(),
        "notification_type": notification_type,
        "audience": audience,
        "risk_level": risk_level,
        "event_ts_utc": event_ts_utc.isoformat(),
        "event_ts_local": _format_local_dt(event_ts_utc),
        "shift_window_local": assessment.shift_window_local,
        "shift_name": assessment.shift.name if assessment.shift is not None else None,
        "first_checkin_local": _format_local_dt(assessment.first_checkin_ts_utc),
        "checkout_local": _format_local_dt(assessment.checkout_ts_utc),
        "checkout_source": assessment.checkout_source,
        "checkout_is_manual": assessment.checkout_is_manual,
        "checkout_is_auto": assessment.checkout_is_auto,
        "override_active": assessment.override_active,
        "override_note": assessment.override_note,
        "title": title,
        "description": description,
        "actual_time_summary": actual_time_summary,
        "suggested_action": suggested_action,
    }
    if extra:
        payload.update(extra)
    return payload


def _create_notification_job(
    session: Session,
    *,
    assessment: DayAssessment,
    notification_type: str,
    audience: str,
    risk_level: str,
    event_ts_utc: datetime,
    scheduled_at_utc: datetime,
    title: str,
    description: str,
    actual_time_summary: str,
    suggested_action: str,
    extra_payload: dict[str, Any] | None = None,
) -> NotificationJob | None:
    event_id, event_hash = _build_event_identity(
        employee_id=assessment.employee.id,
        local_day=assessment.local_day,
        notification_type=notification_type,
        audience=audience,
    )
    existing = session.scalar(select(NotificationJob).where(NotificationJob.event_hash == event_hash))
    if existing is not None:
        return None

    payload = _monitor_payload(
        assessment=assessment,
        notification_type=notification_type,
        audience=audience,
        risk_level=risk_level,
        title=title,
        description=description,
        event_ts_utc=event_ts_utc,
        actual_time_summary=actual_time_summary,
        suggested_action=suggested_action,
        extra=extra_payload,
    )
    job = NotificationJob(
        employee_id=assessment.employee.id,
        admin_user_id=None,
        job_type=JOB_TYPE_ATTENDANCE_MONITOR,
        notification_type=notification_type,
        audience=audience,
        risk_level=risk_level,
        event_id=event_id,
        event_hash=event_hash,
        local_day=assessment.local_day,
        event_ts_utc=event_ts_utc,
        title=title,
        description=description,
        shift_summary=assessment.shift_label,
        actual_time_summary=actual_time_summary,
        suggested_action=suggested_action,
        payload=payload,
        scheduled_at_utc=scheduled_at_utc,
        status="PENDING",
        attempts=0,
        last_error=None,
        idempotency_key=event_hash,
    )
    session.add(job)
    return job


def _schedule_for_both_audiences(
    session: Session,
    *,
    created_jobs: list[NotificationJob],
    assessment: DayAssessment,
    notification_type: str,
    event_ts_utc: datetime,
    scheduled_at_utc: datetime,
    employee_risk: str,
    employee_title: str,
    employee_description: str,
    admin_risk: str,
    admin_title: str,
    admin_description: str,
    actual_time_summary: str,
    employee_action: str,
    admin_action: str,
    extra_payload: dict[str, Any] | None = None,
) -> None:
    employee_job = _create_notification_job(
        session,
        assessment=assessment,
        notification_type=notification_type,
        audience=AUDIENCE_EMPLOYEE,
        risk_level=employee_risk,
        event_ts_utc=event_ts_utc,
        scheduled_at_utc=scheduled_at_utc,
        title=employee_title,
        description=employee_description,
        actual_time_summary=actual_time_summary,
        suggested_action=employee_action,
        extra_payload=extra_payload,
    )
    if employee_job is not None:
        created_jobs.append(employee_job)

    admin_job = _create_notification_job(
        session,
        assessment=assessment,
        notification_type=notification_type,
        audience=AUDIENCE_ADMIN,
        risk_level=admin_risk,
        event_ts_utc=event_ts_utc,
        scheduled_at_utc=scheduled_at_utc,
        title=admin_title,
        description=admin_description,
        actual_time_summary=actual_time_summary,
        suggested_action=admin_action,
        extra_payload=extra_payload,
    )
    if admin_job is not None:
        created_jobs.append(admin_job)


def _schedule_early_checkout(session: Session, *, created_jobs: list[NotificationJob], assessment: DayAssessment) -> None:
    if assessment.first_checkin_ts_utc is None or assessment.checkout_ts_utc is None:
        return
    shift_end_utc = assessment.shift_end_local_dt.astimezone(timezone.utc)
    if assessment.checkout_ts_utc >= shift_end_utc or assessment.override_active:
        return

    diff_minutes = _minutes_between(shift_end_utc, assessment.checkout_ts_utc)
    planned_text = _format_time(shift_end_utc)
    actual_text = _format_time(assessment.checkout_ts_utc)
    actual_summary = f"Planlanan bitis: {planned_text} | Gerceklesen cikis: {actual_text}"
    _schedule_for_both_audiences(
        session,
        created_jobs=created_jobs,
        assessment=assessment,
        notification_type=TYPE_EARLY_CHECKOUT,
        event_ts_utc=assessment.checkout_ts_utc,
        scheduled_at_utc=assessment.checkout_ts_utc,
        employee_risk=RISK_WARNING,
        employee_title="Erken Cikis Bilgilendirmesi",
        employee_description=(
            f"Planlanan vardiya bitis saati: {planned_text}. "
            f"Gerceklesen cikis: {actual_text}. Durum: Erken Cikis ({diff_minutes} dk)."
        ),
        admin_risk=RISK_WARNING,
        admin_title="Erken Cikis Tespit Edildi",
        admin_description=(
            f"{assessment.employee.full_name} icin planlanan vardiya bitis saati: {planned_text}. "
            f"Gerceklesen cikis: {actual_text}. Durum: Erken Cikis ({diff_minutes} dk)."
        ),
        actual_time_summary=actual_summary,
        employee_action="Kayit hataliysa yonetici ile gorusup manuel duzeltme isteyin.",
        admin_action="Giris-cikis timeline'ini kontrol edin; gerekiyorsa manuel duzeltme ve aciklama ekleyin.",
        extra_payload={
            "planned_shift_end_local": planned_text,
            "actual_checkout_local": actual_text,
            "duration_minutes": diff_minutes,
        },
    )


def _schedule_override_info(session: Session, *, created_jobs: list[NotificationJob], assessment: DayAssessment) -> None:
    if not assessment.override_active or assessment.checkout_ts_utc is None or assessment.default_shift_end_local_dt is None:
        return
    effective_end_utc = assessment.shift_end_local_dt.astimezone(timezone.utc)
    default_end_utc = assessment.default_shift_end_local_dt.astimezone(timezone.utc)
    if not (effective_end_utc <= assessment.checkout_ts_utc < default_end_utc):
        return

    job = _create_notification_job(
        session,
        assessment=assessment,
        notification_type=TYPE_OVERRIDE_INFO,
        audience=AUDIENCE_ADMIN,
        risk_level=RISK_INFO,
        event_ts_utc=assessment.checkout_ts_utc,
        scheduled_at_utc=assessment.checkout_ts_utc,
        title="Vardiya Override Bilgisi",
        description=(
            f"{assessment.employee.full_name} icin gecici vardiya duzeni aktif. "
            f"Efektif vardiya bitisi: {_format_time(effective_end_utc)}. "
            f"Gerceklesen cikis: {_format_time(assessment.checkout_ts_utc)}. "
            "Bu kayit erken cikis ihlali olarak isaretlenmedi."
        ),
        actual_time_summary=(
            f"Override bitis: {_format_time(effective_end_utc)} | "
            f"Gerceklesen cikis: {_format_time(assessment.checkout_ts_utc)}"
        ),
        suggested_action="Bilgi kaydi olarak izleyin. Ihlal alarmi uretmeyin.",
        extra_payload={"override_note": assessment.override_note},
    )
    if job is not None:
        created_jobs.append(job)


def _schedule_late_checkin(session: Session, *, created_jobs: list[NotificationJob], assessment: DayAssessment) -> None:
    if assessment.first_checkin_ts_utc is None or assessment.shift_start_local_dt is None:
        return
    late_threshold_utc = (
        assessment.shift_start_local_dt + timedelta(minutes=max(0, assessment.grace_minutes))
    ).astimezone(timezone.utc)
    if assessment.first_checkin_ts_utc <= late_threshold_utc:
        return

    diff_minutes = _minutes_between(assessment.first_checkin_ts_utc, late_threshold_utc)
    planned_text = _format_time(late_threshold_utc)
    actual_text = _format_time(assessment.first_checkin_ts_utc)
    actual_summary = f"Planlanan baslangic: {planned_text} | Gerceklesen giris: {actual_text}"
    _schedule_for_both_audiences(
        session,
        created_jobs=created_jobs,
        assessment=assessment,
        notification_type=TYPE_LATE_CHECKIN,
        event_ts_utc=assessment.first_checkin_ts_utc,
        scheduled_at_utc=assessment.first_checkin_ts_utc,
        employee_risk=RISK_WARNING,
        employee_title="Gec Giris Bilgilendirmesi",
        employee_description=(
            f"Planlanan vardiya baslangici: {planned_text}. "
            f"Gerceklesen giris: {actual_text}. Durum: Gec Giris ({diff_minutes} dk)."
        ),
        admin_risk=RISK_WARNING,
        admin_title="Gec Giris Tespit Edildi",
        admin_description=(
            f"{assessment.employee.full_name} icin planlanan vardiya baslangici: {planned_text}. "
            f"Gerceklesen giris: {actual_text}. Durum: Gec Giris ({diff_minutes} dk)."
        ),
        actual_time_summary=actual_summary,
        employee_action="Kayit hataliysa yonetici ile gorusup duzeltme talep edin.",
        admin_action="Cihaz kaydi ve gun timeline'ini kontrol edin; gerekiyorsa aciklama ekleyin.",
    )


def _schedule_off_shift_activity(session: Session, *, created_jobs: list[NotificationJob], assessment: DayAssessment) -> None:
    if assessment.first_checkin_ts_utc is None or assessment.checkin_outside_shift is not True:
        return

    actual_text = _format_time(assessment.first_checkin_ts_utc)
    actual_summary = f"Vardiya penceresi: {assessment.shift_window_local} | Gerceklesen giris: {actual_text}"
    _schedule_for_both_audiences(
        session,
        created_jobs=created_jobs,
        assessment=assessment,
        notification_type=TYPE_OFF_SHIFT_ACTIVITY,
        event_ts_utc=assessment.first_checkin_ts_utc,
        scheduled_at_utc=assessment.first_checkin_ts_utc,
        employee_risk=RISK_WARNING,
        employee_title="Vardiya Disi Aktivite Bilgisi",
        employee_description=(
            f"Girisiniz tanimli vardiya penceresi disinda algilandi. "
            f"Vardiya: {assessment.shift_window_local}. Gerceklesen giris: {actual_text}."
        ),
        admin_risk=RISK_WARNING,
        admin_title="Vardiya Disi Aktivite Tespit Edildi",
        admin_description=(
            f"{assessment.employee.full_name} icin vardiya disi giris algilandi. "
            f"Vardiya: {assessment.shift_window_local}. Gerceklesen giris: {actual_text}."
        ),
        actual_time_summary=actual_summary,
        employee_action="Kayit planli bir istisnaysa yoneticiye bilgi verin.",
        admin_action="Gece/istisna calisma durumu varsa aciklama ekleyin; degilse kaydi inceleyin.",
    )


def _schedule_absence(
    session: Session,
    *,
    created_jobs: list[NotificationJob],
    assessment: DayAssessment,
    now_utc: datetime,
) -> None:
    if assessment.first_checkin_ts_utc is not None or assessment.has_any_activity or assessment.shift_start_local_dt is None:
        return
    trigger_utc = (
        assessment.shift_end_local_dt + timedelta(minutes=max(0, assessment.grace_minutes))
    ).astimezone(timezone.utc)
    if now_utc < trigger_utc:
        return

    actual_summary = f"Vardiya: {assessment.shift_window_local} | Gerceklesen giris/cikis: Kayit yok"
    _schedule_for_both_audiences(
        session,
        created_jobs=created_jobs,
        assessment=assessment,
        notification_type=TYPE_ABSENCE,
        event_ts_utc=trigger_utc,
        scheduled_at_utc=trigger_utc,
        employee_risk=RISK_CRITICAL,
        employee_title="Devamsizlik Kaydi",
        employee_description=(
            f"Planlanan vardiya penceresi: {assessment.shift_window_local}. "
            "Bugun icin giris veya cikis kaydi bulunamadi."
        ),
        admin_risk=RISK_CRITICAL,
        admin_title="Devamsizlik Tespit Edildi",
        admin_description=(
            f"{assessment.employee.full_name} icin planlanan vardiya penceresi {assessment.shift_window_local}. "
            "Giris veya cikis kaydi bulunamadi."
        ),
        actual_time_summary=actual_summary,
        employee_action="Kayit eksikse yonetici ile iletisime gecin.",
        admin_action="Izin, rapor veya manuel duzeltme gerekip gerekmedigini kontrol edin.",
    )


def _schedule_overtime_started(
    session: Session,
    *,
    created_jobs: list[NotificationJob],
    assessment: DayAssessment,
    now_utc: datetime,
) -> None:
    if assessment.first_checkin_ts_utc is None or assessment.checkout_ts_utc is not None:
        return
    shift_end_utc = assessment.shift_end_local_dt.astimezone(timezone.utc)
    if now_utc < shift_end_utc:
        return
    overtime_minutes = _minutes_between(now_utc, shift_end_utc)
    actual_summary = f"Planlanan bitis: {_format_time(shift_end_utc)} | Guncel fazla mesai: {_format_minutes_label(overtime_minutes)}"
    _schedule_for_both_audiences(
        session,
        created_jobs=created_jobs,
        assessment=assessment,
        notification_type=TYPE_OVERTIME_STARTED,
        event_ts_utc=shift_end_utc,
        scheduled_at_utc=shift_end_utc,
        employee_risk=RISK_INFO,
        employee_title="Fazla Mesai Basladi",
        employee_description=(
            f"Planlanan vardiya bitis saati {_format_time(shift_end_utc)} itibariyla fazla mesainiz basladi. "
            "Maksimum 6 saate kadar devam edebilirsiniz."
        ),
        admin_risk=RISK_INFO,
        admin_title="Fazla Mesai Basladi",
        admin_description=(
            f"{assessment.employee.full_name} icin fazla mesai basladi. "
            f"Planlanan vardiya bitisi: {_format_time(shift_end_utc)}."
        ),
        actual_time_summary=actual_summary,
        employee_action="Fazla mesai sona erdiginde cikis kaydini tamamlayin.",
        admin_action="Gerekliyse operasyonel planlamayi kontrol edin.",
    )


def _schedule_overtime_warning(
    session: Session,
    *,
    created_jobs: list[NotificationJob],
    assessment: DayAssessment,
    now_utc: datetime,
) -> None:
    if assessment.first_checkin_ts_utc is None or assessment.checkout_ts_utc is not None:
        return
    shift_end_utc = assessment.shift_end_local_dt.astimezone(timezone.utc)
    warning_utc = shift_end_utc + timedelta(hours=OVERTIME_WARNING_HOURS)
    if now_utc < warning_utc:
        return

    actual_summary = (
        f"Planlanan bitis: {_format_time(shift_end_utc)} | "
        f"3 saat esigi: {_format_time(warning_utc)}"
    )
    _schedule_for_both_audiences(
        session,
        created_jobs=created_jobs,
        assessment=assessment,
        notification_type=TYPE_OVERTIME_3H,
        event_ts_utc=warning_utc,
        scheduled_at_utc=warning_utc,
        employee_risk=RISK_WARNING,
        employee_title="Fazla Mesai Uyarisi",
        employee_description=(
            "Bugun 3 saati asan fazla mesai yaptiniz. Maksimum 6 saate kadar devam edebilirsiniz. "
            "6 saat asiminda sistem otomatik olarak mesainizi kapatacaktir."
        ),
        admin_risk=RISK_INFO,
        admin_title="Calisan Fazla Mesai Limitine Yaklasiyor",
        admin_description=(
            f"{assessment.employee.full_name} bugun 3 saat fazla mesaiye ulasmistir. "
            "6 saat sinirinda sistem otomatik kapatma yapacaktir. Gerekirse mudahale edin."
        ),
        actual_time_summary=actual_summary,
        employee_action="Mesai sona erdiyse cikis kaydini tamamlayin.",
        admin_action="Operasyon ihtiyaci devam etmiyorsa cikisi kapattirin veya duzeltme yapin.",
    )


def _auto_close_open_shift(
    session: Session,
    *,
    assessment: DayAssessment,
    open_event: AttendanceEvent,
    auto_close_utc: datetime,
) -> AttendanceEvent:
    flags: dict[str, Any] = {
        "AUTO_OVERTIME_CLOSE": True,
        "AUTO_OVERTIME_MAX_HOURS": OVERTIME_MAX_HOURS,
        "SHIFT_DATE": assessment.local_day.isoformat(),
        "SHIFT_WINDOW_LOCAL": assessment.shift_window_local,
    }
    inherited_shift_id = _extract_shift_id_from_flags(open_event.flags)
    if inherited_shift_id is not None:
        flags["SHIFT_ID"] = inherited_shift_id
    if assessment.shift is not None:
        flags["SHIFT_NAME"] = assessment.shift.name

    auto_event = AttendanceEvent(
        employee_id=assessment.employee.id,
        device_id=open_event.device_id,
        type=AttendanceType.OUT,
        ts_utc=auto_close_utc,
        lat=None,
        lon=None,
        accuracy_m=None,
        location_status=LocationStatus.NO_LOCATION,
        flags=flags,
        source=AttendanceEventSource.MANUAL,
        created_by_admin=True,
        note="Sistem 6 saat fazla mesai sinirinda otomatik cikis olusturdu",
    )
    session.add(auto_event)
    session.flush()
    return auto_event


def _schedule_overtime_auto_close(
    session: Session,
    *,
    created_jobs: list[NotificationJob],
    assessment: DayAssessment,
    now_utc: datetime,
    open_event: AttendanceEvent | None,
) -> bool:
    if assessment.first_checkin_ts_utc is None or assessment.checkout_ts_utc is not None or open_event is None:
        return False
    shift_end_utc = assessment.shift_end_local_dt.astimezone(timezone.utc)
    auto_close_utc = shift_end_utc + timedelta(hours=OVERTIME_MAX_HOURS)
    if now_utc < auto_close_utc:
        return False

    auto_event = _auto_close_open_shift(
        session,
        assessment=assessment,
        open_event=open_event,
        auto_close_utc=auto_close_utc,
    )
    actual_summary = (
        f"Planlanan bitis: {_format_time(shift_end_utc)} | "
        f"Otomatik kapatma: {_format_time(auto_close_utc)}"
    )
    _schedule_for_both_audiences(
        session,
        created_jobs=created_jobs,
        assessment=assessment,
        notification_type=TYPE_OVERTIME_6H_CLOSED,
        event_ts_utc=auto_close_utc,
        scheduled_at_utc=auto_close_utc,
        employee_risk=RISK_CRITICAL,
        employee_title="Fazla Mesai Otomatik Kapatildi",
        employee_description=(
            "Bugunku fazla mesainiz 6 saat sinirina ulasti. Sistem kaydinizi otomatik olarak kapatti."
        ),
        admin_risk=RISK_CRITICAL,
        admin_title="Fazla Mesai Sistem Tarafindan Kapatildi",
        admin_description=(
            f"{assessment.employee.full_name} icin fazla mesai 6 saat sinirina ulasti. "
            "Sistem otomatik cikis olusturdu."
        ),
        actual_time_summary=actual_summary,
        employee_action="Kayit hataliysa yonetici ile gorusup duzeltme talep edin.",
        admin_action="Timeline'i kontrol edin; gerekiyorsa manuel duzeltme ve aciklama ekleyin.",
        extra_payload={
            "auto_checkout_event_id": auto_event.id,
            "auto_checkout_local": _format_local_dt(auto_close_utc),
        },
    )
    return True


def schedule_attendance_monitor_notifications(
    now_utc: datetime,
    db: Session | None = None,
) -> list[NotificationJob]:
    if db is None:
        with SessionLocal() as managed_db:
            return schedule_attendance_monitor_notifications(now_utc, db=managed_db)

    session = db
    reference_utc = _normalize_ts(now_utc)
    local_today = reference_utc.astimezone(_attendance_timezone()).date()
    candidate_days = [local_today - timedelta(days=1), local_today]
    employees = list(
        session.scalars(
            select(Employee)
            .where(Employee.is_active.is_(True))
            .order_by(Employee.id.asc())
        ).all()
    )

    created_jobs: list[NotificationJob] = []
    any_db_change = False

    for employee in employees:
        active_open_event = _resolve_active_open_shift_event(
            session,
            employee=employee,
            reference_ts_utc=reference_utc,
        )

        for local_day in candidate_days:
            assessment = _build_day_assessment(session, employee=employee, local_day=local_day)
            if assessment is None:
                continue

            is_active_open_day = (
                active_open_event is not None
                and active_open_event.employee_id == employee.id
                and _normalize_ts(active_open_event.ts_utc).astimezone(_attendance_timezone()).date() == local_day
            )
            open_event = active_open_event if is_active_open_day else None

            _schedule_late_checkin(session, created_jobs=created_jobs, assessment=assessment)
            _schedule_off_shift_activity(session, created_jobs=created_jobs, assessment=assessment)
            _schedule_early_checkout(session, created_jobs=created_jobs, assessment=assessment)
            _schedule_override_info(session, created_jobs=created_jobs, assessment=assessment)
            _schedule_absence(session, created_jobs=created_jobs, assessment=assessment, now_utc=reference_utc)
            _schedule_overtime_started(session, created_jobs=created_jobs, assessment=assessment, now_utc=reference_utc)
            _schedule_overtime_warning(session, created_jobs=created_jobs, assessment=assessment, now_utc=reference_utc)
            if _schedule_overtime_auto_close(
                session,
                created_jobs=created_jobs,
                assessment=assessment,
                now_utc=reference_utc,
                open_event=open_event,
            ):
                any_db_change = True

    if not created_jobs and not any_db_change:
        return []

    session.commit()
    return created_jobs
