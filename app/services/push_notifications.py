from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from pywebpush import WebPushException, webpush
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import ApiError
from app.models import Device, DevicePushSubscription, Employee
from app.settings import get_settings, is_push_enabled


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


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


def _send_to_subscription_row(
    row: DevicePushSubscription,
    *,
    title: str,
    body: str,
    data: dict[str, Any] | None,
) -> tuple[bool, str | None, int | None]:
    if not is_push_enabled():
        return False, "push_disabled", None

    settings = get_settings()
    payload = {
        "title": title,
        "body": body,
        "data": data or {},
        "ts_utc": _utcnow().isoformat(),
    }
    try:
        webpush(
            subscription_info={
                "endpoint": row.endpoint,
                "keys": {
                    "p256dh": row.p256dh,
                    "auth": row.auth,
                },
            },
            data=json.dumps(payload),
            vapid_private_key=settings.push_vapid_private_key,
            vapid_claims={"sub": settings.push_vapid_subject},
            ttl=60,
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
    now_utc = _utcnow()

    for row in subscriptions:
        ok, error_text, status_code = _send_to_subscription_row(
            row,
            title=title,
            body=body,
            data=data,
        )
        row.last_seen_at = now_utc
        if ok:
            sent += 1
            row.last_error = None
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
                "endpoint": row.endpoint,
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
