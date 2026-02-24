from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

from pywebpush import WebPushException, webpush
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.errors import ApiError
from app.models import (
    AdminPushSubscription,
    AdminUser,
    Device,
    DevicePushSubscription,
    Employee,
)
from app.settings import get_public_base_url, get_settings, is_push_enabled


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _resolve_vapid_subject(raw_subject: str | None) -> str:
    """Return a valid VAPID subject claim (`mailto:` or `https:`)."""
    subject = (raw_subject or "").strip()
    if not subject:
        public_base = (get_public_base_url() or "").strip()
        if public_base.startswith("https://"):
            return public_base
        return "mailto:admin@localhost"
    if subject.startswith("mailto:") or subject.startswith("https://"):
        return subject
    if "@" in subject:
        return f"mailto:{subject}"
    return "mailto:admin@localhost"


def get_push_public_config() -> dict[str, Any]:
    settings = get_settings()
    enabled = is_push_enabled()
    return {
        "enabled": enabled,
        "vapid_public_key": settings.push_vapid_public_key if enabled else None,
    }


def _parse_subscription_payload(subscription: dict[str, Any]) -> tuple[str, str, str]:
    endpoint = str(subscription.get("endpoint") or "").strip()
    keys = subscription.get("keys")
    if not isinstance(keys, dict):
        raise ApiError(
            status_code=422,
            code="INVALID_PUSH_SUBSCRIPTION",
            message="Subscription keys are missing.",
        )

    p256dh = str(keys.get("p256dh") or "").strip()
    auth = str(keys.get("auth") or "").strip()
    if not endpoint or not p256dh or not auth:
        raise ApiError(
            status_code=422,
            code="INVALID_PUSH_SUBSCRIPTION",
            message="Subscription payload is incomplete.",
        )
    return endpoint, p256dh, auth


def _resolve_active_device_with_employee(db: Session, *, device_fingerprint: str) -> Device:
    device = db.scalar(
        select(Device).where(
            Device.device_fingerprint == device_fingerprint,
            Device.is_active.is_(True),
        )
    )
    if device is None:
        raise ApiError(
            status_code=404,
            code="DEVICE_NOT_CLAIMED",
            message="Device must be claimed first.",
        )
    if device.employee is None:
        raise ApiError(
            status_code=404,
            code="EMPLOYEE_NOT_FOUND",
            message="Employee not found for this device.",
        )
    if not device.employee.is_active:
        raise ApiError(
            status_code=403,
            code="EMPLOYEE_INACTIVE",
            message="Inactive employee cannot register push notifications.",
        )
    return device


def upsert_device_push_subscription(
    db: Session,
    *,
    device_fingerprint: str,
    subscription: dict[str, Any],
    user_agent: str | None,
) -> DevicePushSubscription:
    if not is_push_enabled():
        raise ApiError(
            status_code=503,
            code="PUSH_NOT_CONFIGURED",
            message="Push notification service is not configured.",
        )

    device = _resolve_active_device_with_employee(db, device_fingerprint=device_fingerprint)
    endpoint, p256dh, auth = _parse_subscription_payload(subscription)
    now_utc = _utcnow()

    row = db.scalar(
        select(DevicePushSubscription).where(DevicePushSubscription.endpoint == endpoint)
    )
    if row is None:
        row = DevicePushSubscription(
            device_id=device.id,
            endpoint=endpoint,
            p256dh=p256dh,
            auth=auth,
            is_active=True,
            user_agent=user_agent,
            last_error=None,
            last_seen_at=now_utc,
        )
        db.add(row)
    else:
        row.device_id = device.id
        row.p256dh = p256dh
        row.auth = auth
        row.is_active = True
        row.user_agent = user_agent
        row.last_error = None
        row.last_seen_at = now_utc

    stale_rows = list(
        db.scalars(
            select(DevicePushSubscription).where(
                DevicePushSubscription.device_id == device.id,
                DevicePushSubscription.id != row.id,
                DevicePushSubscription.is_active.is_(True),
            )
        ).all()
    )
    for stale_row in stale_rows:
        stale_row.is_active = False
        stale_row.last_error = "superseded_by_newer_subscription"
        stale_row.last_seen_at = now_utc

    db.commit()
    db.refresh(row)
    return row


