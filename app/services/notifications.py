from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
import logging
import os
import smtplib
from email.message import EmailMessage
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import log_audit
from app.db import SessionLocal
from app.models import (
    AdminUser,
    AuditActorType,
    AttendanceEvent,
    AttendanceType,
    DepartmentShift,
    Employee,
    ManualDayOverride,
    NotificationJob,
    WorkRule,
)
from app.services.attendance import _attendance_timezone, _local_day_bounds_utc, _normalize_ts
from app.services.schedule_plans import resolve_effective_plan_for_employee_day

DEFAULT_DAILY_MINUTES_PLANNED = 540
DEFAULT_GRACE_MINUTES = 5
DEFAULT_ESCALATION_DELAY_MINUTES = 30
MAX_NOTIFICATION_ATTEMPTS = 5
JOB_TYPE_EMPLOYEE_MISSED_CHECKOUT = "EMPLOYEE_MISSED_CHECKOUT"
JOB_TYPE_ADMIN_ESCALATION_MISSED_CHECKOUT = "ADMIN_ESCALATION_MISSED_CHECKOUT"

logger = logging.getLogger("app.notifications")


@dataclass(frozen=True, slots=True)
class OpenShiftNotificationRecord:
    employee_id: int
    local_day: date
    shift_end_local: time
    grace_deadline_utc: datetime
    escalation_deadline_utc: datetime


@dataclass(frozen=True, slots=True)
class NotificationMessage:
    recipients: list[str]
    subject: str
    body: str


class NotificationChannel:
    configured: bool = False

    def send(self, message: NotificationMessage) -> None:
        raise NotImplementedError


class EmailChannel(NotificationChannel):
    def __init__(self) -> None:
        self.smtp_host = (os.getenv("SMTP_HOST") or "").strip()
        self.smtp_port = int((os.getenv("SMTP_PORT") or "587").strip() or "587")
        self.smtp_user = (os.getenv("SMTP_USER") or "").strip()
        self.smtp_pass = os.getenv("SMTP_PASS") or ""
        self.smtp_from = (os.getenv("SMTP_FROM") or "").strip()
        self.smtp_use_tls = (os.getenv("SMTP_USE_TLS") or "true").strip().lower() not in {"0", "false", "no"}
        self.configured = bool(self.smtp_host and self.smtp_from)

    def send(self, message: NotificationMessage) -> None:
        recipients = [item.strip() for item in message.recipients if item and item.strip()]
        if not recipients and self.configured:
            raise ValueError("No email recipients resolved for configured SMTP send")

        if not self.configured:
            logger.info(
                "email_channel_placeholder_send",
                extra={
                    "subject": message.subject,
                    "recipients": recipients,
                    "body": message.body,
                },
            )
            return

        email_message = EmailMessage()
        email_message["From"] = self.smtp_from
        email_message["To"] = ", ".join(recipients)
        email_message["Subject"] = message.subject
        email_message.set_content(message.body)

        with smtplib.SMTP(self.smtp_host, self.smtp_port, timeout=15) as smtp_client:
            if self.smtp_use_tls:
                smtp_client.starttls()
            if self.smtp_user:
                smtp_client.login(self.smtp_user, self.smtp_pass)
            smtp_client.send_message(email_message)


def _parse_shift_id_from_flags(flags: dict[str, Any] | None) -> int | None:
    if not flags:
        return None
    raw = flags.get("SHIFT_ID")
    if isinstance(raw, int) and raw > 0:
        return raw
    if isinstance(raw, str) and raw.isdigit():
        value = int(raw)
        if value > 0:
            return value
    return None


