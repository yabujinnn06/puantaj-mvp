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
    first_location: EmployeeLiveLocationRead | None = None
    recent_locations: list[EmployeeLiveLocationRead] = Field(default_factory=list)
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


class ControlRoomEmployeeAlertRead(BaseModel):
    code: str
    label: str
    severity: Literal["info", "warning", "critical"] = "info"


class ControlRoomTooltipRead(BaseModel):
    title: str
    body: str


class ControlRoomRiskFactorRead(BaseModel):
    code: str
    label: str
    value: str
    impact_score: int
    description: str


class ControlRoomMeasureRead(BaseModel):
    action_type: Literal["SUSPEND", "DISABLE_TEMP", "REVIEW", "RISK_OVERRIDE"]
    label: str
    reason: str
    note: str
    duration_days: int | None = None
    expires_at: datetime | None = None
    created_at: datetime
    created_by: str
    ip: str | None = None
    override_score: int | None = None


class ControlRoomNoteRead(BaseModel):
    note: str
    created_at: datetime
    created_by: str
    ip: str | None = None


class ControlRoomAuditEntryRead(BaseModel):
    audit_id: int
    action: str
    label: str
    ts_utc: datetime
    actor_id: str
    ip: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)


class ControlRoomEmployeeStateRead(BaseModel):
    employee: EmployeeRead
    department_name: str | None = None
    shift_name: str | None = None
    shift_window_label: str | None = None
    today_status: Literal["NOT_STARTED", "IN_PROGRESS", "FINISHED"] = "NOT_STARTED"
    location_state: Literal["LIVE", "STALE", "DORMANT", "NONE"] = "NONE"
    last_event: DashboardEmployeeLastEventRead | None = None
    last_checkin_utc: datetime | None = None
    last_checkout_utc: datetime | None = None
    latest_location: EmployeeLiveLocationRead | None = None
    last_portal_seen_utc: datetime | None = None
    last_activity_utc: datetime | None = None
    recent_ip: str | None = None
    location_label: str | None = None
    active_devices: int = 0
    total_devices: int = 0
    current_month: DashboardEmployeeMonthMetricsRead
    worked_today_minutes: int = 0
    weekly_total_minutes: int = 0
    violation_count_7d: int = 0
    risk_score: int = 0
    risk_status: Literal["NORMAL", "WATCH", "CRITICAL"] = "NORMAL"
    absence_minutes_7d: int = 0
    active_measure: ControlRoomMeasureRead | None = None
    latest_note: ControlRoomNoteRead | None = None
    attention_flags: list[ControlRoomEmployeeAlertRead] = Field(default_factory=list)
    tooltip_items: list[ControlRoomTooltipRead] = Field(default_factory=list)
    risk_factors: list[ControlRoomRiskFactorRead] = Field(default_factory=list)


class ControlRoomMapPointRead(BaseModel):
    employee_id: int
    employee_name: str
    department_name: str | None = None
    lat: float
    lon: float
    ts_utc: datetime
    accuracy_m: float | None = None
    today_status: Literal["NOT_STARTED", "IN_PROGRESS", "FINISHED"] = "NOT_STARTED"
    location_state: Literal["LIVE", "STALE", "DORMANT", "NONE"] = "NONE"
    label: str


class ControlRoomRecentEventRead(BaseModel):
    event_id: int
    employee_id: int
    employee_name: str
    department_name: str | None = None
    event_type: AttendanceType
    ts_utc: datetime
    location_status: LocationStatus
    device_id: int
    lat: float | None = None
    lon: float | None = None
    accuracy_m: float | None = None


class ControlRoomTrendPointRead(BaseModel):
    label: str
    value: int


class ControlRoomHistogramBucketRead(BaseModel):
    label: str
    min_score: int
    max_score: int
    count: int


class ControlRoomDepartmentMetricRead(BaseModel):
    department_name: str
    employee_count: int
    average_checkin_minutes: int | None = None
    late_rate_percent: float = 0
    average_active_minutes: int = 0


class ControlRoomRiskFormulaItemRead(BaseModel):
    code: str
    label: str
    max_score: int
    description: str