def deactivate_device_push_subscription(
    db: Session,
    *,
    device_fingerprint: str,
    endpoint: str,
) -> bool:
    device = _resolve_active_device_with_employee(db, device_fingerprint=device_fingerprint)
    normalized_endpoint = endpoint.strip()
    if not normalized_endpoint:
        raise ApiError(
            status_code=422,
            code="INVALID_PUSH_SUBSCRIPTION",
            message="Endpoint is required.",
        )

    row = db.scalar(
        select(DevicePushSubscription).where(
            DevicePushSubscription.device_id == device.id,
            DevicePushSubscription.endpoint == normalized_endpoint,
        )
    )
    if row is None:
        return False

    if row.is_active:
        row.is_active = False
        row.last_seen_at = _utcnow()
        db.commit()
    return True


def list_active_push_subscriptions(
    db: Session,
    *,
    employee_id: int | None = None,
) -> list[DevicePushSubscription]:
    stmt = (
        select(DevicePushSubscription)
        .join(Device, Device.id == DevicePushSubscription.device_id)
        .join(Employee, Employee.id == Device.employee_id)
        .where(
            DevicePushSubscription.is_active.is_(True),
            Device.is_active.is_(True),
            Employee.is_active.is_(True),
        )
        .order_by(DevicePushSubscription.id.desc())
    )
    if employee_id is not None:
        stmt = stmt.where(Device.employee_id == employee_id)
    return list(db.scalars(stmt).all())


def upsert_admin_push_subscription(
    db: Session,
    *,
    admin_user_id: int | None,
    admin_username: str,
    subscription: dict[str, Any],
    user_agent: str | None,
) -> AdminPushSubscription:
    if not is_push_enabled():
        raise ApiError(
            status_code=503,
            code="PUSH_NOT_CONFIGURED",
            message="Push notification service is not configured.",
        )

    normalized_username = admin_username.strip()
    if not normalized_username:
        raise ApiError(
            status_code=422,
            code="VALIDATION_ERROR",
            message="Admin username is required.",
        )

    endpoint, p256dh, auth = _parse_subscription_payload(subscription)
    now_utc = _utcnow()

    row = db.scalar(
        select(AdminPushSubscription).where(AdminPushSubscription.endpoint == endpoint)
    )
    if row is None:
        row = AdminPushSubscription(
            admin_user_id=admin_user_id,
            admin_username=normalized_username,
            endpoint=endpoint,
            p256dh=p256dh,
            auth=auth,
            is_active=True,
            user_agent=user_agent,
            last_error=None,
            last_seen_at=now_utc,
        )
        db.add(row)
    else:
        row.admin_user_id = admin_user_id
        row.admin_username = normalized_username
        row.p256dh = p256dh
        row.auth = auth
        row.is_active = True
        row.user_agent = user_agent
        row.last_error = None
        row.last_seen_at = now_utc

    if user_agent:
        stale_filters: list[Any] = [
            AdminPushSubscription.id != row.id,
            AdminPushSubscription.is_active.is_(True),
            AdminPushSubscription.admin_username == normalized_username,
            AdminPushSubscription.user_agent == user_agent,
        ]
        if admin_user_id is not None:
            stale_filters.append(
                or_(
                    AdminPushSubscription.admin_user_id == admin_user_id,
                    and_(
                        AdminPushSubscription.admin_user_id.is_(None),
                        AdminPushSubscription.admin_username == normalized_username,
                    ),
                )
            )
        stale_rows = list(
            db.scalars(select(AdminPushSubscription).where(*stale_filters)).all()
        )
        for stale_row in stale_rows:
            stale_row.is_active = False
            stale_row.last_error = "superseded_by_newer_subscription"
            stale_row.last_seen_at = now_utc

    db.commit()
    db.refresh(row)
    return row


def list_active_admin_push_subscriptions(
    db: Session,
    *,
    admin_user_id: int | None = None,
) -> list[AdminPushSubscription]:
    stmt = (
        select(AdminPushSubscription)
        .outerjoin(AdminUser, AdminUser.id == AdminPushSubscription.admin_user_id)
        .where(
            AdminPushSubscription.is_active.is_(True),
            (AdminPushSubscription.admin_user_id.is_(None) | AdminUser.is_active.is_(True)),
        )
        .order_by(AdminPushSubscription.id.desc())
    )
    if admin_user_id is not None:
        stmt = stmt.where(AdminPushSubscription.admin_user_id == admin_user_id)
    return list(db.scalars(stmt).all())


