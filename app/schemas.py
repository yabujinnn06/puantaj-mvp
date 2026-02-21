from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models import (
    AttendanceEventSource,
    AttendanceType,
    AuditActorType,
    LeaveStatus,
    LeaveType,
    LocationStatus,
    OvertimeRoundingMode,
    QRCodeType,
    SchedulePlanTargetType,
)


class RegionCreate(BaseModel):
    name: str = Field(min_length=2, max_length=255)
    is_active: bool = True


class RegionUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=255)
    is_active: bool = True


class RegionRead(BaseModel):
    id: int
    name: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DepartmentCreate(BaseModel):
    name: str
    region_id: int | None = Field(default=None, ge=1)


class DepartmentUpdate(BaseModel):
    name: str
    region_id: int | None = Field(default=None, ge=1)


class DepartmentRead(BaseModel):
    id: int
    name: str
    region_id: int | None = None
    region_name: str | None = None

    model_config = ConfigDict(from_attributes=True)


class EmployeeCreate(BaseModel):
    full_name: str
    region_id: int | None = Field(default=None, ge=1)
    department_id: int | None = None
    shift_id: int | None = None
    is_active: bool = True
    contract_weekly_minutes: int | None = Field(default=None, ge=1)


class EmployeeRead(BaseModel):
    id: int
    full_name: str
    region_id: int | None
    region_name: str | None = None
    department_id: int | None
    shift_id: int | None
    is_active: bool
    contract_weekly_minutes: int | None

    model_config = ConfigDict(from_attributes=True)


class EmployeeDeviceDetailRead(BaseModel):
    id: int
    device_fingerprint: str
    is_active: bool
    created_at: datetime
    last_attendance_ts_utc: datetime | None = None
    last_seen_ip: str | None = None
    last_seen_action: str | None = None
    last_seen_at_utc: datetime | None = None


class EmployeePortalActivityRead(BaseModel):
    ts_utc: datetime
    action: str
    ip: str | None = None
    user_agent: str | None = None


class EmployeeIpSummaryRead(BaseModel):
    ip: str
    last_seen_at_utc: datetime
    last_action: str
    last_lat: float | None = None
    last_lon: float | None = None
    last_accuracy_m: float | None = None
    last_location_status: LocationStatus | None = None
    last_location_ts_utc: datetime | None = None


class EmployeeLiveLocationRead(BaseModel):
    lat: float
    lon: float
    accuracy_m: float | None = None
    ts_utc: datetime
    location_status: LocationStatus
    event_type: AttendanceType
    device_id: int


class EmployeeDetailResponse(BaseModel):
    employee: EmployeeRead
    last_portal_seen_utc: datetime | None = None
    recent_ips: list[str] = Field(default_factory=list)
    ip_summary: list[EmployeeIpSummaryRead] = Field(default_factory=list)
    devices: list[EmployeeDeviceDetailRead] = Field(default_factory=list)
    latest_location: EmployeeLiveLocationRead | None = None
    home_location: "EmployeeLocationRead | None" = None
    recent_activity: list[EmployeePortalActivityRead] = Field(default_factory=list)


class DashboardEmployeeMonthMetricsRead(BaseModel):
    year: int
    month: int
    worked_minutes: int
    plan_overtime_minutes: int = 0
    extra_work_minutes: int
    overtime_minutes: int
    incomplete_days: int


class DashboardEmployeeLastEventRead(BaseModel):
    event_id: int
    event_type: AttendanceType
    ts_utc: datetime
    location_status: LocationStatus
    device_id: int
    lat: float | None = None
    lon: float | None = None
    accuracy_m: float | None = None


class DashboardEmployeeSnapshotRead(BaseModel):
    employee: EmployeeRead
    today_status: Literal["NOT_STARTED", "IN_PROGRESS", "FINISHED"] = "NOT_STARTED"
    total_devices: int = 0
    active_devices: int = 0
    devices: list[EmployeeDeviceDetailRead] = Field(default_factory=list)
    current_month: DashboardEmployeeMonthMetricsRead
    previous_month: DashboardEmployeeMonthMetricsRead
    last_event: DashboardEmployeeLastEventRead | None = None
    latest_location: EmployeeLiveLocationRead | None = None
    generated_at_utc: datetime


class EmployeeActiveUpdateRequest(BaseModel):
    is_active: bool


class EmployeeShiftUpdateRequest(BaseModel):
    shift_id: int | None = Field(default=None, ge=1)


