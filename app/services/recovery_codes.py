from __future__ import annotations

import base64
import hashlib
import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import ApiError
from app.models import Device, DeviceRecoveryCode, Employee
from app.security import hash_password, verify_password
from app.settings import get_settings

try:
    from cryptography.fernet import Fernet, InvalidToken
except Exception:  # pragma: no cover - optional runtime guard
    Fernet = None  # type: ignore[assignment]
    InvalidToken = Exception  # type: ignore[assignment]

RECOVERY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
RECOVERY_CODE_RAW_LENGTH = 8
RECOVERY_PIN_MIN_LEN = 6
RECOVERY_PIN_MAX_LEN = 12
RECOVERY_CODE_STATUS_ACTIVE = "ACTIVE"
RECOVERY_CODE_STATUS_USED_OR_EXPIRED = "USED_OR_EXPIRED"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_pin(value: str) -> str:
    normalized = "".join((value or "").strip().split())
    if not normalized:
        raise ApiError(status_code=422, code="VALIDATION_ERROR", message="Recovery PIN is required.")
    if not normalized.isdigit():
        raise ApiError(status_code=422, code="VALIDATION_ERROR", message="Recovery PIN must be numeric.")
    if len(normalized) < RECOVERY_PIN_MIN_LEN or len(normalized) > RECOVERY_PIN_MAX_LEN:
        raise ApiError(
            status_code=422,
            code="VALIDATION_ERROR",
            message=f"Recovery PIN length must be {RECOVERY_PIN_MIN_LEN}-{RECOVERY_PIN_MAX_LEN} digits.",
        )
    return normalized


def _normalize_code(value: str) -> str:
    cleaned = "".join(ch for ch in (value or "").upper() if ch.isalnum())
    if not cleaned:
        raise ApiError(status_code=422, code="VALIDATION_ERROR", message="Recovery code is required.")
    return cleaned


def _format_code(raw_code: str) -> str:
    normalized = _normalize_code(raw_code)
    if len(normalized) <= 4:
        return normalized
    return f"{normalized[:4]}-{normalized[4:]}"


def _generate_code() -> str:
    return "".join(secrets.choice(RECOVERY_CODE_ALPHABET) for _ in range(RECOVERY_CODE_RAW_LENGTH))


def _build_vault_cipher() -> Fernet:
    if Fernet is None:
        raise ApiError(
            status_code=500,
            code="RECOVERY_VAULT_UNAVAILABLE",
            message="Recovery vault runtime is unavailable.",
        )

    settings = get_settings()
    raw_key = (settings.recovery_admin_vault_key or "").strip()
    material = raw_key or (settings.jwt_secret or "").strip() or "dev-recovery-vault-key"
    derived = base64.urlsafe_b64encode(hashlib.sha256(material.encode("utf-8")).digest())
    return Fernet(derived)


def _encrypt_admin_vault(
    *,
    recovery_pin: str,
    recovery_codes: list[str],
    issued_at: datetime,
    expires_at: datetime,
) -> str:
    cipher = _build_vault_cipher()
    payload = {
        "recovery_pin": recovery_pin,
        "recovery_codes": list(recovery_codes),
        "issued_at": issued_at.isoformat(),
        "expires_at": expires_at.isoformat(),
    }
    raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    return cipher.encrypt(raw).decode("utf-8")


