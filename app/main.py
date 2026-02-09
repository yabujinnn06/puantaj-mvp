import logging
import time
from pathlib import Path
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

setup_json_logging()
logger = logging.getLogger("app.request")
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


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "ui_build_version": read_ui_build_version(),
    }


mount_spa(app, url_prefix="/admin-panel", static_dir=ADMIN_STATIC_DIR, name="admin-panel")
mount_spa(app, url_prefix="/employee", static_dir=EMPLOYEE_STATIC_DIR, name="employee")