def _resolve_shift_end_local_dt(
    *,
    local_day: date,
    shift: DepartmentShift | None,
    first_in_ts_utc: datetime,
    planned_minutes: int,
) -> datetime:
    tz = _attendance_timezone()
    if shift is not None:
        shift_end_date = local_day
        if shift.end_time_local <= shift.start_time_local:
            shift_end_date = local_day + timedelta(days=1)
        return datetime.combine(shift_end_date, shift.end_time_local, tzinfo=tz)

    first_in_local = _normalize_ts(first_in_ts_utc).astimezone(tz)
    return first_in_local + timedelta(minutes=max(0, planned_minutes))


def get_employees_with_open_shift(
    now_utc: datetime,
    db: Session | None = None,
) -> list[OpenShiftNotificationRecord]:
    if db is None:
        with SessionLocal() as managed_db:
            return get_employees_with_open_shift(now_utc, db=managed_db)

    session = db
    reference_utc = _normalize_ts(now_utc)
    tz = _attendance_timezone()
    local_day = reference_utc.astimezone(tz).date()
    day_start_utc, day_end_utc = _local_day_bounds_utc(reference_utc)

    employees = list(
        session.scalars(
            select(Employee)
            .where(Employee.is_active.is_(True))
            .order_by(Employee.id.asc())
        ).all()
    )

    records: list[OpenShiftNotificationRecord] = []
    for employee in employees:
        manual_override = session.scalar(
            select(ManualDayOverride).where(
                ManualDayOverride.employee_id == employee.id,
                ManualDayOverride.day_date == local_day,
            )
        )
        if manual_override is not None and (manual_override.is_absent or manual_override.out_ts is not None):
            continue

        first_in = session.scalar(
            select(AttendanceEvent)
            .where(
                AttendanceEvent.employee_id == employee.id,
                AttendanceEvent.type == AttendanceType.IN,
                AttendanceEvent.ts_utc >= day_start_utc,
                AttendanceEvent.ts_utc < day_end_utc,
                AttendanceEvent.deleted_at.is_(None),
            )
            .order_by(AttendanceEvent.ts_utc.asc(), AttendanceEvent.id.asc())
        )
        if first_in is None:
            continue

        last_out = session.scalar(
            select(AttendanceEvent)
            .where(
                AttendanceEvent.employee_id == employee.id,
                AttendanceEvent.type == AttendanceType.OUT,
                AttendanceEvent.ts_utc >= day_start_utc,
                AttendanceEvent.ts_utc < day_end_utc,
                AttendanceEvent.deleted_at.is_(None),
            )
            .order_by(AttendanceEvent.ts_utc.desc(), AttendanceEvent.id.desc())
        )
        if last_out is not None:
            continue

        planned_minutes = DEFAULT_DAILY_MINUTES_PLANNED
        grace_minutes = DEFAULT_GRACE_MINUTES
        if employee.department_id is not None:
            work_rule = session.scalar(
                select(WorkRule).where(WorkRule.department_id == employee.department_id)
            )
            if work_rule is not None:
                planned_minutes = work_rule.daily_minutes_planned
                grace_minutes = work_rule.grace_minutes

        plan = resolve_effective_plan_for_employee_day(
            session,
            employee=employee,
            day_date=local_day,
        )
        if plan is not None:
            if plan.daily_minutes_planned is not None:
                planned_minutes = plan.daily_minutes_planned
            if plan.grace_minutes is not None:
                grace_minutes = plan.grace_minutes

        shift: DepartmentShift | None = None
        if plan is not None and plan.shift_id is not None:
            shift = session.get(DepartmentShift, plan.shift_id)
        if shift is None and employee.shift_id is not None:
            shift = session.get(DepartmentShift, employee.shift_id)
        if shift is None:
            event_shift_id = _parse_shift_id_from_flags(first_in.flags)
            if event_shift_id is not None:
                shift = session.get(DepartmentShift, event_shift_id)

        shift_end_local_dt = _resolve_shift_end_local_dt(
            local_day=local_day,
            shift=shift,
            first_in_ts_utc=first_in.ts_utc,
            planned_minutes=planned_minutes,
        )
        grace_deadline_utc = (
            shift_end_local_dt + timedelta(minutes=max(0, grace_minutes))
        ).astimezone(timezone.utc)
        escalation_deadline_utc = grace_deadline_utc + timedelta(
            minutes=DEFAULT_ESCALATION_DELAY_MINUTES
        )

        records.append(
            OpenShiftNotificationRecord(
                employee_id=employee.id,
                local_day=local_day,
                shift_end_local=shift_end_local_dt.timetz().replace(tzinfo=None),
                grace_deadline_utc=grace_deadline_utc,
                escalation_deadline_utc=escalation_deadline_utc,
            )
        )

    return records


