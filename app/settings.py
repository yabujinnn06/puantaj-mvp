from functools import lru_cache

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

