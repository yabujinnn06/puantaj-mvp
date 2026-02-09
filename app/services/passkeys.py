from __future__ import annotations

import base64
import json
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import ApiError
from app.models import Device, DevicePasskey, Employee, WebAuthnChallenge
from app.settings import get_settings, get_webauthn_origin, get_webauthn_rp_id

try:
    from webauthn import (
        base64url_to_bytes,
        generate_authentication_options,
        generate_registration_options,
        options_to_json,
        verify_authentication_response,
        verify_registration_response,
    )
    from webauthn.helpers.structs import (
        AuthenticatorSelectionCriteria,
        PublicKeyCredentialDescriptor,
        ResidentKeyRequirement,
        UserVerificationRequirement,
    )
except Exception:  # pragma: no cover - dependency runtime guard
    base64url_to_bytes = None  # type: ignore[assignment]
    generate_authentication_options = None  # type: ignore[assignment]
    generate_registration_options = None  # type: ignore[assignment]
    options_to_json = None  # type: ignore[assignment]
    verify_authentication_response = None  # type: ignore[assignment]
    verify_registration_response = None  # type: ignore[assignment]
    AuthenticatorSelectionCriteria = None  # type: ignore[assignment]
    PublicKeyCredentialDescriptor = None  # type: ignore[assignment]
    ResidentKeyRequirement = None  # type: ignore[assignment]
    UserVerificationRequirement = None  # type: ignore[assignment]


PASSKEY_PURPOSE_REGISTER = "PASSKEY_REGISTER"
PASSKEY_PURPOSE_RECOVER = "PASSKEY_RECOVER"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _bytes_to_base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _is_passkey_enabled() -> bool:
    mode = (get_settings().passkey_mode or "off").strip().lower()
    return mode in {"optional", "required"}


def _ensure_runtime() -> None:
    if not _is_passkey_enabled():
        raise ApiError(
            status_code=409,
            code="PASSKEY_DISABLED",
            message="Passkey modu devre disi.",
        )
    if (
        generate_registration_options is None
        or generate_authentication_options is None
        or options_to_json is None
        or verify_registration_response is None
        or verify_authentication_response is None
        or base64url_to_bytes is None
    ):
        raise ApiError(
            status_code=500,
            code="PASSKEY_RUNTIME_UNAVAILABLE",
            message="Passkey runtime kullanilabilir degil.",
        )


def _resolve_active_device(db: Session, device_fingerprint: str) -> Device:
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
            message="Cihaz bagli degil.",
        )

    employee: Employee | None = device.employee
    if employee is None:
        raise ApiError(
            status_code=404,
            code="EMPLOYEE_NOT_FOUND",
            message="Cihaza bagli calisan bulunamadi.",
        )
    if not employee.is_active:
        raise ApiError(
            status_code=403,
            code="EMPLOYEE_INACTIVE",
            message="Pasif calisan passkey islemi yapamaz.",
        )
    return device


def _build_expiry() -> datetime:
    minutes = max(1, int(get_settings().passkey_challenge_minutes))
    return _utc_now() + timedelta(minutes=minutes)


def _load_valid_challenge(db: Session, *, challenge_id: int, purpose: str) -> WebAuthnChallenge:
    challenge = db.get(WebAuthnChallenge, challenge_id)
    if challenge is None or challenge.purpose != purpose:
        raise ApiError(
            status_code=404,
            code="PASSKEY_CHALLENGE_NOT_FOUND",
            message="Passkey challenge bulunamadi.",
        )

    now = _utc_now()
    if challenge.used_at is not None:
        raise ApiError(
            status_code=409,
            code="PASSKEY_CHALLENGE_USED",
            message="Passkey challenge daha once kullanilmis.",
        )
    if challenge.expires_at < now:
        raise ApiError(
            status_code=400,
            code="PASSKEY_CHALLENGE_EXPIRED",
            message="Passkey challenge suresi dolmus.",
        )
    return challenge


def has_device_passkey(db: Session, *, device_id: int) -> bool:
    existing = db.scalar(
        select(DevicePasskey.id).where(
            DevicePasskey.device_id == device_id,
            DevicePasskey.is_active.is_(True),
        )
    )
    return existing is not None