class ControlRoomActiveFiltersRead(BaseModel):
    q: str | None = None
    region_id: int | None = None
    department_id: int | None = None
    start_date: date | None = None
    end_date: date | None = None
    map_date: date | None = None
    include_inactive: bool = False
    risk_min: int | None = None
    risk_max: int | None = None
    risk_status: Literal["NORMAL", "WATCH", "CRITICAL"] | None = None
    sort_by: str = "risk_score"
    sort_dir: Literal["asc", "desc"] = "desc"
    limit: int = 24
    offset: int = 0


class ControlRoomSummaryRead(BaseModel):
    total_employees: int = 0
    active_employees: int = 0
    not_started_count: int = 0
    in_progress_count: int = 0
    finished_count: int = 0
    normal_count: int = 0
    watch_count: int = 0
    critical_count: int = 0
    average_checkin_minutes: int | None = None
    late_rate_percent: float = 0
    average_active_minutes: int = 0
    most_common_violation_window: str | None = None
    risk_histogram: list[ControlRoomHistogramBucketRead] = Field(default_factory=list)
    weekly_trend: list[ControlRoomTrendPointRead] = Field(default_factory=list)
    department_metrics: list[ControlRoomDepartmentMetricRead] = Field(default_factory=list)


class ControlRoomOverviewResponse(BaseModel):
    generated_at_utc: datetime
    total: int = 0
    offset: int = 0
    limit: int = 0
    summary: ControlRoomSummaryRead
    active_filters: ControlRoomActiveFiltersRead
    risk_formula: list[ControlRoomRiskFormulaItemRead] = Field(default_factory=list)
    items: list[ControlRoomEmployeeStateRead] = Field(default_factory=list)
    map_points: list[ControlRoomMapPointRead] = Field(default_factory=list)
    recent_events: list[ControlRoomRecentEventRead] = Field(default_factory=list)


class ControlRoomEmployeeDetailResponse(BaseModel):
    generated_at_utc: datetime
    employee_state: ControlRoomEmployeeStateRead
    risk_formula: list[ControlRoomRiskFormulaItemRead] = Field(default_factory=list)
    recent_measures: list[ControlRoomMeasureRead] = Field(default_factory=list)
    recent_notes: list[ControlRoomNoteRead] = Field(default_factory=list)
    recent_audit_entries: list[ControlRoomAuditEntryRead] = Field(default_factory=list)


class ControlRoomEmployeeActionRequest(BaseModel):
    employee_id: int = Field(ge=1)
    action_type: Literal["SUSPEND", "DISABLE_TEMP", "REVIEW"]
    reason: str = Field(min_length=3, max_length=255)
    note: str = Field(min_length=3, max_length=1000)
    duration_days: Literal[1, 3, 7] | None = None
    indefinite: bool = False

    @model_validator(mode="after")
    def validate_duration(self) -> "ControlRoomEmployeeActionRequest":
        if self.indefinite and self.duration_days is not None:
            raise ValueError("duration_days must be empty when indefinite is true")
        if not self.indefinite and self.duration_days is None:
            raise ValueError("duration_days is required unless indefinite is true")
        return self


class ControlRoomRiskOverrideRequest(BaseModel):
    employee_id: int = Field(ge=1)
    override_score: int = Field(ge=0, le=100)
    reason: str = Field(min_length=3, max_length=255)
    note: str = Field(min_length=3, max_length=1000)
    duration_days: Literal[1, 3, 7] | None = None
    indefinite: bool = False

    @model_validator(mode="after")
    def validate_duration(self) -> "ControlRoomRiskOverrideRequest":
        if self.indefinite and self.duration_days is not None:
            raise ValueError("duration_days must be empty when indefinite is true")
        if not self.indefinite and self.duration_days is None:
            raise ValueError("duration_days is required unless indefinite is true")
        return self


class ControlRoomNoteCreateRequest(BaseModel):
    employee_id: int = Field(ge=1)
    note: str = Field(min_length=3, max_length=1000)


class ControlRoomFilterAuditRequest(BaseModel):
    filters: dict[str, Any] = Field(default_factory=dict)
    total_results: int | None = Field(default=None, ge=0)


class ControlRoomMutationResponse(BaseModel):
    ok: bool
    message: str
    expires_at: datetime | None = None


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


class RecoveryCodeAdminEntry(BaseModel):
    code: str
    status: Literal["ACTIVE", "USED_OR_EXPIRED"]