class EmployeeDepartmentUpdateRequest(BaseModel):
    department_id: int | None = Field(default=None, ge=1)


class EmployeeRegionUpdateRequest(BaseModel):
    region_id: int | None = Field(default=None, ge=1)


class EmployeeProfileUpdateRequest(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=255)
    department_id: int | None = Field(default=None, ge=1)


class DeviceActiveUpdateRequest(BaseModel):
    is_active: bool


class DeviceCreate(BaseModel):
    employee_id: int
    device_fingerprint: str
    is_active: bool = True


class DeviceRead(BaseModel):
    id: int
    employee_id: int
    device_fingerprint: str
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class EmployeeDeviceOverviewDevice(BaseModel):
    id: int
    device_fingerprint: str
    is_active: bool
    created_at: datetime


class EmployeeDeviceOverviewRead(BaseModel):
    employee_id: int
    employee_name: str
    region_id: int | None = None
    region_name: str | None = None
    department_id: int | None
    department_name: str | None
    is_employee_active: bool
    total_devices: int = 0
    active_devices: int = 0
    shown_devices: int = 0
    has_more_devices: bool = False
    token_total: int
    token_used: int
    token_pending: int
    token_expired: int
    devices: list[EmployeeDeviceOverviewDevice] = Field(default_factory=list)


class DeviceInviteCreateRequest(BaseModel):
    employee_id: int | None = Field(default=None, ge=1)
    employee_name: str | None = Field(default=None, min_length=2, max_length=255)
    expires_in_minutes: int = Field(ge=1)

    @model_validator(mode="after")
    def _validate_target(self) -> "DeviceInviteCreateRequest":
        normalized_name = (self.employee_name or "").strip()
        if self.employee_id is None and not normalized_name:
            raise ValueError("Either employee_id or employee_name is required.")
        if self.employee_id is not None and normalized_name:
            raise ValueError("Provide employee_id or employee_name, not both.")
        if self.employee_name is not None:
            self.employee_name = normalized_name
        return self


class DeviceInviteCreateResponse(BaseModel):
    token: str
    invite_url: str = Field(
        description="Employee portal claim URL, e.g. https://domain.com/employee/claim?token=...",
    )


class DeviceClaimRequest(BaseModel):
    token: str
    device_fingerprint: str


class DeviceClaimResponse(BaseModel):
    ok: bool
    employee_id: int
    device_id: int


class PasskeyRegisterOptionsRequest(BaseModel):
    device_fingerprint: str


class PasskeyRegisterOptionsResponse(BaseModel):
    challenge_id: int
    expires_at: datetime
    options: dict[str, Any]


class PasskeyRegisterVerifyRequest(BaseModel):
    challenge_id: int
    credential: dict[str, Any]


class PasskeyRegisterVerifyResponse(BaseModel):
    ok: bool
    passkey_id: int


class PasskeyRecoverOptionsResponse(BaseModel):
    challenge_id: int
    expires_at: datetime
    options: dict[str, Any]


class PasskeyRecoverVerifyRequest(BaseModel):
    challenge_id: int
    credential: dict[str, Any]


class PasskeyRecoverVerifyResponse(BaseModel):
    ok: bool
    employee_id: int
    device_id: int
    device_fingerprint: str


class AdminLoginRequest(BaseModel):
    username: str
    password: str


class AdminRefreshRequest(BaseModel):
    refresh_token: str


class AdminLogoutRequest(BaseModel):
    refresh_token: str


class AdminLogoutResponse(BaseModel):
    ok: bool


class AdminAuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    refresh_token: str | None = None


class AdminPermissionValue(BaseModel):
    read: bool = False
    write: bool = False


class AdminUserCreateRequest(BaseModel):
    username: str = Field(min_length=3, max_length=100)
    password: str = Field(min_length=8, max_length=128)
    full_name: str | None = Field(default=None, max_length=255)
    is_active: bool = True
    is_super_admin: bool = False
    permissions: dict[str, AdminPermissionValue] = Field(default_factory=dict)


class AdminUserUpdateRequest(BaseModel):
    username: str | None = Field(default=None, min_length=3, max_length=100)
    full_name: str | None = Field(default=None, max_length=255)
    password: str | None = Field(default=None, min_length=8, max_length=128)
    is_active: bool | None = None
    is_super_admin: bool | None = None
    permissions: dict[str, AdminPermissionValue] | None = None


