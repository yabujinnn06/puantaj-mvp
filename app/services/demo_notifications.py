from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
import hashlib

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import AuditLog, NotificationJob
from app.services.activity_events import (
    EVENT_APP_DEMO_END,
    EVENT_APP_DEMO_MARK,
    EVENT_APP_DEMO_START,
    MODULE_APP,
)
from app.services.attendance import _attendance_timezone, _normalize_ts
from app.services.attendance_notification_monitor import (
    AUDIENCE_ADMIN,
    AUDIENCE_EMPLOYEE,
)
from app.services.notifications import get_employees_with_open_shift

JOB_TYPE_DEMO_MONITOR = "DEMO_MONITOR"

TYPE_DEMO_END_REMINDER = "demo_end_reminder"
TYPE_DEMO_LONG_RUNNING = "demo_long_running"
TYPE_DEMO_GAP = "demo_gap"

RISK_WARNING = "Uyari"
RISK_CRITICAL = "Kritik"

DEMO_END_REMINDER_AFTER = timedelta(hours=1)
DEMO_ADMIN_ESCALATION_AFTER = timedelta(hours=2)
DEMO_GAP_REMINDER_AFTER = timedelta(hours=2)
DEMO_GAP_REPEAT_AFTER = timedelta(hours=2)


def _local_day_bounds_utc(local_day: date) -> tuple[datetime, datetime]:
    tz = _attendance_timezone()
    day_start_local = datetime.combine(local_day, time.min, tzinfo=tz)
    day_end_local = day_start_local + timedelta(days=1)
    return day_start_local.astimezone(timezone.utc), day_end_local.astimezone(timezone.utc)


def _format_local_dt(value: datetime | None) -> str:
    if value is None:
        return "-"
    return _normalize_ts(value).astimezone(_attendance_timezone()).strftime("%d.%m.%Y %H:%M")