class EmployeeDeviceOverviewDevice(BaseModel):
    id: int
    device_fingerprint: str
    is_active: bool
    created_at: datetime
    recovery_ready: bool = False
    recovery_code_active_count: int = 0
    recovery_expires_at: datetime | None = None
    recovery_pin_updated_at: datetime | None = None
    recovery_pin_plain: str | None = None
    recovery_code_entries: list[RecoveryCodeAdminEntry] = Field(default_factory=list)


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
    expires_in_minutes: int = Field(ge=1, le=60 * 24)

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


class RecoveryCodeIssueRequest(BaseModel):
    device_fingerprint: str
    recovery_pin: str = Field(min_length=6, max_length=12)


class RecoveryCodeIssueResponse(BaseModel):
    ok: bool
    employee_id: int
    device_id: int
    code_count: int
    expires_at: datetime
    recovery_codes: list[str] = Field(default_factory=list)


class RecoveryCodeStatusResponse(BaseModel):
    employee_id: int
    device_id: int
    recovery_ready: bool
    active_code_count: int
    expires_at: datetime | None = None


class RecoveryCodeRecoverRequest(BaseModel):
    employee_id: int = Field(ge=1)
    recovery_pin: str = Field(min_length=6, max_length=12)
    recovery_code: str = Field(min_length=4, max_length=32)


class RecoveryCodeRecoverResponse(BaseModel):
    ok: bool
    employee_id: int
    device_id: int
    device_fingerprint: str


class AdminLoginRequest(BaseModel):
    username: str
    password: str
    mfa_code: str | None = Field(default=None, max_length=10)
    mfa_recovery_code: str | None = Field(default=None, max_length=64)


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
    mfa_enabled: bool = False
    mfa_secret_configured: bool = False
    claim_total: int = 0
    claim_active_total: int = 0
    claim_inactive_total: int = 0
    permissions: dict[str, AdminPermissionValue] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AdminPushClaimDetailRead(BaseModel):
    id: int
    admin_user_id: int | None = None
    admin_username: str
    is_active: bool
    endpoint: str
    endpoint_fingerprint: str
    user_agent: str | None = None
    last_error: str | None = None
    created_at: datetime
    updated_at: datetime
    last_seen_at: datetime


class AdminPushClaimActiveUpdateRequest(BaseModel):
    is_active: bool


class AdminDeviceInviteDetailRead(BaseModel):
    id: int
    status: Literal["PENDING", "USED", "EXPIRED"]
    expires_at: datetime
    is_used: bool
    attempt_count: int
    max_attempts: int
    created_by_admin_user_id: int | None = None
    created_by_username: str
    used_by_admin_user_id: int | None = None
    used_by_username: str | None = None
    created_at: datetime
    used_at: datetime | None = None


class AdminUserClaimDetailResponse(BaseModel):
    admin_user: AdminUserRead
    claim_total: int
    claim_active_total: int
    claim_inactive_total: int
    claims: list[AdminPushClaimDetailRead] = Field(default_factory=list)
    created_invites: list[AdminDeviceInviteDetailRead] = Field(default_factory=list)
    used_invites: list[AdminDeviceInviteDetailRead] = Field(default_factory=list)


class AdminUserMfaStatusResponse(BaseModel):
    admin_user_id: int
    username: str
    mfa_enabled: bool
    has_secret: bool
    recovery_code_active_count: int
    recovery_code_total_count: int
    recovery_code_expires_at: datetime | None = None
    updated_at: datetime | None = None


class AdminUserMfaSetupStartResponse(BaseModel):
    admin_user_id: int
    username: str
    issuer: str
    secret_key: str
    otpauth_uri: str


class AdminUserMfaSetupConfirmRequest(BaseModel):
    code: str = Field(min_length=6, max_length=10)


class AdminUserMfaSetupConfirmResponse(BaseModel):
    ok: bool
    mfa_enabled: bool
    recovery_codes: list[str] = Field(default_factory=list)
    recovery_code_expires_at: datetime


class AdminUserMfaRecoveryRegenerateRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)


class AdminUserMfaRecoveryRegenerateResponse(BaseModel):
    ok: bool
    recovery_codes: list[str] = Field(default_factory=list)
    recovery_code_expires_at: datetime


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


class AuditLogPageResponse(BaseModel):
    items: list[AuditLogRead] = Field(default_factory=list)
    total: int = 0
    offset: int = 0
    limit: int = 0


