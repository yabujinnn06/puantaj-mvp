from functools import lru_cache
from urllib.parse import urlparse

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/attendance"
    admin_user: str = "admin"
    admin_pass_hash: str = ""
    jwt_secret: str = ""
    jwt_issuer: str = "puantaj-mvp"
    jwt_audience: str = "puantaj-admin"
    access_token_minutes: int = 30
    refresh_token_days: int = 14
    allow_refresh: bool = True
    app_name: str = "PuantajMVP"
    cors_allow_origins: str = "http://127.0.0.1:5173,http://localhost:5173"
    base_public_url: str | None = None
    employee_portal_base_url: str = "http://127.0.0.1:8000/employee"
    attendance_timezone: str = "Europe/Istanbul"
    passkey_mode: str = "optional"
    webauthn_rp_id: str | None = None
    webauthn_rp_name: str = "PuantajMVP"
    webauthn_origin: str | None = None
    passkey_challenge_minutes: int = 10
    push_vapid_public_key: str | None = None
    push_vapid_private_key: str | None = None
    push_vapid_subject: str = "mailto:admin@example.com"
    notification_worker_enabled: bool = True
    notification_worker_interval_seconds: int = 60
    daily_report_archive_retention_days: int = 180
    schema_guard_strict: bool = True

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()


def get_cors_origins() -> list[str]:
    raw = get_settings().cors_allow_origins
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def get_employee_portal_base_url() -> str:
    settings = get_settings()
    if settings.base_public_url:
        base = settings.base_public_url.rstrip("/")
        if base.endswith("/employee"):
            return base
        return f"{base}/employee"
    return settings.employee_portal_base_url.rstrip("/")


def get_public_base_url() -> str:
    settings = get_settings()
    if settings.base_public_url:
        return settings.base_public_url.rstrip("/")
    return "http://127.0.0.1:8000"


def get_webauthn_origin() -> str:
    settings = get_settings()
    if settings.webauthn_origin:
        return settings.webauthn_origin.rstrip("/")
    return get_public_base_url()


def get_webauthn_rp_id() -> str:
    settings = get_settings()
    if settings.webauthn_rp_id:
        return settings.webauthn_rp_id.strip().lower()

    origin = get_webauthn_origin()
    parsed = urlparse(origin)
    host = (parsed.hostname or "").strip().lower()
    if not host:
        return "localhost"
    return host


def is_push_enabled() -> bool:
    settings = get_settings()
    return bool(
        (settings.push_vapid_public_key or "").strip()
        and (settings.push_vapid_private_key or "").strip()
    )