def _build_idempotency_key(*, job_type: str, employee_id: int, local_day: date) -> str:
    return f"{job_type}:{employee_id}:{local_day.isoformat()}"


def _has_pending_or_sent_job(session: Session, *, idempotency_key: str) -> bool:
    existing = session.scalar(
        select(NotificationJob.id).where(
            NotificationJob.idempotency_key == idempotency_key,
            NotificationJob.status.in_(("PENDING", "SENT")),
        )
    )
    return existing is not None


def _build_notification_payload(
    *,
    local_day: date,
    shift_end_local: time,
    grace_deadline_utc: datetime,
    escalation_deadline_utc: datetime,
) -> dict[str, str]:
    return {
        "shift_date": local_day.isoformat(),
        "planned_checkout_time": shift_end_local.isoformat(timespec="minutes"),
        "grace_deadline_utc": grace_deadline_utc.isoformat(),
        "escalation_deadline_utc": escalation_deadline_utc.isoformat(),
    }


def _create_notification_job_if_needed(
    session: Session,
    *,
    job_type: str,
    employee_id: int,
    local_day: date,
    scheduled_at_utc: datetime,
    payload: dict[str, str],
) -> NotificationJob | None:
    idempotency_key = _build_idempotency_key(
        job_type=job_type,
        employee_id=employee_id,
        local_day=local_day,
    )
    if _has_pending_or_sent_job(session, idempotency_key=idempotency_key):
        return None

    job = NotificationJob(
        employee_id=employee_id,
        admin_user_id=None,
        job_type=job_type,
        payload=payload,
        scheduled_at_utc=scheduled_at_utc,
        status="PENDING",
        attempts=0,
        last_error=None,
        idempotency_key=idempotency_key,
    )
    session.add(job)
    return job


def _claim_due_pending_jobs(
    session: Session,
    *,
    now_utc: datetime,
    limit: int,
) -> list[NotificationJob]:
    with session.begin():
        stmt = (
            select(NotificationJob)
            .where(
                NotificationJob.status == "PENDING",
                NotificationJob.scheduled_at_utc <= now_utc,
            )
            .order_by(NotificationJob.scheduled_at_utc.asc(), NotificationJob.id.asc())
            .limit(limit)
            .with_for_update(skip_locked=True)
        )
        jobs = list(session.scalars(stmt).all())
        for job in jobs:
            job.status = "SENDING"
    return jobs


def _admin_notification_emails(session: Session) -> list[str]:
    values: set[str] = set()
    configured = (os.getenv("ADMIN_NOTIFICATION_EMAILS") or "").strip()
    if configured:
        for raw in configured.split(","):
            item = raw.strip()
            if item:
                values.add(item)

    admin_users = list(
        session.scalars(
            select(AdminUser).where(AdminUser.is_active.is_(True)).order_by(AdminUser.id.asc())
        ).all()
    )
    for user in admin_users:
        username = (user.username or "").strip()
        if "@" in username:
            values.add(username)
    return sorted(values)


