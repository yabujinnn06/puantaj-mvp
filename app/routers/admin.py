import secrets
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.audit import log_audit
from app.db import get_db
from app.errors import ApiError
from app.models import (
    AdminDeviceInvite,
    AdminDailyReportArchive,
    AdminPushSubscription,
    AdminUser,
    AdminRefreshToken,
    AttendanceEvent,
    AttendanceType,
    AuditActorType,
    AuditLog,
    Department,
    DepartmentSchedulePlan,
    DepartmentSchedulePlanEmployee,
    DepartmentShift,
    DepartmentWeeklyRule,
    Device,
    DeviceInvite,
    DevicePushSubscription,
    Employee,
    EmployeeLocation,
    LocationStatus,
    ManualDayOverride,
    NotificationJob,
    QRCode,
    QRCodePoint,
    QRPoint,
    Region,
    WorkRule,
)
from app.schemas import (
    AdminManualNotificationSendRequest,
    AdminManualNotificationSendResponse,
    AdminDeviceInviteCreateRequest,
    AdminDeviceInviteCreateResponse,
    AdminDeviceClaimRequest,
    AdminDeviceClaimResponse,
    AdminAuthResponse,
    AdminLoginRequest,
    AdminLogoutRequest,
    AdminLogoutResponse,
    AdminMeResponse,
    AdminRefreshRequest,
    AdminUserCreateRequest,
    AdminUserRead,
    AdminUserUpdateRequest,
    AdminDevicePushSubscriptionRead,
    AdminPushSubscriptionRead,
    AdminDailyReportArchiveRead,
    AdminDailyReportArchiveNotifyRequest,
    AdminDailyReportArchiveNotifyResponse,
    AdminDailyReportArchivePasswordDownloadRequest,
    AuditLogRead,
    AttendanceEventRead,
    AttendanceEventManualCreateRequest,
    AttendanceEventManualUpdateRequest,
    DepartmentMonthlySummaryItem,
    DepartmentCreate,
    DepartmentRead,
    DepartmentUpdate,
    DeviceInviteCreateRequest,
    DeviceInviteCreateResponse,
    DeviceCreate,
    EmployeeDepartmentUpdateRequest,
    EmployeeProfileUpdateRequest,
    EmployeeRegionUpdateRequest,
    EmployeeDeviceOverviewDevice,
    EmployeeDeviceOverviewRead,
    DeviceActiveUpdateRequest,
    DeviceRead,
    DepartmentShiftRead,
    DepartmentShiftUpsert,
    SchedulePlanRead,
    SchedulePlanUpsertRequest,
    DepartmentWeeklyRuleRead,
    DepartmentWeeklyRuleUpsert,
    EmployeeActiveUpdateRequest,
    EmployeeCreate,
    EmployeeDetailResponse,
    EmployeeDeviceDetailRead,
    EmployeeShiftUpdateRequest,
    EmployeeLocationRead,
    EmployeeLiveLocationRead,
    EmployeeIpSummaryRead,
    EmployeePortalActivityRead,
    EmployeeLocationUpsert,
    EmployeeRead,
    EmployeePushConfigResponse,
    LeaveCreateRequest,
    LeaveRead,
    LaborProfileRead,
    LaborProfileUpsertRequest,
    ManualDayOverrideRead,
    ManualDayOverrideUpsertRequest,
    MonthlyEmployeeResponse,
    NotificationJobRead,
    RegionCreate,
    RegionRead,
    RegionUpdate,
    QRCodeAssignPointsRequest,
    QRCodeCreateRequest,
    QRCodeRead,
    QRCodeUpdateRequest,
    QRPointCreateRequest,
    QRPointRead,
    QRPointUpdateRequest,
    SoftDeleteResponse,
    WorkRuleRead,
    WorkRuleUpsert,
)
from app.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    ensure_login_attempt_allowed,
    hash_password,
    normalize_permissions,
    register_login_failure,
    register_login_success,
    require_admin,
    require_admin_permission,
    should_allow_refresh,
    verify_admin_credentials,
    verify_password,
)
from app.settings import get_employee_portal_base_url, get_public_base_url, get_settings
from app.services.attendance import (
    create_admin_manual_event,
    soft_delete_admin_attendance_event,
    update_admin_manual_event,
)
from app.services.compliance import get_or_create_labor_profile, upsert_labor_profile
from app.services.exports import build_puantaj_range_xlsx_bytes, build_puantaj_xlsx_bytes
from app.services.leaves import create_leave, delete_leave, list_leaves
from app.services.manual_overrides import (
    delete_manual_day_override,
    list_manual_day_overrides,
    upsert_manual_day_override,
)
from app.services.monthly import calculate_department_monthly_summary, calculate_employee_monthly
from app.services.push_notifications import (
    get_push_public_config,
    list_active_admin_push_subscriptions,
    list_active_push_subscriptions,
    send_push_to_admins,
    send_push_to_employees,
    upsert_admin_push_subscription,
)
from app.services.schedule_plans import plan_applies_to_employee

router = APIRouter(tags=["admin"])
settings = get_settings()
XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _parse_hhmm(value: str) -> time:
    try:
        hour_str, minute_str = value.strip().split(":")
        hour = int(hour_str)
        minute = int(minute_str)
        if hour < 0 or hour > 23 or minute < 0 or minute > 59:
            raise ValueError
        return time(hour=hour, minute=minute)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid time format. Use HH:MM.") from exc


def _format_hhmm(value: time) -> str:
    return f"{value.hour:02d}:{value.minute:02d}"


def _client_ip(request: Request) -> str | None:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    if request.client:
        return request.client.host
    return None


def _user_agent(request: Request) -> str | None:
    return request.headers.get("user-agent")


def _resolve_region_id_for_department(
    *,
    db: Session,
    region_id: int | None,
    department: Department | None,
) -> int | None:
    if region_id is not None:
        region = db.get(Region, region_id)
        if region is None:
            raise HTTPException(status_code=404, detail="Region not found")
        return region.id
    if department is not None:
        return department.region_id
    return None


def _to_department_read(department: Department) -> DepartmentRead:
    return DepartmentRead(
        id=department.id,
        name=department.name,
        region_id=department.region_id,
        region_name=department.region.name if department.region else None,
    )


def _to_employee_read(employee: Employee) -> EmployeeRead:
    return EmployeeRead(
        id=employee.id,
        full_name=employee.full_name,
        region_id=employee.region_id,
        region_name=employee.region.name if employee.region else None,
        department_id=employee.department_id,
        shift_id=employee.shift_id,
        is_active=employee.is_active,
        contract_weekly_minutes=employee.contract_weekly_minutes,
    )


def _to_admin_user_read(admin_user: AdminUser) -> AdminUserRead:
    return AdminUserRead(
        id=admin_user.id,
        username=admin_user.username,
        full_name=admin_user.full_name,
        is_active=admin_user.is_active,
        is_super_admin=admin_user.is_super_admin,
        permissions=normalize_permissions(admin_user.permissions),
        created_at=admin_user.created_at,
        updated_at=admin_user.updated_at,
    )


def _to_admin_push_subscription_read(row: DevicePushSubscription) -> AdminPushSubscriptionRead:
    employee_id = row.device.employee_id if row.device is not None else 0
    return AdminPushSubscriptionRead(
        id=row.id,
        device_id=row.device_id,
        employee_id=employee_id,
        endpoint=row.endpoint,
        is_active=row.is_active,
        user_agent=row.user_agent,
        last_error=row.last_error,
        created_at=row.created_at,
        updated_at=row.updated_at,
        last_seen_at=row.last_seen_at,
    )


def _to_admin_device_push_subscription_read(
    row: AdminPushSubscription,
) -> AdminDevicePushSubscriptionRead:
    return AdminDevicePushSubscriptionRead(
        id=row.id,
        admin_user_id=row.admin_user_id,
        admin_username=row.admin_username,
        endpoint=row.endpoint,
        is_active=row.is_active,
        user_agent=row.user_agent,
        last_error=row.last_error,
        created_at=row.created_at,
        updated_at=row.updated_at,
        last_seen_at=row.last_seen_at,
    )


def _permissions_payload(claims: dict[str, Any]) -> dict[str, dict[str, bool]]:
    if str(claims.get("username") or claims.get("sub") or "") == settings.admin_user:
        return _full_permissions()
    if claims.get("permissions") is None and claims.get("role") == "admin":
        return _full_permissions()
    return normalize_permissions(claims.get("permissions"))  # type: ignore[arg-type]


def _is_super_admin(claims: dict[str, Any]) -> bool:
    if str(claims.get("username") or claims.get("sub") or "") == settings.admin_user:
        return True
    return bool(claims.get("is_super_admin"))


def _assert_super_admin(claims: dict[str, Any]) -> None:
    if not _is_super_admin(claims):
        raise ApiError(
            status_code=403,
            code="FORBIDDEN",
            message="Super admin permission is required.",
        )


def _verify_current_admin_password(
    db: Session,
    *,
    claims: dict[str, Any],
    password: str,
) -> None:
    username = str(claims.get("username") or claims.get("sub") or "").strip()
    if not password.strip():
        raise ApiError(
            status_code=422,
            code="VALIDATION_ERROR",
            message="Password confirmation is required.",
        )

    if username and verify_admin_credentials(username, password):
        return

    admin_user: AdminUser | None = None
    admin_user_id = claims.get("admin_user_id")
    if isinstance(admin_user_id, int):
        admin_user = db.get(AdminUser, admin_user_id)
    if admin_user is None and username:
        admin_user = db.scalar(select(AdminUser).where(AdminUser.username == username))

    if admin_user is None or not admin_user.is_active or not verify_password(password, admin_user.password_hash):
        raise ApiError(
            status_code=401,
            code="INVALID_CREDENTIALS",
            message="Password confirmation failed.",
        )