class AdminUserRead(BaseModel):
    id: int
    username: str
    full_name: str | None
    is_active: bool
    is_super_admin: bool
    permissions: dict[str, AdminPermissionValue] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AdminMeResponse(BaseModel):
    sub: str
    username: str
    admin_user_id: int | None = None
    full_name: str | None = None
    role: str
    is_super_admin: bool = False
    permissions: dict[str, AdminPermissionValue] = Field(default_factory=dict)
    iat: int
    exp: int


class LeaveCreateRequest(BaseModel):
    employee_id: int
    start_date: date
    end_date: date
    type: LeaveType
    status: LeaveStatus = LeaveStatus.APPROVED
    note: str | None = None


class LeaveRead(BaseModel):
    id: int
    employee_id: int
    start_date: date
    end_date: date
    type: LeaveType
    status: LeaveStatus
    note: str | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class EmployeeLocationUpsert(BaseModel):
    home_lat: float
    home_lon: float
    radius_m: int = Field(default=120, ge=1)


class EmployeeLocationRead(BaseModel):
    id: int
    employee_id: int
    home_lat: float
    home_lon: float
    radius_m: int
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class WorkRuleUpsert(BaseModel):
    department_id: int
    daily_minutes_planned: int = Field(default=540, ge=0)
    break_minutes: int = Field(default=60, ge=0)
    grace_minutes: int = Field(default=5, ge=0)


class WorkRuleRead(BaseModel):
    id: int
    department_id: int
    daily_minutes_planned: int
    break_minutes: int
    grace_minutes: int

    model_config = ConfigDict(from_attributes=True)


class DepartmentWeeklyRuleUpsert(BaseModel):
    department_id: int
    weekday: int = Field(ge=0, le=6)
    is_workday: bool = True
    planned_minutes: int = Field(default=540, ge=0)
    break_minutes: int = Field(default=60, ge=0)


class DepartmentWeeklyRuleRead(BaseModel):
    id: int
    department_id: int
    weekday: int
    is_workday: bool
    planned_minutes: int
    break_minutes: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DepartmentShiftUpsert(BaseModel):
    id: int | None = None
    department_id: int
    name: str = Field(min_length=1, max_length=100)
    start_time_local: str = Field(pattern=r"^\d{2}:\d{2}$")
    end_time_local: str = Field(pattern=r"^\d{2}:\d{2}$")
    break_minutes: int = Field(default=60, ge=0)
    is_active: bool = True


class DepartmentShiftRead(BaseModel):
    id: int
    department_id: int
    name: str
    start_time_local: str
    end_time_local: str
    break_minutes: int
    is_active: bool
    created_at: datetime
    updated_at: datetime


class QRCodeCreateRequest(BaseModel):
    name: str | None = Field(default=None, max_length=255)
    code_value: str = Field(min_length=1, max_length=255)
    code_type: QRCodeType = QRCodeType.BOTH
    is_active: bool = True


class QRCodeUpdateRequest(BaseModel):
    name: str | None = Field(default=None, max_length=255)
    code_value: str | None = Field(default=None, min_length=1, max_length=255)
    code_type: QRCodeType | None = None
    is_active: bool | None = None


class QRCodeAssignPointsRequest(BaseModel):
    point_ids: list[int] = Field(min_length=1)


class QRCodeRead(BaseModel):
    id: int
    name: str | None
    code_value: str
    code_type: QRCodeType
    is_active: bool
    point_ids: list[int] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class QRPointCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    lat: float
    lon: float
    radius_m: int = Field(default=75, ge=1)
    is_active: bool = True
    department_id: int | None = Field(default=None, ge=1)
    region_id: int | None = Field(default=None, ge=1)


class QRPointUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    lat: float | None = None
    lon: float | None = None
    radius_m: int | None = Field(default=None, ge=1)
    is_active: bool | None = None
    department_id: int | None = Field(default=None, ge=1)
    region_id: int | None = Field(default=None, ge=1)


class QRPointRead(BaseModel):
    id: int
    name: str
    lat: float
    lon: float
    radius_m: int
    is_active: bool
    department_id: int | None = None
    region_id: int | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SchedulePlanUpsertRequest(BaseModel):
    id: int | None = None
    department_id: int
    target_type: SchedulePlanTargetType
    target_employee_id: int | None = None
    target_employee_ids: list[int] | None = Field(default=None)
    shift_id: int | None = Field(default=None, ge=1)
    daily_minutes_planned: int | None = Field(default=None, ge=0)
    break_minutes: int | None = Field(default=None, ge=0)
    grace_minutes: int | None = Field(default=None, ge=0)
    start_date: date
    end_date: date
    is_locked: bool = False
    is_active: bool = True
    note: str | None = None