def create_registration_options(
    db: Session,
    *,
    device_fingerprint: str,
    ip: str | None = None,
    user_agent: str | None = None,
) -> tuple[WebAuthnChallenge, dict[str, Any]]:
    _ensure_runtime()
    device = _resolve_active_device(db, device_fingerprint)

    active_passkeys = list(
        db.scalars(
            select(DevicePasskey).where(
                DevicePasskey.device_id == device.id,
                DevicePasskey.is_active.is_(True),
            )
        ).all()
    )

    exclude_credentials: list[PublicKeyCredentialDescriptor] = []
    if PublicKeyCredentialDescriptor is not None and base64url_to_bytes is not None:
        for passkey in active_passkeys:
            try:
                exclude_credentials.append(
                    PublicKeyCredentialDescriptor(
                        id=base64url_to_bytes(passkey.credential_id),
                    )
                )
            except Exception:
                continue

    rp_id = get_webauthn_rp_id()
    rp_name = get_settings().webauthn_rp_name

    options = generate_registration_options(
        rp_id=rp_id,
        rp_name=rp_name,
        user_id=str(device.id).encode("utf-8"),
        user_name=f"device-{device.id}",
        user_display_name=device.employee.full_name if device.employee is not None else f"Device {device.id}",
        authenticator_selection=(
            AuthenticatorSelectionCriteria(
                resident_key=ResidentKeyRequirement.REQUIRED,
                user_verification=UserVerificationRequirement.PREFERRED,
            )
            if AuthenticatorSelectionCriteria is not None
            else None
        ),
        exclude_credentials=exclude_credentials,
    )
    options_json = json.loads(options_to_json(options))
    challenge_value = str(options_json.get("challenge") or "").strip()
    if not challenge_value:
        raise ApiError(
            status_code=500,
            code="PASSKEY_CHALLENGE_MISSING",
            message="Passkey challenge olusturulamadi.",
        )

    challenge = WebAuthnChallenge(
        purpose=PASSKEY_PURPOSE_REGISTER,
        challenge=challenge_value,
        device_id=device.id,
        expires_at=_build_expiry(),
        ip=ip,
        user_agent=user_agent,
    )
    db.add(challenge)
    db.commit()
    db.refresh(challenge)
    return challenge, options_json


def verify_registration(
    db: Session,
    *,
    challenge_id: int,
    credential: dict[str, Any],
) -> DevicePasskey:
    _ensure_runtime()
    challenge = _load_valid_challenge(db, challenge_id=challenge_id, purpose=PASSKEY_PURPOSE_REGISTER)
    if challenge.device_id is None:
        raise ApiError(
            status_code=409,
            code="PASSKEY_CHALLENGE_INVALID",
            message="Passkey challenge cihaz bilgisi icermiyor.",
        )

    device = db.get(Device, challenge.device_id)
    if device is None or not device.is_active:
        raise ApiError(
            status_code=404,
            code="DEVICE_NOT_CLAIMED",
            message="Cihaz bagli degil.",
        )

    try:
        verification = verify_registration_response(
            credential=credential,
            expected_challenge=base64url_to_bytes(challenge.challenge),
            expected_rp_id=get_webauthn_rp_id(),
            expected_origin=get_webauthn_origin(),
            require_user_verification=False,
        )
    except Exception as exc:  # pragma: no cover - depends on browser payload
        raise ApiError(
            status_code=400,
            code="PASSKEY_REGISTRATION_FAILED",
            message=f"Passkey kaydi dogrulanamadi: {exc}",
        ) from exc

    credential_id = _bytes_to_base64url(verification.credential_id)
    public_key = _bytes_to_base64url(verification.credential_public_key)
    sign_count = int(getattr(verification, "sign_count", 0) or 0)

    transports_raw: Any = None
    if isinstance(credential, dict):
        response = credential.get("response")
        if isinstance(response, dict):
            transports_raw = response.get("transports")
    transports: list[str] = []
    if isinstance(transports_raw, list):
        transports = [str(item) for item in transports_raw if item is not None]

    passkey = db.scalar(
        select(DevicePasskey).where(DevicePasskey.credential_id == credential_id)
    )
    if passkey is None:
        passkey = DevicePasskey(
            device_id=device.id,
            credential_id=credential_id,
            public_key=public_key,
            sign_count=sign_count,
            transports=transports,
            is_active=True,
            last_used_at=_utc_now(),
        )
        db.add(passkey)
    else:
        passkey.device_id = device.id
        passkey.public_key = public_key
        passkey.sign_count = sign_count
        passkey.transports = transports
        passkey.is_active = True
        passkey.last_used_at = _utc_now()

    challenge.used_at = _utc_now()
    db.commit()
    db.refresh(passkey)
    return passkey