def _full_permissions() -> dict[str, dict[str, bool]]:
    return {
        key: {"read": True, "write": True}
        for key in (
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
    }


def _build_env_admin_identity(username: str) -> dict[str, Any]:
    normalized_username = username.strip() or "admin"
    return {
        "sub": normalized_username,
        "username": normalized_username,
        "full_name": normalized_username,
        "role": "admin",
        "admin_user_id": None,
        "is_super_admin": True,
        "permissions": _full_permissions(),
    }


def _build_admin_user_identity(admin_user: AdminUser) -> dict[str, Any]:
    is_reserved_admin = admin_user.username == settings.admin_user
    return {
        "sub": admin_user.username,
        "username": admin_user.username,
        "full_name": admin_user.full_name,
        "role": "admin",
        "admin_user_id": admin_user.id,
        "is_super_admin": True if is_reserved_admin else bool(admin_user.is_super_admin),
        "permissions": _full_permissions()
        if is_reserved_admin
        else normalize_permissions(admin_user.permissions),
    }


def _persist_refresh_token(
    db: Session,
    *,
    claims: dict[str, Any],
    ip: str | None,
    user_agent: str | None,
) -> AdminRefreshToken:
    token_row = AdminRefreshToken(
        jti=str(claims["jti"]),
        admin_user_id=claims.get("admin_user_id"),
        subject=str(claims.get("sub") or "admin"),
        issued_at=datetime.fromtimestamp(int(claims["iat"]), tz=timezone.utc),
        expires_at=datetime.fromtimestamp(int(claims["exp"]), tz=timezone.utc),
        revoked_at=None,
        last_ip=ip,
        last_user_agent=user_agent,
    )
    db.add(token_row)
    return token_row


@router.post("/api/admin/auth/login", response_model=AdminAuthResponse)
def admin_login(
    payload: AdminLoginRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> AdminAuthResponse:
    username = payload.username.strip()
    ip = _client_ip(request)
    user_agent = _user_agent(request)
    request_id = getattr(request.state, "request_id", None)
    request.state.actor = "system"
    request.state.actor_id = "system"

    if ip:
        try:
            ensure_login_attempt_allowed(ip)
        except ApiError:
            log_audit(
                db,
                actor_type=AuditActorType.SYSTEM,
                actor_id="admin",
                action="ADMIN_LOGIN_FAIL",
                success=False,
                ip=ip,
                user_agent=user_agent,
                details={"reason": "TOO_MANY_ATTEMPTS"},
                request_id=request_id,
            )
            raise

    identity: dict[str, Any] | None = None

    if verify_admin_credentials(username, payload.password):
        identity = _build_env_admin_identity(username)
    else:
        admin_user = db.scalar(select(AdminUser).where(AdminUser.username == username))
        if admin_user is not None and admin_user.is_active and verify_password(payload.password, admin_user.password_hash):
            identity = _build_admin_user_identity(admin_user)

    if identity is None:
        if ip:
            register_login_failure(ip)
        log_audit(
            db,
                actor_type=AuditActorType.SYSTEM,
                actor_id=username,
            action="ADMIN_LOGIN_FAIL",
            success=False,
            ip=ip,
            user_agent=user_agent,
            details={"reason": "INVALID_CREDENTIALS"},
            request_id=request_id,
        )
        raise ApiError(
            status_code=401,
            code="INVALID_CREDENTIALS",
            message="Invalid credentials.",
        )

    if ip:
        register_login_success(ip)

    access_token, expires_in, access_claims = create_access_token(
        sub=str(identity["sub"]),
        username=str(identity["username"]),
        full_name=identity.get("full_name"),
        role=str(identity["role"]),
        admin_user_id=identity.get("admin_user_id"),
        is_super_admin=bool(identity.get("is_super_admin")),
        permissions=identity.get("permissions"),
    )
    refresh_token: str | None = None
    refresh_claims: dict[str, Any] | None = None

    if should_allow_refresh():
        refresh_token, refresh_claims = create_refresh_token(
            sub=str(identity["sub"]),
            username=str(identity["username"]),
            full_name=identity.get("full_name"),
            role=str(identity["role"]),
            admin_user_id=identity.get("admin_user_id"),
            is_super_admin=bool(identity.get("is_super_admin")),
            permissions=identity.get("permissions"),
        )
        _persist_refresh_token(
            db,
            claims=refresh_claims,
            ip=ip,
            user_agent=user_agent,
        )

    db.commit()
    request.state.actor = "admin"
    request.state.actor_id = str(identity["username"])

    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=str(identity["username"]),
        action="ADMIN_LOGIN_SUCCESS",
        success=True,
        ip=ip,
        user_agent=user_agent,
        details={
            "access_jti": access_claims["jti"],
            "refresh_jti": refresh_claims["jti"] if refresh_claims else None,
        },
        request_id=request_id,
    )

    return AdminAuthResponse(
        access_token=access_token,
        expires_in=expires_in,
        refresh_token=refresh_token,
    )


@router.post("/api/admin/auth/refresh", response_model=AdminAuthResponse)
def admin_refresh(
    payload: AdminRefreshRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> AdminAuthResponse:
    if not should_allow_refresh():
        raise ApiError(status_code=403, code="FORBIDDEN", message="Refresh token is disabled.")

    ip = _client_ip(request)
    user_agent = _user_agent(request)
    request_id = getattr(request.state, "request_id", None)
    claims = decode_token(payload.refresh_token, expected_type="refresh")
    jti = str(claims.get("jti"))
    now_utc = datetime.now(timezone.utc)

    token_row = db.scalar(select(AdminRefreshToken).where(AdminRefreshToken.jti == jti))
    if token_row is None or token_row.revoked_at is not None or token_row.expires_at <= now_utc:
        raise ApiError(status_code=401, code="INVALID_TOKEN", message="Refresh token is invalid.")
    if token_row.subject != str(claims.get("sub")):
        raise ApiError(status_code=401, code="INVALID_TOKEN", message="Refresh token is invalid.")

    token_row.revoked_at = now_utc
    token_row.last_ip = ip
    token_row.last_user_agent = user_agent

    if token_row.admin_user_id is not None:
        admin_user = db.get(AdminUser, token_row.admin_user_id)
        if admin_user is None or not admin_user.is_active:
            raise ApiError(status_code=401, code="INVALID_TOKEN", message="Refresh token is invalid.")
        identity = _build_admin_user_identity(admin_user)
    else:
        identity = _build_env_admin_identity(str(claims.get("sub") or settings.admin_user))

    access_token, expires_in, access_claims = create_access_token(
        sub=str(identity["sub"]),
        username=str(identity["username"]),
        full_name=identity.get("full_name"),
        role=str(identity["role"]),
        admin_user_id=identity.get("admin_user_id"),
        is_super_admin=bool(identity.get("is_super_admin")),
        permissions=identity.get("permissions"),
    )
    new_refresh_token, new_refresh_claims = create_refresh_token(
        sub=str(identity["sub"]),
        username=str(identity["username"]),
        full_name=identity.get("full_name"),
        role=str(identity["role"]),
        admin_user_id=identity.get("admin_user_id"),
        is_super_admin=bool(identity.get("is_super_admin")),
        permissions=identity.get("permissions"),
    )
    _persist_refresh_token(
        db,
        claims=new_refresh_claims,
        ip=ip,
        user_agent=user_agent,
    )
    db.commit()

    request.state.actor = "admin"
    request.state.actor_id = str(identity["username"])
    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=str(identity["username"]),
        action="ADMIN_REFRESH",
        success=True,
        ip=ip,
        user_agent=user_agent,
        details={
            "old_refresh_jti": jti,
            "new_refresh_jti": new_refresh_claims["jti"],
            "access_jti": access_claims["jti"],
        },
        request_id=request_id,
    )

    return AdminAuthResponse(
        access_token=access_token,
        expires_in=expires_in,
        refresh_token=new_refresh_token,
    )


@router.post(
    "/api/admin/auth/logout",
    response_model=AdminLogoutResponse,
)
def admin_logout(
    payload: AdminLogoutRequest,
    request: Request,
    auth_claims: dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AdminLogoutResponse:
    if not should_allow_refresh():
        raise ApiError(status_code=403, code="FORBIDDEN", message="Refresh token is disabled.")

    refresh_claims = decode_token(payload.refresh_token, expected_type="refresh")
    jti = str(refresh_claims.get("jti"))
    token_row = db.scalar(select(AdminRefreshToken).where(AdminRefreshToken.jti == jti))
    if token_row is None or token_row.subject != str(refresh_claims.get("sub")):
        raise ApiError(status_code=401, code="INVALID_TOKEN", message="Refresh token is invalid.")

    token_row.revoked_at = datetime.now(timezone.utc)
    token_row.last_ip = _client_ip(request)
    token_row.last_user_agent = _user_agent(request)
    db.commit()

    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=str(auth_claims.get("username") or auth_claims.get("sub") or "admin"),
        action="ADMIN_LOGOUT",
        success=True,
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={"refresh_jti": jti},
        request_id=getattr(request.state, "request_id", None),
    )
    return AdminLogoutResponse(ok=True)


@router.get(
    "/api/admin/auth/me",
    response_model=AdminMeResponse,
)
def admin_me(
    claims: dict[str, Any] = Depends(require_admin),
) -> AdminMeResponse:
    return AdminMeResponse(
        sub=str(claims["sub"]),
        username=str(claims.get("username") or claims["sub"]),
        full_name=claims.get("full_name"),
        role=str(claims["role"]),
        is_super_admin=_is_super_admin(claims),
        permissions=_permissions_payload(claims),
        iat=int(claims["iat"]),
        exp=int(claims["exp"]),
    )


@router.get(
    "/api/admin/admin-users",
    response_model=list[AdminUserRead],
    dependencies=[Depends(require_admin_permission("admin_users"))],
)
def list_admin_users(db: Session = Depends(get_db)) -> list[AdminUserRead]:
    rows = list(db.scalars(select(AdminUser).order_by(AdminUser.id)).all())
    return [_to_admin_user_read(item) for item in rows]


@router.post(
    "/api/admin/admin-users",
    response_model=AdminUserRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin_permission("admin_users", write=True))],
)
def create_admin_user(
    payload: AdminUserCreateRequest,
    request: Request,
    claims: dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AdminUserRead:
    _assert_super_admin(claims)
    username = payload.username.strip()
    if not username:
        raise HTTPException(status_code=422, detail="Username cannot be empty")
    if username == settings.admin_user:
        raise HTTPException(status_code=409, detail="Reserved admin username cannot be managed from this endpoint")

    existing = db.scalar(select(AdminUser).where(AdminUser.username == username))
    if existing is not None:
        raise HTTPException(status_code=409, detail="Admin username already exists")

    normalized_permissions = normalize_permissions(
        {key: value.model_dump() for key, value in payload.permissions.items()}
    )
    if payload.is_super_admin:
        normalized_permissions = _full_permissions()

    admin_user = AdminUser(
        username=username,
        password_hash=hash_password(payload.password),
        full_name=payload.full_name.strip() if payload.full_name else None,
        is_active=payload.is_active,
        is_super_admin=payload.is_super_admin,
        permissions=normalized_permissions,
    )
    db.add(admin_user)
    db.commit()
    db.refresh(admin_user)

    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=str(claims.get("username") or claims.get("sub") or "admin"),
        action="ADMIN_USER_CREATED",
        success=True,
        entity_type="admin_user",
        entity_id=str(admin_user.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "username": admin_user.username,
            "is_active": admin_user.is_active,
            "is_super_admin": admin_user.is_super_admin,
            "permissions": admin_user.permissions,
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return _to_admin_user_read(admin_user)


@router.patch(
    "/api/admin/admin-users/{admin_user_id}",
    response_model=AdminUserRead,
    dependencies=[Depends(require_admin_permission("admin_users", write=True))],
)
def update_admin_user(
    admin_user_id: int,
    payload: AdminUserUpdateRequest,
    request: Request,
    claims: dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AdminUserRead:
    _assert_super_admin(claims)
    admin_user = db.get(AdminUser, admin_user_id)
    if admin_user is None:
        raise HTTPException(status_code=404, detail="Admin user not found")

    is_reserved_admin = admin_user.username == settings.admin_user

    if payload.username is not None:
        next_username = payload.username.strip()
        if not next_username:
            raise HTTPException(status_code=422, detail="Username cannot be empty")
        if is_reserved_admin and next_username != admin_user.username:
            raise HTTPException(
                status_code=409,
                detail="Reserved admin username cannot be changed",
            )
        if next_username == settings.admin_user and admin_user.username != settings.admin_user:
            raise HTTPException(
                status_code=409,
                detail="Reserved admin username cannot be assigned",
            )
        duplicate = db.scalar(
            select(AdminUser).where(
                and_(
                    AdminUser.username == next_username,
                    AdminUser.id != admin_user.id,
                )
            )
        )
        if duplicate is not None:
            raise HTTPException(status_code=409, detail="Admin username already exists")
        admin_user.username = next_username

    if is_reserved_admin and payload.is_active is False:
        raise HTTPException(status_code=409, detail="Reserved admin cannot be deactivated")
    if is_reserved_admin and payload.is_super_admin is False:
        raise HTTPException(status_code=409, detail="Reserved admin must stay super admin")

    if payload.full_name is not None:
        admin_user.full_name = payload.full_name.strip() or None
    if payload.password:
        admin_user.password_hash = hash_password(payload.password)
    if payload.is_active is not None:
        admin_user.is_active = payload.is_active
    if payload.is_super_admin is not None:
        admin_user.is_super_admin = payload.is_super_admin
    if payload.permissions is not None:
        admin_user.permissions = normalize_permissions(
            {key: value.model_dump() for key, value in payload.permissions.items()}
        )
    if admin_user.username == settings.admin_user:
        admin_user.is_active = True
        admin_user.is_super_admin = True
        admin_user.permissions = _full_permissions()
    elif admin_user.is_super_admin:
        admin_user.permissions = _full_permissions()

    db.commit()
    db.refresh(admin_user)

    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=str(claims.get("username") or claims.get("sub") or "admin"),
        action="ADMIN_USER_UPDATED",
        success=True,
        entity_type="admin_user",
        entity_id=str(admin_user.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "username": admin_user.username,
            "is_active": admin_user.is_active,
            "is_super_admin": admin_user.is_super_admin,
            "permissions": admin_user.permissions,
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return _to_admin_user_read(admin_user)


@router.delete(
    "/api/admin/admin-users/{admin_user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_admin_permission("admin_users", write=True))],
)
def delete_admin_user(
    admin_user_id: int,
    request: Request,
    claims: dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db),
) -> None:
    _assert_super_admin(claims)
    admin_user = db.get(AdminUser, admin_user_id)
    if admin_user is None:
        raise HTTPException(status_code=404, detail="Admin user not found")
    if admin_user.username == settings.admin_user:
        raise HTTPException(status_code=409, detail="Reserved admin cannot be deleted")
    if claims.get("admin_user_id") == admin_user_id:
        raise HTTPException(status_code=409, detail="You cannot delete your own account")

    deleted_username = admin_user.username
    db.delete(admin_user)
    db.commit()

    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=str(claims.get("username") or claims.get("sub") or "admin"),
        action="ADMIN_USER_DELETED",
        success=True,
        entity_type="admin_user",
        entity_id=str(admin_user_id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={"username": deleted_username},
        request_id=getattr(request.state, "request_id", None),
    )


@router.post(
    "/api/admin/regions",
    response_model=RegionRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin_permission("regions", write=True))],
)
def create_region(
    payload: RegionCreate,
    request: Request,
    db: Session = Depends(get_db),
) -> RegionRead:
    region = Region(name=payload.name.strip(), is_active=payload.is_active)
    db.add(region)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Region name already exists")
    db.refresh(region)
    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=str(getattr(request.state, "actor_id", "admin")),
        action="REGION_CREATED",
        success=True,
        entity_type="region",
        entity_id=str(region.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={"name": region.name, "is_active": region.is_active},
        request_id=getattr(request.state, "request_id", None),
    )
    return region


@router.get(
    "/api/admin/regions",
    response_model=list[RegionRead],
    dependencies=[Depends(require_admin_permission("regions"))],
)
def list_regions(
    include_inactive: bool = Query(default=True),
    db: Session = Depends(get_db),
) -> list[RegionRead]:
    stmt = select(Region).order_by(Region.id.asc())
    if not include_inactive:
        stmt = stmt.where(Region.is_active.is_(True))
    return list(db.scalars(stmt).all())


@router.patch(
    "/api/admin/regions/{region_id}",
    response_model=RegionRead,
    dependencies=[Depends(require_admin_permission("regions", write=True))],
)
def update_region(
    region_id: int,
    payload: RegionUpdate,
    request: Request,
    db: Session = Depends(get_db),
) -> RegionRead:
    region = db.get(Region, region_id)
    if region is None:
        raise HTTPException(status_code=404, detail="Region not found")
    region.name = payload.name.strip()
    region.is_active = payload.is_active
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Region name already exists")
    db.refresh(region)
    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=str(getattr(request.state, "actor_id", "admin")),
        action="REGION_UPDATED",
        success=True,
        entity_type="region",
        entity_id=str(region.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={"name": region.name, "is_active": region.is_active},
        request_id=getattr(request.state, "request_id", None),
    )
    return region


@router.post(
    "/admin/departments",
    response_model=DepartmentRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin_permission("departments", write=True))],
)
def create_department(payload: DepartmentCreate, db: Session = Depends(get_db)) -> DepartmentRead:
    region_id = _resolve_region_id_for_department(db=db, region_id=payload.region_id, department=None)
    department = Department(name=payload.name, region_id=region_id)
    db.add(department)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Department name already exists")
    db.refresh(department)
    department_with_region = db.scalar(
        select(Department).options(selectinload(Department.region)).where(Department.id == department.id)
    )
    if department_with_region is None:
        raise HTTPException(status_code=404, detail="Department not found")
    return _to_department_read(department_with_region)


@router.get(
    "/admin/departments",
    response_model=list[DepartmentRead],
    dependencies=[Depends(require_admin_permission("departments"))],
)
def list_departments(
    region_id: int | None = Query(default=None, ge=1),
    db: Session = Depends(get_db),
) -> list[DepartmentRead]:
    stmt = select(Department).options(selectinload(Department.region)).order_by(Department.id)
    if region_id is not None:
        stmt = stmt.where(Department.region_id == region_id)
    return [_to_department_read(item) for item in db.scalars(stmt).all()]


@router.patch(
    "/admin/departments/{department_id}",
    response_model=DepartmentRead,
    dependencies=[Depends(require_admin_permission("departments", write=True))],
)
def update_department(
    department_id: int,
    payload: DepartmentUpdate,
    request: Request,
    db: Session = Depends(get_db),
) -> DepartmentRead:
    department = db.get(Department, department_id)
    if department is None:
        raise HTTPException(status_code=404, detail="Department not found")

    department.name = payload.name
    if "region_id" in payload.model_fields_set:
        if payload.region_id is None:
            department.region_id = None
        else:
            region = db.get(Region, payload.region_id)
            if region is None:
                raise HTTPException(status_code=404, detail="Region not found")
            department.region_id = region.id
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Department name already exists")
    db.refresh(department)

    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=str(getattr(request.state, "actor_id", "admin")),
        action="DEPARTMENT_UPDATED",
        success=True,
        entity_type="department",
        entity_id=str(department.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={"name": department.name},
        request_id=getattr(request.state, "request_id", None),
    )
    department_with_region = db.scalar(
        select(Department).options(selectinload(Department.region)).where(Department.id == department.id)
    )
    if department_with_region is None:
        raise HTTPException(status_code=404, detail="Department not found")
    return _to_department_read(department_with_region)