def _employee_notification_emails(session: Session, *, job: NotificationJob) -> list[str]:
    payload = job.payload or {}
    values: set[str] = set()
    payload_email = payload.get("employee_email")
    if isinstance(payload_email, str) and payload_email.strip():
        values.add(payload_email.strip())

    if job.employee_id is not None:
        employee = session.get(Employee, job.employee_id)
        if employee is not None:
            employee_email = getattr(employee, "email", None)
            if isinstance(employee_email, str) and employee_email.strip():
                values.add(employee_email.strip())

    return sorted(values)


def _build_message_for_job(session: Session, job: NotificationJob) -> NotificationMessage:
    payload = job.payload or {}
    shift_date = str(payload.get("shift_date", "-"))
    planned_checkout_time = str(payload.get("planned_checkout_time", "-"))
    grace_deadline = str(payload.get("grace_deadline_utc", "-"))
    escalation_deadline = str(payload.get("escalation_deadline_utc", "-"))

    if job.job_type == JOB_TYPE_EMPLOYEE_MISSED_CHECKOUT:
        recipients = _employee_notification_emails(session, job=job)
        return NotificationMessage(
            recipients=recipients,
            subject="Puantaj Uyarısı: Çıkış Kaydı Eksik",
            body=(
                f"Çalışan #{job.employee_id} için {shift_date} vardiyasında çıkış kaydı eksik görünüyor.\n"
                f"Planlı çıkış saati: {planned_checkout_time}\n"
                f"Grace deadline (UTC): {grace_deadline}\n"
                f"Lütfen mesai çıkış kaydınızı tamamlayın."
            ),
        )

    if job.job_type == JOB_TYPE_ADMIN_ESCALATION_MISSED_CHECKOUT:
        recipients = _admin_notification_emails(session)
        return NotificationMessage(
            recipients=recipients,
            subject="Puantaj Eskalasyon: Çıkış Eksikliği Devam Ediyor",
            body=(
                f"Çalışan #{job.employee_id} için {shift_date} günü çıkış kaydı hâlâ eksik.\n"
                f"Planlı çıkış saati: {planned_checkout_time}\n"
                f"Grace deadline (UTC): {grace_deadline}\n"
                f"Eskalasyon deadline (UTC): {escalation_deadline}\n"
                f"Lütfen manuel kontrol yapın."
            ),
        )

    raise ValueError(f"Unsupported notification job_type: {job.job_type}")


def _mark_job_sent(session: Session, *, job_id: int) -> NotificationJob | None:
    job = session.get(NotificationJob, job_id)
    if job is None:
        return None
    job.status = "SENT"
    job.last_error = None
    session.commit()
    session.refresh(job)
    return job


def _mark_job_failure(
    session: Session,
    *,
    job_id: int,
    error: Exception,
    now_utc: datetime,
) -> NotificationJob | None:
    job = session.get(NotificationJob, job_id)
    if job is None:
        return None

    next_attempts = (job.attempts or 0) + 1
    job.attempts = next_attempts
    job.last_error = str(error)[:4000]
    if next_attempts < MAX_NOTIFICATION_ATTEMPTS:
        backoff_minutes = 2 ** next_attempts
        job.status = "PENDING"
        job.scheduled_at_utc = now_utc + timedelta(minutes=backoff_minutes)
    else:
        job.status = "FAILED"

    session.commit()
    session.refresh(job)
    return job