def _decrypt_admin_vault(token: str | None) -> dict[str, Any] | None:
    if not token:
        return None
    try:
        cipher = _build_vault_cipher()
        decoded = cipher.decrypt(token.encode("utf-8"))
        payload = json.loads(decoded.decode("utf-8"))
    except (InvalidToken, ValueError, TypeError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    return payload


def _resolve_active_device(db: Session, *, device_fingerprint: str) -> Device:
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
    if device.employee is None or not device.employee.is_active:
        raise ApiError(
            status_code=403,
            code="EMPLOYEE_INACTIVE",
            message="Inactive employee cannot use recovery codes.",
        )
    return device


def issue_recovery_codes(
    db: Session,
    *,
    device_fingerprint: str,
    recovery_pin: str,
) -> tuple[Device, list[str], datetime]:
    device = _resolve_active_device(db, device_fingerprint=device_fingerprint)
    normalized_pin = _normalize_pin(recovery_pin)
    now_utc = _utc_now()

    existing_codes = list(
        db.scalars(
            select(DeviceRecoveryCode).where(
                DeviceRecoveryCode.device_id == device.id,
                DeviceRecoveryCode.is_active.is_(True),
            )
        ).all()
    )
    for row in existing_codes:
        row.is_active = False

    settings = get_settings()
    count = max(4, min(20, int(settings.recovery_code_count or 8)))
    expiry_days = max(7, int(settings.recovery_code_expiry_days or 365))
    expires_at = now_utc + timedelta(days=expiry_days)

    plain_codes: list[str] = []
    generated_raw_codes: set[str] = set()
    while len(plain_codes) < count:
        raw_code = _generate_code()
        if raw_code in generated_raw_codes:
            continue
        generated_raw_codes.add(raw_code)
        plain_codes.append(_format_code(raw_code))
        db.add(
            DeviceRecoveryCode(
                device_id=device.id,
                code_hash=hash_password(raw_code),
                is_active=True,
                expires_at=expires_at,
            )
        )

    device.recovery_pin_hash = hash_password(normalized_pin)
    device.recovery_pin_updated_at = now_utc
    device.recovery_admin_vault = _encrypt_admin_vault(
        recovery_pin=normalized_pin,
        recovery_codes=plain_codes,
        issued_at=now_utc,
        expires_at=expires_at,
    )
    device.recovery_admin_vault_updated_at = now_utc
    db.commit()
    db.refresh(device)
    return device, plain_codes, expires_at


def get_recovery_status(
    db: Session,
    *,
    device_fingerprint: str,
) -> dict[str, Any]:
    device = _resolve_active_device(db, device_fingerprint=device_fingerprint)
    now_utc = _utc_now()
    active_codes = list(
        db.scalars(
            select(DeviceRecoveryCode).where(
                DeviceRecoveryCode.device_id == device.id,
                DeviceRecoveryCode.is_active.is_(True),
                DeviceRecoveryCode.used_at.is_(None),
                DeviceRecoveryCode.expires_at >= now_utc,
            )
        ).all()
    )
    nearest_expiry = min((row.expires_at for row in active_codes), default=None)
    return {
        "employee_id": device.employee_id,
        "device_id": device.id,
        "recovery_ready": bool(device.recovery_pin_hash and active_codes),
        "active_code_count": len(active_codes),
        "expires_at": nearest_expiry,
    }


def get_admin_recovery_snapshot(
    db: Session,
    *,
    device: Device,
) -> dict[str, Any]:
    now_utc = _utc_now()
    all_codes = list(
        db.scalars(
            select(DeviceRecoveryCode).where(
                DeviceRecoveryCode.device_id == device.id,
            )
        ).all()
    )
    active_codes = [
        row
        for row in all_codes
        if row.is_active and row.used_at is None and row.expires_at >= now_utc
    ]
    nearest_expiry = min((row.expires_at for row in active_codes), default=None)

    payload = _decrypt_admin_vault(device.recovery_admin_vault)
    plain_pin = payload.get("recovery_pin") if isinstance(payload, dict) else None
    raw_codes = payload.get("recovery_codes") if isinstance(payload, dict) else None
    plain_codes: list[str] = []
    if isinstance(raw_codes, list):
        for item in raw_codes:
            if isinstance(item, str):
                plain_codes.append(_format_code(item))

    unmatched_active = list(active_codes)
    entries: list[dict[str, str]] = []
    for item in plain_codes:
        try:
            normalized_code = _normalize_code(item)
        except ApiError:
            entries.append({"code": item, "status": RECOVERY_CODE_STATUS_USED_OR_EXPIRED})
            continue
        matched_index = None
        for index, candidate in enumerate(unmatched_active):
            if verify_password(normalized_code, candidate.code_hash):
                matched_index = index
                break
        if matched_index is None:
            entries.append({"code": item, "status": RECOVERY_CODE_STATUS_USED_OR_EXPIRED})
            continue
        entries.append({"code": item, "status": RECOVERY_CODE_STATUS_ACTIVE})
        unmatched_active.pop(matched_index)

    return {
        "recovery_ready": bool(device.recovery_pin_hash and active_codes),
        "recovery_code_active_count": len(active_codes),
        "recovery_expires_at": nearest_expiry,
        "recovery_pin_updated_at": device.recovery_pin_updated_at,
        "recovery_pin_plain": plain_pin if isinstance(plain_pin, str) and plain_pin else None,
        "recovery_code_entries": entries,
    }


def recover_device_with_code(
    db: Session,
    *,
    employee_id: int,
    recovery_pin: str,
    recovery_code: str,
) -> Device:
    normalized_pin = _normalize_pin(recovery_pin)
    normalized_code = _normalize_code(recovery_code)
    now_utc = _utc_now()

    devices = list(
        db.scalars(
            select(Device)
            .join(Employee, Employee.id == Device.employee_id)
            .where(
                Device.employee_id == employee_id,
                Device.is_active.is_(True),
                Employee.is_active.is_(True),
            )
            .order_by(Device.id.desc())
        ).all()
    )
    if not devices:
        raise ApiError(status_code=404, code="EMPLOYEE_NOT_FOUND", message="Employee not found.")

    pin_matched_devices = [
        item
        for item in devices
        if item.recovery_pin_hash and verify_password(normalized_pin, item.recovery_pin_hash)
    ]
    if not pin_matched_devices:
        raise ApiError(
            status_code=401,
            code="RECOVERY_PIN_INVALID",
            message="Recovery PIN is invalid.",
        )

    device_ids = [item.id for item in pin_matched_devices]
    candidate_codes = list(
        db.scalars(
            select(DeviceRecoveryCode).where(
                DeviceRecoveryCode.device_id.in_(device_ids),
                DeviceRecoveryCode.is_active.is_(True),
                DeviceRecoveryCode.used_at.is_(None),
                DeviceRecoveryCode.expires_at >= now_utc,
            )
        ).all()
    )
    if not candidate_codes:
        raise ApiError(
            status_code=409,
            code="RECOVERY_CODES_NOT_READY",
            message="Recovery codes are not configured or expired for this account.",
        )

    matched_code: DeviceRecoveryCode | None = None
    for row in candidate_codes:
        if verify_password(normalized_code, row.code_hash):
            matched_code = row
            break
    if matched_code is None:
        raise ApiError(
            status_code=401,
            code="RECOVERY_CODE_INVALID",
            message="Recovery code is invalid.",
        )

    matched_code.used_at = now_utc
    matched_code.is_active = False
    db.commit()

    device = db.get(Device, matched_code.device_id)
    if device is None or not device.is_active:
        raise ApiError(
            status_code=404,
            code="DEVICE_NOT_CLAIMED",
            message="Recovery target device is not active.",
        )
    return device
