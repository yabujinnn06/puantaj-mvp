from __future__ import annotations

import hashlib
from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import log_audit
from app.db import SessionLocal
from app.models import AdminUser, AuditActorType, Employee, NotificationJob, ScheduledNotificationTask
from app.services.attendance import _attendance_timezone

TASK_TARGET_EMPLOYEES = "employees"
TASK_TARGET_ADMINS = "admins"
TASK_TARGET_BOTH = "both"
TASK_SCOPE_ALL = "all"
TASK_SCOPE_SELECTED = "selected"
TASK_SCHEDULE_ONCE = "once"
TASK_SCHEDULE_DAILY = "daily"
TASK_JOB_TYPE = "ADMIN_SCHEDULED_BROADCAST"
TASK_NOTIFICATION_TYPE = "gorev_bildirimi"
TASK_DEFAULT_TIMEZONE = "Europe/Istanbul"


def _normalize_positive_ids(values: list[int] | None) -> list[int]:
    if not values:
        return []
    return sorted({value for value in values if isinstance(value, int) and value > 0})


def _task_timezone(name: str | None) -> ZoneInfo:
    normalized = (name or "").strip() or TASK_DEFAULT_TIMEZONE
    try:
        return ZoneInfo(normalized)
    except ZoneInfoNotFoundError:
        return ZoneInfo(TASK_DEFAULT_TIMEZONE)


def _scope_label(target: str, scope: str | None) -> str:
    if target == TASK_TARGET_EMPLOYEES:
        return "Tum calisanlar" if scope == TASK_SCOPE_ALL else "Secili calisanlar"
    if target == TASK_TARGET_ADMINS:
        return "Tum adminler" if scope == TASK_SCOPE_ALL else "Secili adminler"
    return "-"


def _normalize_target_values(
    session: Session,
    *,
    target: str,
    employee_scope: str | None,
    admin_scope: str | None,
    employee_ids: list[int] | None,
    admin_user_ids: list[int] | None,
) -> tuple[str | None, str | None, list[int], list[int]]:
    normalized_employee_ids = _normalize_positive_ids(employee_ids)
    normalized_admin_ids = _normalize_positive_ids(admin_user_ids)

    if target not in {TASK_TARGET_EMPLOYEES, TASK_TARGET_ADMINS, TASK_TARGET_BOTH}:
        raise ValueError("Gecersiz hedef tipi.")

    resolved_employee_scope: str | None = None
    resolved_admin_scope: str | None = None

    if target in {TASK_TARGET_EMPLOYEES, TASK_TARGET_BOTH}:
        resolved_employee_scope = (employee_scope or "").strip().lower()
        if resolved_employee_scope not in {TASK_SCOPE_ALL, TASK_SCOPE_SELECTED}:
            raise ValueError("Calisan hedef kapsami gecersiz.")
        if resolved_employee_scope == TASK_SCOPE_SELECTED:
            if not normalized_employee_ids:
                raise ValueError("Secili calisan gonderimi icin en az bir calisan secin.")
            found_ids = set(session.scalars(select(Employee.id).where(Employee.id.in_(normalized_employee_ids))).all())
            missing_ids = [value for value in normalized_employee_ids if value not in found_ids]
            if missing_ids:
                raise ValueError(f"Bazi calisanlar bulunamadi: {', '.join(str(value) for value in missing_ids)}")
        else:
            normalized_employee_ids = []
    else:
        normalized_employee_ids = []

    if target in {TASK_TARGET_ADMINS, TASK_TARGET_BOTH}:
        resolved_admin_scope = (admin_scope or "").strip().lower()
        if resolved_admin_scope not in {TASK_SCOPE_ALL, TASK_SCOPE_SELECTED}:
            raise ValueError("Admin hedef kapsami gecersiz.")
        if resolved_admin_scope == TASK_SCOPE_SELECTED:
            if not normalized_admin_ids:
                raise ValueError("Secili admin gonderimi icin en az bir admin secin.")
            found_admin_ids = set(session.scalars(select(AdminUser.id).where(AdminUser.id.in_(normalized_admin_ids))).all())
            missing_admin_ids = [value for value in normalized_admin_ids if value not in found_admin_ids]
            if missing_admin_ids:
                raise ValueError(f"Bazi adminler bulunamadi: {', '.join(str(value) for value in missing_admin_ids)}")
        else:
            normalized_admin_ids = []
    else:
        normalized_admin_ids = []

    return resolved_employee_scope, resolved_admin_scope, normalized_employee_ids, normalized_admin_ids