@router.post(
    "/admin/employees",
    response_model=EmployeeRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin_permission("employees", write=True))],
)
def create_employee(payload: EmployeeCreate, db: Session = Depends(get_db)) -> EmployeeRead:
    department = None
    if payload.department_id is not None:
        department = db.get(Department, payload.department_id)
        if department is None:
            raise HTTPException(status_code=404, detail="Department not found")

    resolved_region_id = _resolve_region_id_for_department(
        db=db,
        region_id=payload.region_id,
        department=department,
    )
    if (
        payload.region_id is not None
        and department is not None
        and department.region_id is not None
        and payload.region_id != department.region_id
    ):
        raise HTTPException(status_code=422, detail="Department region and employee region mismatch")

    if payload.shift_id is not None:
        shift = db.get(DepartmentShift, payload.shift_id)
        if shift is None:
            raise HTTPException(status_code=404, detail="Department shift not found")
        if payload.department_id is None:
            raise HTTPException(status_code=422, detail="Shift assignment requires department_id")
        if shift.department_id != payload.department_id:
            raise HTTPException(status_code=422, detail="Shift does not belong to selected department")

    employee = Employee(
        full_name=payload.full_name,
        region_id=resolved_region_id,
        department_id=payload.department_id,
        shift_id=payload.shift_id,
        is_active=payload.is_active,
        contract_weekly_minutes=payload.contract_weekly_minutes,
    )
    db.add(employee)
    db.commit()
    db.refresh(employee)
    employee_with_region = db.scalar(
        select(Employee).options(selectinload(Employee.region)).where(Employee.id == employee.id)
    )
    if employee_with_region is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    return _to_employee_read(employee_with_region)


@router.get(
    "/admin/employees",
    response_model=list[EmployeeRead],
    dependencies=[Depends(require_admin_permission("employees"))],
)
def list_employees(
    include_inactive: bool = Query(default=False),
    status_filter: Literal["active", "inactive", "all"] | None = Query(default=None, alias="status"),
    department_id: int | None = Query(default=None, ge=1),
    region_id: int | None = Query(default=None, ge=1),
    db: Session = Depends(get_db),
) -> list[EmployeeRead]:
    stmt = select(Employee).options(selectinload(Employee.region)).order_by(Employee.id)

    # Backward compatibility:
    # - keep `status` behavior for old clients when provided
    # - default behavior stays active-only unless include_inactive=true
    if status_filter is not None:
        if status_filter == "active":
            stmt = stmt.where(Employee.is_active.is_(True))
        elif status_filter == "inactive":
            stmt = stmt.where(Employee.is_active.is_(False))
    elif not include_inactive:
        stmt = stmt.where(Employee.is_active.is_(True))

    if department_id is not None:
        stmt = stmt.where(Employee.department_id == department_id)
    if region_id is not None:
        stmt = stmt.join(Department, Department.id == Employee.department_id, isouter=True).where(
            or_(
                Employee.region_id == region_id,
                and_(Employee.region_id.is_(None), Department.region_id == region_id),
            )
        )

    return [_to_employee_read(item) for item in db.scalars(stmt).all()]


@router.get(
    "/api/admin/employees/{employee_id}/detail",
    response_model=EmployeeDetailResponse,
    dependencies=[Depends(require_admin_permission("employees"))],
)
def get_employee_detail(
    employee_id: int,
    db: Session = Depends(get_db),
) -> EmployeeDetailResponse:
    employee = db.scalar(
        select(Employee)
        .options(
            selectinload(Employee.region),
            selectinload(Employee.department),
            selectinload(Employee.devices),
        )
        .where(Employee.id == employee_id)
    )
    if employee is None:
        raise HTTPException(status_code=404, detail="Employee not found")

    activity_logs = list(
        db.scalars(
            select(AuditLog)
            .where(
                AuditLog.actor_type == AuditActorType.SYSTEM,
                AuditLog.actor_id == str(employee_id),
            )
            .order_by(AuditLog.ts_utc.desc(), AuditLog.id.desc())
            .limit(100)
        ).all()
    )
    last_portal_seen_utc = activity_logs[0].ts_utc if activity_logs else None

    attendance_event_ids: set[int] = set()
    for log_item in activity_logs:
        if log_item.entity_type != "attendance_event":
            continue
        if log_item.entity_id is None:
            continue
        raw_entity_id = str(log_item.entity_id).strip()
        if raw_entity_id.isdigit():
            attendance_event_ids.add(int(raw_entity_id))

    attendance_events_by_id: dict[int, AttendanceEvent] = {}
    if attendance_event_ids:
        attendance_events_by_id = {
            event_item.id: event_item
            for event_item in db.scalars(
                select(AttendanceEvent).where(AttendanceEvent.id.in_(attendance_event_ids))
            ).all()
        }

    ip_summary_rows: list[EmployeeIpSummaryRead] = []
    ip_index: dict[str, int] = {}
    for log_item in activity_logs:
        raw_ip = (log_item.ip or "").strip()
        if not raw_ip:
            continue

        if raw_ip not in ip_index:
            ip_index[raw_ip] = len(ip_summary_rows)
            ip_summary_rows.append(
                EmployeeIpSummaryRead(
                    ip=raw_ip,
                    last_seen_at_utc=log_item.ts_utc,
                    last_action=log_item.action,
                )
            )

        summary = ip_summary_rows[ip_index[raw_ip]]
        if summary.last_location_ts_utc is not None:
            continue

        if log_item.entity_type != "attendance_event" or log_item.entity_id is None:
            continue

        raw_entity_id = str(log_item.entity_id).strip()
        if not raw_entity_id.isdigit():
            continue
        event_item = attendance_events_by_id.get(int(raw_entity_id))
        if event_item is None or event_item.lat is None or event_item.lon is None:
            continue

        summary.last_lat = event_item.lat
        summary.last_lon = event_item.lon
        summary.last_accuracy_m = event_item.accuracy_m
        summary.last_location_status = event_item.location_status
        summary.last_location_ts_utc = event_item.ts_utc

    ip_summary_rows = ip_summary_rows[:20]
    recent_ips = [item.ip for item in ip_summary_rows]

    recent_activity = [
        EmployeePortalActivityRead(
            ts_utc=log_item.ts_utc,
            action=log_item.action,
            ip=log_item.ip,
            user_agent=log_item.user_agent,
        )
        for log_item in activity_logs[:20]
    ]

    latest_location_event = db.scalar(
        select(AttendanceEvent)
        .where(
            AttendanceEvent.employee_id == employee_id,
            AttendanceEvent.deleted_at.is_(None),
            AttendanceEvent.lat.is_not(None),
            AttendanceEvent.lon.is_not(None),
        )
        .order_by(AttendanceEvent.ts_utc.desc(), AttendanceEvent.id.desc())
        .limit(1)
    )

    latest_location = (
        EmployeeLiveLocationRead(
            lat=latest_location_event.lat if latest_location_event.lat is not None else 0.0,
            lon=latest_location_event.lon if latest_location_event.lon is not None else 0.0,
            accuracy_m=latest_location_event.accuracy_m,
            ts_utc=latest_location_event.ts_utc,
            location_status=latest_location_event.location_status,
            event_type=latest_location_event.type,
            device_id=latest_location_event.device_id,
        )
        if latest_location_event is not None
        and latest_location_event.lat is not None
        and latest_location_event.lon is not None
        else None
    )

    latest_ip_log = db.scalar(
        select(AuditLog)
        .where(
            AuditLog.actor_type == AuditActorType.SYSTEM,
            AuditLog.actor_id == str(employee_id),
            AuditLog.ip.is_not(None),
        )
        .order_by(AuditLog.ts_utc.desc(), AuditLog.id.desc())
        .limit(1)
    )

    devices: list[EmployeeDeviceDetailRead] = []
    sorted_devices = sorted(
        list(employee.devices or []),
        key=lambda item: (item.created_at, item.id),
        reverse=True,
    )
    for device in sorted_devices:
        last_event = db.scalar(
            select(AttendanceEvent)
            .where(
                AttendanceEvent.device_id == device.id,
                AttendanceEvent.deleted_at.is_(None),
            )
            .order_by(AttendanceEvent.ts_utc.desc(), AttendanceEvent.id.desc())
            .limit(1)
        )

        event_log: AuditLog | None = None
        if last_event is not None:
            event_log = db.scalar(
                select(AuditLog)
                .where(
                    AuditLog.entity_type == "attendance_event",
                    AuditLog.entity_id == str(last_event.id),
                    AuditLog.action == "ATTENDANCE_EVENT_CREATED",
                    AuditLog.ip.is_not(None),
                )
                .order_by(AuditLog.ts_utc.desc(), AuditLog.id.desc())
                .limit(1)
            )

        devices.append(
            EmployeeDeviceDetailRead(
                id=device.id,
                device_fingerprint=device.device_fingerprint,
                is_active=device.is_active,
                created_at=device.created_at,
                last_attendance_ts_utc=last_event.ts_utc if last_event is not None else None,
                last_seen_ip=(event_log.ip if event_log and event_log.ip else (latest_ip_log.ip if latest_ip_log else None)),
                last_seen_action=(event_log.action if event_log else (latest_ip_log.action if latest_ip_log else None)),
                last_seen_at_utc=(event_log.ts_utc if event_log else (latest_ip_log.ts_utc if latest_ip_log else None)),
            )
        )

    home_location = db.scalar(
        select(EmployeeLocation).where(EmployeeLocation.employee_id == employee_id)
    )

    return EmployeeDetailResponse(
        employee=_to_employee_read(employee),
        last_portal_seen_utc=last_portal_seen_utc,
        recent_ips=recent_ips,
        ip_summary=ip_summary_rows,
        devices=devices,
        latest_location=latest_location,
        home_location=home_location,
        recent_activity=recent_activity,
    )


