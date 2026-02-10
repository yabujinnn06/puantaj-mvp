from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

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
    devices: list[EmployeeDeviceDetailRead] = Field(default_factory=list)
    latest_location: EmployeeLiveLocationRead | None = None
    recent_activity: list[EmployeePortalActivityRead] = Field(default_factory=list)


class EmployeeActiveUpdateRequest(BaseModel):
    is_active: bool


class EmployeeShiftUpdateRequest(BaseModel):
    shift_id: int | None = Field(default=None, ge=1)


class EmployeeDepartmentUpdateRequest(BaseModel):
    department_id: int | None = Field(default=None, ge=1)


class EmployeeRegionUpdateRequest(BaseModel):
    region_id: int | None = Field(default=None, ge=1)


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
    employee_id: int
    expires_in_minutes: int = Field(ge=1)


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
    worked_minutes: int
    overtime_minutes: int
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
    employee_count: int