def schedule_missed_checkout_notifications(
    now_utc: datetime,
    db: Session | None = None,
) -> list[NotificationJob]:
    if db is None:
        with SessionLocal() as managed_db:
            return schedule_missed_checkout_notifications(now_utc, db=managed_db)

    session = db
    reference_utc = _normalize_ts(now_utc)
    open_shifts = get_employees_with_open_shift(reference_utc, db=session)
    created_jobs: list[NotificationJob] = []

    for record in open_shifts:
        payload = _build_notification_payload(
            local_day=record.local_day,
            shift_end_local=record.shift_end_local,
            grace_deadline_utc=record.grace_deadline_utc,
            escalation_deadline_utc=record.escalation_deadline_utc,
        )

        if reference_utc >= record.grace_deadline_utc:
            employee_job = _create_notification_job_if_needed(
                session,
                job_type=JOB_TYPE_EMPLOYEE_MISSED_CHECKOUT,
                employee_id=record.employee_id,
                local_day=record.local_day,
                scheduled_at_utc=record.grace_deadline_utc,
                payload=payload,
            )
            if employee_job is not None:
                created_jobs.append(employee_job)

        if reference_utc >= record.escalation_deadline_utc:
            escalation_job = _create_notification_job_if_needed(
                session,
                job_type=JOB_TYPE_ADMIN_ESCALATION_MISSED_CHECKOUT,
                employee_id=record.employee_id,
                local_day=record.local_day,
                scheduled_at_utc=record.escalation_deadline_utc,
                payload=payload,
            )
            if escalation_job is not None:
                created_jobs.append(escalation_job)

    if not created_jobs:
        return []

    session.commit()
    for job in created_jobs:
        session.refresh(job)
        log_audit(
            session,
            actor_type=AuditActorType.SYSTEM,
            actor_id="notification_scheduler",
            action="NOTIFICATION_JOB_CREATED",
            success=True,
            entity_type="notification_job",
            entity_id=str(job.id),
            details={
                "job_type": job.job_type,
                "employee_id": job.employee_id,
                "idempotency_key": job.idempotency_key,
                "scheduled_at_utc": job.scheduled_at_utc.isoformat(),
                "shift_date": str(job.payload.get("shift_date", "")),
            },
        )

    return created_jobs


def send_pending_notifications(
    limit: int = 100,
    *,
    now_utc: datetime | None = None,
    db: Session | None = None,
    channel: NotificationChannel | None = None,
) -> list[NotificationJob]:
    if db is None:
        with SessionLocal() as managed_db:
            return send_pending_notifications(
                limit=limit,
                now_utc=now_utc,
                db=managed_db,
                channel=channel,
            )

    session = db
    reference_utc = _normalize_ts(now_utc or datetime.now(timezone.utc))
    email_channel = channel or EmailChannel()

    claimed_jobs = _claim_due_pending_jobs(
        session,
        now_utc=reference_utc,
        limit=max(1, limit),
    )
    if not claimed_jobs:
        return []

    processed: list[NotificationJob] = []
    for claimed in claimed_jobs:
        try:
            current_job = session.get(NotificationJob, claimed.id)
            if current_job is None:
                continue
            message = _build_message_for_job(session, current_job)
            email_channel.send(message)
            sent_job = _mark_job_sent(session, job_id=current_job.id)
            if sent_job is not None:
                processed.append(sent_job)
                log_audit(
                    session,
                    actor_type=AuditActorType.SYSTEM,
                    actor_id="notification_runner",
                    action="NOTIFICATION_JOB_SENT",
                    success=True,
                    entity_type="notification_job",
                    entity_id=str(sent_job.id),
                    details={
                        "job_type": sent_job.job_type,
                        "employee_id": sent_job.employee_id,
                        "attempts": sent_job.attempts,
                        "idempotency_key": sent_job.idempotency_key,
                    },
                )
        except Exception as exc:
            failed_job = _mark_job_failure(
                session,
                job_id=claimed.id,
                error=exc,
                now_utc=reference_utc,
            )
            if failed_job is not None:
                processed.append(failed_job)
                log_audit(
                    session,
                    actor_type=AuditActorType.SYSTEM,
                    actor_id="notification_runner",
                    action="NOTIFICATION_JOB_FAILED",
                    success=False,
                    entity_type="notification_job",
                    entity_id=str(failed_job.id),
                    details={
                        "job_type": failed_job.job_type,
                        "employee_id": failed_job.employee_id,
                        "attempts": failed_job.attempts,
                        "status": failed_job.status,
                        "error": failed_job.last_error,
                    },
                )

    return processed
