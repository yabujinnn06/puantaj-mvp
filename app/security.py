from __future__ import annotations

import hmac
import threading
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Mapping
from uuid import uuid4

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from passlib.exc import UnknownHashError

from app.errors import ApiError
from app.settings import get_settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer(auto_error=False)

_LOCK = threading.Lock()
_FAILED_ATTEMPTS: dict[str, deque[datetime]] = defaultdict(deque)
_MAX_ATTEMPTS = 10
_ATTEMPT_WINDOW = timedelta(minutes=10)

ADMIN_PERMISSION_KEYS: tuple[str, ...] = (
    "regions",
    "departments",
    "employees",
    "devices",
    "work_rules",
    "attendance_events",
    "leaves",
    "reports",
    "compliance",
    "schedule",
    "manual_overrides",
    "audit",
    "admin_users",
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _cleanup_attempts(ip: str, now: datetime) -> None:
    queue = _FAILED_ATTEMPTS[ip]
    threshold = now - _ATTEMPT_WINDOW
    while queue and queue[0] < threshold:
        queue.popleft()
    if not queue:
        _FAILED_ATTEMPTS.pop(ip, None)


def ensure_login_attempt_allowed(ip: str) -> None:
    now = _utcnow()
    with _LOCK:
        _cleanup_attempts(ip, now)
        queue = _FAILED_ATTEMPTS.get(ip, deque())
        if len(queue) >= _MAX_ATTEMPTS:
            raise ApiError(
                status_code=429,
                code="TOO_MANY_ATTEMPTS",
                message="Too many failed login attempts. Please try again later.",
            )


def register_login_failure(ip: str) -> None:
    now = _utcnow()
    with _LOCK:
        _cleanup_attempts(ip, now)
        _FAILED_ATTEMPTS[ip].append(now)


def register_login_success(ip: str) -> None:
    with _LOCK:
        _FAILED_ATTEMPTS.pop(ip, None)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return pwd_context.verify(password, password_hash)
    except (ValueError, TypeError, UnknownHashError):
        # Invalid/legacy hash values should not crash auth flow.
        return False


def verify_admin_credentials(username: str, password: str) -> bool:
    settings = get_settings()
    env_username = (settings.admin_user or "").strip()
    env_pass_hash = (settings.admin_pass_hash or "").strip()

    # Common deployment copy/paste issue: quoted env values.
    if len(env_username) >= 2 and env_username[0] == env_username[-1] and env_username[0] in {"'", '"'}:
        env_username = env_username[1:-1]
    if len(env_pass_hash) >= 2 and env_pass_hash[0] == env_pass_hash[-1] and env_pass_hash[0] in {"'", '"'}:
        env_pass_hash = env_pass_hash[1:-1]

    if not hmac.compare_digest(username, env_username):
        return False
    if not env_pass_hash:
        return False
    return verify_password(password, env_pass_hash)


def empty_permissions() -> dict[str, dict[str, bool]]:
    return {key: {"read": False, "write": False} for key in ADMIN_PERMISSION_KEYS}


def full_permissions() -> dict[str, dict[str, bool]]:
    return {key: {"read": True, "write": True} for key in ADMIN_PERMISSION_KEYS}


def normalize_permissions(raw: Mapping[str, Any] | None) -> dict[str, dict[str, bool]]:
    normalized = empty_permissions()
    if not isinstance(raw, Mapping):
        return normalized

    for key, value in raw.items():
        if key not in normalized:
            continue
        if isinstance(value, Mapping):
            read = bool(value.get("read"))
            write = bool(value.get("write"))
        else:
            read = bool(value)
            write = bool(value)
        if write:
            read = True
        normalized[key] = {"read": read, "write": write}
    return normalized


def has_permission(claims: Mapping[str, Any], permission: str, *, write: bool = False) -> bool:
    if permission not in ADMIN_PERMISSION_KEYS:
        return False
    reserved_admin_username = get_settings().admin_user
    username = str(claims.get("username") or claims.get("sub") or "")
    if username == reserved_admin_username:
        return True
    if bool(claims.get("is_super_admin")):
        return True

    # Backward compatibility for legacy tokens issued before granular permissions.
    if claims.get("permissions") is None and claims.get("role") == "admin":
        return True

    permissions = normalize_permissions(claims.get("permissions"))  # type: ignore[arg-type]
    permission_value = permissions.get(permission)
    if not permission_value:
        return False
    if write:
        return bool(permission_value.get("write"))
    return bool(permission_value.get("read") or permission_value.get("write"))


def _build_claims(
    *,
    token_type: str,
    expires_delta: timedelta,
    sub: str,
    username: str,
    full_name: str | None,
    role: str,
    admin_user_id: int | None,
    is_super_admin: bool,
    permissions: Mapping[str, Any] | None,
) -> dict[str, Any]:
    settings = get_settings()
    now = _utcnow()
    exp = now + expires_delta
    return {
        "sub": sub,
        "username": username,
        "full_name": full_name,
        "role": role,
        "admin_user_id": admin_user_id,
        "is_super_admin": is_super_admin,
        "permissions": normalize_permissions(permissions),
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
        "jti": str(uuid4()),
        "typ": token_type,
    }


def create_access_token(
    *,
    sub: str,
    username: str,
    full_name: str | None = None,
    role: str = "admin",
    admin_user_id: int | None = None,
    is_super_admin: bool = False,
    permissions: Mapping[str, Any] | None = None,
) -> tuple[str, int, dict[str, Any]]:
    settings = get_settings()
    claims = _build_claims(
        token_type="access",
        expires_delta=timedelta(minutes=settings.access_token_minutes),
        sub=sub,
        username=username,
        full_name=full_name,
        role=role,
        admin_user_id=admin_user_id,
        is_super_admin=is_super_admin,
        permissions=permissions,
    )
    token = jwt.encode(claims, settings.jwt_secret, algorithm="HS256")
    return token, settings.access_token_minutes * 60, claims


def create_refresh_token(
    *,
    sub: str,
    username: str,
    full_name: str | None = None,
    role: str = "admin",
    admin_user_id: int | None = None,
    is_super_admin: bool = False,
    permissions: Mapping[str, Any] | None = None,
) -> tuple[str, dict[str, Any]]:
    settings = get_settings()
    claims = _build_claims(
        token_type="refresh",
        expires_delta=timedelta(days=settings.refresh_token_days),
        sub=sub,
        username=username,
        full_name=full_name,
        role=role,
        admin_user_id=admin_user_id,
        is_super_admin=is_super_admin,
        permissions=permissions,
    )
    token = jwt.encode(claims, settings.jwt_secret, algorithm="HS256")
    return token, claims


def decode_token(token: str, *, expected_type: str) -> dict[str, Any]:
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=["HS256"],
            audience=settings.jwt_audience,
            issuer=settings.jwt_issuer,
            options={"require_sub": True, "require_iat": True, "require_exp": True},
        )
    except JWTError as exc:
        raise ApiError(status_code=401, code="INVALID_TOKEN", message="Token is invalid.") from exc

    token_type = payload.get("typ")
    if token_type != expected_type:
        raise ApiError(status_code=401, code="INVALID_TOKEN", message="Token type is invalid.")

    subject = payload.get("sub")
    if not isinstance(subject, str) or not subject:
        raise ApiError(status_code=401, code="INVALID_TOKEN", message="Token subject is invalid.")

    if payload.get("role") != "admin":
        raise ApiError(status_code=403, code="FORBIDDEN", message="Insufficient permissions.")

    return payload


def should_allow_refresh() -> bool:
    return bool(get_settings().allow_refresh)


def require_admin(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict[str, Any]:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise ApiError(status_code=401, code="INVALID_TOKEN", message="Missing bearer token.")

    payload = decode_token(credentials.credentials, expected_type="access")

    request.state.actor = "admin"
    request.state.actor_id = str(payload.get("username") or payload.get("sub") or "admin")
    return payload


def require_admin_permission(permission: str, *, write: bool = False) -> Callable[..., dict[str, Any]]:
    if permission not in ADMIN_PERMISSION_KEYS:
        raise ValueError(f"Unknown admin permission: {permission}")

    def _dependency(claims: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
        if not has_permission(claims, permission, write=write):
            raise ApiError(status_code=403, code="FORBIDDEN", message="Insufficient permissions.")
        return claims

    return _dependency