@router.patch(
    "/api/admin/employees/{employee_id}",
    response_model=EmployeeRead,
    dependencies=[Depends(require_admin_permission("employees", write=True))],
)
def update_employee_profile(
    employee_id: int,
    payload: EmployeeProfileUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> EmployeeRead:
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(status_code=404, detail="Employee not found")

    changed_fields: dict[str, Any] = {}

    if "full_name" in payload.model_fields_set:
        normalized_full_name = (payload.full_name or "").strip()
        if not normalized_full_name:
            raise HTTPException(status_code=422, detail="full_name cannot be empty")
        employee.full_name = normalized_full_name
        changed_fields["full_name"] = employee.full_name

    if "department_id" in payload.model_fields_set:
        if payload.department_id is not None:
            department = db.get(Department, payload.department_id)
            if department is None:
                raise HTTPException(status_code=404, detail="Department not found")

        employee.department_id = payload.department_id

        if employee.shift_id is not None:
            shift = db.get(DepartmentShift, employee.shift_id)
            if (
                shift is None
                or employee.department_id is None
                or shift.department_id != employee.department_id
            ):
                employee.shift_id = None

        if employee.department_id is None:
            employee.region_id = None
        else:
            department = db.get(Department, employee.department_id)
            if department is None:
                raise HTTPException(status_code=404, detail="Department not found")
            employee.region_id = department.region_id

        changed_fields["department_id"] = employee.department_id
        changed_fields["region_id"] = employee.region_id
        changed_fields["shift_id"] = employee.shift_id

    if not changed_fields:
        raise HTTPException(status_code=422, detail="No fields provided for update")

    db.commit()
    db.refresh(employee)

    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id="admin",
        action="EMPLOYEE_PROFILE_UPDATED",
        success=True,
        entity_type="employee",
        entity_id=str(employee.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details=changed_fields,
        request_id=getattr(request.state, "request_id", None),
    )
    return _to_employee_read(employee)


@router.patch(
    "/api/admin/employees/{employee_id}/active",
    response_model=EmployeeRead,
    dependencies=[Depends(require_admin_permission("employees", write=True))],
)
def update_employee_active_status(
    employee_id: int,
    payload: EmployeeActiveUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> EmployeeRead:
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(status_code=404, detail="Employee not found")

    employee.is_active = payload.is_active
    db.commit()
    db.refresh(employee)

    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id="admin",
        action="EMPLOYEE_REACTIVATED" if payload.is_active else "EMPLOYEE_DEACTIVATED",
        success=True,
        entity_type="employee",
        entity_id=str(employee.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={"is_active": payload.is_active},
        request_id=getattr(request.state, "request_id", None),
    )
    return _to_employee_read(employee)


@router.patch(
    "/api/admin/employees/{employee_id}/shift",
    response_model=EmployeeRead,
    dependencies=[Depends(require_admin_permission("employees", write=True))],
)
def update_employee_shift(
    employee_id: int,
    payload: EmployeeShiftUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> EmployeeRead:
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(status_code=404, detail="Employee not found")

    if payload.shift_id is None:
        employee.shift_id = None
    else:
        shift = db.get(DepartmentShift, payload.shift_id)
        if shift is None:
            raise HTTPException(status_code=404, detail="Department shift not found")
        if employee.department_id is None:
            raise HTTPException(status_code=422, detail="Employee has no department for shift assignment")
        if shift.department_id != employee.department_id:
            raise HTTPException(status_code=422, detail="Shift does not belong to employee department")
        employee.shift_id = shift.id

    db.commit()
    db.refresh(employee)

    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id="admin",
        action="EMPLOYEE_SHIFT_UPDATED",
        success=True,
        entity_type="employee",
        entity_id=str(employee.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={"shift_id": employee.shift_id},
        request_id=getattr(request.state, "request_id", None),
    )
    return _to_employee_read(employee)


@router.patch(
    "/api/admin/employees/{employee_id}/department",
    response_model=EmployeeRead,
    dependencies=[Depends(require_admin_permission("employees", write=True))],
)
def update_employee_department(
    employee_id: int,
    payload: EmployeeDepartmentUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> EmployeeRead:
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(status_code=404, detail="Employee not found")

    if payload.department_id is not None:
        department = db.get(Department, payload.department_id)
        if department is None:
            raise HTTPException(status_code=404, detail="Department not found")

    employee.department_id = payload.department_id

    # If current shift no longer belongs to selected department, clear shift assignment.
    if employee.shift_id is not None:
        shift = db.get(DepartmentShift, employee.shift_id)
        if (
            shift is None
            or employee.department_id is None
            or shift.department_id != employee.department_id
        ):
            employee.shift_id = None

    if employee.department_id is None:
        employee.region_id = None
    else:
        department = db.get(Department, employee.department_id)
        if department is None:
            raise HTTPException(status_code=404, detail="Department not found")
        employee.region_id = department.region_id

    db.commit()
    db.refresh(employee)

    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id="admin",
        action="EMPLOYEE_DEPARTMENT_UPDATED",
        success=True,
        entity_type="employee",
        entity_id=str(employee.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "department_id": employee.department_id,
            "region_id": employee.region_id,
            "shift_id": employee.shift_id,
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return _to_employee_read(employee)


@router.patch(
    "/api/admin/employees/{employee_id}/region",
    response_model=EmployeeRead,
    dependencies=[Depends(require_admin_permission("employees", write=True))],
)
def update_employee_region(
    employee_id: int,
    payload: EmployeeRegionUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> EmployeeRead:
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(status_code=404, detail="Employee not found")

    if payload.region_id is not None:
        region = db.get(Region, payload.region_id)
        if region is None:
            raise HTTPException(status_code=404, detail="Region not found")

    if employee.department_id is not None:
        department = db.get(Department, employee.department_id)
        if department is None:
            raise HTTPException(status_code=404, detail="Department not found")
        if department.region_id is not None and payload.region_id != department.region_id:
            raise HTTPException(status_code=422, detail="Employee region must match department region")

    employee.region_id = payload.region_id
    db.commit()
    db.refresh(employee)

    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id="admin",
        action="EMPLOYEE_REGION_UPDATED",
        success=True,
        entity_type="employee",
        entity_id=str(employee.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={"region_id": employee.region_id},
        request_id=getattr(request.state, "request_id", None),
    )
    return _to_employee_read(employee)


@router.post(
    "/api/admin/device-invite",
    response_model=DeviceInviteCreateResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin_permission("devices", write=True))],
)
def create_device_invite(
    payload: DeviceInviteCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> DeviceInviteCreateResponse:
    employee = db.get(Employee, payload.employee_id)
    if employee is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    if not employee.is_active:
        raise HTTPException(status_code=409, detail="Inactive employee cannot receive invites")

    now_utc = datetime.now(timezone.utc)
    token = secrets.token_urlsafe(32)
    invite = DeviceInvite(
        employee_id=payload.employee_id,
        token=token,
        expires_at=now_utc + timedelta(minutes=payload.expires_in_minutes),
        is_used=False,
    )
    db.add(invite)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Could not create invite token")

    base_url = get_employee_portal_base_url()
    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id="admin",
        action="DEVICE_INVITE_CREATED",
        success=True,
        entity_type="device_invite",
        entity_id=str(invite.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={"employee_id": payload.employee_id},
        request_id=getattr(request.state, "request_id", None),
    )
    return DeviceInviteCreateResponse(
        token=token,
        invite_url=f"{base_url}/claim?token={token}",
    )


@router.post(
    "/admin/devices",
    response_model=DeviceRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin_permission("devices", write=True))],
)
def register_device(payload: DeviceCreate, db: Session = Depends(get_db)) -> DeviceRead:
    employee = db.get(Employee, payload.employee_id)
    if employee is None:
        raise HTTPException(status_code=404, detail="Employee not found")

    device = Device(
        employee_id=payload.employee_id,
        device_fingerprint=payload.device_fingerprint,
        is_active=payload.is_active,
    )
    db.add(device)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Device fingerprint already exists")
    db.refresh(device)
    return device


@router.get(
    "/admin/devices",
    response_model=list[DeviceRead],
    dependencies=[Depends(require_admin_permission("devices"))],
)
def list_devices(db: Session = Depends(get_db)) -> list[DeviceRead]:
    return list(db.scalars(select(Device).order_by(Device.id)).all())


@router.get(
    "/api/admin/employee-device-overview",
    response_model=list[EmployeeDeviceOverviewRead],
    dependencies=[Depends(require_admin_permission("devices"))],
)
def list_employee_device_overview(
    employee_id: int | None = Query(default=None, ge=1),
    region_id: int | None = Query(default=None, ge=1),
    include_inactive: bool = Query(default=True),
    q: str | None = Query(default=None, min_length=1),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=500),
    device_limit: int = Query(default=5, ge=1, le=100),
    db: Session = Depends(get_db),
) -> list[EmployeeDeviceOverviewRead]:
    stmt = (
        select(Employee)
        .options(
            selectinload(Employee.region),
            selectinload(Employee.department),
            selectinload(Employee.devices),
            selectinload(Employee.device_invites),
        )
        .order_by(Employee.id.asc())
    )
    if employee_id is not None:
        stmt = stmt.where(Employee.id == employee_id)
    if region_id is not None:
        stmt = stmt.join(Department, Department.id == Employee.department_id, isouter=True).where(
            or_(
                Employee.region_id == region_id,
                and_(Employee.region_id.is_(None), Department.region_id == region_id),
            )
        )
    if not include_inactive:
        stmt = stmt.where(Employee.is_active.is_(True))
    if q:
        normalized_q = q.strip()
        if normalized_q:
            if normalized_q.isdigit():
                stmt = stmt.where(
                    or_(
                        Employee.full_name.ilike(f"%{normalized_q}%"),
                        Employee.id == int(normalized_q),
                    )
                )
            else:
                stmt = stmt.where(Employee.full_name.ilike(f"%{normalized_q}%"))
    stmt = stmt.offset(offset).limit(limit)

    employees = list(db.scalars(stmt).all())
    now_utc = datetime.now(timezone.utc)
    rows: list[EmployeeDeviceOverviewRead] = []

    for employee in employees:
        invites = list(employee.device_invites or [])
        token_total = len(invites)
        token_used = sum(1 for invite in invites if invite.is_used)
        token_expired = sum(
            1
            for invite in invites
            if not invite.is_used and invite.expires_at <= now_utc
        )
        token_pending = max(0, token_total - token_used - token_expired)

        all_devices = sorted(
            list(employee.devices or []),
            key=lambda item: (item.created_at, item.id),
            reverse=True,
        )
        limited_devices = all_devices[:device_limit]
        device_rows = [
            EmployeeDeviceOverviewDevice(
                id=device.id,
                device_fingerprint=device.device_fingerprint,
                is_active=device.is_active,
                created_at=device.created_at,
            )
            for device in limited_devices
        ]

        rows.append(
            EmployeeDeviceOverviewRead(
                employee_id=employee.id,
                employee_name=employee.full_name,
                region_id=employee.region_id,
                region_name=employee.region.name if employee.region else None,
                department_id=employee.department_id,
                department_name=employee.department.name if employee.department else None,
                is_employee_active=employee.is_active,
                total_devices=len(all_devices),
                active_devices=sum(1 for device in all_devices if device.is_active),
                shown_devices=len(device_rows),
                has_more_devices=len(all_devices) > len(device_rows),
                token_total=token_total,
                token_used=token_used,
                token_pending=token_pending,
                token_expired=token_expired,
                devices=device_rows,
            )
        )

    return rows


@router.patch(
    "/api/admin/devices/{device_id}/active",
    response_model=DeviceRead,
    dependencies=[Depends(require_admin_permission("devices", write=True))],
)
def update_device_active_status(
    device_id: int,
    payload: DeviceActiveUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> DeviceRead:
    device = db.get(Device, device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")

    if payload.is_active and (device.employee is None or not device.employee.is_active):
        raise ApiError(
            status_code=409,
            code="EMPLOYEE_INACTIVE",
            message="Inactive employee devices cannot be activated.",
        )

    device.is_active = payload.is_active
    db.commit()
    db.refresh(device)

    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id="admin",
        action="DEVICE_REACTIVATED" if payload.is_active else "DEVICE_DEACTIVATED",
        success=True,
        entity_type="device",
        entity_id=str(device.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={"is_active": payload.is_active, "employee_id": device.employee_id},
        request_id=getattr(request.state, "request_id", None),
    )
    return device


@router.put(
    "/admin/employee-locations/{employee_id}",
    response_model=EmployeeLocationRead,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_admin_permission("employees", write=True))],
)
def upsert_employee_location(
    employee_id: int,
    payload: EmployeeLocationUpsert,
    db: Session = Depends(get_db),
) -> EmployeeLocationRead:
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(status_code=404, detail="Employee not found")

    location = db.scalar(
        select(EmployeeLocation).where(EmployeeLocation.employee_id == employee_id)
    )
    if location is None:
        location = EmployeeLocation(
            employee_id=employee_id,
            home_lat=payload.home_lat,
            home_lon=payload.home_lon,
            radius_m=payload.radius_m,
        )
        db.add(location)
    else:
        location.home_lat = payload.home_lat
        location.home_lon = payload.home_lon
        location.radius_m = payload.radius_m

    db.commit()
    db.refresh(location)
    return location


@router.get(
    "/admin/employee-locations/{employee_id}",
    response_model=EmployeeLocationRead,
    dependencies=[Depends(require_admin_permission("employees"))],
)
def get_employee_location(employee_id: int, db: Session = Depends(get_db)) -> EmployeeLocationRead:
    location = db.scalar(
        select(EmployeeLocation).where(EmployeeLocation.employee_id == employee_id)
    )
    if location is None:
        raise HTTPException(status_code=404, detail="Employee location not found")
    return location


@router.post(
    "/admin/work-rules",
    response_model=WorkRuleRead,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_admin_permission("work_rules", write=True))],
)
def upsert_work_rule(payload: WorkRuleUpsert, db: Session = Depends(get_db)) -> WorkRuleRead:
    department = db.get(Department, payload.department_id)
    if department is None:
        raise HTTPException(status_code=404, detail="Department not found")

    rule = db.scalar(select(WorkRule).where(WorkRule.department_id == payload.department_id))
    if rule is None:
        rule = WorkRule(
            department_id=payload.department_id,
            daily_minutes_planned=payload.daily_minutes_planned,
            break_minutes=payload.break_minutes,
            grace_minutes=payload.grace_minutes,
        )
        db.add(rule)
    else:
        rule.daily_minutes_planned = payload.daily_minutes_planned
        rule.break_minutes = payload.break_minutes
        rule.grace_minutes = payload.grace_minutes

    db.commit()
    db.refresh(rule)
    return rule


@router.get(
    "/admin/work-rules",
    response_model=list[WorkRuleRead],
    dependencies=[Depends(require_admin_permission("work_rules"))],
)
def list_work_rules(
    region_id: int | None = Query(default=None, ge=1),
    db: Session = Depends(get_db),
) -> list[WorkRuleRead]:
    stmt = select(WorkRule).order_by(WorkRule.id)
    if region_id is not None:
        stmt = stmt.join(Department, Department.id == WorkRule.department_id).where(Department.region_id == region_id)
    return list(db.scalars(stmt).all())


@router.post(
    "/admin/department-weekly-rules",
    response_model=DepartmentWeeklyRuleRead,
    dependencies=[Depends(require_admin_permission("schedule", write=True))],
)
def upsert_department_weekly_rule(
    payload: DepartmentWeeklyRuleUpsert,
    db: Session = Depends(get_db),
) -> DepartmentWeeklyRuleRead:
    department = db.get(Department, payload.department_id)
    if department is None:
        raise HTTPException(status_code=404, detail="Department not found")

    rule = db.scalar(
        select(DepartmentWeeklyRule).where(
            DepartmentWeeklyRule.department_id == payload.department_id,
            DepartmentWeeklyRule.weekday == payload.weekday,
        )
    )
    if rule is None:
        rule = DepartmentWeeklyRule(
            department_id=payload.department_id,
            weekday=payload.weekday,
            is_workday=payload.is_workday,
            planned_minutes=payload.planned_minutes,
            break_minutes=payload.break_minutes,
        )
        db.add(rule)
    else:
        rule.is_workday = payload.is_workday
        rule.planned_minutes = payload.planned_minutes
        rule.break_minutes = payload.break_minutes

    db.commit()
    db.refresh(rule)
    return rule


@router.get(
    "/admin/department-weekly-rules",
    response_model=list[DepartmentWeeklyRuleRead],
    dependencies=[Depends(require_admin_permission("schedule"))],
)
def list_department_weekly_rules(
    department_id: int | None = Query(default=None, ge=1),
    region_id: int | None = Query(default=None, ge=1),
    db: Session = Depends(get_db),
) -> list[DepartmentWeeklyRuleRead]:
    stmt = select(DepartmentWeeklyRule).order_by(
        DepartmentWeeklyRule.department_id.asc(),
        DepartmentWeeklyRule.weekday.asc(),
    )
    if department_id is not None:
        stmt = stmt.where(DepartmentWeeklyRule.department_id == department_id)
    if region_id is not None:
        stmt = stmt.join(Department, Department.id == DepartmentWeeklyRule.department_id).where(
            Department.region_id == region_id
        )
    return list(db.scalars(stmt).all())


def _to_shift_read(shift: DepartmentShift) -> DepartmentShiftRead:
    return DepartmentShiftRead(
        id=shift.id,
        department_id=shift.department_id,
        name=shift.name,
        start_time_local=_format_hhmm(shift.start_time_local),
        end_time_local=_format_hhmm(shift.end_time_local),
        break_minutes=shift.break_minutes,
        is_active=shift.is_active,
        created_at=shift.created_at,
        updated_at=shift.updated_at,
    )


def _to_qr_code_read(code: QRCode) -> QRCodeRead:
    point_ids = sorted({item.qr_point_id for item in (code.qr_code_points or [])})
    return QRCodeRead(
        id=code.id,
        name=code.name,
        code_value=code.code_value,
        code_type=code.code_type,
        is_active=code.is_active,
        point_ids=point_ids,
        created_at=code.created_at,
        updated_at=code.updated_at,
    )


def _validate_qr_point_scope(
    *,
    db: Session,
    department_id: int | None,
    region_id: int | None,
) -> tuple[int | None, int | None]:
    department: Department | None = None
    if department_id is not None:
        department = db.get(Department, department_id)
        if department is None:
            raise HTTPException(status_code=404, detail="Department not found")

    if region_id is not None:
        region = db.get(Region, region_id)
        if region is None:
            raise HTTPException(status_code=404, detail="Region not found")

    if (
        department is not None
        and region_id is not None
        and department.region_id is not None
        and department.region_id != region_id
    ):
        raise HTTPException(status_code=422, detail="QR point region must match department region")

    return department_id, region_id


def _normalize_schedule_plan_target_ids(payload: SchedulePlanUpsertRequest) -> list[int]:
    ids: list[int] = []
    if payload.target_employee_ids:
        ids.extend(payload.target_employee_ids)
    if payload.target_employee_id is not None:
        ids.insert(0, payload.target_employee_id)

    normalized: list[int] = []
    seen: set[int] = set()
    for raw_id in ids:
        if raw_id in seen:
            continue
        seen.add(raw_id)
        normalized.append(raw_id)
    return normalized


def _schedule_plan_to_read(plan: DepartmentSchedulePlan) -> SchedulePlanRead:
    target_employee_ids = [item.employee_id for item in (plan.target_employees or [])]
    if not target_employee_ids and plan.target_employee_id is not None:
        target_employee_ids = [plan.target_employee_id]
    primary_target = target_employee_ids[0] if target_employee_ids else None

    return SchedulePlanRead(
        id=plan.id,
        department_id=plan.department_id,
        target_type=plan.target_type,
        target_employee_id=primary_target,
        target_employee_ids=target_employee_ids,
        shift_id=plan.shift_id,
        daily_minutes_planned=plan.daily_minutes_planned,
        break_minutes=plan.break_minutes,
        grace_minutes=plan.grace_minutes,
        start_date=plan.start_date,
        end_date=plan.end_date,
        is_locked=plan.is_locked,
        is_active=plan.is_active,
        note=plan.note,
        created_at=plan.created_at,
        updated_at=plan.updated_at,
    )