class SchedulePlanRead(BaseModel):
    id: int
    department_id: int
    target_type: SchedulePlanTargetType
    target_employee_id: int | None
    target_employee_ids: list[int] = Field(default_factory=list)
    shift_id: int | None
    daily_minutes_planned: int | None
    break_minutes: int | None
    grace_minutes: int | None
    start_date: date
    end_date: date
    is_locked: bool
    is_active: bool
    note: str | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class LaborProfileUpsertRequest(BaseModel):
    name: str = "TR_DEFAULT"
    weekly_normal_minutes_default: int = Field(default=2700, ge=1)
    daily_max_minutes: int = Field(default=660, ge=1)
    enforce_min_break_rules: bool = False
    night_work_max_minutes_default: int = Field(default=450, ge=1)
    night_work_exceptions_note_enabled: bool = True
    overtime_annual_cap_minutes: int = Field(default=16200, ge=1)
    overtime_premium: float = Field(default=1.5, ge=1.0)
    extra_work_premium: float = Field(default=1.25, ge=1.0)
    overtime_rounding_mode: OvertimeRoundingMode = OvertimeRoundingMode.OFF


class LaborProfileRead(BaseModel):
    id: int
    name: str
    weekly_normal_minutes_default: int
    daily_max_minutes: int
    enforce_min_break_rules: bool
    night_work_max_minutes_default: int
    night_work_exceptions_note_enabled: bool
    overtime_annual_cap_minutes: int
    overtime_premium: float
    extra_work_premium: float
    overtime_rounding_mode: OvertimeRoundingMode
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AttendanceEventCreate(BaseModel):
    device_fingerprint: str
    type: AttendanceType
    ts_utc: datetime | None = None
    lat: float | None = None
    lon: float | None = None
    accuracy_m: float | None = Field(default=None, ge=0)


class AttendanceEventRead(BaseModel):
    id: int
    employee_id: int
    device_id: int
    type: AttendanceType
    ts_utc: datetime
    lat: float | None
    lon: float | None
    accuracy_m: float | None
    location_status: LocationStatus
    flags: dict[str, Any] = Field(default_factory=dict)
    source: AttendanceEventSource = AttendanceEventSource.DEVICE
    created_by_admin: bool = False
    note: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    deleted_at: datetime | None = None
    deleted_by_admin: bool = False

    model_config = ConfigDict(from_attributes=True)


class AttendanceEventManualCreateRequest(BaseModel):
    employee_id: int
    type: AttendanceType
    ts_utc: datetime | None = None
    ts_local: datetime | None = None
    lat: float | None = None
    lon: float | None = None
    accuracy_m: float | None = Field(default=None, ge=0)
    note: str | None = None
    shift_id: int | None = Field(default=None, ge=1)
    allow_duplicate: bool = False


class AttendanceEventManualUpdateRequest(BaseModel):
    type: AttendanceType | None = None
    ts_utc: datetime | None = None
    ts_local: datetime | None = None
    note: str | None = None
    shift_id: int | None = Field(default=None, ge=1)
    allow_duplicate: bool = False
    force_edit: bool = False


class SoftDeleteResponse(BaseModel):
    ok: bool
    id: int


class AuditLogRead(BaseModel):
    id: int
    ts_utc: datetime
    actor_type: AuditActorType
    actor_id: str
    action: str
    entity_type: str | None = None
    entity_id: str | None = None
    ip: str | None = None
    user_agent: str | None = None
    success: bool
    details: dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(from_attributes=True)


class NotificationJobRead(BaseModel):
    id: int
    employee_id: int | None
    admin_user_id: int | None
    job_type: str
    payload: dict[str, Any] = Field(default_factory=dict)
    scheduled_at_utc: datetime
    status: Literal["PENDING", "SENDING", "SENT", "CANCELED", "FAILED"]
    attempts: int
    last_error: str | None = None
    idempotency_key: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class EmployeePushConfigResponse(BaseModel):
    enabled: bool
    vapid_public_key: str | None = None


class EmployeePushSubscribeRequest(BaseModel):
    device_fingerprint: str
    subscription: dict[str, Any]
    send_test: bool = False


class EmployeePushSubscribeResponse(BaseModel):
    ok: bool
    subscription_id: int
    test_push_ok: bool | None = None
    test_push_error: str | None = None
    test_push_status_code: int | None = None


class EmployeePushUnsubscribeRequest(BaseModel):
    device_fingerprint: str
    endpoint: str