class NotificationJobRead(BaseModel):
    id: int
    employee_id: int | None
    admin_user_id: int | None
    job_type: str
    notification_type: str | None = None
    audience: str | None = None
    risk_level: str | None = None
    event_id: str | None = None
    event_hash: str | None = None
    local_day: date | None = None
    event_ts_utc: datetime | None = None
    title: str | None = None
    description: str | None = None
    shift_summary: str | None = None
    actual_time_summary: str | None = None
    suggested_action: str | None = None
    admin_note: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    scheduled_at_utc: datetime
    status: Literal["PENDING", "SENDING", "SENT", "CANCELED", "FAILED"]
    attempts: int
    last_error: str | None = None
    idempotency_key: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class NotificationJobPageResponse(BaseModel):
    items: list[NotificationJobRead] = Field(default_factory=list)
    total: int = 0
    offset: int = 0
    limit: int = 0


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
    expires_in_minutes: int = Field(default=15, ge=1, le=60 * 24)


class AdminDeviceInviteCreateResponse(BaseModel):
    token: str
    invite_url: str
    expires_at: datetime


class AdminDeviceClaimRequest(BaseModel):
    token: str = Field(min_length=8, max_length=255)
    subscription: dict[str, Any]


class AdminDeviceClaimPublicRequest(BaseModel):
    token: str = Field(min_length=8, max_length=255)
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=128)
    subscription: dict[str, Any]


class AdminDeviceClaimResponse(BaseModel):
    ok: bool
    admin_username: str
    subscription_id: int


class AdminDeviceHealRequest(BaseModel):
    subscription: dict[str, Any]
    send_test: bool = True


class AdminDeviceHealResponse(BaseModel):
    ok: bool
    admin_username: str
    subscription_id: int
    test_push_ok: bool | None = None
    test_push_error: str | None = None
    test_push_status_code: int | None = None


class AdminPushSelfCheckResponse(BaseModel):
    push_enabled: bool
    actor_username: str
    actor_admin_user_id: int | None = None
    active_total_subscriptions: int
    active_claims_for_actor: int
    active_claims_for_actor_by_id: int
    active_claims_for_actor_by_username: int
    active_claims_healthy: int = 0
    active_claims_with_error: int = 0
    active_claims_stale: int = 0
    latest_claim_seen_at: datetime | None = None
    latest_claim_error: str | None = None
    last_self_test_at: datetime | None = None
    last_self_test_total_targets: int | None = None
    last_self_test_sent: int | None = None
    last_self_test_failed: int | None = None
    last_self_test_success: bool | None = None
    ready_for_receive: bool
    has_other_active_subscriptions: bool
    self_check_ok: bool = True
    self_check_error: str | None = None


class AdminPushSelfTestResponse(BaseModel):
    ok: bool
    total_targets: int
    sent: int
    failed: int
    deactivated: int = 0
    admin_user_ids: list[int] = Field(default_factory=list)
    admin_usernames: list[str] = Field(default_factory=list)


class AdminDailyReportJobHealthResponse(BaseModel):
    report_date: date
    evaluated_at_utc: datetime | None = None
    evaluated_local_time: datetime | None = None
    idempotency_key: str
    job_exists: bool
    job_id: int | None = None
    archive_exists: bool = False
    archive_id: int | None = None
    archive_created_at_utc: datetime | None = None
    archive_employee_count: int = 0
    archive_file_size_bytes: int = 0
    status: str | None = None
    scheduled_at_utc: datetime | None = None
    job_created_at_utc: datetime | None = None
    job_updated_at_utc: datetime | None = None
    attempts: int = 0
    last_error: str | None = None
    push_total_targets: int = 0
    push_sent: int = 0
    push_failed: int = 0
    email_sent: int = 0
    delivery_succeeded: bool = False
    target_zero: bool = False
    alarms: list[str] = Field(default_factory=list)


class AdminNotificationEmailTargetRead(BaseModel):
    id: int
    email: str
    is_active: bool
    created_by_username: str | None = None
    updated_by_username: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AdminNotificationEmailTargetsResponse(BaseModel):
    recipients: list[AdminNotificationEmailTargetRead] = Field(default_factory=list)
    active_recipients: list[str] = Field(default_factory=list)
    active_count: int = 0


class AdminNotificationEmailTargetsUpdateRequest(BaseModel):
    emails: list[str] = Field(default_factory=list)