def _validate_schedule_plan_payload(
    db: Session,
    payload: SchedulePlanUpsertRequest,
) -> tuple[Department, list[Employee], DepartmentShift | None, list[int]]:
    if payload.start_date > payload.end_date:
        raise HTTPException(status_code=422, detail="start_date cannot be greater than end_date")

    if (
        payload.shift_id is None
        and payload.daily_minutes_planned is None
        and payload.break_minutes is None
        and payload.grace_minutes is None
    ):
        raise HTTPException(
            status_code=422,
            detail="At least one plan value is required (shift or rule minutes)",
        )

    if payload.is_locked and payload.shift_id is None:
        raise HTTPException(status_code=422, detail="Locked plan requires shift_id")

    department = db.get(Department, payload.department_id)
    if department is None:
        raise HTTPException(status_code=404, detail="Department not found")

    target_employee_ids = _normalize_schedule_plan_target_ids(payload)
    target_employees: list[Employee] = []

    if payload.target_type.value == "DEPARTMENT":
        if target_employee_ids:
            raise HTTPException(
                status_code=422,
                detail="target_employee_id(s) must be empty for DEPARTMENT target",
            )
    else:
        if not target_employee_ids:
            raise HTTPException(
                status_code=422,
                detail="At least one target employee is required for this target type",
            )
        target_employees = list(
            db.scalars(
                select(Employee).where(Employee.id.in_(target_employee_ids))
            ).all()
        )
        found_ids = {employee.id for employee in target_employees}
        missing_ids = [item for item in target_employee_ids if item not in found_ids]
        if missing_ids:
            raise HTTPException(
                status_code=404,
                detail=f"Target employee not found: {missing_ids[0]}",
            )
        for employee in target_employees:
            if employee.department_id != payload.department_id:
                raise HTTPException(
                    status_code=422,
                    detail="Target employees must belong to selected department",
                )

    shift: DepartmentShift | None = None
    if payload.shift_id is not None:
        shift = db.get(DepartmentShift, payload.shift_id)
        if shift is None:
            raise HTTPException(status_code=404, detail="Department shift not found")
        if shift.department_id != payload.department_id:
            raise HTTPException(status_code=422, detail="Shift does not belong to selected department")

    return department, target_employees, shift, target_employee_ids


@router.post(
    "/admin/department-shifts",
    response_model=DepartmentShiftRead,
    dependencies=[Depends(require_admin_permission("schedule", write=True))],
)
def upsert_department_shift(
    payload: DepartmentShiftUpsert,
    db: Session = Depends(get_db),
) -> DepartmentShiftRead:
    department = db.get(Department, payload.department_id)
    if department is None:
        raise HTTPException(status_code=404, detail="Department not found")

    start_time_local = _parse_hhmm(payload.start_time_local)
    end_time_local = _parse_hhmm(payload.end_time_local)
    normalized_name = payload.name.strip()
    if not normalized_name:
        raise HTTPException(status_code=422, detail="Shift name is required")

    existing_conflict = db.scalar(
        select(DepartmentShift).where(
            DepartmentShift.department_id == payload.department_id,
            DepartmentShift.name == normalized_name,
        )
    )
    if existing_conflict is not None and (payload.id is None or existing_conflict.id != payload.id):
        raise HTTPException(status_code=409, detail="Shift name already exists for department")

    if payload.id is None:
        shift = DepartmentShift(
            department_id=payload.department_id,
            name=normalized_name,
            start_time_local=start_time_local,
            end_time_local=end_time_local,
            break_minutes=payload.break_minutes,
            is_active=payload.is_active,
        )
        db.add(shift)
    else:
        shift = db.get(DepartmentShift, payload.id)
        if shift is None:
            raise HTTPException(status_code=404, detail="Department shift not found")
        if shift.department_id != payload.department_id:
            raise HTTPException(status_code=422, detail="Shift does not belong to provided department")
        shift.name = normalized_name
        shift.start_time_local = start_time_local
        shift.end_time_local = end_time_local
        shift.break_minutes = payload.break_minutes
        shift.is_active = payload.is_active

    db.commit()
    db.refresh(shift)
    return _to_shift_read(shift)


@router.get(
    "/admin/department-shifts",
    response_model=list[DepartmentShiftRead],
    dependencies=[Depends(require_admin_permission("schedule"))],
)
def list_department_shifts(
    department_id: int | None = Query(default=None, ge=1),
    region_id: int | None = Query(default=None, ge=1),
    active_only: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> list[DepartmentShiftRead]:
    stmt = select(DepartmentShift).order_by(
        DepartmentShift.department_id.asc(),
        DepartmentShift.id.asc(),
    )
    if department_id is not None:
        stmt = stmt.where(DepartmentShift.department_id == department_id)
    if region_id is not None:
        stmt = stmt.join(Department, Department.id == DepartmentShift.department_id).where(Department.region_id == region_id)
    if active_only:
        stmt = stmt.where(DepartmentShift.is_active.is_(True))
    shifts = list(db.scalars(stmt).all())
    return [_to_shift_read(item) for item in shifts]


@router.delete(
    "/admin/department-shifts/{shift_id}",
    response_model=SoftDeleteResponse,
    dependencies=[Depends(require_admin_permission("schedule", write=True))],
)
def delete_department_shift(
    shift_id: int,
    request: Request,
    db: Session = Depends(get_db),
) -> SoftDeleteResponse:
    shift = db.get(DepartmentShift, shift_id)
    if shift is None:
        raise HTTPException(status_code=404, detail="Department shift not found")

    # Safe deletion for MVP: keep historical references, only deactivate.
    shift.is_active = False
    db.commit()

    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id="admin",
        action="DEPARTMENT_SHIFT_DEACTIVATED",
        success=True,
        entity_type="department_shift",
        entity_id=str(shift.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "department_id": shift.department_id,
            "name": shift.name,
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return SoftDeleteResponse(ok=True, id=shift.id)


@router.post(
    "/api/admin/qr/codes",
    response_model=QRCodeRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin_permission("schedule", write=True))],
)
def create_qr_code(
    payload: QRCodeCreateRequest,
    request: Request,
    claims: dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db),
) -> QRCodeRead:
    normalized_code_value = payload.code_value.strip()
    if not normalized_code_value:
        raise HTTPException(status_code=422, detail="code_value cannot be empty")

    code = QRCode(
        name=payload.name.strip() if payload.name else None,
        code_value=normalized_code_value,
        code_type=payload.code_type,
        is_active=payload.is_active,
    )
    db.add(code)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="QR code value already exists") from exc

    code = db.scalar(
        select(QRCode)
        .options(selectinload(QRCode.qr_code_points))
        .where(QRCode.id == code.id)
    )
    if code is None:
        raise HTTPException(status_code=404, detail="QR code not found")

    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=str(claims.get("username") or claims.get("sub") or "admin"),
        action="QR_CODE_CREATED",
        success=True,
        entity_type="qr_code",
        entity_id=str(code.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "code_value": code.code_value,
            "code_type": code.code_type.value,
            "is_active": code.is_active,
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return _to_qr_code_read(code)


@router.get(
    "/api/admin/qr/codes",
    response_model=list[QRCodeRead],
    dependencies=[Depends(require_admin_permission("schedule"))],
)
def list_qr_codes(
    active_only: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> list[QRCodeRead]:
    stmt = select(QRCode).options(selectinload(QRCode.qr_code_points)).order_by(QRCode.id.desc())
    if active_only:
        stmt = stmt.where(QRCode.is_active.is_(True))
    rows = list(db.scalars(stmt).all())
    return [_to_qr_code_read(item) for item in rows]


@router.patch(
    "/api/admin/qr/codes/{code_id}",
    response_model=QRCodeRead,
    dependencies=[Depends(require_admin_permission("schedule", write=True))],
)
def update_qr_code(
    code_id: int,
    payload: QRCodeUpdateRequest,
    request: Request,
    claims: dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db),
) -> QRCodeRead:
    code = db.scalar(
        select(QRCode)
        .options(selectinload(QRCode.qr_code_points))
        .where(QRCode.id == code_id)
    )
    if code is None:
        raise HTTPException(status_code=404, detail="QR code not found")

    fields_set = payload.model_fields_set
    if "name" in fields_set:
        code.name = payload.name.strip() if payload.name and payload.name.strip() else None
    if "code_value" in fields_set:
        if payload.code_value is None:
            raise HTTPException(status_code=422, detail="code_value cannot be null")
        normalized_code_value = payload.code_value.strip()
        if not normalized_code_value:
            raise HTTPException(status_code=422, detail="code_value cannot be empty")
        code.code_value = normalized_code_value
    if "code_type" in fields_set:
        if payload.code_type is None:
            raise HTTPException(status_code=422, detail="code_type cannot be null")
        code.code_type = payload.code_type
    if "is_active" in fields_set:
        if payload.is_active is None:
            raise HTTPException(status_code=422, detail="is_active cannot be null")
        code.is_active = payload.is_active

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="QR code value already exists") from exc

    code = db.scalar(
        select(QRCode)
        .options(selectinload(QRCode.qr_code_points))
        .where(QRCode.id == code_id)
    )
    if code is None:
        raise HTTPException(status_code=404, detail="QR code not found")

    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=str(claims.get("username") or claims.get("sub") or "admin"),
        action="QR_CODE_UPDATED",
        success=True,
        entity_type="qr_code",
        entity_id=str(code.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "code_value": code.code_value,
            "code_type": code.code_type.value,
            "is_active": code.is_active,
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return _to_qr_code_read(code)


@router.post(
    "/api/admin/qr/codes/{code_id}/points",
    response_model=QRCodeRead,
    dependencies=[Depends(require_admin_permission("schedule", write=True))],
)
def assign_qr_code_points(
    code_id: int,
    payload: QRCodeAssignPointsRequest,
    request: Request,
    claims: dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db),
) -> QRCodeRead:
    code = db.scalar(
        select(QRCode)
        .options(selectinload(QRCode.qr_code_points))
        .where(QRCode.id == code_id)
    )
    if code is None:
        raise HTTPException(status_code=404, detail="QR code not found")

    requested_point_ids = sorted({point_id for point_id in payload.point_ids if point_id > 0})
    if not requested_point_ids:
        raise HTTPException(status_code=422, detail="point_ids must include at least one valid id")

    found_points = list(db.scalars(select(QRPoint).where(QRPoint.id.in_(requested_point_ids))).all())
    found_ids = {item.id for item in found_points}
    missing_ids = [item for item in requested_point_ids if item not in found_ids]
    if missing_ids:
        raise HTTPException(status_code=404, detail=f"QR point not found: {missing_ids[0]}")

    existing_ids = {item.qr_point_id for item in (code.qr_code_points or [])}
    added_ids: list[int] = []
    for point_id in requested_point_ids:
        if point_id in existing_ids:
            continue
        db.add(QRCodePoint(qr_code_id=code.id, qr_point_id=point_id))
        added_ids.append(point_id)

    db.commit()
    code = db.scalar(
        select(QRCode)
        .options(selectinload(QRCode.qr_code_points))
        .where(QRCode.id == code_id)
    )
    if code is None:
        raise HTTPException(status_code=404, detail="QR code not found")

    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=str(claims.get("username") or claims.get("sub") or "admin"),
        action="QR_CODE_POINTS_ASSIGNED",
        success=True,
        entity_type="qr_code",
        entity_id=str(code.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "requested_point_ids": requested_point_ids,
            "added_point_ids": added_ids,
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return _to_qr_code_read(code)


@router.delete(
    "/api/admin/qr/codes/{code_id}/points/{point_id}",
    response_model=SoftDeleteResponse,
    dependencies=[Depends(require_admin_permission("schedule", write=True))],
)
def unassign_qr_code_point(
    code_id: int,
    point_id: int,
    request: Request,
    claims: dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db),
) -> SoftDeleteResponse:
    code = db.get(QRCode, code_id)
    if code is None:
        raise HTTPException(status_code=404, detail="QR code not found")

    relation = db.get(QRCodePoint, {"qr_code_id": code_id, "qr_point_id": point_id})
    if relation is None:
        raise HTTPException(status_code=404, detail="QR code point relation not found")

    db.delete(relation)
    db.commit()

    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=str(claims.get("username") or claims.get("sub") or "admin"),
        action="QR_CODE_POINT_UNASSIGNED",
        success=True,
        entity_type="qr_code",
        entity_id=str(code_id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={"point_id": point_id},
        request_id=getattr(request.state, "request_id", None),
    )
    return SoftDeleteResponse(ok=True, id=point_id)


@router.post(
    "/api/admin/qr/points",
    response_model=QRPointRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin_permission("schedule", write=True))],
)
def create_qr_point(
    payload: QRPointCreateRequest,
    request: Request,
    claims: dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db),
) -> QRPointRead:
    normalized_name = payload.name.strip()
    if not normalized_name:
        raise HTTPException(status_code=422, detail="name cannot be empty")

    department_id, region_id = _validate_qr_point_scope(
        db=db,
        department_id=payload.department_id,
        region_id=payload.region_id,
    )

    point = QRPoint(
        name=normalized_name,
        lat=payload.lat,
        lon=payload.lon,
        radius_m=payload.radius_m,
        is_active=payload.is_active,
        department_id=department_id,
        region_id=region_id,
    )
    db.add(point)
    db.commit()
    db.refresh(point)

    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=str(claims.get("username") or claims.get("sub") or "admin"),
        action="QR_POINT_CREATED",
        success=True,
        entity_type="qr_point",
        entity_id=str(point.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "name": point.name,
            "department_id": point.department_id,
            "region_id": point.region_id,
            "radius_m": point.radius_m,
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return point


@router.get(
    "/api/admin/qr/points",
    response_model=list[QRPointRead],
    dependencies=[Depends(require_admin_permission("schedule"))],
)
def list_qr_points(
    active_only: bool = Query(default=False),
    department_id: int | None = Query(default=None, ge=1),
    region_id: int | None = Query(default=None, ge=1),
    db: Session = Depends(get_db),
) -> list[QRPointRead]:
    stmt = select(QRPoint).order_by(QRPoint.id.desc())
    if active_only:
        stmt = stmt.where(QRPoint.is_active.is_(True))
    if department_id is not None:
        stmt = stmt.where(QRPoint.department_id == department_id)
    if region_id is not None:
        stmt = stmt.where(QRPoint.region_id == region_id)
    return list(db.scalars(stmt).all())


@router.patch(
    "/api/admin/qr/points/{point_id}",
    response_model=QRPointRead,
    dependencies=[Depends(require_admin_permission("schedule", write=True))],
)
def update_qr_point(
    point_id: int,
    payload: QRPointUpdateRequest,
    request: Request,
    claims: dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db),
) -> QRPointRead:
    point = db.get(QRPoint, point_id)
    if point is None:
        raise HTTPException(status_code=404, detail="QR point not found")

    fields_set = payload.model_fields_set
    if "name" in fields_set:
        if payload.name is None:
            raise HTTPException(status_code=422, detail="name cannot be null")
        normalized_name = payload.name.strip()
        if not normalized_name:
            raise HTTPException(status_code=422, detail="name cannot be empty")
        point.name = normalized_name
    if "lat" in fields_set:
        if payload.lat is None:
            raise HTTPException(status_code=422, detail="lat cannot be null")
        point.lat = payload.lat
    if "lon" in fields_set:
        if payload.lon is None:
            raise HTTPException(status_code=422, detail="lon cannot be null")
        point.lon = payload.lon
    if "radius_m" in fields_set:
        if payload.radius_m is None:
            raise HTTPException(status_code=422, detail="radius_m cannot be null")
        point.radius_m = payload.radius_m
    if "is_active" in fields_set:
        if payload.is_active is None:
            raise HTTPException(status_code=422, detail="is_active cannot be null")
        point.is_active = payload.is_active

    if "department_id" in fields_set or "region_id" in fields_set:
        next_department_id = payload.department_id if "department_id" in fields_set else point.department_id
        next_region_id = payload.region_id if "region_id" in fields_set else point.region_id
        validated_department_id, validated_region_id = _validate_qr_point_scope(
            db=db,
            department_id=next_department_id,
            region_id=next_region_id,
        )
        point.department_id = validated_department_id
        point.region_id = validated_region_id

    db.commit()
    db.refresh(point)

    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=str(claims.get("username") or claims.get("sub") or "admin"),
        action="QR_POINT_UPDATED",
        success=True,
        entity_type="qr_point",
        entity_id=str(point.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "name": point.name,
            "department_id": point.department_id,
            "region_id": point.region_id,
            "radius_m": point.radius_m,
            "is_active": point.is_active,
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return point


@router.delete(
    "/api/admin/qr/points/{point_id}",
    response_model=SoftDeleteResponse,
    dependencies=[Depends(require_admin_permission("schedule", write=True))],
)
def deactivate_qr_point(
    point_id: int,
    request: Request,
    claims: dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db),
) -> SoftDeleteResponse:
    point = db.get(QRPoint, point_id)
    if point is None:
        raise HTTPException(status_code=404, detail="QR point not found")

    point.is_active = False
    db.commit()

    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=str(claims.get("username") or claims.get("sub") or "admin"),
        action="QR_POINT_DEACTIVATED",
        success=True,
        entity_type="qr_point",
        entity_id=str(point.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={},
        request_id=getattr(request.state, "request_id", None),
    )
    return SoftDeleteResponse(ok=True, id=point.id)