class EmployeePushUnsubscribeResponse(BaseModel):
    ok: bool


class AdminPushSubscriptionRead(BaseModel):
    id: int
    device_id: int
    employee_id: int
    endpoint: str
    is_active: bool
    user_agent: str | None = None
    last_error: str | None = None
    created_at: datetime
    updated_at: datetime
    last_seen_at: datetime


class AdminDevicePushSubscriptionRead(BaseModel):
    id: int
    admin_user_id: int | None = None
    admin_username: str
    endpoint: str
    is_active: bool
    user_agent: str | None = None
    last_error: str | None = None
    created_at: datetime
    updated_at: datetime
    last_seen_at: datetime


class AdminDeviceInviteCreateRequest(BaseModel):
    expires_in_minutes: int = Field(default=60, ge=1, le=60 * 24 * 30)


class AdminDeviceInviteCreateResponse(BaseModel):
    token: str
    invite_url: str
    expires_at: datetime


class AdminDeviceClaimRequest(BaseModel):
    token: str = Field(min_length=8, max_length=255)
    subscription: dict[str, Any]


class AdminDeviceClaimResponse(BaseModel):
    ok: bool
    admin_username: str
    subscription_id: int


class AdminPushSelfCheckResponse(BaseModel):
    push_enabled: bool
    actor_username: str
    actor_admin_user_id: int | None = None
    active_total_subscriptions: int
    active_claims_for_actor: int
    active_claims_for_actor_by_id: int
    active_claims_for_actor_by_username: int
    latest_claim_seen_at: datetime | None = None
    latest_claim_error: str | None = None
    ready_for_receive: bool
    has_other_active_subscriptions: bool


class AdminPushSelfTestResponse(BaseModel):
    ok: bool
    total_targets: int
    sent: int
    failed: int
    deactivated: int = 0
    admin_user_ids: list[int] = Field(default_factory=list)
    admin_usernames: list[str] = Field(default_factory=list)


class AdminDailyReportArchiveRead(BaseModel):
    id: int
    report_date: date
    department_id: int | None = None
    region_id: int | None = None
    file_name: str
    file_size_bytes: int
    employee_count: int = 0
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AdminDailyReportArchiveNotifyRequest(BaseModel):
    admin_user_ids: list[int] | None = None


class AdminDailyReportArchiveNotifyResponse(BaseModel):
    ok: bool
    archive_id: int
    archive_url: str
    total_targets: int
    sent: int
    failed: int
    deactivated: int = 0
    admin_user_ids: list[int] = Field(default_factory=list)
    admin_usernames: list[str] = Field(default_factory=list)


class AdminDailyReportArchivePasswordDownloadRequest(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=128)


class AdminManualNotificationSendRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    message: str = Field(min_length=1, max_length=2000)
    password: str = Field(min_length=1, max_length=128)
    target: Literal["employees", "admins", "both"] = "employees"
    employee_ids: list[int] | None = None
    admin_user_ids: list[int] | None = None


class AdminManualNotificationSendResponse(BaseModel):
    ok: bool
    total_targets: int
    sent: int
    failed: int
    deactivated: int = 0
    employee_ids: list[int] = Field(default_factory=list)
    admin_user_ids: list[int] = Field(default_factory=list)
    admin_usernames: list[str] = Field(default_factory=list)


class NotificationDeliveryLogRead(BaseModel):
    audit_id: int
    sent_at_utc: datetime
    sender_admin: str
    target: str
    title: str | None = None
    recipient_type: Literal["employee", "admin"]
    recipient_id: int | None = None
    recipient_name: str | None = None
    device_id: int | None = None
    endpoint: str | None = None
    ip: str | None = None
    status: Literal["SENT", "FAILED"]
    error: str | None = None


class CheckinQrPayload(BaseModel):
    site_id: str
    type: Literal["IN"]
    shift_id: int | None = Field(default=None, ge=1)


class AttendanceCheckinRequest(BaseModel):
    device_fingerprint: str
    qr: CheckinQrPayload
    lat: float | None = None
    lon: float | None = None
    accuracy_m: float | None = Field(default=None, ge=0)


class AttendanceCheckoutRequest(BaseModel):
    device_fingerprint: str
    lat: float | None = None
    lon: float | None = None
    accuracy_m: float | None = Field(default=None, ge=0)
    manual: bool = False


class EmployeeQrScanRequest(BaseModel):
    code_value: str = Field(min_length=1, max_length=255)
    lat: float
    lon: float
    accuracy_m: float | None = Field(default=None, ge=0)
    device_fingerprint: str


