from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
import logging
import os
import smtplib
from email.message import EmailMessage
from typing import Any

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.audit import log_audit
from app.db import SessionLocal
from app.models import (
    AdminDailyReportArchive,
    AdminUser,
    AuditActorType,
    AttendanceEvent,
    AttendanceType,
    Department,
    DepartmentShift,
    Employee,
    ManualDayOverride,
    NotificationJob,
    WorkRule,
)
from app.services.exports import build_puantaj_xlsx_bytes
from app.services.attendance import _attendance_timezone, _local_day_bounds_utc, _normalize_ts
from app.services.push_notifications import send_push_to_admins, send_push_to_employees
from app.services.schedule_plans import resolve_effective_plan_for_employee_day
from app.settings import get_public_base_url, get_settings

DEFAULT_DAILY_MINUTES_PLANNED = 540
DEFAULT_GRACE_MINUTES = 5
DEFAULT_ESCALATION_DELAY_MINUTES = 30
MAX_NOTIFICATION_ATTEMPTS = 5
JOB_TYPE_EMPLOYEE_MISSED_CHECKOUT = "EMPLOYEE_MISSED_CHECKOUT"
JOB_TYPE_ADMIN_ESCALATION_MISSED_CHECKOUT = "ADMIN_ESCALATION_MISSED_CHECKOUT"
JOB_TYPE_EMPLOYEE_OVERTIME_9H = "EMPLOYEE_OVERTIME_9H"
JOB_TYPE_ADMIN_DAILY_REPORT_READY = "ADMIN_DAILY_REPORT_READY"

logger = logging.getLogger("app.notifications")


@dataclass(frozen=True, slots=True)
class OpenShiftNotificationRecord:
    employee_id: int
    local_day: date
    first_checkin_ts_utc: datetime
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
        if not recipients:
            logger.info(
                "email_channel_skip_no_recipients",
                extra={
                    "subject": message.subject,
                },
            )
            return

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
                first_checkin_ts_utc=first_in.ts_utc,
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
    overtime_alert_at_utc: datetime | None = None,
) -> dict[str, str]:
    payload: dict[str, str] = {
        "shift_date": local_day.isoformat(),
        "planned_checkout_time": shift_end_local.isoformat(timespec="minutes"),
        "grace_deadline_utc": grace_deadline_utc.isoformat(),
        "escalation_deadline_utc": escalation_deadline_utc.isoformat(),
    }
    if overtime_alert_at_utc is not None:
        payload["overtime_alert_at_utc"] = overtime_alert_at_utc.isoformat()
    return payload


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

    if job.job_type == JOB_TYPE_EMPLOYEE_OVERTIME_9H:
        recipients = _employee_notification_emails(session, job=job)
        overtime_alert_at = str(payload.get("overtime_alert_at_utc", "-"))
        return NotificationMessage(
            recipients=recipients,
            subject="Puantaj Uyarisi: 9 Saat Siniri Asildi",
            body=(
                f"Calisan #{job.employee_id} icin {shift_date} vardiyasinda 9 saat siniri asildi.\n"
                f"Planli cikis saati: {planned_checkout_time}\n"
                f"9 saat asim esigi (UTC): {overtime_alert_at}\n"
                "Lutfen cikis kaydini tamamlayin."
            ),
        )

    if job.job_type == JOB_TYPE_ADMIN_DAILY_REPORT_READY:
        recipients = _admin_notification_emails(session)
        report_date = str(payload.get("report_date", "-"))
        archive_id = payload.get("archive_id")
        archive_url = (
            f"{get_public_base_url()}/admin-panel/archive-download?archive_id={archive_id}"
            if archive_id
            else f"{get_public_base_url()}/admin-panel/archive-download"
        )
        return NotificationMessage(
            recipients=recipients,
            subject="Puantaj Raporu Hazir: Gunluk Arsiv",
            body=(
                f"{report_date} gunune ait gunluk puantaj Excel arsivi hazirlandi.\n"
                f"Arsiv ID: {archive_id}\n"
                f"Indirme linki: {archive_url}"
            ),
        )

    raise ValueError(f"Unsupported notification job_type: {job.job_type}")