def create_recover_options(
    db: Session,
    *,
    ip: str | None = None,
    user_agent: str | None = None,
) -> tuple[WebAuthnChallenge, dict[str, Any]]:
    _ensure_runtime()

    options = generate_authentication_options(
        rp_id=get_webauthn_rp_id(),
        user_verification=(
            UserVerificationRequirement.PREFERRED
            if UserVerificationRequirement is not None
            else None
        ),
    )
    options_json = json.loads(options_to_json(options))
    challenge_value = str(options_json.get("challenge") or "").strip()
    if not challenge_value:
        raise ApiError(
            status_code=500,
            code="PASSKEY_CHALLENGE_MISSING",
            message="Passkey challenge olusturulamadi.",
        )

    challenge = WebAuthnChallenge(
        purpose=PASSKEY_PURPOSE_RECOVER,
        challenge=challenge_value,
        device_id=None,
        expires_at=_build_expiry(),
        ip=ip,
        user_agent=user_agent,
    )
    db.add(challenge)
    db.commit()
    db.refresh(challenge)
    return challenge, options_json


def verify_recover(
    db: Session,
    *,
    challenge_id: int,
    credential: dict[str, Any],
) -> Device:
    _ensure_runtime()
    challenge = _load_valid_challenge(db, challenge_id=challenge_id, purpose=PASSKEY_PURPOSE_RECOVER)

    credential_id = None
    if isinstance(credential, dict):
        raw_id = credential.get("id")
        if isinstance(raw_id, str) and raw_id.strip():
            credential_id = raw_id.strip()
    if not credential_id:
        raise ApiError(
            status_code=422,
            code="PASSKEY_CREDENTIAL_ID_MISSING",
            message="Passkey credential id eksik.",
        )

    passkey = db.scalar(
        select(DevicePasskey).where(
            DevicePasskey.credential_id == credential_id,
            DevicePasskey.is_active.is_(True),
        )
    )
    if passkey is None:
        raise ApiError(
            status_code=404,
            code="PASSKEY_NOT_REGISTERED",
            message="Bu passkey kayitli degil.",
        )

    device = db.get(Device, passkey.device_id)
    if device is None or not device.is_active:
        raise ApiError(
            status_code=404,
            code="DEVICE_NOT_CLAIMED",
            message="Passkey'e bagli cihaz aktif degil.",
        )
    if device.employee is None or not device.employee.is_active:
        raise ApiError(
            status_code=403,
            code="EMPLOYEE_INACTIVE",
            message="Pasif calisan passkey ile giris yapamaz.",
        )

    try:
        verification = verify_authentication_response(
            credential=credential,
            expected_challenge=base64url_to_bytes(challenge.challenge),
            expected_rp_id=get_webauthn_rp_id(),
            expected_origin=get_webauthn_origin(),
            credential_public_key=base64url_to_bytes(passkey.public_key),
            credential_current_sign_count=passkey.sign_count,
            require_user_verification=False,
        )
    except Exception as exc:  # pragma: no cover - depends on browser payload
        raise ApiError(
            status_code=400,
            code="PASSKEY_AUTH_FAILED",
            message=f"Passkey dogrulamasi basarisiz: {exc}",
        ) from exc

    passkey.sign_count = int(getattr(verification, "new_sign_count", passkey.sign_count) or 0)
    passkey.last_used_at = _utc_now()
    challenge.used_at = _utc_now()
    db.commit()
    db.refresh(device)
    return device