@router.post(
    "/api/admin/schedule-plans",
    response_model=SchedulePlanRead,
    dependencies=[Depends(require_admin_permission("schedule", write=True))],
)
def upsert_schedule_plan(
    payload: SchedulePlanUpsertRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> SchedulePlanRead:
    _, _, _, target_employee_ids = _validate_schedule_plan_payload(db, payload)

    if payload.id is None:
        plan = DepartmentSchedulePlan(
            department_id=payload.department_id,
            target_type=payload.target_type,
            target_employee_id=target_employee_ids[0] if target_employee_ids else None,
            shift_id=payload.shift_id,
            daily_minutes_planned=payload.daily_minutes_planned,
            break_minutes=payload.break_minutes,
            grace_minutes=payload.grace_minutes,
            start_date=payload.start_date,
            end_date=payload.end_date,
            is_locked=payload.is_locked,
            is_active=payload.is_active,
            note=payload.note,
        )
        db.add(plan)
        db.flush()
        plan.target_employees = [
            DepartmentSchedulePlanEmployee(employee_id=employee_id)
            for employee_id in target_employee_ids
        ]
    else:
        plan = db.get(DepartmentSchedulePlan, payload.id)
        if plan is None:
            raise HTTPException(status_code=404, detail="Schedule plan not found")
        plan.department_id = payload.department_id
        plan.target_type = payload.target_type
        plan.target_employee_id = target_employee_ids[0] if target_employee_ids else None
        plan.shift_id = payload.shift_id
        plan.daily_minutes_planned = payload.daily_minutes_planned
        plan.break_minutes = payload.break_minutes
        plan.grace_minutes = payload.grace_minutes
        plan.start_date = payload.start_date
        plan.end_date = payload.end_date
        plan.is_locked = payload.is_locked
        plan.is_active = payload.is_active
        plan.note = payload.note
        desired_target_ids = set(target_employee_ids)
        existing_scope_rows = {
            scope_row.employee_id: scope_row
            for scope_row in list(plan.target_employees)
        }

        for existing_employee_id, scope_row in existing_scope_rows.items():
            if existing_employee_id not in desired_target_ids:
                plan.target_employees.remove(scope_row)

        for employee_id in target_employee_ids:
            if employee_id not in existing_scope_rows:
                plan.target_employees.append(
                    DepartmentSchedulePlanEmployee(employee_id=employee_id)
                )

    db.commit()
    db.refresh(plan)

    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id="admin",
        action="SCHEDULE_PLAN_UPSERT",
        success=True,
        entity_type="schedule_plan",
        entity_id=str(plan.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "department_id": plan.department_id,
            "target_type": plan.target_type.value,
            "target_employee_id": plan.target_employee_id,
            "target_employee_ids": target_employee_ids,
            "shift_id": plan.shift_id,
            "start_date": plan.start_date.isoformat(),
            "end_date": plan.end_date.isoformat(),
            "is_locked": plan.is_locked,
            "is_active": plan.is_active,
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return _schedule_plan_to_read(plan)


@router.get(
    "/api/admin/schedule-plans",
    response_model=list[SchedulePlanRead],
    dependencies=[Depends(require_admin_permission("schedule"))],
)
def list_schedule_plans(
    department_id: int | None = Query(default=None, ge=1),
    region_id: int | None = Query(default=None, ge=1),
    employee_id: int | None = Query(default=None, ge=1),
    active_only: bool = Query(default=True),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[SchedulePlanRead]:
    stmt = (
        select(DepartmentSchedulePlan)
        .options(selectinload(DepartmentSchedulePlan.target_employees))
        .order_by(DepartmentSchedulePlan.id.desc())
    )
    if department_id is not None:
        stmt = stmt.where(DepartmentSchedulePlan.department_id == department_id)
    if region_id is not None:
        stmt = stmt.join(Department, Department.id == DepartmentSchedulePlan.department_id).where(
            Department.region_id == region_id
        )
    if active_only:
        stmt = stmt.where(DepartmentSchedulePlan.is_active.is_(True))
    if start_date is not None:
        stmt = stmt.where(DepartmentSchedulePlan.end_date >= start_date)
    if end_date is not None:
        stmt = stmt.where(DepartmentSchedulePlan.start_date <= end_date)
    plans = list(db.scalars(stmt).all())
    if employee_id is not None:
        plans = [
            item
            for item in plans
            if plan_applies_to_employee(item, employee_id=employee_id)
        ]
    return [_schedule_plan_to_read(item) for item in plans]


@router.delete(
    "/api/admin/schedule-plans/{plan_id}",
    response_model=SoftDeleteResponse,
    dependencies=[Depends(require_admin_permission("schedule", write=True))],
)
def cancel_schedule_plan(
    plan_id: int,
    request: Request,
    db: Session = Depends(get_db),
) -> SoftDeleteResponse:
    plan = db.get(DepartmentSchedulePlan, plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail="Schedule plan not found")
    plan.is_active = False
    db.commit()

    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id="admin",
        action="SCHEDULE_PLAN_CANCELLED",
        success=True,
        entity_type="schedule_plan",
        entity_id=str(plan.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={},
        request_id=getattr(request.state, "request_id", None),
    )
    return SoftDeleteResponse(ok=True, id=plan.id)


@router.get(
    "/api/admin/compliance-settings",
    response_model=LaborProfileRead,
    dependencies=[Depends(require_admin_permission("compliance"))],
)
def get_compliance_settings(db: Session = Depends(get_db)) -> LaborProfileRead:
    profile = get_or_create_labor_profile(db)
    return profile


@router.put(
    "/api/admin/compliance-settings",
    response_model=LaborProfileRead,
    dependencies=[Depends(require_admin_permission("compliance", write=True))],
)
def update_compliance_settings(
    payload: LaborProfileUpsertRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> LaborProfileRead:
    profile = upsert_labor_profile(db, payload)
    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id="admin",
        action="COMPLIANCE_SETTINGS_UPDATED",
        success=True,
        entity_type="labor_profile",
        entity_id=str(profile.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "weekly_normal_minutes_default": profile.weekly_normal_minutes_default,
            "daily_max_minutes": profile.daily_max_minutes,
            "overtime_annual_cap_minutes": profile.overtime_annual_cap_minutes,
            "overtime_rounding_mode": profile.overtime_rounding_mode.value,
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return profile


@router.post(
    "/api/admin/leaves",
    response_model=LeaveRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin_permission("leaves", write=True))],
)
def create_leave_endpoint(
    payload: LeaveCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> LeaveRead:
    leave = create_leave(db, payload)
    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id="admin",
        action="LEAVE_CREATED",
        success=True,
        entity_type="leave",
        entity_id=str(leave.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={"employee_id": leave.employee_id, "type": leave.type.value},
        request_id=getattr(request.state, "request_id", None),
    )
    return leave


@router.get(
    "/api/admin/leaves",
    response_model=list[LeaveRead],
    dependencies=[Depends(require_admin_permission("leaves"))],
)
def list_leaves_endpoint(
    employee_id: int | None = Query(default=None, ge=1),
    year: int | None = Query(default=None, ge=1970),
    month: int | None = Query(default=None, ge=1, le=12),
    db: Session = Depends(get_db),
) -> list[LeaveRead]:
    return list_leaves(
        db,
        employee_id=employee_id,
        year=year,
        month=month,
    )


@router.delete(
    "/api/admin/leaves/{leave_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_admin_permission("leaves", write=True))],
)
def delete_leave_endpoint(
    leave_id: int,
    request: Request,
    db: Session = Depends(get_db),
) -> None:
    delete_leave(db, leave_id)
    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id="admin",
        action="LEAVE_DELETED",
        success=True,
        entity_type="leave",
        entity_id=str(leave_id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        request_id=getattr(request.state, "request_id", None),
    )


@router.get(
    "/admin/attendance-events",
    response_model=list[AttendanceEventRead],
    dependencies=[Depends(require_admin_permission("attendance_events"))],
)
def list_attendance_events(
    employee_id: int | None = Query(default=None),
    department_id: int | None = Query(default=None, ge=1),
    region_id: int | None = Query(default=None, ge=1),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    event_type: AttendanceType | None = Query(default=None, alias="type"),
    location_status: LocationStatus | None = Query(default=None),
    duplicates_only: bool = Query(default=False),
    include_deleted: bool = Query(default=False),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
) -> list[AttendanceEventRead]:
    stmt = select(AttendanceEvent).order_by(AttendanceEvent.id.desc()).limit(limit)
    employee_joined = False
    if not include_deleted:
        stmt = stmt.where(AttendanceEvent.deleted_at.is_(None))
    if employee_id is not None:
        stmt = stmt.where(AttendanceEvent.employee_id == employee_id)
    if department_id is not None:
        stmt = stmt.join(Employee, Employee.id == AttendanceEvent.employee_id).where(
            Employee.department_id == department_id
        )
        employee_joined = True
    if region_id is not None:
        if not employee_joined:
            stmt = stmt.join(Employee, Employee.id == AttendanceEvent.employee_id)
            employee_joined = True
        stmt = stmt.join(Department, Department.id == Employee.department_id, isouter=True).where(
            or_(
                Employee.region_id == region_id,
                and_(Employee.region_id.is_(None), Department.region_id == region_id),
            )
        )
    if start_date is not None:
        start_dt = datetime.combine(start_date, datetime.min.time(), tzinfo=timezone.utc)
        stmt = stmt.where(AttendanceEvent.ts_utc >= start_dt)
    if end_date is not None:
        end_dt = datetime.combine(end_date + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
        stmt = stmt.where(AttendanceEvent.ts_utc < end_dt)
    if event_type is not None:
        stmt = stmt.where(AttendanceEvent.type == event_type)
    if location_status is not None:
        stmt = stmt.where(AttendanceEvent.location_status == location_status)
    if duplicates_only:
        stmt = stmt.where(AttendanceEvent.flags["DUPLICATE_EVENT"].astext == "true")
    return list(db.scalars(stmt).all())


@router.post(
    "/api/admin/attendance-events",
    response_model=AttendanceEventRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin_permission("attendance_events", write=True))],
)
def create_manual_attendance_event_v2_endpoint(
    payload: AttendanceEventManualCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> AttendanceEventRead:
    event = create_admin_manual_event(
        db,
        employee_id=payload.employee_id,
        event_type=payload.type,
        ts_utc=payload.ts_utc,
        ts_local=payload.ts_local,
        lat=payload.lat,
        lon=payload.lon,
        accuracy_m=payload.accuracy_m,
        note=payload.note,
        shift_id=payload.shift_id,
        allow_duplicate=payload.allow_duplicate,
    )
    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id="admin",
        action="ATTENDANCE_EVENT_CREATED",
        success=True,
        entity_type="attendance_event",
        entity_id=str(event.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "event_type": event.type.value,
            "ts_utc": event.ts_utc.isoformat(),
            "flags": event.flags or {},
            "source": event.source.value,
            "note": event.note,
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return event


@router.post(
    "/api/admin/attendance-events/manual",
    response_model=AttendanceEventRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin_permission("attendance_events", write=True))],
)
def create_manual_attendance_event_endpoint(
    payload: AttendanceEventManualCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> AttendanceEventRead:
    return create_manual_attendance_event_v2_endpoint(payload=payload, request=request, db=db)


@router.patch(
    "/api/admin/attendance-events/{event_id}",
    response_model=AttendanceEventRead,
    dependencies=[Depends(require_admin_permission("attendance_events", write=True))],
)
def update_manual_attendance_event_endpoint(
    event_id: int,
    payload: AttendanceEventManualUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> AttendanceEventRead:
    event = update_admin_manual_event(
        db,
        event_id=event_id,
        event_type=payload.type,
        ts_utc=payload.ts_utc,
        ts_local=payload.ts_local,
        note=payload.note,
        shift_id=payload.shift_id,
        allow_duplicate=payload.allow_duplicate,
        force_edit=payload.force_edit,
    )
    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id="admin",
        action="ATTENDANCE_EVENT_UPDATED",
        success=True,
        entity_type="attendance_event",
        entity_id=str(event.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "event_type": event.type.value,
            "ts_utc": event.ts_utc.isoformat(),
            "flags": event.flags or {},
            "source": event.source.value,
            "force_edit": payload.force_edit,
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return event


@router.delete(
    "/api/admin/attendance-events/{event_id}",
    response_model=SoftDeleteResponse,
    dependencies=[Depends(require_admin_permission("attendance_events", write=True))],
)
def soft_delete_attendance_event_endpoint(
    event_id: int,
    request: Request,
    force: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> SoftDeleteResponse:
    event = soft_delete_admin_attendance_event(db, event_id=event_id, force_delete=force)
    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id="admin",
        action="ATTENDANCE_EVENT_SOFT_DELETED",
        success=True,
        entity_type="attendance_event",
        entity_id=str(event.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "ts_utc": event.ts_utc.isoformat(),
            "force_delete": force,
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return SoftDeleteResponse(ok=True, id=event.id)


@router.get(
    "/api/admin/audit-logs",
    response_model=list[AuditLogRead],
    dependencies=[Depends(require_admin_permission("audit"))],
)
def list_audit_logs(
    action: str | None = Query(default=None),
    entity_type: str | None = Query(default=None),
    entity_id: str | None = Query(default=None),
    success: bool | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
) -> list[AuditLogRead]:
    stmt = select(AuditLog).order_by(AuditLog.id.desc()).limit(limit)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type)
    if entity_id:
        stmt = stmt.where(AuditLog.entity_id == entity_id)
    if success is not None:
        stmt = stmt.where(AuditLog.success.is_(success))
    return list(db.scalars(stmt).all())


@router.get(
    "/api/admin/notifications/jobs",
    response_model=list[NotificationJobRead],
)
def list_notification_jobs(
    request: Request,
    status: Literal["PENDING", "SENDING", "SENT", "CANCELED", "FAILED"] | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    claims: dict[str, Any] = Depends(require_admin_permission("audit")),
    db: Session = Depends(get_db),
) -> list[NotificationJobRead]:
    stmt = select(NotificationJob).order_by(NotificationJob.id.desc()).offset(offset).limit(limit)
    if status is not None:
        stmt = stmt.where(NotificationJob.status == status)

    jobs = list(db.scalars(stmt).all())
    actor_id = str(claims.get("username") or claims.get("sub") or "admin")
    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=actor_id,
        action="NOTIFICATION_JOBS_LIST",
        success=True,
        entity_type="notification_job",
        entity_id=None,
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "status": status,
            "offset": offset,
            "limit": limit,
            "count": len(jobs),
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return jobs


@router.get(
    "/api/admin/notifications/subscriptions",
    response_model=list[AdminPushSubscriptionRead],
)
def list_notification_subscriptions(
    request: Request,
    employee_id: int | None = Query(default=None, ge=1),
    claims: dict[str, Any] = Depends(require_admin_permission("audit")),
    db: Session = Depends(get_db),
) -> list[AdminPushSubscriptionRead]:
    rows = list_active_push_subscriptions(db, employee_id=employee_id)
    actor_id = str(claims.get("username") or claims.get("sub") or "admin")
    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=actor_id,
        action="NOTIFICATION_SUBSCRIPTIONS_LIST",
        success=True,
        entity_type="device_push_subscription",
        entity_id=None,
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "employee_id": employee_id,
            "count": len(rows),
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return [_to_admin_push_subscription_read(row) for row in rows]


@router.get(
    "/api/admin/notifications/admin-subscriptions",
    response_model=list[AdminDevicePushSubscriptionRead],
)
def list_admin_notification_subscriptions(
    request: Request,
    admin_user_id: int | None = Query(default=None, ge=1),
    claims: dict[str, Any] = Depends(require_admin_permission("audit")),
    db: Session = Depends(get_db),
) -> list[AdminDevicePushSubscriptionRead]:
    rows = list_active_admin_push_subscriptions(db, admin_user_id=admin_user_id)
    actor_id = str(claims.get("username") or claims.get("sub") or "admin")
    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=actor_id,
        action="ADMIN_NOTIFICATION_SUBSCRIPTIONS_LIST",
        success=True,
        entity_type="admin_push_subscription",
        entity_id=None,
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "admin_user_id": admin_user_id,
            "count": len(rows),
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return [_to_admin_device_push_subscription_read(row) for row in rows]


@router.get(
    "/api/admin/notifications/push/config",
    response_model=EmployeePushConfigResponse,
)
def admin_push_config(
    _claims: dict[str, Any] = Depends(require_admin),
) -> EmployeePushConfigResponse:
    return EmployeePushConfigResponse(**get_push_public_config())


@router.post(
    "/api/admin/notifications/admin-device-invite",
    response_model=AdminDeviceInviteCreateResponse,
)
def create_admin_device_invite(
    payload: AdminDeviceInviteCreateRequest,
    request: Request,
    claims: dict[str, Any] = Depends(require_admin_permission("audit", write=True)),
    db: Session = Depends(get_db),
) -> AdminDeviceInviteCreateResponse:
    now_utc = datetime.now(timezone.utc)
    actor_id = str(claims.get("username") or claims.get("sub") or settings.admin_user)
    admin_user_id = claims.get("admin_user_id") if isinstance(claims.get("admin_user_id"), int) else None

    token = secrets.token_urlsafe(32)
    expires_at = now_utc + timedelta(minutes=payload.expires_in_minutes)

    invite = AdminDeviceInvite(
        token=token,
        expires_at=expires_at,
        is_used=False,
        created_by_admin_user_id=admin_user_id,
        created_by_username=actor_id,
    )
    db.add(invite)
    db.commit()
    db.refresh(invite)

    invite_url = f"{get_public_base_url()}/admin-panel/device-claim?token={token}"
    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=actor_id,
        action="ADMIN_DEVICE_INVITE_CREATED",
        success=True,
        entity_type="admin_device_invite",
        entity_id=str(invite.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "expires_at": expires_at.isoformat(),
            "expires_in_minutes": payload.expires_in_minutes,
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return AdminDeviceInviteCreateResponse(
        token=token,
        invite_url=invite_url,
        expires_at=expires_at,
    )


@router.post(
    "/api/admin/notifications/admin-device-claim",
    response_model=AdminDeviceClaimResponse,
)
def claim_admin_device_push(
    payload: AdminDeviceClaimRequest,
    request: Request,
    claims: dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AdminDeviceClaimResponse:
    now_utc = datetime.now(timezone.utc)
    actor_id = str(claims.get("username") or claims.get("sub") or settings.admin_user)
    admin_user_id = claims.get("admin_user_id") if isinstance(claims.get("admin_user_id"), int) else None
    request.state.actor = "admin"
    request.state.actor_id = actor_id

    invite = db.scalar(select(AdminDeviceInvite).where(AdminDeviceInvite.token == payload.token))
    if invite is None:
        raise ApiError(status_code=404, code="INVITE_NOT_FOUND", message="Admin device invite token not found.")
    if invite.is_used:
        raise ApiError(status_code=409, code="INVITE_ALREADY_USED", message="Admin device invite already used.")
    if invite.expires_at < now_utc:
        raise ApiError(status_code=410, code="INVITE_EXPIRED", message="Admin device invite expired.")

    subscription = upsert_admin_push_subscription(
        db,
        admin_user_id=admin_user_id,
        admin_username=actor_id,
        subscription=payload.subscription,
        user_agent=_user_agent(request),
    )

    invite.is_used = True
    invite.used_at = now_utc
    invite.used_by_admin_user_id = admin_user_id
    invite.used_by_username = actor_id
    db.commit()

    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=actor_id,
        action="ADMIN_DEVICE_CLAIMED",
        success=True,
        entity_type="admin_push_subscription",
        entity_id=str(subscription.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "invite_id": invite.id,
            "admin_user_id": admin_user_id,
            "admin_username": actor_id,
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return AdminDeviceClaimResponse(
        ok=True,
        admin_username=actor_id,
        subscription_id=subscription.id,
    )


@router.get(
    "/api/admin/daily-report-archives",
    response_model=list[AdminDailyReportArchiveRead],
)
def list_daily_report_archives(
    request: Request,
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    department_id: int | None = Query(default=None, ge=1),
    region_id: int | None = Query(default=None, ge=1),
    limit: int = Query(default=60, ge=1, le=500),
    claims: dict[str, Any] = Depends(require_admin_permission("reports")),
    db: Session = Depends(get_db),
) -> list[AdminDailyReportArchiveRead]:
    stmt = select(AdminDailyReportArchive).order_by(
        AdminDailyReportArchive.report_date.desc(),
        AdminDailyReportArchive.id.desc(),
    ).limit(limit)
    if start_date is not None:
        stmt = stmt.where(AdminDailyReportArchive.report_date >= start_date)
    if end_date is not None:
        stmt = stmt.where(AdminDailyReportArchive.report_date <= end_date)
    if department_id is not None:
        stmt = stmt.where(AdminDailyReportArchive.department_id == department_id)
    if region_id is not None:
        stmt = stmt.where(AdminDailyReportArchive.region_id == region_id)

    rows = list(db.scalars(stmt).all())
    actor_id = str(claims.get("username") or claims.get("sub") or "admin")
    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=actor_id,
        action="ADMIN_DAILY_REPORT_ARCHIVES_LIST",
        success=True,
        entity_type="admin_daily_report_archive",
        entity_id=None,
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "start_date": start_date.isoformat() if start_date else None,
            "end_date": end_date.isoformat() if end_date else None,
            "department_id": department_id,
            "region_id": region_id,
            "limit": limit,
            "count": len(rows),
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return rows


@router.get(
    "/api/admin/daily-report-archives/{archive_id}/download",
    dependencies=[Depends(require_admin_permission("reports"))],
)
def download_daily_report_archive(
    archive_id: int,
    request: Request,
    claims: dict[str, Any] = Depends(require_admin_permission("reports")),
    db: Session = Depends(get_db),
) -> Response:
    archive = db.get(AdminDailyReportArchive, archive_id)
    if archive is None:
        raise HTTPException(status_code=404, detail="Daily report archive not found")
    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=str(claims.get("username") or claims.get("sub") or "admin"),
        action="ADMIN_DAILY_REPORT_ARCHIVE_DOWNLOADED",
        success=True,
        entity_type="admin_daily_report_archive",
        entity_id=str(archive.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "report_date": archive.report_date.isoformat(),
            "file_name": archive.file_name,
            "file_size_bytes": archive.file_size_bytes,
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return Response(
        content=archive.file_data,
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{archive.file_name}"'},
    )


@router.post("/api/admin/daily-report-archives/{archive_id}/password-download")
def password_download_daily_report_archive(
    archive_id: int,
    payload: AdminDailyReportArchivePasswordDownloadRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> Response:
    username = payload.username.strip()
    if not username:
        raise ApiError(
            status_code=422,
            code="VALIDATION_ERROR",
            message="Username is required.",
        )

    ip = _client_ip(request)
    user_agent = _user_agent(request)
    request_id = getattr(request.state, "request_id", None)
    request.state.actor = "system"
    request.state.actor_id = "system"

    if ip:
        try:
            ensure_login_attempt_allowed(ip)
        except ApiError:
            log_audit(
                db,
                actor_type=AuditActorType.SYSTEM,
                actor_id=username,
                action="ADMIN_DAILY_REPORT_ARCHIVE_PASSWORD_DOWNLOAD_FAIL",
                success=False,
                entity_type="admin_daily_report_archive",
                entity_id=str(archive_id),
                ip=ip,
                user_agent=user_agent,
                details={"reason": "TOO_MANY_ATTEMPTS"},
                request_id=request_id,
            )
            raise

    identity: dict[str, Any] | None = None
    if verify_admin_credentials(username, payload.password):
        identity = _build_env_admin_identity(username)
    else:
        admin_user = db.scalar(select(AdminUser).where(AdminUser.username == username))
        if admin_user is not None and admin_user.is_active and verify_password(
            payload.password,
            admin_user.password_hash,
        ):
            identity = _build_admin_user_identity(admin_user)

    if identity is None:
        if ip:
            register_login_failure(ip)
        log_audit(
            db,
            actor_type=AuditActorType.SYSTEM,
            actor_id=username,
            action="ADMIN_DAILY_REPORT_ARCHIVE_PASSWORD_DOWNLOAD_FAIL",
            success=False,
            entity_type="admin_daily_report_archive",
            entity_id=str(archive_id),
            ip=ip,
            user_agent=user_agent,
            details={"reason": "INVALID_CREDENTIALS"},
            request_id=request_id,
        )
        raise ApiError(
            status_code=401,
            code="INVALID_CREDENTIALS",
            message="Invalid credentials.",
        )

    if ip:
        register_login_success(ip)

    archive = db.get(AdminDailyReportArchive, archive_id)
    if archive is None:
        raise HTTPException(status_code=404, detail="Daily report archive not found")

    actor_id = str(identity.get("username") or identity.get("sub") or username)
    request.state.actor = "admin"
    request.state.actor_id = actor_id
    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=actor_id,
        action="ADMIN_DAILY_REPORT_ARCHIVE_PASSWORD_DOWNLOADED",
        success=True,
        entity_type="admin_daily_report_archive",
        entity_id=str(archive.id),
        ip=ip,
        user_agent=user_agent,
        details={
            "report_date": archive.report_date.isoformat(),
            "file_name": archive.file_name,
            "file_size_bytes": archive.file_size_bytes,
        },
        request_id=request_id,
    )

    return Response(
        content=archive.file_data,
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{archive.file_name}"'},
    )


@router.post(
    "/api/admin/daily-report-archives/{archive_id}/notify",
    response_model=AdminDailyReportArchiveNotifyResponse,
)
def notify_daily_report_archive(
    archive_id: int,
    payload: AdminDailyReportArchiveNotifyRequest,
    request: Request,
    claims: dict[str, Any] = Depends(require_admin_permission("reports", write=True)),
    db: Session = Depends(get_db),
) -> AdminDailyReportArchiveNotifyResponse:
    archive = db.get(AdminDailyReportArchive, archive_id)
    if archive is None:
        raise HTTPException(status_code=404, detail="Daily report archive not found")

    admin_user_ids: list[int] | None = None
    if payload.admin_user_ids is not None:
        normalized_ids = sorted(
            {value for value in payload.admin_user_ids if isinstance(value, int) and value > 0}
        )
        if not normalized_ids:
            raise ApiError(
                status_code=422,
                code="VALIDATION_ERROR",
                message="At least one admin_user_id is required when admin_user_ids is provided.",
            )
        admin_user_ids = normalized_ids

    archive_url = f"{get_public_base_url()}/admin-panel/archive-download?archive_id={archive.id}"
    report_date_text = archive.report_date.isoformat()
    title = f"Günlük Puantaj Raporu Hazır ({report_date_text})"
    body = (
        f"{report_date_text} tarihli günlük puantaj Excel raporu hazır. "
        "Bildirime dokunup doğrudan indirebilirsin."
    )
    push_summary = send_push_to_admins(
        db,
        admin_user_ids=admin_user_ids,
        title=title,
        body=body,
        data={
            "type": "ADMIN_DAILY_REPORT_ARCHIVE",
            "archive_id": archive.id,
            "report_date": report_date_text,
            "file_name": archive.file_name,
            "url": f"/admin-panel/archive-download?archive_id={archive.id}",
        },
    )

    actor_id = str(claims.get("username") or claims.get("sub") or "admin")
    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=actor_id,
        action="ADMIN_DAILY_REPORT_ARCHIVE_NOTIFY",
        success=True,
        entity_type="admin_daily_report_archive",
        entity_id=str(archive.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "report_date": report_date_text,
            "file_name": archive.file_name,
            "archive_url": archive_url,
            "requested_admin_user_ids": admin_user_ids,
            "total_targets": push_summary.get("total_targets", 0),
            "sent": push_summary.get("sent", 0),
            "failed": push_summary.get("failed", 0),
            "deactivated": push_summary.get("deactivated", 0),
        },
        request_id=getattr(request.state, "request_id", None),
    )

    return AdminDailyReportArchiveNotifyResponse(
        ok=True,
        archive_id=archive.id,
        archive_url=archive_url,
        total_targets=int(push_summary.get("total_targets", 0)),
        sent=int(push_summary.get("sent", 0)),
        failed=int(push_summary.get("failed", 0)),
        deactivated=int(push_summary.get("deactivated", 0)),
        admin_user_ids=list(push_summary.get("admin_user_ids", [])),
        admin_usernames=list(push_summary.get("admin_usernames", [])),
    )


@router.post(
    "/api/admin/notifications/send",
    response_model=AdminManualNotificationSendResponse,
)
def send_manual_notification(
    payload: AdminManualNotificationSendRequest,
    request: Request,
    claims: dict[str, Any] = Depends(require_admin_permission("audit", write=True)),
    db: Session = Depends(get_db),
) -> AdminManualNotificationSendResponse:
    _verify_current_admin_password(
        db,
        claims=claims,
        password=payload.password,
    )

    actor_id = str(claims.get("username") or claims.get("sub") or "admin")
    employee_ids: list[int] | None = None
    admin_user_ids: list[int] | None = None
    if payload.employee_ids is not None:
        normalized_ids = sorted({value for value in payload.employee_ids if isinstance(value, int) and value > 0})
        if not normalized_ids:
            raise ApiError(
                status_code=422,
                code="VALIDATION_ERROR",
                message="At least one employee_id is required when employee_ids is provided.",
            )
        employee_ids = normalized_ids

    if payload.admin_user_ids is not None:
        normalized_admin_ids = sorted({value for value in payload.admin_user_ids if isinstance(value, int) and value > 0})
        if not normalized_admin_ids:
            raise ApiError(
                status_code=422,
                code="VALIDATION_ERROR",
                message="At least one admin_user_id is required when admin_user_ids is provided.",
            )
        admin_user_ids = normalized_admin_ids

    employee_summary = {"total_targets": 0, "sent": 0, "failed": 0, "deactivated": 0, "employee_ids": []}
    admin_summary = {"total_targets": 0, "sent": 0, "failed": 0, "deactivated": 0, "admin_user_ids": [], "admin_usernames": []}

    if payload.target in {"employees", "both"}:
        employee_summary = send_push_to_employees(
            db,
            employee_ids=employee_ids,
            title=payload.title,
            body=payload.message,
            data={
                "type": "ADMIN_MANUAL",
                "target": "employees",
                "title": payload.title,
                "actor": actor_id,
            },
        )
    if payload.target in {"admins", "both"}:
        admin_summary = send_push_to_admins(
            db,
            admin_user_ids=admin_user_ids,
            title=payload.title,
            body=payload.message,
            data={
                "type": "ADMIN_MANUAL",
                "target": "admins",
                "title": payload.title,
                "actor": actor_id,
                "url": "/admin-panel/notifications",
            },
        )

    total_targets = int(employee_summary.get("total_targets", 0)) + int(admin_summary.get("total_targets", 0))
    sent_total = int(employee_summary.get("sent", 0)) + int(admin_summary.get("sent", 0))
    failed_total = int(employee_summary.get("failed", 0)) + int(admin_summary.get("failed", 0))
    deactivated_total = int(employee_summary.get("deactivated", 0)) + int(admin_summary.get("deactivated", 0))

    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=actor_id,
        action="ADMIN_MANUAL_PUSH_SENT",
        success=True,
        entity_type="notification",
        entity_id=None,
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "target": payload.target,
            "employee_ids": employee_ids,
            "admin_user_ids": admin_user_ids,
            "title": payload.title,
            "total_targets": total_targets,
            "sent": sent_total,
            "failed": failed_total,
            "deactivated": deactivated_total,
            "employee_summary": employee_summary,
            "admin_summary": admin_summary,
        },
        request_id=getattr(request.state, "request_id", None),
    )

    return AdminManualNotificationSendResponse(
        ok=True,
        total_targets=total_targets,
        sent=sent_total,
        failed=failed_total,
        deactivated=deactivated_total,
        employee_ids=list(employee_summary.get("employee_ids", [])),
        admin_user_ids=list(admin_summary.get("admin_user_ids", [])),
        admin_usernames=list(admin_summary.get("admin_usernames", [])),
    )


@router.post(
    "/api/admin/notifications/jobs/{job_id}/cancel",
    response_model=NotificationJobRead,
)
def cancel_notification_job(
    job_id: int,
    request: Request,
    claims: dict[str, Any] = Depends(require_admin_permission("audit", write=True)),
    db: Session = Depends(get_db),
) -> NotificationJobRead:
    job = db.get(NotificationJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Notification job not found")
    if job.status == "SENT":
        raise HTTPException(status_code=409, detail="Notification job already sent and cannot be canceled")

    previous_status = job.status
    if job.status != "CANCELED":
        job.status = "CANCELED"
        db.commit()
        db.refresh(job)

    actor_id = str(claims.get("username") or claims.get("sub") or "admin")
    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=actor_id,
        action="NOTIFICATION_JOB_CANCELED",
        success=True,
        entity_type="notification_job",
        entity_id=str(job.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "previous_status": previous_status,
            "status": job.status,
            "job_type": job.job_type,
            "employee_id": job.employee_id,
            "idempotency_key": job.idempotency_key,
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return job


@router.post(
    "/api/admin/manual-overrides/day",
    response_model=ManualDayOverrideRead,
    dependencies=[Depends(require_admin_permission("manual_overrides", write=True))],
)
def upsert_manual_override_endpoint(
    request: Request,
    employee_id: int = Query(..., ge=1),
    payload: ManualDayOverrideUpsertRequest = ...,
    db: Session = Depends(get_db),
) -> ManualDayOverrideRead:
    override = upsert_manual_day_override(
        db,
        employee_id=employee_id,
        payload=payload,
        created_by="admin",
    )

    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id="admin",
        action="MANUAL_DAY_OVERRIDE_UPSERT",
        success=True,
        entity_type="manual_day_override",
        entity_id=str(override.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "employee_id": employee_id,
            "day_date": payload.day_date.isoformat(),
            "is_absent": payload.is_absent,
            "rule_source_override": payload.rule_source_override,
            "rule_shift_id_override": payload.rule_shift_id_override,
            "note": payload.note,
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return override


@router.get(
    "/api/admin/manual-overrides/day",
    response_model=list[ManualDayOverrideRead],
    dependencies=[Depends(require_admin_permission("manual_overrides"))],
)
def list_manual_overrides_endpoint(
    employee_id: int = Query(..., ge=1),
    year: int = Query(..., ge=1970),
    month: int = Query(..., ge=1, le=12),
    db: Session = Depends(get_db),
) -> list[ManualDayOverrideRead]:
    return list_manual_day_overrides(
        db,
        employee_id=employee_id,
        year=year,
        month=month,
    )


@router.delete(
    "/api/admin/manual-overrides/day/{override_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_admin_permission("manual_overrides", write=True))],
)
def delete_manual_override_endpoint(
    override_id: int,
    request: Request,
    db: Session = Depends(get_db),
) -> None:
    override = db.get(ManualDayOverride, override_id)
    if override is None:
        raise HTTPException(status_code=404, detail="Manual override not found")

    employee_id = override.employee_id
    day_date = override.day_date.isoformat()
    delete_manual_day_override(db, override_id)
    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id="admin",
        action="MANUAL_DAY_OVERRIDE_DELETE",
        success=True,
        entity_type="manual_day_override",
        entity_id=str(override_id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={"employee_id": employee_id, "day_date": day_date},
        request_id=getattr(request.state, "request_id", None),
    )


@router.get(
    "/api/admin/exports/puantaj.xlsx",
    dependencies=[Depends(require_admin_permission("reports"))],
)
def export_puantaj_xlsx(
    request: Request,
    mode: Literal["employee", "department", "all", "date_range"] = Query(...),
    year: int | None = Query(default=None, ge=1970),
    month: int | None = Query(default=None, ge=1, le=12),
    employee_id: int | None = Query(default=None, ge=1),
    department_id: int | None = Query(default=None, ge=1),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    include_daily_sheet: bool = Query(default=True),
    include_inactive: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> Response:
    payload = build_puantaj_xlsx_bytes(
        db,
        mode=mode,
        year=year,
        month=month,
        employee_id=employee_id,
        department_id=department_id,
        start_date=start_date,
        end_date=end_date,
        include_daily_sheet=include_daily_sheet,
        include_inactive=include_inactive,
    )

    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id="admin",
        action="PUANTAJ_EXPORT_XLSX",
        success=True,
        entity_type="export",
        entity_id=mode,
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "mode": mode,
            "year": year,
            "month": month,
            "employee_id": employee_id,
            "department_id": department_id,
            "start_date": start_date.isoformat() if start_date else None,
            "end_date": end_date.isoformat() if end_date else None,
            "include_inactive": include_inactive,
        },
        request_id=getattr(request.state, "request_id", None),
    )

    filename_suffix = mode
    if year is not None and month is not None:
        filename_suffix = f"{mode}-{year}-{month:02d}"
    elif start_date is not None and end_date is not None:
        filename_suffix = f"{mode}-{start_date.isoformat()}-{end_date.isoformat()}"

    return Response(
        content=payload,
        media_type=XLSX_MEDIA_TYPE,
        headers={
            "Content-Disposition": f'attachment; filename="puantaj-{filename_suffix}.xlsx"',
        },
    )


@router.get(
    "/api/admin/export/employee-monthly",
    dependencies=[Depends(require_admin_permission("reports"))],
)
def export_employee_monthly(
    request: Request,
    employee_id: int = Query(..., ge=1),
    year: int = Query(..., ge=1970),
    month: int = Query(..., ge=1, le=12),
    db: Session = Depends(get_db),
) -> Response:
    payload = build_puantaj_xlsx_bytes(
        db,
        mode="employee",
        employee_id=employee_id,
        year=year,
        month=month,
    )
    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id="admin",
        action="PUANTAJ_EXPORT_XLSX",
        success=True,
        entity_type="export",
        entity_id="employee",
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "mode": "employee",
            "year": year,
            "month": month,
            "employee_id": employee_id,
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return Response(
        content=payload,
        media_type=XLSX_MEDIA_TYPE,
        headers={
            "Content-Disposition": f'attachment; filename="puantaj-employee-{employee_id}-{year}-{month:02d}.xlsx"',
        },
    )


@router.get(
    "/api/admin/export/department-monthly",
    dependencies=[Depends(require_admin_permission("reports"))],
)
def export_department_monthly(
    request: Request,
    department_id: int = Query(..., ge=1),
    year: int = Query(..., ge=1970),
    month: int = Query(..., ge=1, le=12),
    include_inactive: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> Response:
    payload = build_puantaj_xlsx_bytes(
        db,
        mode="department",
        department_id=department_id,
        year=year,
        month=month,
        include_inactive=include_inactive,
    )
    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id="admin",
        action="PUANTAJ_EXPORT_XLSX",
        success=True,
        entity_type="export",
        entity_id="department",
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "mode": "department",
            "year": year,
            "month": month,
            "department_id": department_id,
            "include_inactive": include_inactive,
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return Response(
        content=payload,
        media_type=XLSX_MEDIA_TYPE,
        headers={
            "Content-Disposition": f'attachment; filename="puantaj-department-{department_id}-{year}-{month:02d}.xlsx"',
        },
    )


@router.get(
    "/api/admin/export/all-monthly",
    dependencies=[Depends(require_admin_permission("reports"))],
)
def export_all_monthly(
    request: Request,
    year: int = Query(..., ge=1970),
    month: int = Query(..., ge=1, le=12),
    include_inactive: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> Response:
    payload = build_puantaj_xlsx_bytes(
        db,
        mode="all",
        year=year,
        month=month,
        include_inactive=include_inactive,
    )
    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id="admin",
        action="PUANTAJ_EXPORT_XLSX",
        success=True,
        entity_type="export",
        entity_id="all",
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "mode": "all",
            "year": year,
            "month": month,
            "include_inactive": include_inactive,
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return Response(
        content=payload,
        media_type=XLSX_MEDIA_TYPE,
        headers={
            "Content-Disposition": f'attachment; filename="puantaj-all-{year}-{month:02d}.xlsx"',
        },
    )


@router.get(
    "/api/admin/export/date-range",
    dependencies=[Depends(require_admin_permission("reports"))],
)
def export_date_range(
    request: Request,
    start: date = Query(...),
    end: date = Query(...),
    department_id: int | None = Query(default=None, ge=1),
    employee_id: int | None = Query(default=None, ge=1),
    db: Session = Depends(get_db),
) -> Response:
    payload = build_puantaj_xlsx_bytes(
        db,
        mode="date_range",
        start_date=start,
        end_date=end,
        department_id=department_id,
        employee_id=employee_id,
    )
    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id="admin",
        action="PUANTAJ_EXPORT_XLSX",
        success=True,
        entity_type="export",
        entity_id="date_range",
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "mode": "date_range",
            "start": start.isoformat(),
            "end": end.isoformat(),
            "department_id": department_id,
            "employee_id": employee_id,
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return Response(
        content=payload,
        media_type=XLSX_MEDIA_TYPE,
        headers={
            "Content-Disposition": f'attachment; filename="puantaj-date-range-{start.isoformat()}-{end.isoformat()}.xlsx"',
        },
    )


@router.get(
    "/api/admin/export/puantaj-range.xlsx",
    dependencies=[Depends(require_admin_permission("reports"))],
)
def export_puantaj_range(
    request: Request,
    start_date: date = Query(...),
    end_date: date = Query(...),
    mode: Literal["consolidated", "employee_sheets", "department_sheets"] = Query(default="consolidated"),
    department_id: int | None = Query(default=None, ge=1),
    employee_id: int | None = Query(default=None, ge=1),
    db: Session = Depends(get_db),
) -> Response:
    payload = build_puantaj_range_xlsx_bytes(
        db,
        start_date=start_date,
        end_date=end_date,
        mode=mode,
        department_id=department_id,
        employee_id=employee_id,
    )
    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id="admin",
        action="PUANTAJ_EXPORT_XLSX",
        success=True,
        entity_type="export",
        entity_id="puantaj_range",
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "mode": mode,
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "department_id": department_id,
            "employee_id": employee_id,
        },
        request_id=getattr(request.state, "request_id", None),
    )
    filename = f"puantaj-range-{mode}-{start_date.isoformat()}-{end_date.isoformat()}.xlsx"
    return Response(
        content=payload,
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get(
    "/api/admin/monthly/employee",
    response_model=MonthlyEmployeeResponse,
    dependencies=[Depends(require_admin_permission("reports"))],
)
def get_employee_monthly(
    employee_id: int = Query(..., ge=1),
    year: int = Query(..., ge=1970),
    month: int = Query(..., ge=1, le=12),
    db: Session = Depends(get_db),
) -> MonthlyEmployeeResponse:
    return calculate_employee_monthly(
        db,
        employee_id=employee_id,
        year=year,
        month=month,
    )


@router.get(
    "/api/admin/monthly/department-summary",
    response_model=list[DepartmentMonthlySummaryItem],
    dependencies=[Depends(require_admin_permission("reports"))],
)
def get_department_monthly_summary(
    year: int = Query(..., ge=1970),
    month: int = Query(..., ge=1, le=12),
    department_id: int | None = Query(default=None, ge=1),
    region_id: int | None = Query(default=None, ge=1),
    include_inactive: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> list[DepartmentMonthlySummaryItem]:
    return calculate_department_monthly_summary(
        db,
        year=year,
        month=month,
        department_id=department_id,
        region_id=region_id,
        include_inactive=include_inactive,
    )