class AdminNotificationEmailTestRequest(BaseModel):
    recipients: list[str] | None = None
    subject: str | None = Field(default=None, max_length=200)
    message: str | None = Field(default=None, max_length=4000)


class AdminNotificationEmailTestResponse(BaseModel):
    ok: bool
    sent: int
    mode: str
    recipients: list[str] = Field(default_factory=list)
    configured: bool
    error: str | None = None
    channel: dict[str, Any] = Field(default_factory=dict)


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


class AdminDailyReportArchivePageResponse(BaseModel):
    items: list[AdminDailyReportArchiveRead] = Field(default_factory=list)
    total: int = 0
    offset: int = 0
    limit: int = 0


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


class AdminAttendanceExtraCheckinApprovalRead(BaseModel):
    approval_id: int
    employee_id: int
    employee_name: str
    device_id: int | None = None
    local_day: date
    status: Literal["PENDING", "APPROVED", "CONSUMED", "EXPIRED"]
    requested_at: datetime
    expires_at: datetime
    approved_at: datetime | None = None
    approved_by_username: str | None = None
    consumed_at: datetime | None = None
    push_total_targets: int = 0
    push_sent: int = 0
    push_failed: int = 0
    last_push_at: datetime | None = None


class AdminAttendanceExtraCheckinApprovalApproveRequest(BaseModel):
    token: str = Field(min_length=16, max_length=255)
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=128)


class AdminAttendanceExtraCheckinApprovalApproveResponse(BaseModel):
    ok: bool
    approval: AdminAttendanceExtraCheckinApprovalRead
    already_processed: bool = False


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
    employee_total_targets: int = 0
    employee_sent: int = 0
    employee_failed: int = 0
    employee_deactivated: int = 0
    admin_total_targets: int = 0
    admin_sent: int = 0
    admin_failed: int = 0
    admin_deactivated: int = 0
    admin_target_missing: bool = False


class NotificationDeliveryLogRead(BaseModel):
    id: int
    notification_job_id: int | None = None
    event_id: str
    notification_type: str | None = None
    audience: str | None = None
    sent_at_utc: datetime
    title: str | None = None
    recipient_type: Literal["employee", "admin"]
    recipient_id: int | None = None
    recipient_name: str | None = None
    recipient_address: str | None = None
    device_id: int | None = None
    endpoint: str | None = None
    ip: str | None = None
    channel: Literal["push", "email"]
    status: Literal["PENDING", "SENT", "FAILED"]
    error: str | None = None


class NotificationJobNoteUpdateRequest(BaseModel):
    admin_note: str | None = Field(default=None, max_length=4000)


class NotificationDeliveryLogPageResponse(BaseModel):
    items: list[NotificationDeliveryLogRead] = Field(default_factory=list)
    total: int = 0
    offset: int = 0
    limit: int = 0


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
    employee_name: str | None = None
    region_name: str | None = None
    department_name: str | None = None
    shift_name: str | None = None
    shift_start_local: str | None = None
    shift_end_local: str | None = None
    today_status: Literal["NOT_STARTED", "IN_PROGRESS", "FINISHED"]
    last_in_ts: datetime | None = None
    last_out_ts: datetime | None = None
    last_location_status: LocationStatus | None = None
    last_flags: dict[str, Any] = Field(default_factory=dict)
    has_open_shift: bool | None = None
    suggested_action: Literal["CHECKIN", "CHECKOUT", "WAIT_NEXT_DAY"] | None = None
    last_checkin_time_utc: datetime | None = None
    completed_cycles_today: int | None = None
    home_location_required: bool | None = None
    passkey_registered: bool | None = None


class EmployeeInstallFunnelEventRequest(BaseModel):
    device_fingerprint: str = Field(min_length=8, max_length=255)
    event: Literal[
        "banner_shown",
        "install_cta_clicked",
        "ios_onboarding_opened",
        "android_onboarding_opened",
        "install_prompt_opened",
        "install_prompt_accepted",
        "install_prompt_dismissed",
        "app_installed",
        "ios_inapp_browser_detected",
        "install_link_copied",
    ]
    occurred_at_ms: int | None = Field(default=None, ge=0)
    context: dict[str, Any] = Field(default_factory=dict)


class EmployeeInstallFunnelEventResponse(BaseModel):
    ok: bool


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