def _send_push_for_job(
    session: Session,
    *,
    job: NotificationJob,
    message: NotificationMessage,
) -> dict[str, Any]:
    if job.job_type in {JOB_TYPE_EMPLOYEE_MISSED_CHECKOUT, JOB_TYPE_EMPLOYEE_OVERTIME_9H}:
        if job.employee_id is None:
            return {"total_targets": 0, "sent": 0, "failed": 0, "deactivated": 0, "failures": []}
        return send_push_to_employees(
            session,
            employee_ids=[job.employee_id],
            title=message.subject,
            body=message.body,
            data={
                "job_id": job.id,
                "job_type": job.job_type,
                "employee_id": job.employee_id,
                "payload": job.payload or {},
            },
        )

    if job.job_type in {JOB_TYPE_ADMIN_ESCALATION_MISSED_CHECKOUT, JOB_TYPE_ADMIN_DAILY_REPORT_READY}:
        payload = job.payload or {}
        archive_id = payload.get("archive_id")
        return send_push_to_admins(
            session,
            admin_user_ids=None,
            title=message.subject,
            body=message.body,
            data={
                "job_id": job.id,
                "job_type": job.job_type,
                "archive_id": archive_id,
                "report_date": payload.get("report_date"),
                "url": f"/admin-panel/archive-download?archive_id={archive_id}"
                if archive_id
                else "/admin-panel/archive-download",
            },
        )

    return {"total_targets": 0, "sent": 0, "failed": 0, "deactivated": 0, "failures": []}


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
        overtime_alert_at_utc = _normalize_ts(record.first_checkin_ts_utc) + timedelta(hours=9)
        payload = _build_notification_payload(
            local_day=record.local_day,
            shift_end_local=record.shift_end_local,
            grace_deadline_utc=record.grace_deadline_utc,
            escalation_deadline_utc=record.escalation_deadline_utc,
            overtime_alert_at_utc=overtime_alert_at_utc,
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

        if reference_utc >= overtime_alert_at_utc:
            overtime_job = _create_notification_job_if_needed(
                session,
                job_type=JOB_TYPE_EMPLOYEE_OVERTIME_9H,
                employee_id=record.employee_id,
                local_day=record.local_day,
                scheduled_at_utc=overtime_alert_at_utc,
                payload=payload,
            )
            if overtime_job is not None:
                created_jobs.append(overtime_job)

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


def _normalize_archive_employee_name(value: str) -> str:
    return " ".join((value or "").strip().lower().split())


def _build_archive_employee_index(
    session: Session,
    *,
    report_date: date,
    department_id: int | None,
    region_id: int | None,
) -> tuple[int, str | None, str | None]:
    tz = _attendance_timezone()
    start_local = datetime.combine(report_date, time.min, tzinfo=tz)
    end_local = start_local + timedelta(days=1)
    start_utc = start_local.astimezone(timezone.utc)
    end_utc = end_local.astimezone(timezone.utc)

    stmt = (
        select(Employee.id, Employee.full_name)
        .join(AttendanceEvent, AttendanceEvent.employee_id == Employee.id)
        .outerjoin(Department, Department.id == Employee.department_id)
        .where(
            AttendanceEvent.deleted_at.is_(None),
            AttendanceEvent.ts_utc >= start_utc,
            AttendanceEvent.ts_utc < end_utc,
        )
    )
    if department_id is not None:
        stmt = stmt.where(Employee.department_id == department_id)
    if region_id is not None:
        stmt = stmt.where(
            or_(
                Employee.region_id == region_id,
                and_(Employee.region_id.is_(None), Department.region_id == region_id),
            )
        )

    unique_ids: set[int] = set()
    unique_names: set[str] = set()
    for employee_id_value, full_name in session.execute(stmt).all():
        if isinstance(employee_id_value, int) and employee_id_value > 0:
            unique_ids.add(employee_id_value)
        normalized_name = _normalize_archive_employee_name(str(full_name or ""))
        if normalized_name:
            unique_names.add(normalized_name)

    sorted_ids = sorted(unique_ids)
    sorted_names = sorted(unique_names)
    ids_index = f",{','.join(str(item) for item in sorted_ids)}," if sorted_ids else None
    names_index = "|".join(sorted_names) if sorted_names else None
    return len(sorted_ids), ids_index, names_index


def _cleanup_expired_daily_report_archives(
    session: Session,
    *,
    local_now_date: date,
) -> int:
    retention_days = max(0, int(get_settings().daily_report_archive_retention_days))
    if retention_days <= 0:
        return 0

    cutoff_date = local_now_date - timedelta(days=retention_days)
    stale_archives = list(
        session.scalars(
            select(AdminDailyReportArchive).where(AdminDailyReportArchive.report_date < cutoff_date)
        ).all()
    )
    if not stale_archives:
        return 0

    for archive in stale_archives:
        session.delete(archive)
    return len(stale_archives)


def schedule_daily_admin_report_archive_notifications(
    now_utc: datetime,
    db: Session | None = None,
) -> list[NotificationJob]:
    if db is None:
        with SessionLocal() as managed_db:
            return schedule_daily_admin_report_archive_notifications(now_utc, db=managed_db)

    session = db
    reference_utc = _normalize_ts(now_utc)
    tz = _attendance_timezone()
    local_now = reference_utc.astimezone(tz)
    report_date = local_now.date() - timedelta(days=1)
    deleted_archive_count = _cleanup_expired_daily_report_archives(
        session,
        local_now_date=local_now.date(),
    )

    existing_archive = session.scalar(
        select(AdminDailyReportArchive).where(
            AdminDailyReportArchive.report_date == report_date,
            AdminDailyReportArchive.department_id.is_(None),
            AdminDailyReportArchive.region_id.is_(None),
        )
    )
    if existing_archive is not None:
        if deleted_archive_count > 0:
            session.commit()
            log_audit(
                session,
                actor_type=AuditActorType.SYSTEM,
                actor_id="notification_scheduler",
                action="ADMIN_DAILY_REPORT_ARCHIVE_CLEANUP",
                success=True,
                entity_type="admin_daily_report_archive",
                entity_id=None,
                details={
                    "deleted_count": deleted_archive_count,
                    "retention_days": max(0, int(get_settings().daily_report_archive_retention_days)),
                },
            )
        return []

    archive_bytes = build_puantaj_xlsx_bytes(
        session,
        mode="date_range",
        start_date=report_date,
        end_date=report_date,
    )
    employee_count, employee_ids_index, employee_names_index = _build_archive_employee_index(
        session,
        report_date=report_date,
        department_id=None,
        region_id=None,
    )
    file_name = f"puantaj-gunluk-{report_date.isoformat()}.xlsx"
    archive = AdminDailyReportArchive(
        report_date=report_date,
        department_id=None,
        region_id=None,
        file_name=file_name,
        file_data=archive_bytes,
        file_size_bytes=len(archive_bytes),
        employee_count=employee_count,
        employee_ids_index=employee_ids_index,
        employee_names_index=employee_names_index,
    )
    session.add(archive)
    session.flush()

    idempotency_key = f"{JOB_TYPE_ADMIN_DAILY_REPORT_READY}:{report_date.isoformat()}"
    if _has_pending_or_sent_job(session, idempotency_key=idempotency_key):
        session.commit()
        return []

    job = NotificationJob(
        employee_id=None,
        admin_user_id=None,
        job_type=JOB_TYPE_ADMIN_DAILY_REPORT_READY,
        payload={
            "report_date": report_date.isoformat(),
            "archive_id": archive.id,
            "file_name": file_name,
        },
        scheduled_at_utc=reference_utc,
        status="PENDING",
        attempts=0,
        last_error=None,
        idempotency_key=idempotency_key,
    )
    session.add(job)
    session.commit()
    session.refresh(job)

    log_audit(
        session,
        actor_type=AuditActorType.SYSTEM,
        actor_id="notification_scheduler",
        action="ADMIN_DAILY_REPORT_ARCHIVE_CREATED",
        success=True,
        entity_type="admin_daily_report_archive",
        entity_id=str(archive.id),
        details={
            "report_date": report_date.isoformat(),
            "file_name": file_name,
            "file_size_bytes": len(archive_bytes),
            "employee_count": employee_count,
            "notification_job_id": job.id,
        },
    )
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
            "idempotency_key": job.idempotency_key,
            "scheduled_at_utc": job.scheduled_at_utc.isoformat(),
            "report_date": report_date.isoformat(),
            "archive_id": archive.id,
        },
    )
    if deleted_archive_count > 0:
        log_audit(
            session,
            actor_type=AuditActorType.SYSTEM,
            actor_id="notification_scheduler",
            action="ADMIN_DAILY_REPORT_ARCHIVE_CLEANUP",
            success=True,
            entity_type="admin_daily_report_archive",
            entity_id=None,
            details={
                "deleted_count": deleted_archive_count,
                "retention_days": max(0, int(get_settings().daily_report_archive_retention_days)),
            },
        )

    return [job]


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
            push_summary = _send_push_for_job(session, job=current_job, message=message)
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
                        "push_sent": push_summary.get("sent"),
                        "push_failed": push_summary.get("failed"),
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
