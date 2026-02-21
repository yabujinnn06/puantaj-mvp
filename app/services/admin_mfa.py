from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import secrets
import struct
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import quote

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AdminMfaRecoveryCode, AdminUser
from app.security import hash_password, verify_password
from app.settings import get_settings

try:
    from cryptography.fernet import Fernet, InvalidToken
except Exception:  # pragma: no cover - optional runtime guard
    Fernet = None  # type: ignore[assignment]
    InvalidToken = Exception  # type: ignore[assignment]

MFA_SECRET_ENC_PREFIX = "MFA1:"
RECOVERY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
RECOVERY_CODE_RAW_LENGTH = 10


def _normalize_totp_secret(raw_secret: str | None) -> bytes | None:
    cleaned = "".join(ch for ch in (raw_secret or "").strip().upper() if ch.isalnum())
    if not cleaned:
        return None
    padding = "=" * ((8 - len(cleaned) % 8) % 8)
    try:
        return base64.b32decode(cleaned + padding, casefold=True)
    except (binascii.Error, ValueError):
        return None


def _hotp(secret: bytes, counter: int, digits: int = 6) -> str:
    packed_counter = struct.pack(">Q", counter)
    digest = hmac.new(secret, packed_counter, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    binary = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    otp_int = binary % (10**digits)
    return str(otp_int).zfill(digits)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_code(code: str | None) -> str:
    return "".join(ch for ch in (code or "").strip() if ch.isdigit())


def _normalize_recovery_code(value: str | None) -> str:
    return "".join(ch for ch in (value or "").strip().upper() if ch.isalnum())


def _format_recovery_code(raw_code: str) -> str:
    normalized = _normalize_recovery_code(raw_code)
    if len(normalized) <= 5:
        return normalized
    return f"{normalized[:5]}-{normalized[5:]}"


def _generate_recovery_code() -> str:
    return "".join(secrets.choice(RECOVERY_CODE_ALPHABET) for _ in range(RECOVERY_CODE_RAW_LENGTH))


def _mfa_cipher() -> Fernet | None:
    if Fernet is None:
        return None
    settings = get_settings()
    material = (
        (settings.recovery_admin_vault_key or "").strip()
        or (settings.archive_file_encryption_key or "").strip()
        or (settings.jwt_secret or "").strip()
        or "dev-admin-mfa-key"
    )
    derived = base64.urlsafe_b64encode(hashlib.sha256(material.encode("utf-8")).digest())
    return Fernet(derived)


def _encrypt_secret(secret_key: str) -> str:
    cipher = _mfa_cipher()
    payload = secret_key.strip()
    if not payload:
        return ""
    if cipher is None:
        return payload
    return MFA_SECRET_ENC_PREFIX + cipher.encrypt(payload.encode("utf-8")).decode("utf-8")


def _decrypt_secret(token: str | None) -> str | None:
    raw = (token or "").strip()
    if not raw:
        return None
    if not raw.startswith(MFA_SECRET_ENC_PREFIX):
        return raw
    cipher = _mfa_cipher()
    if cipher is None:
        return None
    payload = raw[len(MFA_SECRET_ENC_PREFIX) :]
    try:
        decoded = cipher.decrypt(payload.encode("utf-8"))
    except InvalidToken:
        return None
    secret_key = decoded.decode("utf-8").strip()
    return secret_key or None


def is_admin_mfa_enabled() -> bool:
    """Legacy/global MFA flag for env-admin compatibility."""
    settings = get_settings()
    if not settings.admin_mfa_required:
        return False
    return _normalize_totp_secret(settings.admin_mfa_totp_secret) is not None


def _verify_totp_for_secret(secret_key: str | None, code: str | None, *, now_utc: datetime | None = None) -> bool:
    secret = _normalize_totp_secret(secret_key)
    if secret is None:
        return False

    normalized_code = _normalize_code(code)
    if len(normalized_code) != 6:
        return False

    settings = get_settings()
    step_seconds = max(15, int(settings.admin_mfa_step_seconds or 30))
    window_steps = max(0, min(6, int(settings.admin_mfa_window_steps or 1)))
    now = now_utc or _utc_now()
    base_counter = int(now.timestamp()) // step_seconds

    for offset in range(-window_steps, window_steps + 1):
        candidate = _hotp(secret, base_counter + offset, digits=6)
        if hmac.compare_digest(candidate, normalized_code):
            return True
    return False


def verify_admin_totp_code(code: str | None, *, now_utc: datetime | None = None) -> bool:
    """Verify TOTP against legacy/global secret."""
    settings = get_settings()
    if not settings.admin_mfa_required:
        return False
    return _verify_totp_for_secret(settings.admin_mfa_totp_secret, code, now_utc=now_utc)


def is_admin_user_mfa_enabled(admin_user: AdminUser | None) -> bool:
    if admin_user is None:
        return False
    return bool(admin_user.mfa_enabled and (admin_user.mfa_secret_enc or "").strip())


def build_totp_secret_key() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode("utf-8").rstrip("=")


def build_totp_otpauth_uri(
    *,
    account_name: str,
    secret_key: str,
    issuer: str | None = None,
) -> str:
    settings = get_settings()
    normalized_issuer = (issuer or f"{settings.app_name} Admin").strip() or "PuantajMVP Admin"
    label = f"{normalized_issuer}:{account_name.strip() or 'admin'}"
    step_seconds = max(15, int(settings.admin_mfa_step_seconds or 30))
    return (
        f"otpauth://totp/{quote(label)}"
        f"?secret={quote(secret_key.strip())}"
        f"&issuer={quote(normalized_issuer)}"
        f"&algorithm=SHA1&digits=6&period={step_seconds}"
    )


def start_admin_user_mfa_setup(db: Session, *, admin_user: AdminUser) -> dict[str, str]:
    secret_key = build_totp_secret_key()
    admin_user.mfa_secret_enc = _encrypt_secret(secret_key)
    admin_user.mfa_secret_updated_at = _utc_now()
    admin_user.mfa_enabled = False

    for row in db.scalars(
        select(AdminMfaRecoveryCode).where(
            AdminMfaRecoveryCode.admin_user_id == admin_user.id,
            AdminMfaRecoveryCode.is_active.is_(True),
        )
    ).all():
        row.is_active = False

    issuer = (get_settings().app_name or "PuantajMVP").strip()
    issuer = f"{issuer} Admin"
    return {
        "secret_key": secret_key,
        "issuer": issuer,
        "otpauth_uri": build_totp_otpauth_uri(
            account_name=admin_user.username,
            secret_key=secret_key,
            issuer=issuer,
        ),
    }


def verify_admin_user_totp_code(
    admin_user: AdminUser,
    code: str | None,
    *,
    now_utc: datetime | None = None,
) -> bool:
    secret_key = _decrypt_secret(admin_user.mfa_secret_enc)
    if secret_key is None:
        return False
    return _verify_totp_for_secret(secret_key, code, now_utc=now_utc)


def issue_admin_user_recovery_codes(
    db: Session,
    *,
    admin_user: AdminUser,
    count: int | None = None,
) -> tuple[list[str], datetime]:
    settings = get_settings()
    code_count = int(count or settings.recovery_code_count or 8)
    code_count = max(4, min(20, code_count))
    expiry_days = max(7, int(settings.recovery_code_expiry_days or 365))
    now_utc = _utc_now()
    expires_at = now_utc + timedelta(days=expiry_days)

    for row in db.scalars(
        select(AdminMfaRecoveryCode).where(
            AdminMfaRecoveryCode.admin_user_id == admin_user.id,
            AdminMfaRecoveryCode.is_active.is_(True),
        )
    ).all():
        row.is_active = False

    plain_codes: list[str] = []
    generated_raw_codes: set[str] = set()
    while len(plain_codes) < code_count:
        raw_code = _generate_recovery_code()
        if raw_code in generated_raw_codes:
            continue
        generated_raw_codes.add(raw_code)
        plain_codes.append(_format_recovery_code(raw_code))
        db.add(
            AdminMfaRecoveryCode(
                admin_user_id=admin_user.id,
                code_hash=hash_password(raw_code),
                is_active=True,
                expires_at=expires_at,
            )
        )
    return plain_codes, expires_at


def consume_admin_user_recovery_code(
    db: Session,
    *,
    admin_user: AdminUser,
    recovery_code: str | None,
) -> bool:
    normalized_code = _normalize_recovery_code(recovery_code)
    if not normalized_code:
        return False
    now_utc = _utc_now()
    candidate_rows = list(
        db.scalars(
            select(AdminMfaRecoveryCode).where(
                AdminMfaRecoveryCode.admin_user_id == admin_user.id,
                AdminMfaRecoveryCode.is_active.is_(True),
                AdminMfaRecoveryCode.used_at.is_(None),
                AdminMfaRecoveryCode.expires_at >= now_utc,
            )
        ).all()
    )
    for row in candidate_rows:
        if verify_password(normalized_code, row.code_hash):
            row.is_active = False
            row.used_at = now_utc
            return True
    return False


def get_admin_user_mfa_status(db: Session, *, admin_user: AdminUser) -> dict[str, Any]:
    now_utc = _utc_now()
    rows = list(
        db.scalars(
            select(AdminMfaRecoveryCode).where(
                AdminMfaRecoveryCode.admin_user_id == admin_user.id,
            )
        ).all()
    )
    active_rows = [
        row for row in rows if row.is_active and row.used_at is None and row.expires_at >= now_utc
    ]
    return {
        "admin_user_id": admin_user.id,
        "username": admin_user.username,
        "mfa_enabled": bool(admin_user.mfa_enabled),
        "has_secret": bool((admin_user.mfa_secret_enc or "").strip()),
        "recovery_code_active_count": len(active_rows),
        "recovery_code_total_count": len(rows),
        "recovery_code_expires_at": min((row.expires_at for row in active_rows), default=None),
        "updated_at": admin_user.mfa_secret_updated_at,
    }


def reset_admin_user_mfa(db: Session, *, admin_user: AdminUser) -> None:
    admin_user.mfa_enabled = False
    admin_user.mfa_secret_enc = None
    admin_user.mfa_secret_updated_at = _utc_now()
    for row in db.scalars(
        select(AdminMfaRecoveryCode).where(
            AdminMfaRecoveryCode.admin_user_id == admin_user.id,
            AdminMfaRecoveryCode.is_active.is_(True),
        )
    ).all():
        row.is_active = False
