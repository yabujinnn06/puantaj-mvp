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
    employee_full_name: str = "-"
    department_name: str | None = None
    shift_name: str | None = None
    shift_start_local: time | None = None
    checkin_outside_shift: bool | None = None


@dataclass(frozen=True, slots=True)
class NotificationMessage:
    recipients: list[str]
    subject: str
    body: str


class NotificationChannel:
    configured: bool = False

    def send(self, message: NotificationMessage) -> dict[str, Any]:
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

    def send(self, message: NotificationMessage) -> dict[str, Any]:
        recipients = [item.strip() for item in message.recipients if item and item.strip()]
        if not recipients:
            logger.info(
                "email_channel_skip_no_recipients",
                extra={
                    "subject": message.subject,
                },
            )
            return {
                "mode": "skipped_no_recipients",
                "sent": 0,
                "recipients": [],
            }

        if not self.configured:
            logger.info(
                "email_channel_placeholder_send",
                extra={
                    "subject": message.subject,
                    "recipients": recipients,
                    "body": message.body,
                },
            )
            return {
                "mode": "not_configured",
                "sent": 0,
                "recipients": recipients,
            }

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
        return {
            "mode": "sent",
            "sent": len(recipients),
            "recipients": recipients,
        }

    def config_status(self) -> dict[str, Any]:
        missing_fields: list[str] = []
        if not self.smtp_host:
            missing_fields.append("SMTP_HOST")
        if not self.smtp_from:
            missing_fields.append("SMTP_FROM")
        return {
            "configured": self.configured,
            "smtp_host_set": bool(self.smtp_host),
            "smtp_from_set": bool(self.smtp_from),
            "smtp_user_set": bool(self.smtp_user),
            "smtp_use_tls": bool(self.smtp_use_tls),
            "missing_fields": missing_fields,
        }


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


def _is_checkin_outside_shift(
    *,
    first_checkin_ts_utc: datetime,
    shift: DepartmentShift | None,
) -> bool | None:
    if shift is None:
        return None

    checkin_local = _normalize_ts(first_checkin_ts_utc).astimezone(_attendance_timezone())
    checkin_minutes = checkin_local.hour * 60 + checkin_local.minute
    shift_start_minutes = shift.start_time_local.hour * 60 + shift.start_time_local.minute
    shift_end_minutes = shift.end_time_local.hour * 60 + shift.end_time_local.minute

    if shift_end_minutes > shift_start_minutes:
        in_shift_window = shift_start_minutes <= checkin_minutes <= shift_end_minutes
    elif shift_end_minutes < shift_start_minutes:
        in_shift_window = checkin_minutes >= shift_start_minutes or checkin_minutes <= shift_end_minutes
    else:
        in_shift_window = True

    return not in_shift_window


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
        department_name: str | None = None
        if employee.department_id is not None:
            department = session.get(Department, employee.department_id)
            if department is not None and department.name:
                department_name = department.name
        checkin_outside_shift = _is_checkin_outside_shift(
            first_checkin_ts_utc=first_in.ts_utc,
            shift=shift,
        )

        records.append(
            OpenShiftNotificationRecord(
                employee_id=employee.id,
                local_day=local_day,
                first_checkin_ts_utc=first_in.ts_utc,
                shift_end_local=shift_end_local_dt.timetz().replace(tzinfo=None),
                grace_deadline_utc=grace_deadline_utc,
                escalation_deadline_utc=escalation_deadline_utc,
                employee_full_name=(employee.full_name or "-"),
                department_name=department_name,
                shift_name=(shift.name if shift is not None else None),
                shift_start_local=(shift.start_time_local if shift is not None else None),
                checkin_outside_shift=checkin_outside_shift,
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
    employee_id: int | None = None,
    employee_full_name: str | None = None,
    department_name: str | None = None,
    shift_name: str | None = None,
    shift_start_local: time | None = None,
    first_checkin_ts_utc: datetime | None = None,
    checkin_outside_shift: bool | None = None,
) -> dict[str, str]:
    payload: dict[str, str] = {
        "shift_date": local_day.isoformat(),
        "planned_checkout_time": shift_end_local.isoformat(timespec="minutes"),
        "grace_deadline_utc": grace_deadline_utc.isoformat(),
        "escalation_deadline_utc": escalation_deadline_utc.isoformat(),
    }
    if employee_id is not None:
        payload["employee_id"] = str(employee_id)
    if employee_full_name:
        payload["employee_full_name"] = employee_full_name
    if department_name:
        payload["department_name"] = department_name
    if shift_name:
        payload["shift_name"] = shift_name
    if shift_start_local is not None:
        payload["shift_start_time"] = shift_start_local.isoformat(timespec="minutes")
        payload["shift_window_local"] = (
            f"{shift_start_local.isoformat(timespec='minutes')}"
            f"-{shift_end_local.isoformat(timespec='minutes')}"
        )
    if first_checkin_ts_utc is not None:
        first_checkin_utc = _normalize_ts(first_checkin_ts_utc)
        payload["first_checkin_utc"] = first_checkin_utc.isoformat()
        payload["first_checkin_local"] = first_checkin_utc.astimezone(_attendance_timezone()).strftime(
            "%Y-%m-%d %H:%M"
        )
    if checkin_outside_shift is not None:
        payload["checkin_outside_shift"] = "true" if checkin_outside_shift else "false"
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


def _payload_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "evet"}:
            return True
        if normalized in {"false", "0", "no", "hayir", "hayır"}:
            return False
    return None