class EmployeeQrScanDeniedResponse(BaseModel):
    reason: str
    closest_distance_m: int | None = None


class AttendanceActionResponse(BaseModel):
    ok: bool
    employee_id: int
    event_id: int
    event_type: AttendanceType
    ts_utc: datetime
    location_status: LocationStatus
    flags: dict[str, Any] = Field(default_factory=dict)
    shift_id: int | None = None


class EmployeeStatusResponse(BaseModel):
    employee_id: int
    today_status: Literal["NOT_STARTED", "IN_PROGRESS", "FINISHED"]
    last_in_ts: datetime | None = None
    last_out_ts: datetime | None = None
    last_location_status: LocationStatus | None = None
    last_flags: dict[str, Any] = Field(default_factory=dict)
    passkey_registered: bool | None = None


class EmployeeHomeLocationSetRequest(BaseModel):
    device_fingerprint: str
    home_lat: float
    home_lon: float
    radius_m: int = Field(default=300, ge=1)


class EmployeeHomeLocationSetResponse(BaseModel):
    ok: bool
    employee_id: int
    home_lat: float
    home_lon: float
    radius_m: int


class ManualDayOverrideUpsertRequest(BaseModel):
    day_date: date
    in_time: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    out_time: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    is_absent: bool = False
    rule_source_override: Literal["AUTO", "SHIFT", "WEEKLY", "WORK_RULE"] = "AUTO"
    rule_shift_id_override: int | None = Field(default=None, ge=1)
    note: str | None = None


class ManualDayOverrideRead(BaseModel):
    id: int
    employee_id: int
    day_date: date
    in_ts: datetime | None
    out_ts: datetime | None
    is_absent: bool
    rule_source_override: Literal["SHIFT", "WEEKLY", "WORK_RULE"] | None = None
    rule_shift_id_override: int | None = None
    note: str | None
    created_by: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MonthlyEmployeeDay(BaseModel):
    date: date
    status: Literal["OK", "INCOMPLETE", "LEAVE", "OFF"]
    check_in: datetime | None = Field(default=None, serialization_alias="in")
    check_out: datetime | None = Field(default=None, serialization_alias="out")
    check_in_lat: float | None = Field(default=None, serialization_alias="in_lat")
    check_in_lon: float | None = Field(default=None, serialization_alias="in_lon")
    check_out_lat: float | None = Field(default=None, serialization_alias="out_lat")
    check_out_lon: float | None = Field(default=None, serialization_alias="out_lon")
    worked_minutes: int
    overtime_minutes: int
    plan_overtime_minutes: int = 0
    legal_extra_work_minutes: int = 0
    legal_overtime_minutes: int = 0
    missing_minutes: int = 0
    rule_source: Literal["SHIFT", "WEEKLY", "WORK_RULE"] = "WORK_RULE"
    applied_planned_minutes: int = 0
    applied_break_minutes: int = 0
    leave_type: LeaveType | None = None
    shift_id: int | None = None
    shift_name: str | None = None
    flags: list[str] = Field(default_factory=list)


class MonthlyEmployeeTotals(BaseModel):
    worked_minutes: int
    overtime_minutes: int
    plan_overtime_minutes: int = 0
    legal_extra_work_minutes: int = 0
    legal_overtime_minutes: int = 0
    incomplete_days: int


class MonthlyEmployeeWeek(BaseModel):
    week_start: date
    week_end: date
    normal_minutes: int
    extra_work_minutes: int
    overtime_minutes: int
    flags: list[str] = Field(default_factory=list)


class MonthlyEmployeeResponse(BaseModel):
    employee_id: int
    year: int
    month: int
    days: list[MonthlyEmployeeDay]
    totals: MonthlyEmployeeTotals
    worked_minutes_net: int
    weekly_totals: list[MonthlyEmployeeWeek] = Field(default_factory=list)
    annual_overtime_used_minutes: int
    annual_overtime_remaining_minutes: int
    annual_overtime_cap_exceeded: bool
    labor_profile: LaborProfileRead | None = None


class DepartmentMonthlySummaryItem(BaseModel):
    department_id: int
    department_name: str
    region_id: int | None = None
    region_name: str | None = None
    worked_minutes: int
    overtime_minutes: int
    plan_overtime_minutes: int = 0
    legal_extra_work_minutes: int = 0
    legal_overtime_minutes: int = 0
    employee_count: int

