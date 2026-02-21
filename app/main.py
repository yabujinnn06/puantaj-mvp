import asyncio
from contextlib import suppress
from datetime import datetime, timezone
import logging
import time
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.errors import ApiError, error_response
from app.logging_utils import setup_json_logging
from app.routers import admin, attendance
from app.settings import get_cors_origins, get_settings
from app.services.notifications import (
    get_daily_report_job_health,
    get_notification_channel_health,
    schedule_daily_admin_report_archive_notifications,
    schedule_missed_checkout_notifications,
    send_pending_notifications,
)
from app.services.schema_guard import SchemaGuardResult, verify_runtime_schema
from app.db import engine

setup_json_logging()
logger = logging.getLogger("app.request")
notification_worker_logger = logging.getLogger("app.notification_worker")
settings = get_settings()
STATIC_ROOT = Path(__file__).resolve().parent / "static"
ADMIN_STATIC_DIR = STATIC_ROOT / "admin"
EMPLOYEE_STATIC_DIR = STATIC_ROOT / "employee"
BUILD_VERSION_FILE = STATIC_ROOT / "build_version.txt"


class SPAStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):  # type: ignore[override]
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404:
                raise
            # Keep 404 for missing assets (e.g. .js/.css), but return SPA index for route paths.
            if "." in Path(path).name:
                raise
            return await super().get_response("index.html", scope)


def mount_spa(app_instance: FastAPI, *, url_prefix: str, static_dir: Path, name: str) -> None:
    app_instance.mount(
        url_prefix,
        SPAStaticFiles(directory=str(static_dir), html=True, check_dir=False),
        name=name,
    )


def read_ui_build_version() -> str:
    try:
        value = BUILD_VERSION_FILE.read_text(encoding="utf-8-sig").strip()
    except FileNotFoundError:
        return "unknown"
    except OSError:
        return "unknown"
    return value or "unknown"


app = FastAPI(title=settings.app_name, version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_middleware(request: Request, call_next):
    request_id = request.headers.get("X-Request-Id") or str(uuid4())
    request.state.request_id = request_id
    request.state.actor = getattr(request.state, "actor", "system")
    request.state.actor_id = getattr(request.state, "actor_id", "system")

    start = time.perf_counter()
    status_code = 500
    try:
        response = await call_next(request)
        status_code = response.status_code
        response.headers["X-Request-Id"] = request_id
        return response
    finally:
        latency_ms = round((time.perf_counter() - start) * 1000, 2)
        logger.info(
            "request_complete",
            extra={
                "request_id": request_id,
                "path": request.url.path,
                "method": request.method,
                "status_code": status_code,
                "latency_ms": latency_ms,
                "actor": getattr(request.state, "actor", "system"),
                "actor_id": getattr(request.state, "actor_id", "system"),
                "employee_id": getattr(request.state, "employee_id", None),
                "event_id": getattr(request.state, "event_id", None),
                "location_status": getattr(request.state, "location_status", None),
                "flags": getattr(request.state, "flags", None),
            },
        )


@app.exception_handler(ApiError)
async def handle_api_error(request: Request, exc: ApiError) -> JSONResponse:
    return error_response(
        request,
        status_code=exc.status_code,
        code=exc.code,
        message=exc.message,
    )


@app.exception_handler(HTTPException)
async def handle_http_exception(request: Request, exc: HTTPException) -> JSONResponse:
    status_code = exc.status_code
    code_map = {
        401: "INVALID_TOKEN",
        403: "FORBIDDEN",
        429: "TOO_MANY_ATTEMPTS",
    }
    code = code_map.get(status_code, "HTTP_ERROR")
    message = str(exc.detail) if exc.detail else "Request failed."
    return error_response(
        request,
        status_code=status_code,
        code=code,
        message=message,
    )


@app.exception_handler(RequestValidationError)
async def handle_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    return error_response(
        request,
        status_code=422,
        code="VALIDATION_ERROR",
        message=str(exc.errors()),
    )


@app.exception_handler(Exception)
async def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
    logger.exception(
        "unhandled_error",
        extra={
            "request_id": getattr(request.state, "request_id", "unknown"),
            "path": request.url.path,
            "method": request.method,
        },
    )
    return error_response(
        request,
        status_code=500,
        code="INTERNAL_ERROR",
        message="Unexpected server error.",
    )


app.include_router(attendance.router)
app.include_router(admin.router)


def _default_schema_guard_result() -> SchemaGuardResult:
    return SchemaGuardResult(
        ok=False,
        checked_at_utc=datetime.now(timezone.utc),
        issues=["SCHEMA_GUARD_NOT_RUN"],
        warnings=[],
    )


async def _notification_worker_loop(stop_event: asyncio.Event) -> None:
    interval_seconds = max(15, int(settings.notification_worker_interval_seconds))
    last_daily_alarm_signature: str | None = None
    while not stop_event.is_set():
        created_jobs_count = 0
        processed_jobs_count = 0
        daily_report_health: dict[str, Any] | None = None
        try:
            now_utc = datetime.now(timezone.utc)
            created_jobs = await asyncio.to_thread(schedule_missed_checkout_notifications, now_utc)
            daily_jobs = await asyncio.to_thread(schedule_daily_admin_report_archive_notifications, now_utc)
            processed_jobs = await asyncio.to_thread(send_pending_notifications, 100, now_utc=now_utc)
            daily_report_health = await asyncio.to_thread(get_daily_report_job_health, now_utc)
            created_jobs_count = len(created_jobs) + len(daily_jobs)
            processed_jobs_count = len(processed_jobs)
        except Exception:
            notification_worker_logger.exception("notification_worker_tick_failed")
        else:
            alarms = (
                daily_report_health.get("alarms", [])
                if isinstance(daily_report_health, dict)
                else []
            )
            alarm_signature = (
                "|".join(str(item) for item in alarms)
                if isinstance(alarms, list) and alarms
                else None
            )
            if alarm_signature is not None and alarm_signature != last_daily_alarm_signature:
                notification_worker_logger.error(
                    "notification_daily_report_alarm",
                    extra=daily_report_health if isinstance(daily_report_health, dict) else {},
                )
                last_daily_alarm_signature = alarm_signature
            elif alarm_signature is None and last_daily_alarm_signature is not None:
                notification_worker_logger.info(
                    "notification_daily_report_alarm_cleared",
                    extra=daily_report_health if isinstance(daily_report_health, dict) else {},
                )
                last_daily_alarm_signature = None

            if created_jobs_count or processed_jobs_count:
                notification_worker_logger.info(
                    "notification_worker_tick",
                    extra={
                        "created_jobs": created_jobs_count,
                        "processed_jobs": processed_jobs_count,
                        "daily_report_health": daily_report_health or {},
                    },
                )

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=interval_seconds)
        except asyncio.TimeoutError:
            continue