def _duration_minutes(reference_utc: datetime, event_utc: datetime) -> int:
    return max(0, int((_normalize_ts(reference_utc) - _normalize_ts(event_utc)).total_seconds() // 60))


def _create_job_if_missing(
    session: Session,
    *,
    employee_id: int,
    employee_name: str,
    department_name: str | None,
    local_day: date,
    audience: str,
    notification_type: str,
    risk_level: str,
    event_ts_utc: datetime,
    scheduled_at_utc: datetime,
    identity_suffix: str,
    title: str,
    description: str,
    actual_time_summary: str,
    suggested_action: str,
    extra_payload: dict[str, str | int | float | bool | None] | None = None,
) -> NotificationJob | None:
    identity_seed = (
        f"{employee_id}:{local_day.isoformat()}:{notification_type}:{audience}:{identity_suffix}"
    )
    event_hash = hashlib.sha256(identity_seed.encode("utf-8")).hexdigest()
    existing = session.scalar(select(NotificationJob.id).where(NotificationJob.event_hash == event_hash))
    if existing is not None:
        return None

    event_id = (
        f"DEMO-{local_day.strftime('%Y%m%d')}-{employee_id}-"
        f"{notification_type.upper()}-{audience.upper()}-{identity_suffix.upper()}"
    )
    payload: dict[str, str | int | float | bool | None | list[int]] = {
        "audience": audience,
        "employee_full_name": employee_name,
        "department_name": department_name,
        "shift_date": local_day.isoformat(),
        "event_ts_utc": _normalize_ts(event_ts_utc).isoformat(),
        "event_ts_local": _format_local_dt(event_ts_utc),
        "actual_time_summary": actual_time_summary,
        "suggested_action": suggested_action,
    }
    if audience == AUDIENCE_EMPLOYEE:
        payload["employee_ids"] = [employee_id]
    else:
        payload["admin_scope"] = "all"
    if extra_payload:
        payload.update(extra_payload)

    job = NotificationJob(
        employee_id=employee_id,
        admin_user_id=None,
        job_type=JOB_TYPE_DEMO_MONITOR,
        notification_type=notification_type,
        audience=audience,
        risk_level=risk_level,
        event_id=event_id,
        event_hash=event_hash,
        local_day=local_day,
        event_ts_utc=_normalize_ts(event_ts_utc),
        title=title,
        description=description,
        shift_summary="Demo takip akisi",
        actual_time_summary=actual_time_summary,
        suggested_action=suggested_action,
        payload=payload,
        scheduled_at_utc=_normalize_ts(scheduled_at_utc),
        status="PENDING",
        attempts=0,
        last_error=None,
        idempotency_key=event_hash,
    )
    session.add(job)
    return job


def schedule_demo_monitor_notifications(
    now_utc: datetime,
    db: Session | None = None,
) -> list[NotificationJob]:
    if db is None:
        with SessionLocal() as managed_db:
            return schedule_demo_monitor_notifications(now_utc, db=managed_db)

    session = db
    reference_utc = _normalize_ts(now_utc)
    created_jobs: list[NotificationJob] = []

    for record in get_employees_with_open_shift(reference_utc, db=session):
        day_start_utc, _ = _local_day_bounds_utc(record.local_day)
        demo_logs = list(
            session.scalars(
                select(AuditLog)
                .where(
                    AuditLog.employee_id == record.employee_id,
                    AuditLog.module == MODULE_APP,
                    AuditLog.action == "EMPLOYEE_APP_LOCATION_PING",
                    AuditLog.ts_utc >= day_start_utc,
                    AuditLog.ts_utc <= reference_utc,
                    AuditLog.event_type.in_(
                        (
                            EVENT_APP_DEMO_START,
                            EVENT_APP_DEMO_END,
                            EVENT_APP_DEMO_MARK,
                        )
                    ),
                )
                .order_by(AuditLog.ts_utc.asc(), AuditLog.id.asc())
            ).all()
        )
        if not demo_logs:
            continue

        latest_start_log: AuditLog | None = None
        latest_end_log: AuditLog | None = None
        for log_item in demo_logs:
            event_type = str(log_item.event_type or "").strip().lower()
            if event_type in {EVENT_APP_DEMO_START, EVENT_APP_DEMO_MARK}:
                latest_start_log = log_item
            elif event_type == EVENT_APP_DEMO_END:
                latest_end_log = log_item

        latest_start_utc = _normalize_ts(latest_start_log.ts_utc) if latest_start_log is not None else None
        latest_end_utc = _normalize_ts(latest_end_log.ts_utc) if latest_end_log is not None else None
        demo_active = bool(
            latest_start_utc is not None
            and (latest_end_utc is None or latest_start_utc > latest_end_utc)
        )

        employee_name = record.employee_full_name or f"#{record.employee_id}"

        if demo_active and latest_start_log is not None and latest_start_utc is not None:
            active_for = reference_utc - latest_start_utc
            active_minutes = _duration_minutes(reference_utc, latest_start_utc)
            actual_time_summary = (
                f"Demo baslangici: {_format_local_dt(latest_start_utc)} | "
                f"Acik sure: {active_minutes} dk"
            )

            if active_for >= DEMO_END_REMINDER_AFTER:
                employee_job = _create_job_if_missing(
                    session,
                    employee_id=record.employee_id,
                    employee_name=employee_name,
                    department_name=record.department_name,
                    local_day=record.local_day,
                    audience=AUDIENCE_EMPLOYEE,
                    notification_type=TYPE_DEMO_END_REMINDER,
                    risk_level=RISK_WARNING,
                    event_ts_utc=latest_start_utc,
                    scheduled_at_utc=reference_utc,
                    identity_suffix=f"start-{latest_start_log.id}-1h",
                    title="Demo bitisi bekleniyor",
                    description="Demo baslangicindan beri 1 saat gecti. Demo bittiyse bitis butonuna basin.",
                    actual_time_summary=actual_time_summary,
                    suggested_action="Demo bittiyse employee uygulamasindan Demo Bitti butonuna basin.",
                    extra_payload={
                        "demo_started_local": _format_local_dt(latest_start_utc),
                        "demo_open_minutes": active_minutes,
                    },
                )
                if employee_job is not None:
                    created_jobs.append(employee_job)

            if active_for >= DEMO_ADMIN_ESCALATION_AFTER:
                admin_job = _create_job_if_missing(
                    session,
                    employee_id=record.employee_id,
                    employee_name=employee_name,
                    department_name=record.department_name,
                    local_day=record.local_day,
                    audience=AUDIENCE_ADMIN,
                    notification_type=TYPE_DEMO_LONG_RUNNING,
                    risk_level=RISK_CRITICAL,
                    event_ts_utc=latest_start_utc,
                    scheduled_at_utc=reference_utc,
                    identity_suffix=f"start-{latest_start_log.id}-2h",
                    title="Demo 2 saattir bitmedi",
                    description=(
                        f"{employee_name} icin demo baslangicinin uzerinden 2 saatten fazla gecti."
                    ),
                    actual_time_summary=actual_time_summary,
                    suggested_action="Calisanla iletisime gecip demo bitis kaydini kontrol edin.",
                    extra_payload={
                        "demo_started_local": _format_local_dt(latest_start_utc),
                        "demo_open_minutes": active_minutes,
                    },
                )
                if admin_job is not None:
                    created_jobs.append(admin_job)
            continue

        if latest_end_log is None or latest_end_utc is None:
            continue

        gap_duration = reference_utc - latest_end_utc
        if gap_duration < DEMO_GAP_REMINDER_AFTER:
            continue

        gap_minutes = _duration_minutes(reference_utc, latest_end_utc)
        gap_bucket = int(gap_duration.total_seconds() // DEMO_GAP_REPEAT_AFTER.total_seconds())
        if gap_bucket < 1:
            continue

        actual_time_summary = (
            f"Son demo bitisi: {_format_local_dt(latest_end_utc)} | "
            f"Yeni demo araligi: {gap_minutes} dk"
        )
        extra_payload = {
            "demo_ended_local": _format_local_dt(latest_end_utc),
            "demo_gap_minutes": gap_minutes,
            "demo_gap_bucket": gap_bucket,
        }

        employee_job = _create_job_if_missing(
            session,
            employee_id=record.employee_id,
            employee_name=employee_name,
            department_name=record.department_name,
            local_day=record.local_day,
            audience=AUDIENCE_EMPLOYEE,
            notification_type=TYPE_DEMO_GAP,
            risk_level=RISK_WARNING,
            event_ts_utc=latest_end_utc,
            scheduled_at_utc=reference_utc,
            identity_suffix=f"end-{latest_end_log.id}-gap-{gap_bucket}-employee",
            title="Son demodan beri yeni kayit yok",
            description=(
                "Son demo kaydinizin uzerinden 2 saatten fazla gecti. "
                "Yeni bir demoya gittiyseniz Demo Basladi butonunu kullanin."
            ),
            actual_time_summary=actual_time_summary,
            suggested_action="Yeni bir demo basladiysa employee uygulamasindan Demo Basladi butonuna basin.",
            extra_payload=extra_payload,
        )
        if employee_job is not None:
            created_jobs.append(employee_job)

        admin_job = _create_job_if_missing(
            session,
            employee_id=record.employee_id,
            employee_name=employee_name,
            department_name=record.department_name,
            local_day=record.local_day,
            audience=AUDIENCE_ADMIN,
            notification_type=TYPE_DEMO_GAP,
            risk_level=RISK_WARNING,
            event_ts_utc=latest_end_utc,
            scheduled_at_utc=reference_utc,
            identity_suffix=f"end-{latest_end_log.id}-gap-{gap_bucket}-admin",
            title="Calisan 2 saattir yeni demo kaydi olusturmadi",
            description=(
                f"{employee_name} icin son demo bitisinin uzerinden 2 saatten fazla gecti."
            ),
            actual_time_summary=actual_time_summary,
            suggested_action="Saha akisinda yeni demo noktasi varsa kaydin alinip alinmadigini kontrol edin.",
            extra_payload=extra_payload,
        )
        if admin_job is not None:
            created_jobs.append(admin_job)

    if created_jobs:
        session.commit()
        for job in created_jobs:
            session.refresh(job)

    return created_jobs