def normalize_scheduled_notification_task_payload(
    session: Session,
    *,
    name: str,
    title: str,
    message: str,
    target: str,
    employee_scope: str | None,
    admin_scope: str | None,
    employee_ids: list[int] | None,
    admin_user_ids: list[int] | None,
    schedule_kind: str,
    run_date_local: date | None,
    run_time_local: time,
    timezone_name: str | None,
    is_active: bool,
) -> dict[str, Any]:
    normalized_name = " ".join((name or "").strip().split())
    normalized_title = " ".join((title or "").strip().split())
    normalized_message = (message or "").strip()
    if not normalized_name:
        raise ValueError("Gorev adi zorunludur.")
    if not normalized_title:
        raise ValueError("Bildirim basligi zorunludur.")
    if not normalized_message:
        raise ValueError("Bildirim mesaji zorunludur.")

    normalized_schedule_kind = (schedule_kind or "").strip().lower()
    if normalized_schedule_kind not in {TASK_SCHEDULE_ONCE, TASK_SCHEDULE_DAILY}:
        raise ValueError("Gecersiz plan tipi.")

    current_local_date = datetime.now(_attendance_timezone()).date()
    resolved_run_date = run_date_local
    if normalized_schedule_kind == TASK_SCHEDULE_ONCE:
        if resolved_run_date is None:
            raise ValueError("Tek seferlik gorevler icin gonderim tarihi zorunludur.")
        if resolved_run_date < current_local_date:
            raise ValueError("Tek seferlik gorev tarihi bugunden eski olamaz.")
    else:
        resolved_run_date = None

    normalized_timezone_name = (timezone_name or "").strip() or TASK_DEFAULT_TIMEZONE
    resolved_employee_scope, resolved_admin_scope, normalized_employee_ids, normalized_admin_ids = _normalize_target_values(
        session,
        target=(target or "").strip().lower(),
        employee_scope=employee_scope,
        admin_scope=admin_scope,
        employee_ids=employee_ids,
        admin_user_ids=admin_user_ids,
    )

    return {
        "name": normalized_name,
        "title": normalized_title,
        "message": normalized_message,
        "target": (target or "").strip().lower(),
        "employee_scope": resolved_employee_scope,
        "admin_scope": resolved_admin_scope,
        "employee_ids": normalized_employee_ids,
        "admin_user_ids": normalized_admin_ids,
        "schedule_kind": normalized_schedule_kind,
        "run_date_local": resolved_run_date,
        "run_time_local": run_time_local.replace(second=0, microsecond=0),
        "timezone_name": normalized_timezone_name,
        "is_active": bool(is_active),
    }


def get_task_next_run_at_utc(
    task: ScheduledNotificationTask,
    *,
    reference_utc: datetime | None = None,
) -> datetime | None:
    if not task.is_active:
        return None

    tz = _task_timezone(task.timezone_name)
    reference = (reference_utc or datetime.now(timezone.utc)).astimezone(timezone.utc)
    reference_local = reference.astimezone(tz)

    if task.schedule_kind == TASK_SCHEDULE_ONCE:
        if task.run_date_local is None:
            return None
        if task.last_enqueued_local_date == task.run_date_local:
            return None
        return datetime.combine(task.run_date_local, task.run_time_local, tzinfo=tz).astimezone(timezone.utc)

    candidate_date = reference_local.date()
    if task.last_enqueued_local_date == candidate_date:
        candidate_date = candidate_date + timedelta(days=1)
    return datetime.combine(candidate_date, task.run_time_local, tzinfo=tz).astimezone(timezone.utc)


def _task_occurrence_date(task: ScheduledNotificationTask, *, reference_utc: datetime) -> date:
    if task.schedule_kind == TASK_SCHEDULE_ONCE and task.run_date_local is not None:
        return task.run_date_local
    return reference_utc.astimezone(_task_timezone(task.timezone_name)).date()


def _task_audiences(task: ScheduledNotificationTask) -> list[str]:
    if task.target == TASK_TARGET_BOTH:
        return [TASK_TARGET_EMPLOYEES, TASK_TARGET_ADMINS]
    return [task.target]


def _task_scope(task: ScheduledNotificationTask, audience: str) -> str | None:
    if audience == TASK_TARGET_EMPLOYEES:
        return task.employee_scope
    if audience == TASK_TARGET_ADMINS:
        return task.admin_scope
    return None


def _task_target_ids(task: ScheduledNotificationTask, audience: str) -> list[int]:
    if audience == TASK_TARGET_EMPLOYEES:
        return [value for value in (task.employee_ids or []) if isinstance(value, int) and value > 0]
    if audience == TASK_TARGET_ADMINS:
        return [value for value in (task.admin_user_ids or []) if isinstance(value, int) and value > 0]
    return []


def _task_event_hash(idempotency_key: str) -> str:
    return hashlib.sha256(idempotency_key.encode("utf-8")).hexdigest()