def _payload_local_day(value: Any) -> date | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    if not normalized:
        return None
    try:
        return date.fromisoformat(normalized[:10])
    except ValueError:
        return None


def _build_message_for_job(session: Session, job: NotificationJob) -> NotificationMessage:
    payload = job.payload or {}
    shift_date = str(payload.get("shift_date", "-"))
    planned_checkout_time = str(payload.get("planned_checkout_time", "-"))
    grace_deadline = str(payload.get("grace_deadline_utc", "-"))
    escalation_deadline = str(payload.get("escalation_deadline_utc", "-"))
    employee = session.get(Employee, job.employee_id) if job.employee_id is not None else None
    employee_name = str(payload.get("employee_full_name") or (employee.full_name if employee is not None else "-"))
    employee_id_text = str(payload.get("employee_id") or (job.employee_id if job.employee_id is not None else "-"))
    employee_display = f"#{employee_id_text} - {employee_name}"
    department_name = str(
        payload.get("department_name")
        or (
            employee.department.name
            if employee is not None and employee.department is not None and employee.department.name
            else "-"
        )
    )
    shift_name = str(payload.get("shift_name", "-"))
    shift_window_local = str(payload.get("shift_window_local", "-"))
    shift_line = shift_name if shift_window_local == "-" else f"{shift_name} ({shift_window_local})"
    first_checkin_local = str(payload.get("first_checkin_local", "-"))
    first_checkin_utc = str(payload.get("first_checkin_utc", "-"))
    checkout_local = "KAYIT YOK"
    local_day = _payload_local_day(payload.get("shift_date"))
    if local_day is not None and job.employee_id is not None:
        tz = _attendance_timezone()
        day_reference_utc = datetime.combine(local_day, time(12, 0), tzinfo=tz).astimezone(timezone.utc)
        day_start_utc, day_end_utc = _local_day_bounds_utc(day_reference_utc)
        first_in = session.scalar(
            select(AttendanceEvent)
            .where(
                AttendanceEvent.employee_id == job.employee_id,
                AttendanceEvent.type == AttendanceType.IN,
                AttendanceEvent.ts_utc >= day_start_utc,
                AttendanceEvent.ts_utc < day_end_utc,
                AttendanceEvent.deleted_at.is_(None),
            )
            .order_by(AttendanceEvent.ts_utc.asc(), AttendanceEvent.id.asc())
        )
        if first_in is not None:
            first_in_utc = _normalize_ts(first_in.ts_utc)
            first_checkin_local = first_in_utc.astimezone(tz).strftime("%Y-%m-%d %H:%M")
            first_checkin_utc = first_in_utc.isoformat()

        last_out = session.scalar(
            select(AttendanceEvent)
            .where(
                AttendanceEvent.employee_id == job.employee_id,
                AttendanceEvent.type == AttendanceType.OUT,
                AttendanceEvent.ts_utc >= day_start_utc,
                AttendanceEvent.ts_utc < day_end_utc,
                AttendanceEvent.deleted_at.is_(None),
            )
            .order_by(AttendanceEvent.ts_utc.desc(), AttendanceEvent.id.desc())
        )
        if last_out is not None:
            checkout_local = _normalize_ts(last_out.ts_utc).astimezone(tz).strftime("%Y-%m-%d %H:%M")
    checkin_outside_shift = _payload_bool(payload.get("checkin_outside_shift"))
    checkin_outside_shift_text = (
        "Evet"
        if checkin_outside_shift is True
        else ("Hayır" if checkin_outside_shift is False else "Bilinmiyor")
    )

    if job.job_type == JOB_TYPE_EMPLOYEE_MISSED_CHECKOUT:
        recipients = _employee_notification_emails(session, job=job)
        return NotificationMessage(
            recipients=recipients,
            subject="Puantaj Uyarısı: Çıkış Kaydı Eksik",
            body=(
                f"Çalışan: {employee_display}\n"
                f"Vardiya günü: {shift_date}\n"
                f"Giriş (yerel): {first_checkin_local}\n"
                f"Çıkış (yerel): {checkout_local}\n"
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
                f"Çalışan: {employee_display}\n"
                f"Departman: {department_name}\n"
                f"Vardiya: {shift_line}\n"
                f"Vardiya günü: {shift_date}\n"
                f"Vardiya dışı giriş: {checkin_outside_shift_text}\n"
                f"Giriş (yerel): {first_checkin_local}\n"
                f"Giriş (UTC): {first_checkin_utc}\n"
                f"Çıkış (yerel): {checkout_local}\n"
                f"Planlı çıkış saati: {planned_checkout_time}\n"
                f"Grace deadline (UTC): {grace_deadline}\n"
                f"Eskalasyon deadline (UTC): {escalation_deadline}\n"
                "Aksiyon: Çalışanı kontrol edin ve gerekirse manuel çıkış kaydı oluşturun."
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

    if job.job_type == JOB_TYPE_ADMIN_ESCALATION_MISSED_CHECKOUT:
        payload = job.payload or {}
        return send_push_to_admins(
            session,
            admin_user_ids=None,
            title=message.subject,
            body=message.body,
            data={
                "job_id": job.id,
                "job_type": job.job_type,
                "employee_id": job.employee_id,
                "employee_full_name": payload.get("employee_full_name"),
                "department_name": payload.get("department_name"),
                "shift_date": payload.get("shift_date"),
                "first_checkin_local": payload.get("first_checkin_local"),
                "planned_checkout_time": payload.get("planned_checkout_time"),
                "url": "/admin-panel/notifications",
            },
        )

    if job.job_type == JOB_TYPE_ADMIN_DAILY_REPORT_READY:
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


def _mark_job_sent(
    session: Session,
    *,
    job_id: int,
    delivery_details: dict[str, Any] | None = None,
) -> NotificationJob | None:
    job = session.get(NotificationJob, job_id)
    if job is None:
        return None
    if delivery_details:
        payload = job.payload if isinstance(job.payload, dict) else {}
        payload["delivery"] = delivery_details
        job.payload = payload
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
            employee_id=record.employee_id,
            employee_full_name=record.employee_full_name,
            department_name=record.department_name,
            shift_name=record.shift_name,
            shift_start_local=record.shift_start_local,
            first_checkin_ts_utc=record.first_checkin_ts_utc,
            checkin_outside_shift=record.checkin_outside_shift,
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


def _ensure_daily_report_notification_job(
    session: Session,
    *,
    report_date: date,
    archive_id: int,
    file_name: str,
    scheduled_at_utc: datetime,
) -> tuple[NotificationJob | None, str]:
    idempotency_key = f"{JOB_TYPE_ADMIN_DAILY_REPORT_READY}:{report_date.isoformat()}"
    existing_job = session.scalar(
        select(NotificationJob).where(NotificationJob.idempotency_key == idempotency_key)
    )
    if existing_job is None:
        job = NotificationJob(
            employee_id=None,
            admin_user_id=None,
            job_type=JOB_TYPE_ADMIN_DAILY_REPORT_READY,
            payload={
                "report_date": report_date.isoformat(),
                "archive_id": archive_id,
                "file_name": file_name,
            },
            scheduled_at_utc=scheduled_at_utc,
            status="PENDING",
            attempts=0,
            last_error=None,
            idempotency_key=idempotency_key,
        )
        session.add(job)
        return job, "created"

    if existing_job.status in {"FAILED", "CANCELED"}:
        existing_job.status = "PENDING"
        existing_job.scheduled_at_utc = scheduled_at_utc
        existing_job.attempts = 0
        existing_job.last_error = None
        existing_job.payload = {
            "report_date": report_date.isoformat(),
            "archive_id": archive_id,
            "file_name": file_name,
        }
        return existing_job, "reactivated"

    return None, "unchanged"


def _as_int(value: Any, default: int = 0) -> int:
    if isinstance(value, bool):
        return default
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        raw = value.strip()
        if raw.isdigit():
            return int(raw)
    return default


def get_notification_channel_health() -> dict[str, Any]:
    email_channel = EmailChannel()
    settings = get_settings()
    push_enabled = bool(
        (settings.push_vapid_public_key or "").strip()
        and (settings.push_vapid_private_key or "").strip()
    )
    return {
        "push_enabled": push_enabled,
        "email": email_channel.config_status(),
    }


def get_daily_report_job_health(
    now_utc: datetime | None = None,
    db: Session | None = None,
) -> dict[str, Any]:
    if db is None:
        with SessionLocal() as managed_db:
            return get_daily_report_job_health(now_utc=now_utc, db=managed_db)

    session = db
    reference_utc = _normalize_ts(now_utc or datetime.now(timezone.utc))
    local_now = reference_utc.astimezone(_attendance_timezone())
    report_date = local_now.date() - timedelta(days=1)
    idempotency_key = f"{JOB_TYPE_ADMIN_DAILY_REPORT_READY}:{report_date.isoformat()}"
    try:
        job = session.scalar(
            select(NotificationJob).where(NotificationJob.idempotency_key == idempotency_key)
        )
    except Exception as exc:
        return {
            "report_date": report_date.isoformat(),
            "idempotency_key": idempotency_key,
            "job_exists": False,
            "status": None,
            "scheduled_at_utc": None,
            "attempts": 0,
            "last_error": str(exc)[:500],
            "push_total_targets": 0,
            "push_sent": 0,
            "push_failed": 0,
            "email_sent": 0,
            "alarms": ["DAILY_REPORT_HEALTH_QUERY_FAILED"],
        }

    alarms: list[str] = []
    if job is None:
        if local_now.time() >= time(0, 15):
            alarms.append("DAILY_REPORT_JOB_MISSING")
        return {
            "report_date": report_date.isoformat(),
            "idempotency_key": idempotency_key,
            "job_exists": False,
            "status": None,
            "scheduled_at_utc": None,
            "attempts": 0,
            "last_error": None,
            "push_total_targets": 0,
            "push_sent": 0,
            "push_failed": 0,
            "email_sent": 0,
            "alarms": alarms,
        }

    payload = job.payload if isinstance(job.payload, dict) else {}
    delivery = payload.get("delivery") if isinstance(payload.get("delivery"), dict) else {}
    push_total_targets = _as_int(delivery.get("push_total_targets"), 0)
    push_sent = _as_int(delivery.get("push_sent"), 0)
    push_failed = _as_int(delivery.get("push_failed"), 0)
    email_sent = _as_int(delivery.get("email_sent"), 0)

    if job.status == "FAILED":
        alarms.append("DAILY_REPORT_JOB_FAILED")
    if local_now.time() >= time(0, 30) and job.status in {"PENDING", "SENDING"}:
        alarms.append("DAILY_REPORT_JOB_STUCK")
    if job.status == "SENT" and push_sent <= 0 and email_sent <= 0:
        alarms.append("DAILY_REPORT_DELIVERY_EMPTY")
    if push_total_targets <= 0 and email_sent <= 0 and local_now.time() >= time(0, 30):
        alarms.append("DAILY_REPORT_TARGET_ZERO")

    return {
        "report_date": report_date.isoformat(),
        "idempotency_key": idempotency_key,
        "job_exists": True,
        "job_id": job.id,
        "status": job.status,
        "scheduled_at_utc": job.scheduled_at_utc.isoformat() if job.scheduled_at_utc else None,
        "attempts": int(job.attempts or 0),
        "last_error": job.last_error,
        "push_total_targets": push_total_targets,
        "push_sent": push_sent,
        "push_failed": push_failed,
        "email_sent": email_sent,
        "alarms": alarms,
    }


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

    archive = session.scalar(
        select(AdminDailyReportArchive).where(
            AdminDailyReportArchive.report_date == report_date,
            AdminDailyReportArchive.department_id.is_(None),
            AdminDailyReportArchive.region_id.is_(None),
        )
    )
    archive_created = False
    archive_bytes_len = 0
    employee_count = 0
    if archive is None:
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
        archive_created = True
        archive_bytes_len = len(archive_bytes)

    ensured_job, ensured_job_state = _ensure_daily_report_notification_job(
        session,
        report_date=report_date,
        archive_id=archive.id,
        file_name=archive.file_name,
        scheduled_at_utc=reference_utc,
    )

    if archive_created or ensured_job is not None or deleted_archive_count > 0:
        session.commit()

    if ensured_job is not None:
        session.refresh(ensured_job)

    if archive_created and ensured_job is not None:
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
                "file_name": archive.file_name,
                "file_size_bytes": archive_bytes_len,
                "employee_count": employee_count,
                "notification_job_id": ensured_job.id,
            },
        )
    if ensured_job is not None:
        log_audit(
            session,
            actor_type=AuditActorType.SYSTEM,
            actor_id="notification_scheduler",
            action="NOTIFICATION_JOB_CREATED",
            success=True,
            entity_type="notification_job",
            entity_id=str(ensured_job.id),
            details={
                "job_type": ensured_job.job_type,
                "idempotency_key": ensured_job.idempotency_key,
                "scheduled_at_utc": ensured_job.scheduled_at_utc.isoformat(),
                "report_date": report_date.isoformat(),
                "archive_id": archive.id,
                "job_state": ensured_job_state,
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

    if ensured_job is None:
        return []
    return [ensured_job]


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
            push_summary = _send_push_for_job(session, job=current_job, message=message)
            push_total_targets = int(push_summary.get("total_targets", 0))
            push_sent = int(push_summary.get("sent", 0))
            push_failed = int(push_summary.get("failed", 0))
            push_deactivated = int(push_summary.get("deactivated", 0))

            email_result: dict[str, Any] = {
                "mode": "not_attempted",
                "sent": 0,
                "recipients": [],
            }
            if push_sent <= 0:
                email_result = email_channel.send(message)

            email_sent = _as_int(email_result.get("sent"), 0)
            delivery_ok = push_sent > 0 or email_sent > 0
            if not delivery_ok:
                raise RuntimeError(
                    "Notification delivery failed on all channels "
                    f"(push_targets={push_total_targets}, push_sent={push_sent}, email_mode={email_result.get('mode')})"
                )

            sent_job = _mark_job_sent(
                session,
                job_id=current_job.id,
                delivery_details={
                    "push_total_targets": push_total_targets,
                    "push_sent": push_sent,
                    "push_failed": push_failed,
                    "push_deactivated": push_deactivated,
                    "email_mode": str(email_result.get("mode") or "unknown"),
                    "email_sent": email_sent,
                },
            )
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
                        "push_total_targets": push_total_targets,
                        "push_sent": push_sent,
                        "push_failed": push_failed,
                        "push_deactivated": push_deactivated,
                        "email_mode": email_result.get("mode"),
                        "email_sent": email_sent,
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
