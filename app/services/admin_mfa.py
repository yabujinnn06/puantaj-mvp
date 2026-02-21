from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import struct
from datetime import datetime, timezone

from app.settings import get_settings


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


def is_admin_mfa_enabled() -> bool:
    settings = get_settings()
    if not settings.admin_mfa_required:
        return False
    return _normalize_totp_secret(settings.admin_mfa_totp_secret) is not None


def verify_admin_totp_code(code: str | None, *, now_utc: datetime | None = None) -> bool:
    settings = get_settings()
    secret = _normalize_totp_secret(settings.admin_mfa_totp_secret)
    if secret is None:
        return False

    normalized_code = "".join(ch for ch in (code or "").strip() if ch.isdigit())
    if len(normalized_code) != 6:
        return False

    step_seconds = max(15, int(settings.admin_mfa_step_seconds or 30))
    window_steps = max(0, min(6, int(settings.admin_mfa_window_steps or 1)))
    now = now_utc or datetime.now(timezone.utc)
    base_counter = int(now.timestamp()) // step_seconds

    for offset in range(-window_steps, window_steps + 1):
        candidate = _hotp(secret, base_counter + offset, digits=6)
        if hmac.compare_digest(candidate, normalized_code):
            return True
    return False