def _build_job_for_task(
    session: Session,
    *,
    task: ScheduledNotificationTask,
    audience: str,
    occurrence_date: date,
    scheduled_at_utc: datetime,
) -> NotificationJob | None:
    scope = _task_scope(task, audience)
    target_ids = _task_target_ids(task, audience)
    audience_key = "employee" if audience == TASK_TARGET_EMPLOYEES else "admin"
    idempotency_key = f"{TASK_JOB_TYPE}:{task.id}:{occurrence_date.isoformat()}:{audience_key}"
    existing = session.scalar(select(NotificationJob).where(NotificationJob.idempotency_key == idempotency_key))
    if existing is not None:
        return None

    event_id = f"TASK-{task.id}-{occurrence_date.strftime('%Y%m%d')}-{audience_key.upper()}"
    target_summary = _scope_label(audience, scope)
    payload: dict[str, Any] = {
        "task_id": task.id,
        "task_name": task.name,
        "title": task.title,
        "description": task.message,
        "audience": audience_key,
        "risk_level": "Bilgi",
        "event_id": event_id,
        "event_ts_local": scheduled_at_utc.astimezone(_task_timezone(task.timezone_name)).strftime("%Y-%m-%d %H:%M"),
        "shift_window_local": task.name,
        "actual_time_summary": f"{occurrence_date.isoformat()} {task.run_time_local.strftime('%H:%M')} · {target_summary}",
        "suggested_action": "Bilgilendirme amacli planli gonderim.",
        "employee_scope": task.employee_scope,
        "admin_scope": task.admin_scope,
        "timezone_name": task.timezone_name,
        "schedule_kind": task.schedule_kind,
        "run_date_local": task.run_date_local.isoformat() if task.run_date_local is not None else None,
        "run_time_local": task.run_time_local.strftime("%H:%M"),
    }
    if audience == TASK_TARGET_EMPLOYEES:
        payload["employee_ids"] = target_ids
    else:
        payload["admin_user_ids"] = target_ids

    primary_employee_id = target_ids[0] if audience == TASK_TARGET_EMPLOYEES and len(target_ids) == 1 else None
    primary_admin_user_id = target_ids[0] if audience == TASK_TARGET_ADMINS and len(target_ids) == 1 else None

    job = NotificationJob(
        employee_id=primary_employee_id,
        admin_user_id=primary_admin_user_id,
        job_type=TASK_JOB_TYPE,
        notification_type=TASK_NOTIFICATION_TYPE,
        audience=audience_key,
        risk_level="Bilgi",
        event_id=event_id,
        event_hash=_task_event_hash(idempotency_key),
        local_day=occurrence_date,
        event_ts_utc=scheduled_at_utc,
        title=task.title,
        description=task.message,
        shift_summary=task.name,
        actual_time_summary=str(payload["actual_time_summary"]),
        suggested_action="Bilgilendirme amacli planli gonderim.",
        payload=payload,
        scheduled_at_utc=scheduled_at_utc,
        status="PENDING",
        attempts=0,
        last_error=None,
        idempotency_key=idempotency_key,
    )
    session.add(job)
    return job


def enqueue_due_scheduled_notification_tasks(
    now_utc: datetime,
    db: Session | None = None,
) -> list[NotificationJob]:
    if db is None:
        with SessionLocal() as managed_db:
            return enqueue_due_scheduled_notification_tasks(now_utc, db=managed_db)

    session = db
    reference_utc = now_utc.astimezone(timezone.utc)
    tasks = list(
        session.scalars(
            select(ScheduledNotificationTask)
            .where(ScheduledNotificationTask.is_active.is_(True))
            .order_by(ScheduledNotificationTask.id.asc())
        ).all()
    )

    created_jobs: list[NotificationJob] = []
    changed = False
    for task in tasks:
        next_run_at_utc = get_task_next_run_at_utc(task, reference_utc=reference_utc)
        if next_run_at_utc is None or next_run_at_utc > reference_utc:
            continue

        occurrence_date = _task_occurrence_date(task, reference_utc=reference_utc)
        for audience in _task_audiences(task):
            job = _build_job_for_task(
                session,
                task=task,
                audience=audience,
                occurrence_date=occurrence_date,
                scheduled_at_utc=next_run_at_utc,
            )
            if job is not None:
                created_jobs.append(job)
                changed = True

        if changed:
            session.flush()

        task.last_enqueued_local_date = occurrence_date
        task.last_enqueued_at_utc = reference_utc
        if task.schedule_kind == TASK_SCHEDULE_ONCE:
            task.is_active = False
        changed = True

        log_audit(
            session,
            actor_type=AuditActorType.SYSTEM,
            actor_id="notification_task_scheduler",
            action="SCHEDULED_NOTIFICATION_TASK_ENQUEUED",
            success=True,
            entity_type="scheduled_notification_task",
            entity_id=str(task.id),
            details={
                "task_name": task.name,
                "target": task.target,
                "schedule_kind": task.schedule_kind,
                "occurrence_date": occurrence_date.isoformat(),
                "scheduled_at_utc": next_run_at_utc.isoformat(),
                "created_job_ids": [job.id for job in created_jobs if job.id is not None],
            },
        )

    if changed:
        session.commit()
        for job in created_jobs:
            session.refresh(job)
    return created_jobs
