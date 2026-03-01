import secrets
from datetime import date, datetime, time, timedelta, timezone
import hashlib
import logging
from math import ceil
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.audit import log_audit
from app.db import get_db
from app.errors import ApiError
from app.models import (
    AdminDeviceInvite,
    AdminDailyReportArchive,
    AdminNotificationEmailTarget,
    AdminPushSubscription,
    AdminUser,
    AdminRefreshToken,
    AttendanceExtraCheckinApproval,
    AttendanceEvent,
    AttendanceType,
    AuditActorType,
    AuditLog,
    Department,
    DepartmentSchedulePlan,
    DepartmentSchedulePlanEmployee,
    DepartmentShift,
    DepartmentWeekdayShiftAssignment,
    DepartmentWeeklyRule,
    Device,
    DeviceInvite,
    DevicePushSubscription,
    Employee,
    EmployeeLocation,
    LocationStatus,
    ManualDayOverride,
    NotificationDeliveryLog,
    NotificationJob,
    ScheduledNotificationTask,
    QRCode,
    QRCodePoint,
    QRPoint,
    Region,
    WorkRule,
)
from app.schemas import (
    AdminManualNotificationSendRequest,
    AdminManualNotificationSendResponse,
    AdminDeviceHealRequest,
    AdminDeviceHealResponse,
    AdminDeviceInviteCreateRequest,
    AdminDeviceInviteCreateResponse,
    AdminDeviceClaimRequest,
    AdminDeviceClaimPublicRequest,
    AdminDeviceClaimResponse,
    AdminPushSelfCheckResponse,
    AdminPushSelfTestResponse,
    AdminDailyReportJobHealthResponse,
    AdminNotificationEmailTargetRead,
    AdminNotificationEmailTargetsResponse,
    AdminNotificationEmailTargetsUpdateRequest,
    AdminNotificationEmailTestRequest,
    AdminNotificationEmailTestResponse,
    AdminAuthResponse,
    AdminLoginRequest,
    AdminLogoutRequest,
    AdminLogoutResponse,
    AdminMeResponse,
    AdminRefreshRequest,
    AdminUserCreateRequest,
    AdminUserMfaRecoveryRegenerateRequest,
    AdminUserMfaRecoveryRegenerateResponse,
    AdminUserMfaSetupConfirmRequest,
    AdminUserMfaSetupConfirmResponse,
    AdminUserMfaSetupStartResponse,
    AdminUserMfaStatusResponse,
    AdminUserClaimDetailResponse,
    AdminPushClaimDetailRead,
    AdminPushClaimActiveUpdateRequest,
    AdminDeviceInviteDetailRead,
    AdminUserRead,
    AdminUserUpdateRequest,
    AdminDevicePushSubscriptionRead,
    AdminPushSubscriptionRead,
    AdminDailyReportArchiveRead,
    AdminDailyReportArchivePageResponse,
    AdminDailyReportArchiveNotifyRequest,
    AdminDailyReportArchiveNotifyResponse,
    AdminDailyReportArchivePasswordDownloadRequest,
    AdminAttendanceExtraCheckinApprovalApproveRequest,
    AdminAttendanceExtraCheckinApprovalApproveResponse,
    AdminAttendanceExtraCheckinApprovalRead,
    AuditLogRead,
    AuditLogPageResponse,
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
    DepartmentWeekdayShiftAssignmentRead,
    DepartmentWeekdayShiftAssignmentReplaceRequest,
    ControlRoomEmployeeAlertRead,
    ControlRoomEmployeeActionRequest,
    ControlRoomEmployeeDetailResponse,
    ControlRoomEmployeeStateRead,
    ControlRoomFilterAuditRequest,
    ControlRoomMapPointRead,
    ControlRoomMutationResponse,
    ControlRoomNoteCreateRequest,
    ControlRoomOverviewResponse,
    ControlRoomRecentEventRead,
    ControlRoomRiskOverrideRequest,
    ControlRoomSummaryRead,
    SchedulePlanRead,
    SchedulePlanUpsertRequest,
    DepartmentWeeklyRuleRead,
    DepartmentWeeklyRuleUpsert,
    EmployeeActiveUpdateRequest,
    EmployeeCreate,
    DashboardEmployeeLastEventRead,
    DashboardEmployeeMonthMetricsRead,
    DashboardEmployeeSnapshotRead,
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
    NotificationJobPageResponse,
    NotificationDeliveryLogRead,
    NotificationDeliveryLogPageResponse,
    NotificationJobNoteUpdateRequest,
    ScheduledNotificationTaskCreateRequest,
    ScheduledNotificationTaskPageResponse,
    ScheduledNotificationTaskRead,
    ScheduledNotificationTaskUpdateRequest,
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
    _attendance_timezone,
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
from app.services.control_room import (
    CONTROL_ROOM_ACTION_AUDIT,
    CONTROL_ROOM_NOTE_AUDIT,
    CONTROL_ROOM_OVERRIDE_AUDIT,
    build_control_room_employee_detail,
    build_control_room_overview,
)
from app.services.weekday_shift_assignments import normalize_shift_ids
from app.services.monthly import calculate_department_monthly_summary, calculate_employee_monthly
from app.services.push_notifications import (
    get_push_public_config,
    list_active_admin_push_subscriptions,
    list_active_push_subscriptions,
    send_test_push_to_admin_subscription,
    send_push_to_admin_subscriptions,
    send_push_to_admins,
    send_push_to_employees,
    upsert_admin_push_subscription,
)
from app.services.admin_mfa import (
    consume_admin_user_recovery_code,
    get_admin_user_mfa_status,
    is_admin_mfa_enabled,
    is_admin_user_mfa_enabled,
    issue_admin_user_recovery_codes,
    reset_admin_user_mfa,
    start_admin_user_mfa_setup,
    verify_admin_totp_code,
    verify_admin_user_totp_code,
)
from app.services.recovery_codes import get_admin_recovery_snapshot
from app.services.schedule_plans import plan_applies_to_employee
from app.services.notifications import (
    decrypt_archive_file_data,
    get_daily_report_job_health,
    list_admin_notification_email_targets,
    normalize_notification_email,
    replace_admin_notification_email_targets,
    send_admin_notification_test_email,
)
from app.services.notification_tasks import (
    get_task_next_run_at_utc,
    normalize_scheduled_notification_task_payload,
)

router = APIRouter(tags=["admin"])
logger = logging.getLogger("app.admin")
settings = get_settings()
XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
EXTRA_CHECKIN_APPROVAL_STATUS_PENDING = "PENDING"
EXTRA_CHECKIN_APPROVAL_STATUS_APPROVED = "APPROVED"
EXTRA_CHECKIN_APPROVAL_STATUS_CONSUMED = "CONSUMED"
EXTRA_CHECKIN_APPROVAL_STATUS_EXPIRED = "EXPIRED"


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


def _user_agent_hash(request: Request) -> str | None:
    value = (_user_agent(request) or "").strip()
    if not value:
        return None
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _normalize_query_text(value: str | None) -> str:
    return " ".join((value or "").strip().split())


def _as_positive_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value > 0 else None
    if isinstance(value, str):
        normalized = value.strip()
        if normalized.isdigit():
            parsed = int(normalized)
            return parsed if parsed > 0 else None
    return None


def _as_int(value: Any, default: int = 0) -> int:
    if isinstance(value, bool):
        return default
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        normalized = value.strip()
        if not normalized:
            return default
        try:
            return int(normalized)
        except ValueError:
            return default
    return default


def _as_utc_datetime(value: Any) -> datetime | None:
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _normalized_admin_actor_from_claims(claims: dict[str, Any]) -> tuple[str, int | None]:
    actor_username = str(claims.get("username") or claims.get("sub") or "admin").strip()
    actor_admin_user_id = _as_positive_int(claims.get("admin_user_id"))
    return actor_username, actor_admin_user_id


def _resolve_current_admin_claim_subscriptions(
    rows: list[AdminPushSubscription],
    *,
    actor_username: str,
    actor_admin_user_id: int | None,
) -> tuple[list[AdminPushSubscription], int, int]:
    actor_username_lc = actor_username.strip().lower()
    matched: list[AdminPushSubscription] = []
    by_id = 0
    by_username = 0
    seen_subscription_ids: set[int] = set()

    for row in rows:
        matched_row = False
        if actor_admin_user_id is not None and row.admin_user_id == actor_admin_user_id:
            by_id += 1
            matched_row = True
        if actor_username_lc and (row.admin_username or "").strip().lower() == actor_username_lc:
            by_username += 1
            matched_row = True
        if matched_row and row.id not in seen_subscription_ids:
            seen_subscription_ids.add(row.id)
            matched.append(row)

    return matched, by_id, by_username


def _resolve_employee_by_name(db: Session, employee_name: str) -> Employee:
    normalized_name = _normalize_query_text(employee_name)
    if not normalized_name:
        raise ApiError(
            status_code=422,
            code="VALIDATION_ERROR",
            message="employee_name cannot be empty.",
        )

    exact_matches = list(
        db.scalars(
            select(Employee)
            .where(Employee.full_name.ilike(normalized_name))
            .order_by(Employee.is_active.desc(), Employee.id.asc())
            .limit(10)
        ).all()
    )
    if len(exact_matches) == 1:
        return exact_matches[0]
    if len(exact_matches) > 1:
        raise ApiError(
            status_code=409,
            code="EMPLOYEE_NAME_AMBIGUOUS",
            message="Multiple employees matched this full name. Use employee_id.",
        )

    fuzzy_matches = list(
        db.scalars(
            select(Employee)
            .where(Employee.full_name.ilike(f"%{normalized_name}%"))
            .order_by(Employee.is_active.desc(), Employee.id.asc())
            .limit(10)
        ).all()
    )
    if len(fuzzy_matches) == 1:
        return fuzzy_matches[0]
    if len(fuzzy_matches) > 1:
        raise ApiError(
            status_code=409,
            code="EMPLOYEE_NAME_AMBIGUOUS",
            message="Multiple employees matched this name. Use employee_id.",
        )

    raise ApiError(
        status_code=404,
        code="EMPLOYEE_NOT_FOUND",
        message="Employee not found for provided name.",
    )


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


def _to_admin_user_read(
    admin_user: AdminUser,
    *,
    claim_total: int = 0,
    claim_active_total: int = 0,
) -> AdminUserRead:
    claim_total_value = max(0, int(claim_total))
    claim_active_value = max(0, int(claim_active_total))
    return AdminUserRead(
        id=admin_user.id,
        username=admin_user.username,
        full_name=admin_user.full_name,
        is_active=admin_user.is_active,
        is_super_admin=admin_user.is_super_admin,
        mfa_enabled=bool(admin_user.mfa_enabled),
        mfa_secret_configured=bool((admin_user.mfa_secret_enc or "").strip()),
        claim_total=claim_total_value,
        claim_active_total=claim_active_value,
        claim_inactive_total=max(0, claim_total_value - claim_active_value),
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


def _to_admin_notification_email_target_read(
    row: AdminNotificationEmailTarget,
) -> AdminNotificationEmailTargetRead:
    return AdminNotificationEmailTargetRead.model_validate(row)


def _to_scheduled_notification_task_read(
    row: ScheduledNotificationTask,
) -> ScheduledNotificationTaskRead:
    payload = ScheduledNotificationTaskRead.model_validate(row)
    return payload.model_copy(
        update={
            "employee_ids": [value for value in (row.employee_ids or []) if isinstance(value, int) and value > 0],
            "admin_user_ids": [value for value in (row.admin_user_ids or []) if isinstance(value, int) and value > 0],
            "next_run_at_utc": get_task_next_run_at_utc(row),
        }
    )


def _endpoint_fingerprint(endpoint: str) -> str:
    return hashlib.sha256(endpoint.encode("utf-8")).hexdigest()[:16]


def _to_admin_push_claim_detail_read(row: AdminPushSubscription) -> AdminPushClaimDetailRead:
    return AdminPushClaimDetailRead(
        id=row.id,
        admin_user_id=row.admin_user_id,
        admin_username=row.admin_username,
        is_active=row.is_active,
        endpoint=row.endpoint,
        endpoint_fingerprint=_endpoint_fingerprint(row.endpoint),
        user_agent=row.user_agent,
        last_error=row.last_error,
        created_at=row.created_at,
        updated_at=row.updated_at,
        last_seen_at=row.last_seen_at,
    )


def _to_admin_device_invite_detail_read(
    row: AdminDeviceInvite,
    *,
    now_utc: datetime,
) -> AdminDeviceInviteDetailRead:
    status_value: Literal["PENDING", "USED", "EXPIRED"]
    if row.is_used:
        status_value = "USED"
    elif row.expires_at <= now_utc:
        status_value = "EXPIRED"
    else:
        status_value = "PENDING"

    return AdminDeviceInviteDetailRead(
        id=row.id,
        status=status_value,
        expires_at=row.expires_at,
        is_used=row.is_used,
        attempt_count=int(row.attempt_count or 0),
        max_attempts=int(row.max_attempts or 0),
        created_by_admin_user_id=row.created_by_admin_user_id,
        created_by_username=row.created_by_username,
        used_by_admin_user_id=row.used_by_admin_user_id,
        used_by_username=row.used_by_username,
        created_at=row.created_at,
        used_at=row.used_at,
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


def _assert_can_manage_admin_mfa(claims: dict[str, Any], *, target_admin_user_id: int) -> None:
    if _is_super_admin(claims):
        return
    actor_admin_user_id = _as_positive_int(claims.get("admin_user_id"))
    if actor_admin_user_id is not None and actor_admin_user_id == target_admin_user_id:
        return
    raise ApiError(
        status_code=403,
        code="FORBIDDEN",
        message="Insufficient permissions.",
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


def _authenticate_admin_identity_by_password(
    db: Session,
    *,
    username: str,
    password: str,
) -> dict[str, Any] | None:
    normalized_username = username.strip()
    if not normalized_username:
        return None
    if verify_admin_credentials(normalized_username, password):
        return _build_env_admin_identity(normalized_username)

    admin_user = db.scalar(select(AdminUser).where(AdminUser.username == normalized_username))
    if admin_user is None or not admin_user.is_active:
        return None
    if not verify_password(password, admin_user.password_hash):
        return None
    return _build_admin_user_identity(admin_user)


def _normalize_extra_checkin_approval_status(
    db: Session,
    *,
    approval: AttendanceExtraCheckinApproval,
    now_utc: datetime,
) -> None:
    if approval.status in {
        EXTRA_CHECKIN_APPROVAL_STATUS_PENDING,
        EXTRA_CHECKIN_APPROVAL_STATUS_APPROVED,
    } and approval.expires_at < now_utc:
        approval.status = EXTRA_CHECKIN_APPROVAL_STATUS_EXPIRED
        db.commit()
        db.refresh(approval)


def _resolve_extra_checkin_approval_by_token(
    db: Session,
    *,
    token: str,
) -> AttendanceExtraCheckinApproval:
    normalized_token = token.strip()
    if not normalized_token:
        raise ApiError(
            status_code=422,
            code="VALIDATION_ERROR",
            message="Approval token is required.",
        )
    approval = db.scalar(
        select(AttendanceExtraCheckinApproval).where(
            AttendanceExtraCheckinApproval.approval_token == normalized_token
        )
    )
    if approval is None:
        raise ApiError(
            status_code=404,
            code="EXTRA_CHECKIN_APPROVAL_NOT_FOUND",
            message="Ek giris onay talebi bulunamadi.",
        )
    return approval


def _to_attendance_extra_checkin_approval_read(
    *,
    approval: AttendanceExtraCheckinApproval,
    employee_name: str,
) -> AdminAttendanceExtraCheckinApprovalRead:
    return AdminAttendanceExtraCheckinApprovalRead(
        approval_id=approval.id,
        employee_id=approval.employee_id,
        employee_name=employee_name,
        device_id=approval.device_id,
        local_day=approval.local_day,
        status=approval.status,
        requested_at=approval.requested_at,
        expires_at=approval.expires_at,
        approved_at=approval.approved_at,
        approved_by_username=approval.approved_by_username,
        consumed_at=approval.consumed_at,
        push_total_targets=int(approval.push_total_targets or 0),
        push_sent=int(approval.push_sent or 0),
        push_failed=int(approval.push_failed or 0),
        last_push_at=approval.last_push_at,
    )


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
    matched_admin_user: AdminUser | None = None
    is_env_admin = False

    if verify_admin_credentials(username, payload.password):
        identity = _build_env_admin_identity(username)
        is_env_admin = True
    else:
        matched_admin_user = db.scalar(select(AdminUser).where(AdminUser.username == username))
        if (
            matched_admin_user is not None
            and matched_admin_user.is_active
            and verify_password(payload.password, matched_admin_user.password_hash)
        ):
            identity = _build_admin_user_identity(matched_admin_user)

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

    raw_mfa_code = (payload.mfa_code or "").strip()
    raw_recovery_code = (payload.mfa_recovery_code or "").strip()

    if matched_admin_user is not None and is_admin_user_mfa_enabled(matched_admin_user):
        if not raw_mfa_code and not raw_recovery_code:
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
                details={"reason": "MFA_REQUIRED"},
                request_id=request_id,
            )
            raise ApiError(
                status_code=401,
                code="MFA_REQUIRED",
                message="MFA code or recovery code is required.",
            )

        mfa_ok = False
        used_recovery = False
        if raw_mfa_code:
            mfa_ok = verify_admin_user_totp_code(matched_admin_user, raw_mfa_code)
        if not mfa_ok and raw_recovery_code:
            mfa_ok = consume_admin_user_recovery_code(
                db,
                admin_user=matched_admin_user,
                recovery_code=raw_recovery_code,
            )
            used_recovery = mfa_ok
        if not mfa_ok:
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
                details={"reason": "INVALID_MFA_CODE"},
                request_id=request_id,
            )
            raise ApiError(
                status_code=401,
                code="INVALID_MFA_CODE",
                message="MFA code is invalid.",
            )

        if used_recovery:
            log_audit(
                db,
                actor_type=AuditActorType.SYSTEM,
                actor_id=username,
                action="ADMIN_MFA_RECOVERY_CODE_USED",
                success=True,
                ip=ip,
                user_agent=user_agent,
                details={"admin_user_id": matched_admin_user.id},
                request_id=request_id,
            )

    elif is_env_admin and is_admin_mfa_enabled():
        if not raw_mfa_code:
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
                details={"reason": "MFA_REQUIRED"},
                request_id=request_id,
            )
            raise ApiError(
                status_code=401,
                code="MFA_REQUIRED",
                message="MFA code is required.",
            )
        if not verify_admin_totp_code(raw_mfa_code):
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
                details={"reason": "INVALID_MFA_CODE"},
                request_id=request_id,
            )
            raise ApiError(
                status_code=401,
                code="INVALID_MFA_CODE",
                message="MFA code is invalid.",
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
            "mfa_legacy_enabled": is_admin_mfa_enabled(),
            "mfa_user_enabled": bool(matched_admin_user and is_admin_user_mfa_enabled(matched_admin_user)),
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
        admin_user_id=_as_positive_int(claims.get("admin_user_id")),
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
    if not rows:
        return []

    username_to_id = {item.username.casefold(): item.id for item in rows}
    count_by_user_id: dict[int, dict[str, int]] = {
        item.id: {"total": 0, "active": 0} for item in rows
    }

    subscription_rows = list(db.scalars(select(AdminPushSubscription)).all())
    for subscription in subscription_rows:
        sub_admin_user_id = subscription.admin_user_id
        sub_admin_username = subscription.admin_username
        sub_is_active = subscription.is_active
        matched_user_ids: set[int] = set()
        if isinstance(sub_admin_user_id, int) and sub_admin_user_id in count_by_user_id:
            matched_user_ids.add(sub_admin_user_id)

        username_key = (sub_admin_username or "").strip().casefold()
        mapped_user_id = username_to_id.get(username_key)
        if mapped_user_id is not None:
            matched_user_ids.add(mapped_user_id)

        for matched_user_id in matched_user_ids:
            counters = count_by_user_id[matched_user_id]
            counters["total"] += 1
            if bool(sub_is_active):
                counters["active"] += 1

    return [
        _to_admin_user_read(
            item,
            claim_total=count_by_user_id[item.id]["total"],
            claim_active_total=count_by_user_id[item.id]["active"],
        )
        for item in rows
    ]


@router.get(
    "/api/admin/admin-users/{admin_user_id}/claim-detail",
    response_model=AdminUserClaimDetailResponse,
    dependencies=[Depends(require_admin_permission("admin_users"))],
)
def get_admin_user_claim_detail(
    admin_user_id: int,
    request: Request,
    claims: dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AdminUserClaimDetailResponse:
    admin_user = db.get(AdminUser, admin_user_id)
    if admin_user is None:
        raise HTTPException(status_code=404, detail="Admin user not found")

    claim_rows = list(
        db.scalars(
            select(AdminPushSubscription)
            .where(
                or_(
                    AdminPushSubscription.admin_user_id == admin_user.id,
                    AdminPushSubscription.admin_username.ilike(admin_user.username),
                )
            )
            .order_by(
                AdminPushSubscription.is_active.desc(),
                AdminPushSubscription.last_seen_at.desc(),
                AdminPushSubscription.id.desc(),
            )
            .limit(200)
        ).all()
    )
    active_claim_total = sum(1 for row in claim_rows if bool(row.is_active))
    inactive_claim_total = len(claim_rows) - active_claim_total
    now_utc = datetime.now(timezone.utc)

    created_invites = list(
        db.scalars(
            select(AdminDeviceInvite)
            .where(
                or_(
                    AdminDeviceInvite.created_by_admin_user_id == admin_user.id,
                    AdminDeviceInvite.created_by_username.ilike(admin_user.username),
                )
            )
            .order_by(AdminDeviceInvite.id.desc())
            .limit(30)
        ).all()
    )
    used_invites = list(
        db.scalars(
            select(AdminDeviceInvite)
            .where(
                or_(
                    AdminDeviceInvite.used_by_admin_user_id == admin_user.id,
                    AdminDeviceInvite.used_by_username.ilike(admin_user.username),
                )
            )
            .order_by(AdminDeviceInvite.id.desc())
            .limit(30)
        ).all()
    )

    actor_id = str(claims.get("username") or claims.get("sub") or "admin")
    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=actor_id,
        action="ADMIN_USER_CLAIM_DETAIL_VIEWED",
        success=True,
        entity_type="admin_user",
        entity_id=str(admin_user.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "username": admin_user.username,
            "claim_total": len(claim_rows),
            "claim_active_total": active_claim_total,
            "claim_inactive_total": inactive_claim_total,
            "created_invites_total": len(created_invites),
            "used_invites_total": len(used_invites),
        },
        request_id=getattr(request.state, "request_id", None),
    )

    return AdminUserClaimDetailResponse(
        admin_user=_to_admin_user_read(
            admin_user,
            claim_total=len(claim_rows),
            claim_active_total=active_claim_total,
        ),
        claim_total=len(claim_rows),
        claim_active_total=active_claim_total,
        claim_inactive_total=inactive_claim_total,
        claims=[_to_admin_push_claim_detail_read(row) for row in claim_rows],
        created_invites=[
            _to_admin_device_invite_detail_read(item, now_utc=now_utc)
            for item in created_invites
        ],
        used_invites=[
            _to_admin_device_invite_detail_read(item, now_utc=now_utc)
            for item in used_invites
        ],
    )


@router.patch(
    "/api/admin/admin-users/{admin_user_id}/claims/{claim_id}/active",
    response_model=AdminPushClaimDetailRead,
    dependencies=[Depends(require_admin_permission("admin_users", write=True))],
)
def update_admin_user_claim_active_status(
    admin_user_id: int,
    claim_id: int,
    payload: AdminPushClaimActiveUpdateRequest,
    request: Request,
    claims: dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AdminPushClaimDetailRead:
    _assert_super_admin(claims)

    admin_user = db.get(AdminUser, admin_user_id)
    if admin_user is None:
        raise HTTPException(status_code=404, detail="Admin user not found")

    claim_row = db.get(AdminPushSubscription, claim_id)
    if claim_row is None:
        raise HTTPException(status_code=404, detail="Admin push claim not found")

    username_matches = (
        (claim_row.admin_username or "").strip().casefold()
        == (admin_user.username or "").strip().casefold()
    )
    if claim_row.admin_user_id != admin_user.id and not username_matches:
        raise HTTPException(status_code=404, detail="Claim does not belong to selected admin user")

    previous_state = bool(claim_row.is_active)
    if payload.is_active:
        test_result = send_test_push_to_admin_subscription(
            db,
            subscription=claim_row,
            title="Admin Claim Aktivasyon Testi",
            body="Bu claim aktif edilmeden once test edildi.",
            data={
                "type": "ADMIN_CLAIM_ACTIVATION_TEST",
                "silent": True,
                "url": "/admin-panel/admin-users",
            },
        )
        if not bool(test_result.get("ok")):
            status_code_value = test_result.get("status_code")
            if status_code_value in {404, 410}:
                raise ApiError(
                    status_code=409,
                    code="ADMIN_CLAIM_RECLAIM_REQUIRED",
                    message="Bu claim aboneligi suresi dolmus/iptal edilmis. Cihazdan yeniden claim yapin.",
                )
            raise ApiError(
                status_code=409,
                code="ADMIN_CLAIM_TEST_FAILED",
                message=f"Claim test bildirimi basarisiz: {test_result.get('error') or 'unknown_error'}",
            )

    if previous_state != payload.is_active:
        claim_row.is_active = payload.is_active
        db.commit()
        db.refresh(claim_row)

    actor_id = str(claims.get("username") or claims.get("sub") or "admin")
    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=actor_id,
        action="ADMIN_PUSH_CLAIM_STATUS_UPDATED",
        success=True,
        entity_type="admin_push_subscription",
        entity_id=str(claim_row.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "admin_user_id": admin_user.id,
            "admin_username": admin_user.username,
            "claim_id": claim_row.id,
            "endpoint_fingerprint": _endpoint_fingerprint(claim_row.endpoint),
            "previous_is_active": previous_state,
            "next_is_active": bool(payload.is_active),
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return _to_admin_push_claim_detail_read(claim_row)


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


@router.get(
    "/api/admin/admin-users/{admin_user_id}/mfa",
    response_model=AdminUserMfaStatusResponse,
)
def get_admin_user_mfa(
    admin_user_id: int,
    claims: dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AdminUserMfaStatusResponse:
    _assert_can_manage_admin_mfa(claims, target_admin_user_id=admin_user_id)
    admin_user = db.get(AdminUser, admin_user_id)
    if admin_user is None:
        raise HTTPException(status_code=404, detail="Admin user not found")
    if admin_user.username == settings.admin_user:
        raise HTTPException(status_code=409, detail="Reserved admin MFA is env-managed")
    return AdminUserMfaStatusResponse(**get_admin_user_mfa_status(db, admin_user=admin_user))


@router.post(
    "/api/admin/admin-users/{admin_user_id}/mfa/setup/start",
    response_model=AdminUserMfaSetupStartResponse,
)
def start_admin_user_mfa(
    admin_user_id: int,
    request: Request,
    claims: dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AdminUserMfaSetupStartResponse:
    _assert_can_manage_admin_mfa(claims, target_admin_user_id=admin_user_id)
    admin_user = db.get(AdminUser, admin_user_id)
    if admin_user is None:
        raise HTTPException(status_code=404, detail="Admin user not found")
    if admin_user.username == settings.admin_user:
        raise HTTPException(status_code=409, detail="Reserved admin MFA is env-managed")
    if not admin_user.is_active:
        raise HTTPException(status_code=409, detail="Inactive admin user cannot setup MFA")

    setup_payload = start_admin_user_mfa_setup(db, admin_user=admin_user)
    db.commit()
    db.refresh(admin_user)

    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=str(claims.get("username") or claims.get("sub") or "admin"),
        action="ADMIN_USER_MFA_SETUP_STARTED",
        success=True,
        entity_type="admin_user",
        entity_id=str(admin_user.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "username": admin_user.username,
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return AdminUserMfaSetupStartResponse(
        admin_user_id=admin_user.id,
        username=admin_user.username,
        issuer=setup_payload["issuer"],
        secret_key=setup_payload["secret_key"],
        otpauth_uri=setup_payload["otpauth_uri"],
    )


@router.post(
    "/api/admin/admin-users/{admin_user_id}/mfa/setup/confirm",
    response_model=AdminUserMfaSetupConfirmResponse,
)
def confirm_admin_user_mfa(
    admin_user_id: int,
    payload: AdminUserMfaSetupConfirmRequest,
    request: Request,
    claims: dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AdminUserMfaSetupConfirmResponse:
    _assert_can_manage_admin_mfa(claims, target_admin_user_id=admin_user_id)
    admin_user = db.get(AdminUser, admin_user_id)
    if admin_user is None:
        raise HTTPException(status_code=404, detail="Admin user not found")
    if admin_user.username == settings.admin_user:
        raise HTTPException(status_code=409, detail="Reserved admin MFA is env-managed")
    if not (admin_user.mfa_secret_enc or "").strip():
        raise ApiError(
            status_code=409,
            code="MFA_SETUP_NOT_STARTED",
            message="MFA setup is not started.",
        )
    if not verify_admin_user_totp_code(admin_user, payload.code):
        raise ApiError(
            status_code=401,
            code="INVALID_MFA_CODE",
            message="MFA code is invalid.",
        )

    admin_user.mfa_enabled = True
    recovery_codes, recovery_expires_at = issue_admin_user_recovery_codes(db, admin_user=admin_user)
    db.commit()
    db.refresh(admin_user)

    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=str(claims.get("username") or claims.get("sub") or "admin"),
        action="ADMIN_USER_MFA_ENABLED",
        success=True,
        entity_type="admin_user",
        entity_id=str(admin_user.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "username": admin_user.username,
            "recovery_code_count": len(recovery_codes),
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return AdminUserMfaSetupConfirmResponse(
        ok=True,
        mfa_enabled=True,
        recovery_codes=recovery_codes,
        recovery_code_expires_at=recovery_expires_at,
    )


@router.post(
    "/api/admin/admin-users/{admin_user_id}/mfa/recovery-codes/regenerate",
    response_model=AdminUserMfaRecoveryRegenerateResponse,
)
def regenerate_admin_user_mfa_recovery_codes(
    admin_user_id: int,
    payload: AdminUserMfaRecoveryRegenerateRequest,
    request: Request,
    claims: dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AdminUserMfaRecoveryRegenerateResponse:
    _assert_can_manage_admin_mfa(claims, target_admin_user_id=admin_user_id)
    _verify_current_admin_password(db, claims=claims, password=payload.current_password)
    admin_user = db.get(AdminUser, admin_user_id)
    if admin_user is None:
        raise HTTPException(status_code=404, detail="Admin user not found")
    if admin_user.username == settings.admin_user:
        raise HTTPException(status_code=409, detail="Reserved admin MFA is env-managed")
    if not is_admin_user_mfa_enabled(admin_user):
        raise ApiError(
            status_code=409,
            code="MFA_NOT_ENABLED",
            message="MFA is not enabled for this user.",
        )

    recovery_codes, recovery_expires_at = issue_admin_user_recovery_codes(db, admin_user=admin_user)
    db.commit()
    db.refresh(admin_user)

    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=str(claims.get("username") or claims.get("sub") or "admin"),
        action="ADMIN_USER_MFA_RECOVERY_REGENERATED",
        success=True,
        entity_type="admin_user",
        entity_id=str(admin_user.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "username": admin_user.username,
            "recovery_code_count": len(recovery_codes),
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return AdminUserMfaRecoveryRegenerateResponse(
        ok=True,
        recovery_codes=recovery_codes,
        recovery_code_expires_at=recovery_expires_at,
    )


@router.post(
    "/api/admin/admin-users/{admin_user_id}/mfa/reset",
    response_model=SoftDeleteResponse,
)
def reset_admin_user_mfa_endpoint(
    admin_user_id: int,
    payload: AdminUserMfaRecoveryRegenerateRequest,
    request: Request,
    claims: dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db),
) -> SoftDeleteResponse:
    _assert_can_manage_admin_mfa(claims, target_admin_user_id=admin_user_id)
    _verify_current_admin_password(db, claims=claims, password=payload.current_password)
    admin_user = db.get(AdminUser, admin_user_id)
    if admin_user is None:
        raise HTTPException(status_code=404, detail="Admin user not found")
    if admin_user.username == settings.admin_user:
        raise HTTPException(status_code=409, detail="Reserved admin MFA is env-managed")

    reset_admin_user_mfa(db, admin_user=admin_user)
    db.commit()
    db.refresh(admin_user)

    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=str(claims.get("username") or claims.get("sub") or "admin"),
        action="ADMIN_USER_MFA_RESET",
        success=True,
        entity_type="admin_user",
        entity_id=str(admin_user.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "username": admin_user.username,
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return SoftDeleteResponse(ok=True)


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

    location_event_filters = (
        AttendanceEvent.employee_id == employee_id,
        AttendanceEvent.deleted_at.is_(None),
        AttendanceEvent.lat.is_not(None),
        AttendanceEvent.lon.is_not(None),
    )

    recent_location_events = list(
        db.scalars(
            select(AttendanceEvent)
            .where(*location_event_filters)
            .order_by(AttendanceEvent.ts_utc.desc(), AttendanceEvent.id.desc())
            .limit(20)
        ).all()
    )
    latest_location_event = recent_location_events[0] if recent_location_events else None
    first_location_event = db.scalar(
        select(AttendanceEvent)
        .where(*location_event_filters)
        .order_by(AttendanceEvent.ts_utc.asc(), AttendanceEvent.id.asc())
        .limit(1)
    )

    def _to_live_location(event: AttendanceEvent | None) -> EmployeeLiveLocationRead | None:
        if event is None or event.lat is None or event.lon is None:
            return None
        return EmployeeLiveLocationRead(
            lat=event.lat,
            lon=event.lon,
            accuracy_m=event.accuracy_m,
            ts_utc=event.ts_utc,
            location_status=event.location_status,
            event_type=event.type,
            device_id=event.device_id,
        )

    latest_location = _to_live_location(latest_location_event)
    first_location = _to_live_location(first_location_event)
    recent_locations = [
        EmployeeLiveLocationRead(
            lat=event_item.lat if event_item.lat is not None else 0.0,
            lon=event_item.lon if event_item.lon is not None else 0.0,
            accuracy_m=event_item.accuracy_m,
            ts_utc=event_item.ts_utc,
            location_status=event_item.location_status,
            event_type=event_item.type,
            device_id=event_item.device_id,
        )
        for event_item in recent_location_events
        if event_item.lat is not None and event_item.lon is not None
    ]

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
        first_location=first_location,
        recent_locations=recent_locations,
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
    selected_by = "employee_id"
    if payload.employee_id is not None:
        employee = db.get(Employee, payload.employee_id)
    else:
        selected_by = "employee_name"
        employee = _resolve_employee_by_name(db, payload.employee_name or "")
    if employee is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    if not employee.is_active:
        raise HTTPException(status_code=409, detail="Inactive employee cannot receive invites")

    now_utc = datetime.now(timezone.utc)
    max_ttl_minutes = max(1, int(settings.device_invite_max_ttl_minutes or 1))
    if payload.expires_in_minutes > max_ttl_minutes:
        raise ApiError(
            status_code=422,
            code="INVITE_TTL_TOO_LONG",
            message=f"Invite ttl cannot exceed {max_ttl_minutes} minutes.",
        )
    max_attempts = max(1, int(settings.device_invite_max_attempts or 1))
    token = secrets.token_urlsafe(32)
    invite = DeviceInvite(
        employee_id=employee.id,
        token=token,
        expires_at=now_utc + timedelta(minutes=payload.expires_in_minutes),
        is_used=False,
        max_attempts=max_attempts,
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
        details={
            "employee_id": employee.id,
            "employee_name": employee.full_name,
            "selected_by": selected_by,
            "expires_in_minutes": payload.expires_in_minutes,
            "max_attempts": max_attempts,
        },
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
    request: Request,
    employee_id: int | None = Query(default=None, ge=1),
    region_id: int | None = Query(default=None, ge=1),
    include_inactive: bool = Query(default=True),
    include_recovery_secrets: bool = Query(default=False),
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
        device_rows: list[EmployeeDeviceOverviewDevice] = []
        for device in limited_devices:
            recovery_snapshot = (
                get_admin_recovery_snapshot(db, device=device)
                if include_recovery_secrets
                else None
            )
            device_rows.append(
                EmployeeDeviceOverviewDevice(
                    id=device.id,
                    device_fingerprint=device.device_fingerprint,
                    is_active=device.is_active,
                    created_at=device.created_at,
                    recovery_ready=(
                        recovery_snapshot["recovery_ready"]
                        if recovery_snapshot is not None
                        else False
                    ),
                    recovery_code_active_count=(
                        recovery_snapshot["recovery_code_active_count"]
                        if recovery_snapshot is not None
                        else 0
                    ),
                    recovery_expires_at=(
                        recovery_snapshot["recovery_expires_at"]
                        if recovery_snapshot is not None
                        else None
                    ),
                    recovery_pin_updated_at=(
                        recovery_snapshot["recovery_pin_updated_at"]
                        if recovery_snapshot is not None
                        else None
                    ),
                    recovery_pin_plain=(
                        recovery_snapshot["recovery_pin_plain"]
                        if recovery_snapshot is not None
                        else None
                    ),
                    recovery_code_entries=(
                        recovery_snapshot["recovery_code_entries"]
                        if recovery_snapshot is not None
                        else []
                    ),
                )
            )

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

    if include_recovery_secrets and request is not None:
        log_audit(
            db,
            actor_type=AuditActorType.ADMIN,
            actor_id=str(getattr(request.state, "actor_id", "admin")),
            action="DEVICE_RECOVERY_SECRETS_VIEWED",
            success=True,
            entity_type="employee",
            entity_id=str(employee_id) if employee_id is not None else None,
            ip=_client_ip(request),
            user_agent=_user_agent(request),
            details={
                "employee_id": employee_id,
                "region_id": region_id,
                "offset": offset,
                "limit": limit,
                "device_limit": device_limit,
            },
            request_id=getattr(request.state, "request_id", None),
        )
    return rows


def _dashboard_month_metrics_from_report(report: MonthlyEmployeeResponse) -> DashboardEmployeeMonthMetricsRead:
    return DashboardEmployeeMonthMetricsRead(
        year=report.year,
        month=report.month,
        worked_minutes=report.totals.worked_minutes,
        plan_overtime_minutes=report.totals.plan_overtime_minutes,
        extra_work_minutes=report.totals.legal_extra_work_minutes,
        overtime_minutes=report.totals.legal_overtime_minutes,
        incomplete_days=report.totals.incomplete_days,
    )


def _today_status_from_events(
    today_events: list[AttendanceEvent],
) -> Literal["NOT_STARTED", "IN_PROGRESS", "FINISHED"]:
    today_last_in: datetime | None = None
    today_last_out: datetime | None = None
    for event in today_events:
        if event.type == AttendanceType.IN:
            today_last_in = event.ts_utc
        elif event.type == AttendanceType.OUT:
            today_last_out = event.ts_utc

    if today_last_in is None and today_last_out is None:
        return "NOT_STARTED"
    if today_last_in is not None and (today_last_out is None or today_last_out < today_last_in):
        return "IN_PROGRESS"
    return "FINISHED"


def _attendance_event_to_dashboard_last_event(
    event: AttendanceEvent | None,
) -> DashboardEmployeeLastEventRead | None:
    if event is None:
        return None
    return DashboardEmployeeLastEventRead(
        event_id=event.id,
        event_type=event.type,
        ts_utc=event.ts_utc,
        location_status=event.location_status,
        device_id=event.device_id,
        lat=event.lat,
        lon=event.lon,
        accuracy_m=event.accuracy_m,
    )


def _attendance_event_to_live_location(
    event: AttendanceEvent | None,
) -> EmployeeLiveLocationRead | None:
    if event is None or event.lat is None or event.lon is None:
        return None
    return EmployeeLiveLocationRead(
        lat=event.lat,
        lon=event.lon,
        accuracy_m=event.accuracy_m,
        ts_utc=event.ts_utc,
        location_status=event.location_status,
        event_type=event.type,
        device_id=event.device_id,
    )


def _control_room_location_state(
    latest_location_event: AttendanceEvent | None,
    *,
    now_utc: datetime,
) -> Literal["LIVE", "STALE", "DORMANT", "NONE"]:
    if latest_location_event is None or latest_location_event.lat is None or latest_location_event.lon is None:
        return "NONE"
    location_ts = _as_utc_datetime(latest_location_event.ts_utc)
    if location_ts is None:
        return "NONE"
    age = now_utc - location_ts
    if age <= timedelta(minutes=30):
        return "LIVE"
    if age <= timedelta(hours=6):
        return "STALE"
    return "DORMANT"


def _control_room_attention_flags(
    *,
    employee: Employee,
    today_status: Literal["NOT_STARTED", "IN_PROGRESS", "FINISHED"],
    today_events: list[AttendanceEvent],
    last_event: AttendanceEvent | None,
    latest_location_event: AttendanceEvent | None,
    active_devices: int,
    total_devices: int,
    now_utc: datetime,
    now_local: datetime,
) -> list[ControlRoomEmployeeAlertRead]:
    flags: list[ControlRoomEmployeeAlertRead] = []
    seen_codes: set[str] = set()

    def push_alert(code: str, label: str, severity: Literal["info", "warning", "critical"]) -> None:
        if code in seen_codes:
            return
        seen_codes.add(code)
        flags.append(ControlRoomEmployeeAlertRead(code=code, label=label, severity=severity))

    if total_devices == 0:
        push_alert("NO_DEVICE", "Kayıtlı cihaz yok", "critical")
    elif active_devices == 0:
        push_alert("NO_ACTIVE_DEVICE", "Aktif cihaz görünmüyor", "warning")

    if today_status == "NOT_STARTED" and employee.is_active and now_local.hour >= 10:
        push_alert("MISSING_TODAY_CHECKIN", "Bugün giriş görünmüyor", "warning")

    if today_status == "IN_PROGRESS" and last_event is not None:
        last_event_ts = _as_utc_datetime(last_event.ts_utc)
        if last_event_ts is not None:
            last_event_age = now_utc - last_event_ts
            if last_event.type == AttendanceType.IN and last_event_age >= timedelta(hours=10):
                push_alert("LONG_OPEN_SHIFT", "Açık vardiya 10 saati aştı", "critical")
        if latest_location_event is None:
            push_alert("IN_PROGRESS_NO_LOCATION", "Açık vardiyada güncel konum yok", "warning")

    if latest_location_event is not None and latest_location_event.location_status == LocationStatus.UNVERIFIED_LOCATION:
        push_alert("UNVERIFIED_LOCATION", "Son konum doğrulanamadı", "warning")

    has_today_in = any(item.type == AttendanceType.IN for item in today_events)
    has_today_out = any(item.type == AttendanceType.OUT for item in today_events)
    if has_today_out and not has_today_in:
        push_alert("MISSING_CHECKIN_PATTERN", "Çıkış var, giriş görünmüyor", "critical")

    if any(bool(item.flags) for item in today_events):
        push_alert("RULE_OR_EVENT_FLAG", "Gün içinde kural veya olay uyarısı oluştu", "info")

    return flags


@router.get(
    "/api/admin/dashboard/employee-snapshot",
    response_model=DashboardEmployeeSnapshotRead,
    dependencies=[Depends(require_admin_permission("reports"))],
)
def get_dashboard_employee_snapshot(
    employee_id: int | None = Query(default=None, ge=1),
    employee_name: str | None = Query(default=None, min_length=2, max_length=255),
    db: Session = Depends(get_db),
) -> DashboardEmployeeSnapshotRead:
    if employee_id is None and not _normalize_query_text(employee_name):
        raise ApiError(
            status_code=422,
            code="VALIDATION_ERROR",
            message="employee_id or employee_name is required.",
        )
    if employee_id is not None and _normalize_query_text(employee_name):
        raise ApiError(
            status_code=422,
            code="VALIDATION_ERROR",
            message="Provide employee_id or employee_name, not both.",
        )

    selected_employee_id: int
    if employee_id is not None:
        selected_employee_id = employee_id
    else:
        selected_employee = _resolve_employee_by_name(db, employee_name or "")
        selected_employee_id = selected_employee.id

    employee = db.scalar(
        select(Employee)
        .options(
            selectinload(Employee.region),
            selectinload(Employee.department),
            selectinload(Employee.devices),
        )
        .where(Employee.id == selected_employee_id)
    )
    if employee is None:
        raise HTTPException(status_code=404, detail="Employee not found")

    now_utc = datetime.now(timezone.utc)
    tz = _attendance_timezone()
    now_local = now_utc.astimezone(tz)
    current_year = now_local.year
    current_month = now_local.month
    if current_month == 1:
        previous_year = current_year - 1
        previous_month = 12
    else:
        previous_year = current_year
        previous_month = current_month - 1

    current_report = calculate_employee_monthly(
        db,
        employee_id=employee.id,
        year=current_year,
        month=current_month,
    )
    previous_report = calculate_employee_monthly(
        db,
        employee_id=employee.id,
        year=previous_year,
        month=previous_month,
    )

    today_local = now_local.date()
    today_start_local = datetime.combine(today_local, time.min, tzinfo=tz)
    today_end_local = today_start_local + timedelta(days=1)
    today_start_utc = today_start_local.astimezone(timezone.utc)
    today_end_utc = today_end_local.astimezone(timezone.utc)

    today_events = list(
        db.scalars(
            select(AttendanceEvent)
            .where(
                AttendanceEvent.employee_id == employee.id,
                AttendanceEvent.deleted_at.is_(None),
                AttendanceEvent.ts_utc >= today_start_utc,
                AttendanceEvent.ts_utc < today_end_utc,
            )
            .order_by(AttendanceEvent.ts_utc.asc(), AttendanceEvent.id.asc())
        ).all()
    )
    today_status = _today_status_from_events(today_events)

    last_event = db.scalar(
        select(AttendanceEvent)
        .where(
            AttendanceEvent.employee_id == employee.id,
            AttendanceEvent.deleted_at.is_(None),
        )
        .order_by(AttendanceEvent.ts_utc.desc(), AttendanceEvent.id.desc())
        .limit(1)
    )
    latest_location_event = db.scalar(
        select(AttendanceEvent)
        .where(
            AttendanceEvent.employee_id == employee.id,
            AttendanceEvent.deleted_at.is_(None),
            AttendanceEvent.lat.is_not(None),
            AttendanceEvent.lon.is_not(None),
        )
            .order_by(AttendanceEvent.ts_utc.desc(), AttendanceEvent.id.desc())
            .limit(1)
    )
    latest_location = _attendance_event_to_live_location(latest_location_event)

    sorted_devices = sorted(
        list(employee.devices or []),
        key=lambda item: (item.created_at, item.id),
        reverse=True,
    )
    device_rows: list[EmployeeDeviceDetailRead] = []
    for device in sorted_devices:
        last_device_event = db.scalar(
            select(AttendanceEvent)
            .where(
                AttendanceEvent.device_id == device.id,
                AttendanceEvent.deleted_at.is_(None),
            )
            .order_by(AttendanceEvent.ts_utc.desc(), AttendanceEvent.id.desc())
            .limit(1)
        )
        device_rows.append(
            EmployeeDeviceDetailRead(
                id=device.id,
                device_fingerprint=device.device_fingerprint,
                is_active=device.is_active,
                created_at=device.created_at,
                last_attendance_ts_utc=last_device_event.ts_utc if last_device_event is not None else None,
                last_seen_ip=None,
                last_seen_action=None,
                last_seen_at_utc=None,
            )
        )

    return DashboardEmployeeSnapshotRead(
        employee=_to_employee_read(employee),
        today_status=today_status,
        total_devices=len(sorted_devices),
        active_devices=sum(1 for item in sorted_devices if item.is_active),
        devices=device_rows,
        current_month=_dashboard_month_metrics_from_report(current_report),
        previous_month=_dashboard_month_metrics_from_report(previous_report),
        last_event=_attendance_event_to_dashboard_last_event(last_event),
        latest_location=latest_location,
        generated_at_utc=now_utc,
    )


@router.get(
    "/api/admin/control-room/overview",
    response_model=ControlRoomOverviewResponse,
    dependencies=[Depends(require_admin)],
)
def get_control_room_overview(
    q: str | None = Query(default=None, max_length=255),
    region_id: int | None = Query(default=None, ge=1),
    department_id: int | None = Query(default=None, ge=1),
    today_status: Literal["NOT_STARTED", "IN_PROGRESS", "FINISHED"] | None = Query(default=None),
    location_state: Literal["LIVE", "STALE", "DORMANT", "NONE"] | None = Query(default=None),
    map_date: date | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    include_inactive: bool = Query(default=False),
    risk_min: int | None = Query(default=None, ge=0, le=100),
    risk_max: int | None = Query(default=None, ge=0, le=100),
    risk_status: Literal["NORMAL", "WATCH", "CRITICAL"] | None = Query(default=None),
    sort_by: str = Query(default="risk_score"),
    sort_dir: Literal["asc", "desc"] = Query(default="desc"),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=24, ge=1, le=100),
    db: Session = Depends(get_db),
) -> ControlRoomOverviewResponse:
    return build_control_room_overview(
        db,
        q=q,
        region_id=region_id,
        department_id=department_id,
        today_status=today_status,
        location_state=location_state,
        map_date=map_date,
        start_date=start_date,
        end_date=end_date,
        include_inactive=include_inactive,
        risk_min=risk_min,
        risk_max=risk_max,
        risk_status=risk_status,
        sort_by=sort_by,
        sort_dir=sort_dir,
        offset=offset,
        limit=limit,
    )


@router.get(
    "/api/admin/control-room/employees/{employee_id}",
    response_model=ControlRoomEmployeeDetailResponse,
    dependencies=[Depends(require_admin)],
)
def get_control_room_employee_detail(
    employee_id: int,
    db: Session = Depends(get_db),
) -> ControlRoomEmployeeDetailResponse:
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    return build_control_room_employee_detail(db, employee_id=employee_id)


@router.post(
    "/api/admin/control-room/actions",
    response_model=ControlRoomMutationResponse,
)
def create_control_room_employee_action(
    payload: ControlRoomEmployeeActionRequest,
    request: Request,
    claims: dict[str, Any] = Depends(require_admin_permission("audit", write=True)),
    db: Session = Depends(get_db),
) -> ControlRoomMutationResponse:
    employee = db.get(Employee, payload.employee_id)
    if employee is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    actor_id, actor_admin_user_id = _normalized_admin_actor_from_claims(claims)
    expires_at = None if payload.indefinite else datetime.now(timezone.utc) + timedelta(days=int(payload.duration_days or 0))
    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=actor_id,
        action=CONTROL_ROOM_ACTION_AUDIT,
        success=True,
        entity_type="employee",
        entity_id=str(employee.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "action_type": payload.action_type,
            "action_label": {
                "SUSPEND": "Askiya Al",
                "DISABLE_TEMP": "Gecici Devre Disi",
                "REVIEW": "Incelemeye Al",
            }[payload.action_type],
            "reason": payload.reason,
            "note": payload.note,
            "duration_days": payload.duration_days,
            "indefinite": payload.indefinite,
            "expires_at": expires_at.isoformat() if expires_at is not None else None,
            "actor_admin_user_id": actor_admin_user_id,
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return ControlRoomMutationResponse(ok=True, message="Kontrol islemi kaydedildi.", expires_at=expires_at)


@router.post(
    "/api/admin/control-room/risk-override",
    response_model=ControlRoomMutationResponse,
)
def create_control_room_risk_override(
    payload: ControlRoomRiskOverrideRequest,
    request: Request,
    claims: dict[str, Any] = Depends(require_admin_permission("audit", write=True)),
    db: Session = Depends(get_db),
) -> ControlRoomMutationResponse:
    employee = db.get(Employee, payload.employee_id)
    if employee is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    actor_id, actor_admin_user_id = _normalized_admin_actor_from_claims(claims)
    expires_at = None if payload.indefinite else datetime.now(timezone.utc) + timedelta(days=int(payload.duration_days or 0))
    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=actor_id,
        action=CONTROL_ROOM_OVERRIDE_AUDIT,
        success=True,
        entity_type="employee",
        entity_id=str(employee.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "action_type": "RISK_OVERRIDE",
            "action_label": "Risk Override",
            "reason": payload.reason,
            "note": payload.note,
            "override_score": payload.override_score,
            "duration_days": payload.duration_days,
            "indefinite": payload.indefinite,
            "expires_at": expires_at.isoformat() if expires_at is not None else None,
            "actor_admin_user_id": actor_admin_user_id,
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return ControlRoomMutationResponse(ok=True, message="Risk override kaydedildi.", expires_at=expires_at)


@router.post(
    "/api/admin/control-room/notes",
    response_model=ControlRoomMutationResponse,
)
def create_control_room_note(
    payload: ControlRoomNoteCreateRequest,
    request: Request,
    claims: dict[str, Any] = Depends(require_admin_permission("audit", write=True)),
    db: Session = Depends(get_db),
) -> ControlRoomMutationResponse:
    employee = db.get(Employee, payload.employee_id)
    if employee is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    actor_id, actor_admin_user_id = _normalized_admin_actor_from_claims(claims)
    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=actor_id,
        action=CONTROL_ROOM_NOTE_AUDIT,
        success=True,
        entity_type="employee",
        entity_id=str(employee.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "note": payload.note,
            "actor_admin_user_id": actor_admin_user_id,
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return ControlRoomMutationResponse(ok=True, message="Not kaydedildi.", expires_at=None)


@router.post(
    "/api/admin/control-room/filter-activity",
    response_model=ControlRoomMutationResponse,
)
def create_control_room_filter_activity(
    payload: ControlRoomFilterAuditRequest,
    request: Request,
    claims: dict[str, Any] = Depends(require_admin_permission("audit", write=True)),
    db: Session = Depends(get_db),
) -> ControlRoomMutationResponse:
    actor_id, actor_admin_user_id = _normalized_admin_actor_from_claims(claims)
    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=actor_id,
        action="CONTROL_ROOM_FILTER_APPLIED",
        success=True,
        entity_type="control_room",
        entity_id=None,
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "filters": payload.filters,
            "total_results": payload.total_results,
            "actor_admin_user_id": actor_admin_user_id,
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return ControlRoomMutationResponse(ok=True, message="Filtre aktivitesi kaydedildi.", expires_at=None)


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


@router.put(
    "/admin/department-weekday-shifts",
    response_model=list[DepartmentWeekdayShiftAssignmentRead],
    dependencies=[Depends(require_admin_permission("schedule", write=True))],
)
def replace_department_weekday_shift_assignments(
    payload: DepartmentWeekdayShiftAssignmentReplaceRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> list[DepartmentWeekdayShiftAssignmentRead]:
    department = db.get(Department, payload.department_id)
    if department is None:
        raise HTTPException(status_code=404, detail="Department not found")

    shift_ids = normalize_shift_ids(payload.shift_ids)
    shifts_by_id: dict[int, DepartmentShift] = {}
    if shift_ids:
        shifts = list(
            db.scalars(
                select(DepartmentShift).where(DepartmentShift.id.in_(shift_ids))
            ).all()
        )
        shifts_by_id = {shift.id: shift for shift in shifts}
        missing_shift_ids = [shift_id for shift_id in shift_ids if shift_id not in shifts_by_id]
        if missing_shift_ids:
            raise HTTPException(status_code=404, detail=f"Department shift not found: {missing_shift_ids[0]}")
        for shift_id in shift_ids:
            shift = shifts_by_id[shift_id]
            if shift.department_id != payload.department_id:
                raise HTTPException(status_code=422, detail="Shift does not belong to selected department")

    existing_rows = list(
        db.scalars(
            select(DepartmentWeekdayShiftAssignment)
            .options(selectinload(DepartmentWeekdayShiftAssignment.shift))
            .where(
                DepartmentWeekdayShiftAssignment.department_id == payload.department_id,
                DepartmentWeekdayShiftAssignment.weekday == payload.weekday,
            )
            .order_by(
                DepartmentWeekdayShiftAssignment.sort_order.asc(),
                DepartmentWeekdayShiftAssignment.id.asc(),
            )
        ).all()
    )
    existing_by_shift_id = {row.shift_id: row for row in existing_rows}
    desired_shift_ids = set(shift_ids)

    for row in existing_rows:
        if row.shift_id not in desired_shift_ids:
            db.delete(row)

    for sort_order, shift_id in enumerate(shift_ids):
        row = existing_by_shift_id.get(shift_id)
        if row is None:
            row = DepartmentWeekdayShiftAssignment(
                department_id=payload.department_id,
                weekday=payload.weekday,
                shift_id=shift_id,
                sort_order=sort_order,
                is_active=True,
            )
            db.add(row)
            continue
        row.sort_order = sort_order
        row.is_active = True

    db.commit()

    rows = list(
        db.scalars(
            select(DepartmentWeekdayShiftAssignment)
            .options(selectinload(DepartmentWeekdayShiftAssignment.shift))
            .where(
                DepartmentWeekdayShiftAssignment.department_id == payload.department_id,
                DepartmentWeekdayShiftAssignment.weekday == payload.weekday,
            )
            .order_by(
                DepartmentWeekdayShiftAssignment.sort_order.asc(),
                DepartmentWeekdayShiftAssignment.id.asc(),
            )
        ).all()
    )

    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id="admin",
        action="DEPARTMENT_WEEKDAY_SHIFT_ASSIGNMENTS_REPLACED",
        success=True,
        entity_type="department_weekday_shift_assignments",
        entity_id=f"{payload.department_id}:{payload.weekday}",
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "department_id": payload.department_id,
            "weekday": payload.weekday,
            "shift_ids": shift_ids,
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return [_to_department_weekday_shift_assignment_read(item) for item in rows]


@router.get(
    "/admin/department-weekday-shifts",
    response_model=list[DepartmentWeekdayShiftAssignmentRead],
    dependencies=[Depends(require_admin_permission("schedule"))],
)
def list_department_weekday_shift_assignments(
    department_id: int | None = Query(default=None, ge=1),
    region_id: int | None = Query(default=None, ge=1),
    weekday: int | None = Query(default=None, ge=0, le=6),
    active_only: bool = Query(default=True),
    db: Session = Depends(get_db),
) -> list[DepartmentWeekdayShiftAssignmentRead]:
    stmt = (
        select(DepartmentWeekdayShiftAssignment)
        .options(selectinload(DepartmentWeekdayShiftAssignment.shift))
        .order_by(
            DepartmentWeekdayShiftAssignment.department_id.asc(),
            DepartmentWeekdayShiftAssignment.weekday.asc(),
            DepartmentWeekdayShiftAssignment.sort_order.asc(),
            DepartmentWeekdayShiftAssignment.id.asc(),
        )
    )
    if department_id is not None:
        stmt = stmt.where(DepartmentWeekdayShiftAssignment.department_id == department_id)
    if region_id is not None:
        stmt = stmt.join(Department, Department.id == DepartmentWeekdayShiftAssignment.department_id).where(
            Department.region_id == region_id
        )
    if weekday is not None:
        stmt = stmt.where(DepartmentWeekdayShiftAssignment.weekday == weekday)
    if active_only:
        stmt = stmt.where(DepartmentWeekdayShiftAssignment.is_active.is_(True))

    rows = list(db.scalars(stmt).all())
    return [_to_department_weekday_shift_assignment_read(item) for item in rows]


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


def _to_department_weekday_shift_assignment_read(
    assignment: DepartmentWeekdayShiftAssignment,
) -> DepartmentWeekdayShiftAssignmentRead:
    shift = assignment.shift
    if shift is None:
        raise HTTPException(status_code=500, detail="Department weekday shift assignment missing shift")
    return DepartmentWeekdayShiftAssignmentRead(
        id=assignment.id,
        department_id=assignment.department_id,
        weekday=assignment.weekday,
        shift_id=assignment.shift_id,
        shift_name=shift.name,
        shift_start_time_local=_format_hhmm(shift.start_time_local),
        shift_end_time_local=_format_hhmm(shift.end_time_local),
        shift_break_minutes=shift.break_minutes,
        sort_order=assignment.sort_order,
        is_active=assignment.is_active,
        created_at=assignment.created_at,
        updated_at=assignment.updated_at,
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
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
) -> list[AttendanceEventRead]:
    stmt = (
        select(
            AttendanceEvent,
            Employee.full_name.label("employee_name"),
            Department.name.label("department_name"),
        )
        .join(Employee, Employee.id == AttendanceEvent.employee_id)
        .join(Department, Department.id == Employee.department_id, isouter=True)
        .order_by(AttendanceEvent.id.desc())
        .offset(offset)
        .limit(limit)
    )
    attendance_tz = _attendance_timezone()
    if not include_deleted:
        stmt = stmt.where(AttendanceEvent.deleted_at.is_(None))
    if employee_id is not None:
        stmt = stmt.where(AttendanceEvent.employee_id == employee_id)
    if department_id is not None:
        stmt = stmt.where(Employee.department_id == department_id)
    if region_id is not None:
        stmt = stmt.where(
            or_(
                Employee.region_id == region_id,
                and_(Employee.region_id.is_(None), Department.region_id == region_id),
            )
        )
    if start_date is not None:
        start_dt = datetime.combine(start_date, datetime.min.time(), tzinfo=attendance_tz).astimezone(timezone.utc)
        stmt = stmt.where(AttendanceEvent.ts_utc >= start_dt)
    if end_date is not None:
        end_dt = (
            datetime.combine(end_date + timedelta(days=1), datetime.min.time(), tzinfo=attendance_tz)
            .astimezone(timezone.utc)
        )
        stmt = stmt.where(AttendanceEvent.ts_utc < end_dt)
    if event_type is not None:
        stmt = stmt.where(AttendanceEvent.type == event_type)
    if location_status is not None:
        stmt = stmt.where(AttendanceEvent.location_status == location_status)
    if duplicates_only:
        stmt = stmt.where(AttendanceEvent.flags["DUPLICATE_EVENT"].astext == "true")
    rows = db.execute(stmt).all()
    items: list[AttendanceEventRead] = []
    for event, employee_name, department_name in rows:
        payload = AttendanceEventRead.model_validate(event).model_dump()
        payload["employee_name"] = employee_name
        payload["department_name"] = department_name
        items.append(AttendanceEventRead(**payload))
    return items


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
    response_model=AuditLogPageResponse,
    dependencies=[Depends(require_admin_permission("audit"))],
)
def list_audit_logs(
    action: str | None = Query(default=None),
    entity_type: str | None = Query(default=None),
    entity_id: str | None = Query(default=None),
    success: bool | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=35, ge=1, le=500),
    db: Session = Depends(get_db),
) -> AuditLogPageResponse:
    conditions: list[Any] = []
    if action:
        conditions.append(AuditLog.action == action)
    if entity_type:
        conditions.append(AuditLog.entity_type == entity_type)
    if entity_id:
        conditions.append(AuditLog.entity_id == entity_id)
    if success is not None:
        conditions.append(AuditLog.success.is_(success))

    total_stmt = select(func.count(AuditLog.id))
    data_stmt = select(AuditLog)
    if conditions:
        total_stmt = total_stmt.where(*conditions)
        data_stmt = data_stmt.where(*conditions)

    total = int(db.scalar(total_stmt) or 0)
    rows = list(
        db.scalars(
            data_stmt.order_by(AuditLog.id.desc()).offset(offset).limit(limit)
        ).all()
    )
    return AuditLogPageResponse(items=rows, total=total, offset=offset, limit=limit)


@router.get(
    "/api/admin/notifications/jobs",
    response_model=NotificationJobPageResponse,
)
def list_notification_jobs(
    request: Request,
    status: Literal["PENDING", "SENDING", "SENT", "CANCELED", "FAILED"] | None = Query(default=None),
    notification_type: str | None = Query(default=None),
    risk_level: str | None = Query(default=None),
    employee_id: int | None = Query(default=None, ge=1),
    audience: Literal["employee", "admin"] | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=35, ge=1, le=500),
    claims: dict[str, Any] = Depends(require_admin_permission("audit")),
    db: Session = Depends(get_db),
) -> NotificationJobPageResponse:
    data_stmt = select(NotificationJob)
    total_stmt = select(func.count(NotificationJob.id))
    if status is not None:
        data_stmt = data_stmt.where(NotificationJob.status == status)
        total_stmt = total_stmt.where(NotificationJob.status == status)
    if notification_type:
        data_stmt = data_stmt.where(NotificationJob.notification_type == notification_type)
        total_stmt = total_stmt.where(NotificationJob.notification_type == notification_type)
    if risk_level:
        data_stmt = data_stmt.where(NotificationJob.risk_level == risk_level)
        total_stmt = total_stmt.where(NotificationJob.risk_level == risk_level)
    if employee_id is not None:
        data_stmt = data_stmt.where(NotificationJob.employee_id == employee_id)
        total_stmt = total_stmt.where(NotificationJob.employee_id == employee_id)
    if audience is not None:
        data_stmt = data_stmt.where(NotificationJob.audience == audience)
        total_stmt = total_stmt.where(NotificationJob.audience == audience)
    if start_date is not None:
        data_stmt = data_stmt.where(NotificationJob.local_day >= start_date)
        total_stmt = total_stmt.where(NotificationJob.local_day >= start_date)
    if end_date is not None:
        data_stmt = data_stmt.where(NotificationJob.local_day <= end_date)
        total_stmt = total_stmt.where(NotificationJob.local_day <= end_date)

    total = int(db.scalar(total_stmt) or 0)
    jobs = list(
        db.scalars(
            data_stmt.order_by(
                NotificationJob.event_ts_utc.desc().nullslast(),
                NotificationJob.id.desc(),
            ).offset(offset).limit(limit)
        ).all()
    )
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
            "notification_type": notification_type,
            "risk_level": risk_level,
            "employee_id": employee_id,
            "audience": audience,
            "start_date": start_date.isoformat() if start_date is not None else None,
            "end_date": end_date.isoformat() if end_date is not None else None,
            "offset": offset,
            "limit": limit,
            "total": total,
            "count": len(jobs),
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return NotificationJobPageResponse(items=jobs, total=total, offset=offset, limit=limit)


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
    "/api/admin/notifications/daily-report-health",
    response_model=AdminDailyReportJobHealthResponse,
)
def admin_daily_report_health(
    _claims: dict[str, Any] = Depends(require_admin),
) -> AdminDailyReportJobHealthResponse:
    return AdminDailyReportJobHealthResponse.model_validate(get_daily_report_job_health())


@router.get(
    "/api/admin/notifications/email-targets",
    response_model=AdminNotificationEmailTargetsResponse,
)
def get_admin_notification_email_targets(
    request: Request,
    claims: dict[str, Any] = Depends(require_admin_permission("audit")),
    db: Session = Depends(get_db),
) -> AdminNotificationEmailTargetsResponse:
    rows = list_admin_notification_email_targets(db, include_inactive=True)
    active_recipients = [
        row.email
        for row in rows
        if row.is_active and (row.email or "").strip()
    ]
    actor_id = str(claims.get("username") or claims.get("sub") or "admin")
    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=actor_id,
        action="ADMIN_NOTIFICATION_EMAIL_TARGETS_LIST",
        success=True,
        entity_type="admin_notification_email_targets",
        entity_id=None,
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "total_count": len(rows),
            "active_count": len(active_recipients),
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return AdminNotificationEmailTargetsResponse(
        recipients=[_to_admin_notification_email_target_read(row) for row in rows],
        active_recipients=sorted(active_recipients),
        active_count=len(active_recipients),
    )


@router.put(
    "/api/admin/notifications/email-targets",
    response_model=AdminNotificationEmailTargetsResponse,
)
def update_admin_notification_email_targets(
    payload: AdminNotificationEmailTargetsUpdateRequest,
    request: Request,
    claims: dict[str, Any] = Depends(require_admin_permission("audit", write=True)),
    db: Session = Depends(get_db),
) -> AdminNotificationEmailTargetsResponse:
    invalid_values: list[str] = []
    normalized_values: list[str] = []
    for raw_value in payload.emails:
        normalized = normalize_notification_email(raw_value)
        if normalized is None:
            trimmed = " ".join((raw_value or "").strip().split())
            if trimmed:
                invalid_values.append(trimmed)
            continue
        normalized_values.append(normalized)

    if invalid_values:
        raise ApiError(
            status_code=422,
            code="VALIDATION_ERROR",
            message=f"Gecersiz email degeri: {invalid_values[0]}",
        )

    actor_id = str(claims.get("username") or claims.get("sub") or "admin")
    rows = replace_admin_notification_email_targets(
        db,
        emails=normalized_values,
        actor_username=actor_id,
    )
    active_recipients = [
        row.email
        for row in rows
        if row.is_active and (row.email or "").strip()
    ]

    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=actor_id,
        action="ADMIN_NOTIFICATION_EMAIL_TARGETS_UPDATE",
        success=True,
        entity_type="admin_notification_email_targets",
        entity_id=None,
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "requested_count": len(payload.emails),
            "applied_count": len(normalized_values),
            "active_count": len(active_recipients),
            "emails": sorted(active_recipients),
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return AdminNotificationEmailTargetsResponse(
        recipients=[_to_admin_notification_email_target_read(row) for row in rows],
        active_recipients=sorted(active_recipients),
        active_count=len(active_recipients),
    )


@router.post(
    "/api/admin/notifications/email-test",
    response_model=AdminNotificationEmailTestResponse,
)
def test_admin_notification_email(
    payload: AdminNotificationEmailTestRequest,
    request: Request,
    claims: dict[str, Any] = Depends(require_admin_permission("audit", write=True)),
    db: Session = Depends(get_db),
) -> AdminNotificationEmailTestResponse:
    normalized_recipients: list[str] = []
    if payload.recipients is not None:
        for raw_value in payload.recipients:
            normalized = normalize_notification_email(raw_value)
            if normalized is None:
                trimmed = " ".join((raw_value or "").strip().split())
                if trimmed:
                    raise ApiError(
                        status_code=422,
                        code="VALIDATION_ERROR",
                        message=f"Gecersiz email degeri: {trimmed}",
                    )
                continue
            normalized_recipients.append(normalized)

    actor_id = str(claims.get("username") or claims.get("sub") or "admin")
    result = send_admin_notification_test_email(
        db,
        recipients=(normalized_recipients if payload.recipients is not None else None),
        subject=payload.subject,
        body=payload.message,
    )

    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=actor_id,
        action="ADMIN_NOTIFICATION_EMAIL_TEST",
        success=bool(result.get("ok")),
        entity_type="admin_notification_email_targets",
        entity_id=None,
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "recipients": list(result.get("recipients") or []),
            "sent": int(result.get("sent") or 0),
            "mode": str(result.get("mode") or "unknown"),
            "configured": bool(result.get("configured")),
            "error": result.get("error"),
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return AdminNotificationEmailTestResponse.model_validate(result)


@router.get(
    "/api/admin/notifications/admin-self-check",
    response_model=AdminPushSelfCheckResponse,
)
def admin_push_self_check(
    request: Request,
    claims: dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AdminPushSelfCheckResponse:
    actor_username, actor_admin_user_id = _normalized_admin_actor_from_claims(claims)
    push_enabled = bool(get_push_public_config().get("enabled"))
    request_id = getattr(request.state, "request_id", None)
    try:
        rows = list_active_admin_push_subscriptions(db)
        actor_rows, by_id, by_username = _resolve_current_admin_claim_subscriptions(
            rows,
            actor_username=actor_username,
            actor_admin_user_id=actor_admin_user_id,
        )
        latest_claim = max(
            actor_rows,
            key=lambda row: _as_utc_datetime(row.last_seen_at) or datetime.min.replace(tzinfo=timezone.utc),
            default=None,
        )
        now_utc = datetime.now(timezone.utc)
        stale_cutoff = now_utc - timedelta(hours=24)
        active_claims_healthy = 0
        active_claims_with_error = 0
        active_claims_stale = 0
        for row in actor_rows:
            row_last_seen_at = _as_utc_datetime(row.last_seen_at)
            has_error = bool((row.last_error or "").strip())
            is_stale = row_last_seen_at is None or row_last_seen_at < stale_cutoff
            if has_error:
                active_claims_with_error += 1
            if is_stale:
                active_claims_stale += 1
            if (not has_error) and (not is_stale):
                active_claims_healthy += 1

        latest_self_test = db.scalar(
            select(AuditLog)
            .where(
                AuditLog.action == "ADMIN_PUSH_SELF_TEST",
                AuditLog.actor_id == actor_username,
            )
            .order_by(AuditLog.ts_utc.desc(), AuditLog.id.desc())
            .limit(1)
        )
        latest_self_test_details = (
            latest_self_test.details
            if latest_self_test is not None and isinstance(latest_self_test.details, dict)
            else {}
        )
        last_self_test_total_targets = (
            _as_int(latest_self_test_details.get("total_targets"), 0)
            if latest_self_test is not None
            else None
        )
        last_self_test_sent = (
            _as_int(latest_self_test_details.get("sent"), 0)
            if latest_self_test is not None
            else None
        )
        last_self_test_failed = (
            _as_int(latest_self_test_details.get("failed"), 0)
            if latest_self_test is not None
            else None
        )
        ready_for_receive = push_enabled and len(actor_rows) > 0
        response = AdminPushSelfCheckResponse(
            push_enabled=push_enabled,
            actor_username=actor_username,
            actor_admin_user_id=actor_admin_user_id,
            active_total_subscriptions=len(rows),
            active_claims_for_actor=len(actor_rows),
            active_claims_for_actor_by_id=by_id,
            active_claims_for_actor_by_username=by_username,
            active_claims_healthy=active_claims_healthy,
            active_claims_with_error=active_claims_with_error,
            active_claims_stale=active_claims_stale,
            latest_claim_seen_at=(_as_utc_datetime(latest_claim.last_seen_at) if latest_claim is not None else None),
            latest_claim_error=(latest_claim.last_error if latest_claim is not None else None),
            last_self_test_at=(latest_self_test.ts_utc if latest_self_test is not None else None),
            last_self_test_total_targets=last_self_test_total_targets,
            last_self_test_sent=last_self_test_sent,
            last_self_test_failed=last_self_test_failed,
            last_self_test_success=(
                bool(latest_self_test.success)
                if latest_self_test is not None
                else None
            ),
            ready_for_receive=ready_for_receive,
            has_other_active_subscriptions=len(rows) > len(actor_rows),
            self_check_ok=True,
            self_check_error=None,
        )

        log_audit(
            db,
            actor_type=AuditActorType.ADMIN,
            actor_id=actor_username,
            action="ADMIN_PUSH_SELF_CHECK",
            success=True,
            entity_type="admin_push_subscription",
            entity_id=None,
            ip=_client_ip(request),
            user_agent=_user_agent(request),
            details={
                "push_enabled": push_enabled,
                "actor_admin_user_id": actor_admin_user_id,
                "active_total_subscriptions": len(rows),
                "active_claims_for_actor": len(actor_rows),
                "active_claims_for_actor_by_id": by_id,
                "active_claims_for_actor_by_username": by_username,
                "active_claims_healthy": active_claims_healthy,
                "active_claims_with_error": active_claims_with_error,
                "active_claims_stale": active_claims_stale,
                "last_self_test_at": latest_self_test.ts_utc.isoformat() if latest_self_test is not None else None,
                "last_self_test_total_targets": last_self_test_total_targets,
                "last_self_test_sent": last_self_test_sent,
                "last_self_test_failed": last_self_test_failed,
                "last_self_test_success": bool(latest_self_test.success) if latest_self_test is not None else None,
                "ready_for_receive": ready_for_receive,
                "has_other_active_subscriptions": len(rows) > len(actor_rows),
                "self_check_ok": True,
            },
            request_id=request_id,
        )
        return response
    except Exception as exc:
        error_text = (str(exc) or exc.__class__.__name__).strip()[:500]
        logger.exception(
            "admin_push_self_check_failed",
            extra={
                "actor_username": actor_username,
                "actor_admin_user_id": actor_admin_user_id,
                "request_id": request_id,
            },
        )
        try:
            log_audit(
                db,
                actor_type=AuditActorType.ADMIN,
                actor_id=actor_username,
                action="ADMIN_PUSH_SELF_CHECK",
                success=False,
                entity_type="admin_push_subscription",
                entity_id=None,
                ip=_client_ip(request),
                user_agent=_user_agent(request),
                details={
                    "push_enabled": push_enabled,
                    "actor_admin_user_id": actor_admin_user_id,
                    "self_check_ok": False,
                    "self_check_error": error_text,
                },
                request_id=request_id,
            )
        except Exception:
            logger.exception(
                "admin_push_self_check_audit_failed",
                extra={
                    "actor_username": actor_username,
                    "actor_admin_user_id": actor_admin_user_id,
                    "request_id": request_id,
                },
            )

        return AdminPushSelfCheckResponse(
            push_enabled=push_enabled,
            actor_username=actor_username,
            actor_admin_user_id=actor_admin_user_id,
            active_total_subscriptions=0,
            active_claims_for_actor=0,
            active_claims_for_actor_by_id=0,
            active_claims_for_actor_by_username=0,
            active_claims_healthy=0,
            active_claims_with_error=0,
            active_claims_stale=0,
            latest_claim_seen_at=None,
            latest_claim_error=None,
            last_self_test_at=None,
            last_self_test_total_targets=None,
            last_self_test_sent=None,
            last_self_test_failed=None,
            last_self_test_success=None,
            ready_for_receive=False,
            has_other_active_subscriptions=False,
            self_check_ok=False,
            self_check_error=error_text,
        )


@router.post(
    "/api/admin/notifications/admin-self-test",
    response_model=AdminPushSelfTestResponse,
)
def admin_push_self_test(
    request: Request,
    claims: dict[str, Any] = Depends(require_admin_permission("audit", write=True)),
    db: Session = Depends(get_db),
) -> AdminPushSelfTestResponse:
    if not bool(get_push_public_config().get("enabled")):
        raise ApiError(
            status_code=503,
            code="PUSH_NOT_CONFIGURED",
            message="Push notification service is not configured.",
        )

    actor_username, actor_admin_user_id = _normalized_admin_actor_from_claims(claims)
    rows = list_active_admin_push_subscriptions(db)
    actor_rows, by_id, by_username = _resolve_current_admin_claim_subscriptions(
        rows,
        actor_username=actor_username,
        actor_admin_user_id=actor_admin_user_id,
    )
    if not actor_rows:
        raise ApiError(
            status_code=409,
            code="ADMIN_DEVICE_CLAIM_REQUIRED",
            message="Current admin account has no active push claim. Claim a device first.",
        )

    now_utc = datetime.now(timezone.utc)
    local_time = now_utc.astimezone(_attendance_timezone()).strftime("%Y-%m-%d %H:%M:%S")
    push_summary = send_push_to_admin_subscriptions(
        db,
        subscriptions=actor_rows,
        title="Admin Push Test",
        body=f"{actor_username} hesabi icin test bildirimi ({local_time}).",
        data={
            "type": "ADMIN_SELF_TEST",
            "actor": actor_username,
            "url": "/admin-panel/notifications",
            "ts_utc": now_utc.isoformat(),
        },
    )

    admin_user_ids = sorted({row.admin_user_id for row in actor_rows if row.admin_user_id is not None})
    admin_usernames = sorted({row.admin_username for row in actor_rows if row.admin_username})
    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=actor_username,
        action="ADMIN_PUSH_SELF_TEST",
        success=int(push_summary.get("sent", 0)) > 0,
        entity_type="admin_push_subscription",
        entity_id=None,
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "actor_admin_user_id": actor_admin_user_id,
            "active_claims_for_actor": len(actor_rows),
            "active_claims_for_actor_by_id": by_id,
            "active_claims_for_actor_by_username": by_username,
            "total_targets": int(push_summary.get("total_targets", 0)),
            "sent": int(push_summary.get("sent", 0)),
            "failed": int(push_summary.get("failed", 0)),
            "deactivated": int(push_summary.get("deactivated", 0)),
        },
        request_id=getattr(request.state, "request_id", None),
    )

    return AdminPushSelfTestResponse(
        ok=True,
        total_targets=int(push_summary.get("total_targets", 0)),
        sent=int(push_summary.get("sent", 0)),
        failed=int(push_summary.get("failed", 0)),
        deactivated=int(push_summary.get("deactivated", 0)),
        admin_user_ids=admin_user_ids,
        admin_usernames=admin_usernames,
    )


@router.get(
    "/api/admin/notifications/delivery-logs",
    response_model=NotificationDeliveryLogPageResponse,
)
def list_notification_delivery_logs(
    request: Request,
    notification_type: str | None = Query(default=None),
    employee_id: int | None = Query(default=None, ge=1),
    recipient_type: Literal["employee", "admin"] | None = Query(default=None),
    status_value: Literal["PENDING", "SENT", "FAILED"] | None = Query(default=None, alias="status"),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=35, ge=1, le=500),
    claims: dict[str, Any] = Depends(require_admin_permission("audit")),
    db: Session = Depends(get_db),
) -> NotificationDeliveryLogPageResponse:
    data_stmt = select(NotificationDeliveryLog).options(
        selectinload(NotificationDeliveryLog.notification_job),
        selectinload(NotificationDeliveryLog.employee),
        selectinload(NotificationDeliveryLog.admin_user),
    )
    total_stmt = select(func.count(NotificationDeliveryLog.id))
    if notification_type:
        data_stmt = data_stmt.where(NotificationDeliveryLog.notification_type == notification_type)
        total_stmt = total_stmt.where(NotificationDeliveryLog.notification_type == notification_type)
    if employee_id is not None:
        data_stmt = data_stmt.where(NotificationDeliveryLog.employee_id == employee_id)
        total_stmt = total_stmt.where(NotificationDeliveryLog.employee_id == employee_id)
    if recipient_type is not None:
        data_stmt = data_stmt.where(NotificationDeliveryLog.recipient_type == recipient_type)
        total_stmt = total_stmt.where(NotificationDeliveryLog.recipient_type == recipient_type)
    if status_value is not None:
        data_stmt = data_stmt.where(NotificationDeliveryLog.status == status_value)
        total_stmt = total_stmt.where(NotificationDeliveryLog.status == status_value)
    if start_date is not None:
        start_dt = datetime.combine(start_date, time.min, tzinfo=timezone.utc)
        data_stmt = data_stmt.where(NotificationDeliveryLog.created_at >= start_dt)
        total_stmt = total_stmt.where(NotificationDeliveryLog.created_at >= start_dt)
    if end_date is not None:
        end_dt = datetime.combine(end_date + timedelta(days=1), time.min, tzinfo=timezone.utc)
        data_stmt = data_stmt.where(NotificationDeliveryLog.created_at < end_dt)
        total_stmt = total_stmt.where(NotificationDeliveryLog.created_at < end_dt)

    total = int(db.scalar(total_stmt) or 0)
    rows = list(
        db.scalars(
            data_stmt.order_by(NotificationDeliveryLog.id.desc()).offset(offset).limit(limit)
        ).all()
    )

    result_rows: list[NotificationDeliveryLogRead] = []
    for row in rows:
        recipient_name = None
        recipient_id = None
        if row.recipient_type == "employee":
            recipient_id = row.employee_id
            if row.employee is not None:
                recipient_name = row.employee.full_name
        else:
            recipient_id = row.admin_user_id
            if row.admin_user is not None:
                recipient_name = row.admin_user.username

        sent_at_utc = row.delivered_at or row.created_at
        job = row.notification_job
        result_rows.append(
            NotificationDeliveryLogRead(
                id=row.id,
                notification_job_id=row.notification_job_id,
                event_id=row.event_id,
                notification_type=row.notification_type,
                audience=row.audience,
                sent_at_utc=sent_at_utc,
                title=job.title if job is not None else None,
                recipient_type="admin" if row.recipient_type == "admin" else "employee",
                recipient_id=recipient_id,
                recipient_name=recipient_name,
                recipient_address=row.recipient_address,
                device_id=None,
                endpoint=row.endpoint,
                ip=None,
                channel="email" if row.channel == "email" else "push",
                status=row.status,  # type: ignore[arg-type]
                error=row.error,
            )
        )

    actor_id = str(claims.get("username") or claims.get("sub") or "admin")
    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=actor_id,
        action="NOTIFICATION_DELIVERY_LOG_LIST",
        success=True,
        entity_type="notification",
        entity_id=None,
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "notification_type": notification_type,
            "employee_id": employee_id,
            "recipient_type": recipient_type,
            "status": status_value,
            "start_date": start_date.isoformat() if start_date is not None else None,
            "end_date": end_date.isoformat() if end_date is not None else None,
            "offset": offset,
            "limit": limit,
            "total": total,
            "row_count": len(result_rows),
        },
        request_id=getattr(request.state, "request_id", None),
    )

    return NotificationDeliveryLogPageResponse(
        items=result_rows,
        total=total,
        offset=offset,
        limit=limit,
    )


@router.get(
    "/api/admin/notifications/push/config",
    response_model=EmployeePushConfigResponse,
)
def admin_push_config(
    _claims: dict[str, Any] = Depends(require_admin),
) -> EmployeePushConfigResponse:
    return EmployeePushConfigResponse(**get_push_public_config())


@router.get(
    "/api/admin/notifications/push/config/public",
    response_model=EmployeePushConfigResponse,
)
def admin_push_config_public() -> EmployeePushConfigResponse:
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
    max_ttl_minutes = max(1, int(settings.admin_device_invite_max_ttl_minutes or 1))
    if payload.expires_in_minutes > max_ttl_minutes:
        raise ApiError(
            status_code=422,
            code="INVITE_TTL_TOO_LONG",
            message=f"Invite ttl cannot exceed {max_ttl_minutes} minutes.",
        )
    max_attempts = max(1, int(settings.admin_device_invite_max_attempts or 1))

    token = secrets.token_urlsafe(32)
    expires_at = now_utc + timedelta(minutes=payload.expires_in_minutes)

    invite = AdminDeviceInvite(
        token=token,
        expires_at=expires_at,
        is_used=False,
        max_attempts=max_attempts,
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
            "max_attempts": max_attempts,
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return AdminDeviceInviteCreateResponse(
        token=token,
        invite_url=invite_url,
        expires_at=expires_at,
    )


def _claim_admin_device_push_with_actor(
    *,
    token: str,
    subscription_payload: dict[str, Any],
    request: Request,
    db: Session,
    actor_id: str,
    admin_user_id: int | None,
) -> AdminDeviceClaimResponse:
    now_utc = datetime.now(timezone.utc)
    client_ip = _client_ip(request)
    user_agent = _user_agent(request)
    user_agent_hash = _user_agent_hash(request)
    normalized_token = token.strip()
    request.state.actor = "admin"
    request.state.actor_id = actor_id

    invite = db.scalar(select(AdminDeviceInvite).where(AdminDeviceInvite.token == normalized_token))
    if invite is None:
        raise ApiError(status_code=404, code="INVITE_NOT_FOUND", message="Admin device invite token not found.")
    if invite.is_used:
        raise ApiError(status_code=409, code="INVITE_ALREADY_USED", message="Admin device invite already used.")
    if invite.expires_at < now_utc:
        raise ApiError(status_code=410, code="INVITE_EXPIRED", message="Admin device invite expired.")
    max_attempts = max(1, int(invite.max_attempts or 0))
    if int(invite.attempt_count or 0) >= max_attempts:
        raise ApiError(
            status_code=429,
            code="INVITE_ATTEMPTS_EXCEEDED",
            message="Admin invite attempt limit exceeded. Create a new invite link.",
        )
    min_retry_seconds = max(0, int(settings.admin_device_invite_min_retry_seconds or 0))
    if min_retry_seconds > 0 and invite.last_attempt_at is not None:
        elapsed_seconds = (now_utc - invite.last_attempt_at).total_seconds()
        if elapsed_seconds < min_retry_seconds:
            retry_after_seconds = max(1, ceil(min_retry_seconds - elapsed_seconds))
            invite.attempt_count = int(invite.attempt_count or 0) + 1
            invite.last_attempt_at = now_utc
            db.commit()
            log_audit(
                db,
                actor_type=AuditActorType.ADMIN,
                actor_id=actor_id,
                action="ADMIN_DEVICE_CLAIM_BLOCKED",
                success=False,
                entity_type="admin_device_invite",
                entity_id=str(invite.id),
                ip=client_ip,
                user_agent=user_agent,
                details={
                    "reason": "INVITE_RETRY_TOO_FAST",
                    "retry_after_seconds": retry_after_seconds,
                    "attempt_count": invite.attempt_count,
                    "max_attempts": max_attempts,
                },
                request_id=getattr(request.state, "request_id", None),
            )
            raise ApiError(
                status_code=429,
                code="INVITE_RETRY_TOO_FAST",
                message=f"Invite retry is too fast. Wait {retry_after_seconds} seconds and try again.",
            )
    if invite.bound_ip is None and client_ip:
        invite.bound_ip = client_ip
    if invite.bound_user_agent_hash is None and user_agent_hash:
        invite.bound_user_agent_hash = user_agent_hash
    ip_mismatch = bool(invite.bound_ip and client_ip and invite.bound_ip != client_ip)
    ua_mismatch = bool(
        invite.bound_user_agent_hash
        and user_agent_hash
        and invite.bound_user_agent_hash != user_agent_hash
    )
    if ip_mismatch or ua_mismatch:
        invite.attempt_count = int(invite.attempt_count or 0) + 1
        invite.last_attempt_at = now_utc
        db.commit()
        log_audit(
            db,
            actor_type=AuditActorType.ADMIN,
            actor_id=actor_id,
            action="ADMIN_DEVICE_CLAIM_BLOCKED",
            success=False,
            entity_type="admin_device_invite",
            entity_id=str(invite.id),
            ip=client_ip,
            user_agent=user_agent,
            details={
                "reason": "INVITE_CONTEXT_MISMATCH",
                "ip_mismatch": ip_mismatch,
                "ua_mismatch": ua_mismatch,
                "attempt_count": invite.attempt_count,
                "max_attempts": max_attempts,
            },
            request_id=getattr(request.state, "request_id", None),
        )
        raise ApiError(
            status_code=403,
            code="INVITE_CONTEXT_MISMATCH",
            message="Invite link must be used from the same device/browser context.",
        )
    invite.attempt_count = int(invite.attempt_count or 0) + 1
    invite.last_attempt_at = now_utc
    db.commit()
    db.refresh(invite)

    subscription = upsert_admin_push_subscription(
        db,
        admin_user_id=admin_user_id,
        admin_username=actor_id,
        subscription=subscription_payload,
        user_agent=user_agent,
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
        ip=client_ip,
        user_agent=user_agent,
        details={
            "invite_id": invite.id,
            "admin_user_id": admin_user_id,
            "admin_username": actor_id,
            "invite_attempt_count": invite.attempt_count,
            "invite_max_attempts": max_attempts,
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return AdminDeviceClaimResponse(
        ok=True,
        admin_username=actor_id,
        subscription_id=subscription.id,
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
    actor_id = str(claims.get("username") or claims.get("sub") or settings.admin_user)
    admin_user_id = claims.get("admin_user_id") if isinstance(claims.get("admin_user_id"), int) else None
    return _claim_admin_device_push_with_actor(
        token=payload.token.strip(),
        subscription_payload=payload.subscription,
        request=request,
        db=db,
        actor_id=actor_id,
        admin_user_id=admin_user_id,
    )


@router.post(
    "/api/admin/notifications/admin-device-claim/public",
    response_model=AdminDeviceClaimResponse,
)
def claim_admin_device_push_public(
    payload: AdminDeviceClaimPublicRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> AdminDeviceClaimResponse:
    username = payload.username.strip()
    password = payload.password
    normalized_token = payload.token.strip()
    now_utc = datetime.now(timezone.utc)
    client_ip = _client_ip(request)
    user_agent = _user_agent(request)
    request_id = getattr(request.state, "request_id", None)
    request.state.actor = "system"
    request.state.actor_id = "system"

    invite = db.scalar(select(AdminDeviceInvite).where(AdminDeviceInvite.token == normalized_token))
    if invite is None:
        raise ApiError(status_code=404, code="INVITE_NOT_FOUND", message="Admin device invite token not found.")
    if invite.is_used:
        raise ApiError(status_code=409, code="INVITE_ALREADY_USED", message="Admin device invite already used.")
    if invite.expires_at < now_utc:
        raise ApiError(status_code=410, code="INVITE_EXPIRED", message="Admin device invite expired.")
    max_attempts = max(1, int(invite.max_attempts or 0))
    if int(invite.attempt_count or 0) >= max_attempts:
        raise ApiError(
            status_code=429,
            code="INVITE_ATTEMPTS_EXCEEDED",
            message="Admin invite attempt limit exceeded. Create a new invite link.",
        )

    if client_ip:
        try:
            ensure_login_attempt_allowed(client_ip)
        except ApiError:
            invite.attempt_count = int(invite.attempt_count or 0) + 1
            db.commit()
            log_audit(
                db,
                actor_type=AuditActorType.SYSTEM,
                actor_id=username or "admin",
                action="ADMIN_DEVICE_CLAIM_AUTH_FAIL",
                success=False,
                ip=client_ip,
                user_agent=user_agent,
                details={
                    "reason": "TOO_MANY_ATTEMPTS",
                    "invite_id": invite.id,
                    "invite_attempt_count": invite.attempt_count,
                    "invite_max_attempts": max_attempts,
                },
                request_id=request_id,
            )
            raise

    identity = _authenticate_admin_identity_by_password(
        db,
        username=username,
        password=password,
    )
    if identity is None:
        if client_ip:
            register_login_failure(client_ip)
        invite.attempt_count = int(invite.attempt_count or 0) + 1
        db.commit()
        log_audit(
            db,
            actor_type=AuditActorType.SYSTEM,
            actor_id=username or "admin",
            action="ADMIN_DEVICE_CLAIM_AUTH_FAIL",
            success=False,
            ip=client_ip,
            user_agent=user_agent,
            details={
                "reason": "INVALID_CREDENTIALS",
                "invite_id": invite.id,
                "invite_attempt_count": invite.attempt_count,
                "invite_max_attempts": max_attempts,
            },
            request_id=request_id,
        )
        raise ApiError(
            status_code=401,
            code="INVALID_CREDENTIALS",
            message="Invalid credentials.",
        )

    if client_ip:
        register_login_success(client_ip)

    actor_id = str(identity.get("username") or identity.get("sub") or username or "admin")
    admin_user_id = identity.get("admin_user_id") if isinstance(identity.get("admin_user_id"), int) else None
    return _claim_admin_device_push_with_actor(
        token=normalized_token,
        subscription_payload=payload.subscription,
        request=request,
        db=db,
        actor_id=actor_id,
        admin_user_id=admin_user_id,
    )


@router.post(
    "/api/admin/notifications/admin-device-heal",
    response_model=AdminDeviceHealResponse,
)
def heal_admin_device_push(
    payload: AdminDeviceHealRequest,
    request: Request,
    claims: dict[str, Any] = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AdminDeviceHealResponse:
    actor_id = str(claims.get("username") or claims.get("sub") or settings.admin_user)
    admin_user_id = claims.get("admin_user_id") if isinstance(claims.get("admin_user_id"), int) else None
    request.state.actor = "admin"
    request.state.actor_id = actor_id
    user_agent = _user_agent(request)

    subscription = upsert_admin_push_subscription(
        db,
        admin_user_id=admin_user_id,
        admin_username=actor_id,
        subscription=payload.subscription,
        user_agent=user_agent,
    )

    test_result: dict[str, Any] | None = None
    if payload.send_test:
        now_utc = datetime.now(timezone.utc)
        local_time = now_utc.astimezone(_attendance_timezone()).strftime("%Y-%m-%d %H:%M:%S")
        test_result = send_test_push_to_admin_subscription(
            db,
            subscription=subscription,
            title="Admin Claim Heal Test",
            body=f"{actor_id} hesabi icin heal dogrulama bildirimi ({local_time}).",
            data={
                "type": "ADMIN_DEVICE_HEAL_TEST",
                "actor": actor_id,
                "url": "/admin-panel/notifications",
                "ts_utc": now_utc.isoformat(),
            },
        )

    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=actor_id,
        action="ADMIN_DEVICE_HEALED",
        success=bool((test_result or {}).get("ok", True)),
        entity_type="admin_push_subscription",
        entity_id=str(subscription.id),
        ip=_client_ip(request),
        user_agent=user_agent,
        details={
            "admin_user_id": admin_user_id,
            "admin_username": actor_id,
            "send_test": payload.send_test,
            "test_push_ok": bool((test_result or {}).get("ok", False)) if test_result is not None else None,
            "test_push_status_code": (test_result or {}).get("status_code") if test_result is not None else None,
            "test_push_error": (test_result or {}).get("error") if test_result is not None else None,
        },
        request_id=getattr(request.state, "request_id", None),
    )

    return AdminDeviceHealResponse(
        ok=True,
        admin_username=actor_id,
        subscription_id=subscription.id,
        test_push_ok=bool((test_result or {}).get("ok", False)) if test_result is not None else None,
        test_push_error=((test_result or {}).get("error") if test_result is not None else None),
        test_push_status_code=((test_result or {}).get("status_code") if test_result is not None else None),
    )


@router.get(
    "/api/admin/daily-report-archives",
    response_model=AdminDailyReportArchivePageResponse,
)
def list_daily_report_archives(
    request: Request,
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    department_id: int | None = Query(default=None, ge=1),
    region_id: int | None = Query(default=None, ge=1),
    employee_id: int | None = Query(default=None, ge=1),
    employee_query: str | None = Query(default=None, min_length=1, max_length=255),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=35, ge=1, le=500),
    claims: dict[str, Any] = Depends(require_admin_permission("reports")),
    db: Session = Depends(get_db),
) -> AdminDailyReportArchivePageResponse:
    stmt = select(AdminDailyReportArchive)
    count_stmt = select(func.count(AdminDailyReportArchive.id))
    stmt = stmt.order_by(
        AdminDailyReportArchive.report_date.desc(),
        AdminDailyReportArchive.id.desc(),
    )
    if start_date is not None:
        stmt = stmt.where(AdminDailyReportArchive.report_date >= start_date)
        count_stmt = count_stmt.where(AdminDailyReportArchive.report_date >= start_date)
    if end_date is not None:
        stmt = stmt.where(AdminDailyReportArchive.report_date <= end_date)
        count_stmt = count_stmt.where(AdminDailyReportArchive.report_date <= end_date)
    if department_id is not None:
        stmt = stmt.where(AdminDailyReportArchive.department_id == department_id)
        count_stmt = count_stmt.where(AdminDailyReportArchive.department_id == department_id)
    if region_id is not None:
        stmt = stmt.where(AdminDailyReportArchive.region_id == region_id)
        count_stmt = count_stmt.where(AdminDailyReportArchive.region_id == region_id)
    if employee_id is not None:
        employee_condition = and_(
            AdminDailyReportArchive.employee_ids_index.is_not(None),
            AdminDailyReportArchive.employee_ids_index.like(f"%,{employee_id},%"),
        )
        stmt = stmt.where(
            employee_condition,
        )
        count_stmt = count_stmt.where(employee_condition)
    normalized_query = _normalize_query_text(employee_query).lower()
    if normalized_query:
        name_expr = AdminDailyReportArchive.employee_names_index
        file_expr = AdminDailyReportArchive.file_name
        if normalized_query.isdigit():
            query_id = int(normalized_query)
            query_condition = or_(
                and_(
                    AdminDailyReportArchive.employee_ids_index.is_not(None),
                    AdminDailyReportArchive.employee_ids_index.like(f"%,{query_id},%"),
                ),
                name_expr.ilike(f"%{normalized_query}%"),
                file_expr.ilike(f"%{normalized_query}%"),
            )
            stmt = stmt.where(
                query_condition
            )
            count_stmt = count_stmt.where(query_condition)
        else:
            query_condition = or_(
                name_expr.ilike(f"%{normalized_query}%"),
                file_expr.ilike(f"%{normalized_query}%"),
            )
            stmt = stmt.where(
                query_condition
            )
            count_stmt = count_stmt.where(query_condition)
    stmt = stmt.offset(offset).limit(limit)

    total = int(db.scalar(count_stmt) or 0)
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
            "employee_id": employee_id,
            "employee_query": normalized_query or None,
            "offset": offset,
            "limit": limit,
            "total": total,
            "count": len(rows),
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return AdminDailyReportArchivePageResponse(
        items=rows,
        total=total,
        offset=offset,
        limit=limit,
    )


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
    try:
        archive_bytes = decrypt_archive_file_data(archive.file_data)
    except RuntimeError as exc:
        raise ApiError(
            status_code=500,
            code="ARCHIVE_DECRYPT_FAILED",
            message="Archive file cannot be decrypted.",
        ) from exc
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
        content=archive_bytes,
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
    try:
        archive_bytes = decrypt_archive_file_data(archive.file_data)
    except RuntimeError as exc:
        raise ApiError(
            status_code=500,
            code="ARCHIVE_DECRYPT_FAILED",
            message="Archive file cannot be decrypted.",
        ) from exc

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
        content=archive_bytes,
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{archive.file_name}"'},
    )


@router.get(
    "/api/admin/attendance-extra-checkin-approval",
    response_model=AdminAttendanceExtraCheckinApprovalRead,
)
def get_attendance_extra_checkin_approval(
    request: Request,
    token: str = Query(min_length=16, max_length=255),
    db: Session = Depends(get_db),
) -> AdminAttendanceExtraCheckinApprovalRead:
    approval = _resolve_extra_checkin_approval_by_token(db, token=token)
    now_utc = datetime.now(timezone.utc)
    _normalize_extra_checkin_approval_status(
        db,
        approval=approval,
        now_utc=now_utc,
    )

    employee = db.get(Employee, approval.employee_id)
    if employee is None:
        raise ApiError(
            status_code=404,
            code="EMPLOYEE_NOT_FOUND",
            message="Calisan bulunamadi.",
        )

    request.state.actor = "system"
    request.state.actor_id = "system"
    request.state.employee_id = approval.employee_id
    request.state.flags = {
        "approval_id": approval.id,
        "status": approval.status,
    }
    return _to_attendance_extra_checkin_approval_read(
        approval=approval,
        employee_name=(employee.full_name or "-"),
    )


@router.post(
    "/api/admin/attendance-extra-checkin-approval/approve",
    response_model=AdminAttendanceExtraCheckinApprovalApproveResponse,
)
def approve_attendance_extra_checkin_approval(
    payload: AdminAttendanceExtraCheckinApprovalApproveRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> AdminAttendanceExtraCheckinApprovalApproveResponse:
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
                actor_id=payload.username.strip() or "admin",
                action="ATTENDANCE_EXTRA_CHECKIN_APPROVAL_FAIL",
                success=False,
                entity_type="attendance_extra_checkin_approval",
                entity_id=None,
                ip=ip,
                user_agent=user_agent,
                details={"reason": "TOO_MANY_ATTEMPTS"},
                request_id=request_id,
            )
            raise

    approval = _resolve_extra_checkin_approval_by_token(db, token=payload.token)
    employee = db.get(Employee, approval.employee_id)
    if employee is None:
        raise ApiError(
            status_code=404,
            code="EMPLOYEE_NOT_FOUND",
            message="Calisan bulunamadi.",
        )

    now_utc = datetime.now(timezone.utc)
    _normalize_extra_checkin_approval_status(
        db,
        approval=approval,
        now_utc=now_utc,
    )

    identity = _authenticate_admin_identity_by_password(
        db,
        username=payload.username,
        password=payload.password,
    )
    if identity is None:
        if ip:
            register_login_failure(ip)
        log_audit(
            db,
            actor_type=AuditActorType.SYSTEM,
            actor_id=payload.username.strip() or "admin",
            action="ATTENDANCE_EXTRA_CHECKIN_APPROVAL_FAIL",
            success=False,
            entity_type="attendance_extra_checkin_approval",
            entity_id=str(approval.id),
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

    if approval.status == EXTRA_CHECKIN_APPROVAL_STATUS_EXPIRED:
        raise ApiError(
            status_code=409,
            code="EXTRA_CHECKIN_APPROVAL_EXPIRED",
            message="Ek giris onay talebinin suresi dolmus.",
        )

    already_processed = approval.status in {
        EXTRA_CHECKIN_APPROVAL_STATUS_APPROVED,
        EXTRA_CHECKIN_APPROVAL_STATUS_CONSUMED,
    }
    if approval.status == EXTRA_CHECKIN_APPROVAL_STATUS_PENDING:
        approval.status = EXTRA_CHECKIN_APPROVAL_STATUS_APPROVED
        approval.approved_at = now_utc
        approval.approved_by_username = str(identity.get("username") or identity.get("sub") or payload.username)
        admin_user_id = identity.get("admin_user_id")
        approval.approved_by_admin_user_id = admin_user_id if isinstance(admin_user_id, int) else None
        db.commit()
        db.refresh(approval)

    actor_id = str(identity.get("username") or identity.get("sub") or payload.username).strip() or "admin"
    request.state.actor = "admin"
    request.state.actor_id = actor_id
    request.state.employee_id = approval.employee_id
    request.state.flags = {
        "approval_id": approval.id,
        "status": approval.status,
        "already_processed": already_processed,
    }
    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=actor_id,
        action="ATTENDANCE_EXTRA_CHECKIN_APPROVAL_APPROVED",
        success=True,
        entity_type="attendance_extra_checkin_approval",
        entity_id=str(approval.id),
        ip=ip,
        user_agent=user_agent,
        details={
            "employee_id": approval.employee_id,
            "local_day": approval.local_day.isoformat(),
            "status": approval.status,
            "already_processed": already_processed,
        },
        request_id=request_id,
    )

    return AdminAttendanceExtraCheckinApprovalApproveResponse(
        ok=True,
        approval=_to_attendance_extra_checkin_approval_read(
            approval=approval,
            employee_name=(employee.full_name or "-"),
        ),
        already_processed=already_processed,
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
    title = f"Gunluk Puantaj Raporu Hazir ({report_date_text})"
    body = (
        f"{report_date_text} tarihli gunluk puantaj Excel raporu hazir. "
        "Bildirime dokunup dogrudan indirebilirsin."
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
    total_targets = int(push_summary.get("total_targets", 0))
    if total_targets <= 0:
        log_audit(
            db,
            actor_type=AuditActorType.ADMIN,
            actor_id=str(claims.get("username") or claims.get("sub") or "admin"),
            action="ADMIN_DAILY_REPORT_ARCHIVE_NOTIFY_BLOCKED",
            success=False,
            entity_type="admin_daily_report_archive",
            entity_id=str(archive.id),
            ip=_client_ip(request),
            user_agent=_user_agent(request),
            details={
                "reason": "NO_ACTIVE_ADMIN_PUSH_SUBSCRIPTION",
                "report_date": report_date_text,
                "requested_admin_user_ids": admin_user_ids,
            },
            request_id=getattr(request.state, "request_id", None),
        )
        raise ApiError(
            status_code=409,
            code="ADMIN_PUSH_SUBSCRIPTION_REQUIRED",
            message="No active admin push subscription found. Claim an admin device first.",
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

    employee_total_targets = int(employee_summary.get("total_targets", 0))
    employee_sent = int(employee_summary.get("sent", 0))
    employee_failed = int(employee_summary.get("failed", 0))
    employee_deactivated = int(employee_summary.get("deactivated", 0))

    admin_total_targets = int(admin_summary.get("total_targets", 0))
    admin_sent = int(admin_summary.get("sent", 0))
    admin_failed = int(admin_summary.get("failed", 0))
    admin_deactivated = int(admin_summary.get("deactivated", 0))
    admin_target_requested = payload.target in {"admins", "both"}
    admin_target_missing = admin_target_requested and admin_total_targets <= 0

    total_targets = employee_total_targets + admin_total_targets
    sent_total = employee_sent + admin_sent
    failed_total = employee_failed + admin_failed
    deactivated_total = employee_deactivated + admin_deactivated

    if payload.target == "admins" and admin_target_missing:
        log_audit(
            db,
            actor_type=AuditActorType.ADMIN,
            actor_id=actor_id,
            action="ADMIN_MANUAL_PUSH_BLOCKED",
            success=False,
            entity_type="notification",
            entity_id=None,
            ip=_client_ip(request),
            user_agent=_user_agent(request),
            details={
                "target": payload.target,
                "employee_ids": employee_ids,
                "admin_user_ids": admin_user_ids,
                "title": payload.title,
                "reason": "NO_ACTIVE_ADMIN_PUSH_SUBSCRIPTION",
            },
            request_id=getattr(request.state, "request_id", None),
        )
        raise ApiError(
            status_code=409,
            code="ADMIN_PUSH_SUBSCRIPTION_REQUIRED",
            message="No active admin push subscription found. Claim an admin device first.",
        )

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
            "employee_total_targets": employee_total_targets,
            "employee_sent": employee_sent,
            "employee_failed": employee_failed,
            "employee_deactivated": employee_deactivated,
            "admin_total_targets": admin_total_targets,
            "admin_sent": admin_sent,
            "admin_failed": admin_failed,
            "admin_deactivated": admin_deactivated,
            "admin_target_missing": admin_target_missing,
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
        employee_total_targets=employee_total_targets,
        employee_sent=employee_sent,
        employee_failed=employee_failed,
        employee_deactivated=employee_deactivated,
        admin_total_targets=admin_total_targets,
        admin_sent=admin_sent,
        admin_failed=admin_failed,
        admin_deactivated=admin_deactivated,
        admin_target_missing=admin_target_missing,
    )


@router.get(
    "/api/admin/notifications/tasks",
    response_model=ScheduledNotificationTaskPageResponse,
)
def list_scheduled_notification_tasks(
    is_active: bool | None = Query(default=None),
    claims: dict[str, Any] = Depends(require_admin_permission("audit")),
    db: Session = Depends(get_db),
) -> ScheduledNotificationTaskPageResponse:
    stmt = select(ScheduledNotificationTask)
    total_stmt = select(func.count(ScheduledNotificationTask.id))
    if is_active is not None:
        stmt = stmt.where(ScheduledNotificationTask.is_active.is_(is_active))
        total_stmt = total_stmt.where(ScheduledNotificationTask.is_active.is_(is_active))

    stmt = stmt.order_by(
        ScheduledNotificationTask.is_active.desc(),
        ScheduledNotificationTask.updated_at.desc(),
        ScheduledNotificationTask.id.desc(),
    )
    rows = list(db.scalars(stmt).all())
    total = int(db.scalar(total_stmt) or 0)
    return ScheduledNotificationTaskPageResponse(
        items=[_to_scheduled_notification_task_read(row) for row in rows],
        total=total,
    )


@router.post(
    "/api/admin/notifications/tasks",
    response_model=ScheduledNotificationTaskRead,
)
def create_scheduled_notification_task(
    payload: ScheduledNotificationTaskCreateRequest,
    request: Request,
    claims: dict[str, Any] = Depends(require_admin_permission("audit", write=True)),
    db: Session = Depends(get_db),
) -> ScheduledNotificationTaskRead:
    actor_username, _ = _normalized_admin_actor_from_claims(claims)
    try:
        normalized = normalize_scheduled_notification_task_payload(
            db,
            name=payload.name,
            title=payload.title,
            message=payload.message,
            target=payload.target,
            employee_scope=payload.employee_scope,
            admin_scope=payload.admin_scope,
            employee_ids=payload.employee_ids,
            admin_user_ids=payload.admin_user_ids,
            schedule_kind=payload.schedule_kind,
            run_date_local=payload.run_date_local,
            run_time_local=payload.run_time_local,
            timezone_name=payload.timezone_name,
            is_active=payload.is_active,
        )
    except ValueError as exc:
        raise ApiError(status_code=422, code="VALIDATION_ERROR", message=str(exc)) from exc

    row = ScheduledNotificationTask(
        **normalized,
        created_by_username=actor_username,
        updated_by_username=actor_username,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=actor_username,
        action="SCHEDULED_NOTIFICATION_TASK_CREATED",
        success=True,
        entity_type="scheduled_notification_task",
        entity_id=str(row.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "name": row.name,
            "target": row.target,
            "employee_scope": row.employee_scope,
            "admin_scope": row.admin_scope,
            "employee_ids": row.employee_ids,
            "admin_user_ids": row.admin_user_ids,
            "schedule_kind": row.schedule_kind,
            "run_date_local": row.run_date_local.isoformat() if row.run_date_local is not None else None,
            "run_time_local": row.run_time_local.strftime("%H:%M:%S"),
            "is_active": row.is_active,
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return _to_scheduled_notification_task_read(row)


@router.patch(
    "/api/admin/notifications/tasks/{task_id}",
    response_model=ScheduledNotificationTaskRead,
)
def update_scheduled_notification_task(
    task_id: int,
    payload: ScheduledNotificationTaskUpdateRequest,
    request: Request,
    claims: dict[str, Any] = Depends(require_admin_permission("audit", write=True)),
    db: Session = Depends(get_db),
) -> ScheduledNotificationTaskRead:
    row = db.get(ScheduledNotificationTask, task_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Scheduled notification task not found")

    actor_username, _ = _normalized_admin_actor_from_claims(claims)
    try:
        normalized = normalize_scheduled_notification_task_payload(
            db,
            name=payload.name,
            title=payload.title,
            message=payload.message,
            target=payload.target,
            employee_scope=payload.employee_scope,
            admin_scope=payload.admin_scope,
            employee_ids=payload.employee_ids,
            admin_user_ids=payload.admin_user_ids,
            schedule_kind=payload.schedule_kind,
            run_date_local=payload.run_date_local,
            run_time_local=payload.run_time_local,
            timezone_name=payload.timezone_name,
            is_active=payload.is_active,
        )
    except ValueError as exc:
        raise ApiError(status_code=422, code="VALIDATION_ERROR", message=str(exc)) from exc

    previous_last_enqueued_local_date = row.last_enqueued_local_date
    previous_is_active = row.is_active
    previous_schedule_kind = row.schedule_kind
    previous_run_date_local = row.run_date_local
    for key, value in normalized.items():
        setattr(row, key, value)
    row.updated_by_username = actor_username
    if row.schedule_kind == "once" and (
        row.run_date_local != previous_run_date_local
        or row.run_date_local != previous_last_enqueued_local_date
        or (not previous_is_active and row.is_active)
        or previous_schedule_kind != row.schedule_kind
    ):
        row.last_enqueued_local_date = None
        row.last_enqueued_at_utc = None
    elif row.schedule_kind == "daily" and ((not previous_is_active and row.is_active) or previous_schedule_kind != row.schedule_kind):
        row.last_enqueued_local_date = None
        row.last_enqueued_at_utc = None

    db.commit()
    db.refresh(row)

    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=actor_username,
        action="SCHEDULED_NOTIFICATION_TASK_UPDATED",
        success=True,
        entity_type="scheduled_notification_task",
        entity_id=str(row.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "name": row.name,
            "target": row.target,
            "employee_scope": row.employee_scope,
            "admin_scope": row.admin_scope,
            "employee_ids": row.employee_ids,
            "admin_user_ids": row.admin_user_ids,
            "schedule_kind": row.schedule_kind,
            "run_date_local": row.run_date_local.isoformat() if row.run_date_local is not None else None,
            "run_time_local": row.run_time_local.strftime("%H:%M:%S"),
            "is_active": row.is_active,
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return _to_scheduled_notification_task_read(row)


@router.delete(
    "/api/admin/notifications/tasks/{task_id}",
    response_model=SoftDeleteResponse,
)
def delete_scheduled_notification_task(
    task_id: int,
    request: Request,
    claims: dict[str, Any] = Depends(require_admin_permission("audit", write=True)),
    db: Session = Depends(get_db),
) -> SoftDeleteResponse:
    row = db.get(ScheduledNotificationTask, task_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Scheduled notification task not found")

    actor_username, _ = _normalized_admin_actor_from_claims(claims)
    task_snapshot = {
        "name": row.name,
        "target": row.target,
        "schedule_kind": row.schedule_kind,
        "run_date_local": row.run_date_local.isoformat() if row.run_date_local is not None else None,
        "run_time_local": row.run_time_local.strftime("%H:%M:%S"),
    }
    db.delete(row)
    db.commit()

    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=actor_username,
        action="SCHEDULED_NOTIFICATION_TASK_DELETED",
        success=True,
        entity_type="scheduled_notification_task",
        entity_id=str(task_id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details=task_snapshot,
        request_id=getattr(request.state, "request_id", None),
    )
    return SoftDeleteResponse(ok=True)


@router.post(
    "/api/admin/notifications/jobs/{job_id}/note",
    response_model=NotificationJobRead,
)
def update_notification_job_note(
    job_id: int,
    payload: NotificationJobNoteUpdateRequest,
    request: Request,
    claims: dict[str, Any] = Depends(require_admin_permission("audit", write=True)),
    db: Session = Depends(get_db),
) -> NotificationJobRead:
    job = db.get(NotificationJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Notification job not found")

    job.admin_note = (payload.admin_note or "").strip() or None
    db.commit()
    db.refresh(job)

    actor_id = str(claims.get("username") or claims.get("sub") or "admin")
    log_audit(
        db,
        actor_type=AuditActorType.ADMIN,
        actor_id=actor_id,
        action="NOTIFICATION_JOB_NOTE_UPDATED",
        success=True,
        entity_type="notification_job",
        entity_id=str(job.id),
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        details={
            "notification_type": job.notification_type,
            "employee_id": job.employee_id,
            "admin_note": job.admin_note,
        },
        request_id=getattr(request.state, "request_id", None),
    )
    return job


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
    region_id: int | None = Query(default=None, ge=1),
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
        region_id=region_id,
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
            "region_id": region_id,
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
    region_id: int | None = Query(default=None, ge=1),
    include_inactive: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> Response:
    payload = build_puantaj_xlsx_bytes(
        db,
        mode="all",
        year=year,
        month=month,
        region_id=region_id,
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
            "region_id": region_id,
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
    region_id: int | None = Query(default=None, ge=1),
    employee_id: int | None = Query(default=None, ge=1),
    db: Session = Depends(get_db),
) -> Response:
    payload = build_puantaj_xlsx_bytes(
        db,
        mode="date_range",
        start_date=start,
        end_date=end,
        department_id=department_id,
        region_id=region_id,
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
            "region_id": region_id,
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
    region_id: int | None = Query(default=None, ge=1),
    employee_id: int | None = Query(default=None, ge=1),
    db: Session = Depends(get_db),
) -> Response:
    payload = build_puantaj_range_xlsx_bytes(
        db,
        start_date=start_date,
        end_date=end_date,
        mode=mode,
        department_id=department_id,
        region_id=region_id,
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
            "region_id": region_id,
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