def _send_to_subscription_row(
    *,
    endpoint: str,
    p256dh: str,
    auth_key: str,
    title: str,
    body: str,
    data: dict[str, Any] | None,
) -> tuple[bool, str | None, int | None]:
    if not is_push_enabled():
        return False, "push_disabled", None

    settings = get_settings()
    vapid_subject = _resolve_vapid_subject(settings.push_vapid_subject)
    payload = {
        "title": title,
        "body": body,
        "data": data or {},
        "ts_utc": _utcnow().isoformat(),
    }
    try:
        webpush(
            subscription_info={
                "endpoint": endpoint,
                "keys": {
                    "p256dh": p256dh,
                    "auth": auth_key,
                },
            },
            data=json.dumps(payload),
            vapid_private_key=settings.push_vapid_private_key,
            vapid_claims={"sub": vapid_subject},
            content_encoding="aes128gcm",
            headers={"Urgency": "high"},
            ttl=3600,
        )
        return True, None, None
    except WebPushException as exc:
        status_code: int | None = None
        if exc.response is not None:
            status_code = exc.response.status_code
        return False, str(exc), status_code
    except Exception as exc:  # pragma: no cover - defensive path
        return False, str(exc), None


def send_push_to_subscriptions(
    db: Session,
    *,
    subscriptions: list[DevicePushSubscription],
    title: str,
    body: str,
    data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    sent = 0
    failed = 0
    deactivated = 0
    failures: list[dict[str, Any]] = []
    deliveries: list[dict[str, Any]] = []
    now_utc = _utcnow()

    for row in subscriptions:
        employee_id: int | None = None
        if row.device is not None:
            employee_id = row.device.employee_id

        ok, error_text, status_code = _send_to_subscription_row(
            endpoint=row.endpoint,
            p256dh=row.p256dh,
            auth_key=row.auth,
            title=title,
            body=body,
            data=data,
        )
        row.last_seen_at = now_utc
        if ok:
            sent += 1
            row.last_error = None
            deliveries.append(
                {
                    "subscription_id": row.id,
                    "device_id": row.device_id,
                    "employee_id": employee_id,
                    "endpoint": row.endpoint,
                    "status": "SENT",
                }
            )
            continue

        failed += 1
        row.last_error = error_text
        if status_code in {404, 410}:
            if row.is_active:
                row.is_active = False
                deactivated += 1
        failures.append(
            {
                "subscription_id": row.id,
                "device_id": row.device_id,
                "employee_id": employee_id,
                "endpoint": row.endpoint,
                "status_code": status_code,
                "error": error_text,
            }
        )
        deliveries.append(
            {
                "subscription_id": row.id,
                "device_id": row.device_id,
                "employee_id": employee_id,
                "endpoint": row.endpoint,
                "status": "FAILED",
                "status_code": status_code,
                "error": error_text,
            }
        )

    db.commit()
    return {
        "total_targets": len(subscriptions),
        "sent": sent,
        "failed": failed,
        "deactivated": deactivated,
        "failures": failures,
        "deliveries": deliveries,
    }


def send_test_push_to_device_subscription(
    db: Session,
    *,
    subscription: DevicePushSubscription,
    title: str = "Puantaj Bildirim Testi",
    body: str = "Bildirim kanali dogrulandi.",
    data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    ok, error_text, status_code = _send_to_subscription_row(
        endpoint=subscription.endpoint,
        p256dh=subscription.p256dh,
        auth_key=subscription.auth,
        title=title,
        body=body,
        data=data,
    )
    subscription.last_seen_at = _utcnow()
    if ok:
        subscription.last_error = None
    else:
        subscription.last_error = error_text
        if status_code in {404, 410} and subscription.is_active:
            subscription.is_active = False
    db.commit()
    return {
        "ok": ok,
        "error": error_text,
        "status_code": status_code,
    }


def send_test_push_to_admin_subscription(
    db: Session,
    *,
    subscription: AdminPushSubscription,
    title: str = "Admin Bildirim Testi",
    body: str = "Admin cihaz claim sagligi dogrulandi.",
    data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    ok, error_text, status_code = _send_to_subscription_row(
        endpoint=subscription.endpoint,
        p256dh=subscription.p256dh,
        auth_key=subscription.auth,
        title=title,
        body=body,
        data=data,
    )
    subscription.last_seen_at = _utcnow()
    if ok:
        subscription.last_error = None
    else:
        subscription.last_error = error_text
        if status_code in {404, 410} and subscription.is_active:
            subscription.is_active = False
    db.commit()
    return {
        "ok": ok,
        "error": error_text,
        "status_code": status_code,
    }


def send_push_to_employees(
    db: Session,
    *,
    employee_ids: list[int] | None,
    title: str,
    body: str,
    data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    stmt = (
        select(DevicePushSubscription)
        .join(Device, Device.id == DevicePushSubscription.device_id)
        .join(Employee, Employee.id == Device.employee_id)
        .where(
            DevicePushSubscription.is_active.is_(True),
            Device.is_active.is_(True),
            Employee.is_active.is_(True),
        )
        .order_by(DevicePushSubscription.id.desc())
    )
    if employee_ids:
        stmt = stmt.where(Device.employee_id.in_(employee_ids))

    subscriptions = list(db.scalars(stmt).all())
    result = send_push_to_subscriptions(
        db,
        subscriptions=subscriptions,
        title=title,
        body=body,
        data=data,
    )
    result["employee_ids"] = sorted({item.device.employee_id for item in subscriptions if item.device is not None})
    return result


def send_push_to_admin_subscriptions(
    db: Session,
    *,
    subscriptions: list[AdminPushSubscription],
    title: str,
    body: str,
    data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    sent = 0
    failed = 0
    deactivated = 0
    failures: list[dict[str, Any]] = []
    deliveries: list[dict[str, Any]] = []
    now_utc = _utcnow()

    for row in subscriptions:
        ok, error_text, status_code = _send_to_subscription_row(
            endpoint=row.endpoint,
            p256dh=row.p256dh,
            auth_key=row.auth,
            title=title,
            body=body,
            data=data,
        )
        row.last_seen_at = now_utc
        if ok:
            sent += 1
            row.last_error = None
            deliveries.append(
                {
                    "subscription_id": row.id,
                    "admin_user_id": row.admin_user_id,
                    "admin_username": row.admin_username,
                    "endpoint": row.endpoint,
                    "status": "SENT",
                }
            )
            continue

        failed += 1
        row.last_error = error_text
        if status_code in {404, 410} and row.is_active:
            row.is_active = False
            deactivated += 1
        failures.append(
            {
                "subscription_id": row.id,
                "admin_user_id": row.admin_user_id,
                "admin_username": row.admin_username,
                "endpoint": row.endpoint,
                "status_code": status_code,
                "error": error_text,
            }
        )
        deliveries.append(
            {
                "subscription_id": row.id,
                "admin_user_id": row.admin_user_id,
                "admin_username": row.admin_username,
                "endpoint": row.endpoint,
                "status": "FAILED",
                "status_code": status_code,
                "error": error_text,
            }
        )

    db.commit()
    return {
        "total_targets": len(subscriptions),
        "sent": sent,
        "failed": failed,
        "deactivated": deactivated,
        "failures": failures,
        "deliveries": deliveries,
    }


def send_push_to_admins(
    db: Session,
    *,
    admin_user_ids: list[int] | None = None,
    title: str,
    body: str,
    data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    stmt = (
        select(AdminPushSubscription)
        .outerjoin(AdminUser, AdminUser.id == AdminPushSubscription.admin_user_id)
        .where(
            AdminPushSubscription.is_active.is_(True),
            (AdminPushSubscription.admin_user_id.is_(None) | AdminUser.is_active.is_(True)),
        )
        .order_by(AdminPushSubscription.id.desc())
    )
    if admin_user_ids:
        stmt = stmt.where(AdminPushSubscription.admin_user_id.in_(admin_user_ids))

    subscriptions = list(db.scalars(stmt).all())
    result = send_push_to_admin_subscriptions(
        db,
        subscriptions=subscriptions,
        title=title,
        body=body,
        data=data,
    )
    result["admin_user_ids"] = sorted(
        {item.admin_user_id for item in subscriptions if item.admin_user_id is not None}
    )
    result["admin_usernames"] = sorted({item.admin_username for item in subscriptions if item.admin_username})
    return result


def run_admin_push_claim_health_check(
    *,
    stale_after_minutes: int | None = None,
    batch_size: int | None = None,
    db: Session | None = None,
) -> dict[str, Any]:
    if db is None:
        with SessionLocal() as managed_db:
            return run_admin_push_claim_health_check(
                stale_after_minutes=stale_after_minutes,
                batch_size=batch_size,
                db=managed_db,
            )

    if not is_push_enabled():
        return {
            "push_enabled": False,
            "checked_at_utc": _utcnow().isoformat(),
            "stale_after_minutes": 0,
            "total_active": 0,
            "stale_candidates": 0,
            "checked": 0,
            "healthy_active": 0,
            "with_error_active": 0,
            "stale_active": 0,
            "ping_total_targets": 0,
            "ping_sent": 0,
            "ping_failed": 0,
            "ping_deactivated": 0,
            "checked_subscription_ids": [],
        }

    settings = get_settings()
    now_utc = _utcnow()
    stale_minutes = max(
        5,
        int(stale_after_minutes or settings.admin_push_healthcheck_stale_minutes or 0),
    )
    max_batch = max(1, int(batch_size or settings.admin_push_healthcheck_batch_size or 0))
    stale_cutoff = now_utc - timedelta(minutes=stale_minutes)

    rows = list_active_admin_push_subscriptions(db)
    stale_rows: list[AdminPushSubscription] = []
    for row in rows:
        row_last_seen_at = _as_utc_datetime(row.last_seen_at)
        has_error = bool((row.last_error or "").strip())
        is_stale = row_last_seen_at is None or row_last_seen_at < stale_cutoff
        if has_error or is_stale:
            stale_rows.append(row)

    stale_rows.sort(
        key=lambda row: (
            0 if bool((row.last_error or "").strip()) else 1,
            _as_utc_datetime(row.last_seen_at) or datetime.min.replace(tzinfo=timezone.utc),
            row.id,
        )
    )
    checked_rows = stale_rows[:max_batch]

    ping_summary: dict[str, Any] = {
        "total_targets": 0,
        "sent": 0,
        "failed": 0,
        "deactivated": 0,
    }
    if checked_rows:
        ping_summary = send_push_to_admin_subscriptions(
            db,
            subscriptions=checked_rows,
            title="Admin Claim Health Check",
            body="Silent health ping for admin claim validation.",
            data={
                "type": "ADMIN_CLAIM_HEALTH_PING",
                "silent": True,
                "url": "/admin-panel/notifications",
                "source": "notification_worker",
                "ts_utc": now_utc.isoformat(),
            },
        )

    healthy_active = 0
    with_error_active = 0
    stale_active = 0
    for row in rows:
        row_last_seen_at = _as_utc_datetime(row.last_seen_at)
        has_error = bool((row.last_error or "").strip())
        is_stale = row_last_seen_at is None or row_last_seen_at < stale_cutoff
        if has_error:
            with_error_active += 1
        if is_stale:
            stale_active += 1
        if (not has_error) and (not is_stale):
            healthy_active += 1

    return {
        "push_enabled": True,
        "checked_at_utc": now_utc.isoformat(),
        "stale_after_minutes": stale_minutes,
        "total_active": len(rows),
        "stale_candidates": len(stale_rows),
        "checked": len(checked_rows),
        "healthy_active": healthy_active,
        "with_error_active": with_error_active,
        "stale_active": stale_active,
        "ping_total_targets": int(ping_summary.get("total_targets", 0)),
        "ping_sent": int(ping_summary.get("sent", 0)),
        "ping_failed": int(ping_summary.get("failed", 0)),
        "ping_deactivated": int(ping_summary.get("deactivated", 0)),
        "checked_subscription_ids": [int(row.id) for row in checked_rows],
    }