@app.on_event("startup")
async def run_schema_guard() -> None:
    result = await asyncio.to_thread(verify_runtime_schema, engine)
    app.state.schema_guard_result = result
    if result.ok:
        notification_worker_logger.info(
            "schema_guard_ok",
            extra=result.to_dict(),
        )
        return

    notification_worker_logger.error(
        "schema_guard_failed",
        extra=result.to_dict(),
    )
    if settings.schema_guard_strict:
        joined_issues = "; ".join(result.issues)
        raise RuntimeError(f"Runtime schema guard failed: {joined_issues}")


@app.on_event("startup")
async def start_notification_worker() -> None:
    if not settings.notification_worker_enabled:
        return
    if getattr(app.state, "notification_worker_task", None) is not None:
        return

    stop_event = asyncio.Event()
    task = asyncio.create_task(_notification_worker_loop(stop_event))
    app.state.notification_worker_stop_event = stop_event
    app.state.notification_worker_task = task
    notification_channel_health = await asyncio.to_thread(get_notification_channel_health)
    email_status = notification_channel_health.get("email", {}) if isinstance(notification_channel_health, dict) else {}
    missing_fields = email_status.get("missing_fields", []) if isinstance(email_status, dict) else []
    if isinstance(missing_fields, list) and missing_fields:
        notification_worker_logger.warning(
            "notification_email_channel_not_configured",
            extra={"missing_fields": missing_fields},
        )
    notification_worker_logger.info(
        "notification_worker_started",
        extra={
            "interval_seconds": max(15, int(settings.notification_worker_interval_seconds)),
            "channel_health": notification_channel_health,
        },
    )


@app.on_event("shutdown")
async def stop_notification_worker() -> None:
    stop_event: asyncio.Event | None = getattr(app.state, "notification_worker_stop_event", None)
    task: asyncio.Task[None] | None = getattr(app.state, "notification_worker_task", None)
    if stop_event is not None:
        stop_event.set()
    if task is not None:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
    app.state.notification_worker_stop_event = None
    app.state.notification_worker_task = None


@app.get("/health")
def health() -> dict[str, Any]:
    schema_guard_result: SchemaGuardResult = getattr(app.state, "schema_guard_result", _default_schema_guard_result())
    notification_channel_health = get_notification_channel_health()
    daily_report_job_health = get_daily_report_job_health()
    return {
        "status": "ok",
        "ui_build_version": read_ui_build_version(),
        "schema_guard": schema_guard_result.to_dict(),
        "notification_channels": notification_channel_health,
        "daily_report_job_health": daily_report_job_health,
    }


mount_spa(app, url_prefix="/admin-panel", static_dir=ADMIN_STATIC_DIR, name="admin-panel")
mount_spa(app, url_prefix="/employee", static_dir=EMPLOYEE_STATIC_DIR, name="employee")
