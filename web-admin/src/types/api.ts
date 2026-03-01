export type AttendanceType = 'IN' | 'OUT'
export type LocationStatus = 'VERIFIED_HOME' | 'UNVERIFIED_LOCATION' | 'NO_LOCATION'
export type AttendanceEventSource = 'DEVICE' | 'MANUAL'
export type SchedulePlanTargetType = 'DEPARTMENT' | 'DEPARTMENT_EXCEPT_EMPLOYEE' | 'ONLY_EMPLOYEE'

export type LeaveType = 'ANNUAL' | 'SICK' | 'UNPAID' | 'EXCUSE' | 'PUBLIC_HOLIDAY'
export type LeaveStatus = 'APPROVED' | 'PENDING' | 'REJECTED'

export interface Region {
  id: number
  name: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Department {
  id: number
  name: string
  region_id: number | null
  region_name: string | null
}

export interface Employee {
  id: number
  full_name: string
  region_id: number | null
  region_name: string | null
  department_id: number | null
  shift_id: number | null
  is_active: boolean
  contract_weekly_minutes?: number | null
}

export interface EmployeeDeviceDetail {
  id: number
  device_fingerprint: string
  is_active: boolean
  created_at: string
  last_attendance_ts_utc: string | null
  last_seen_ip: string | null
  last_seen_action: string | null
  last_seen_at_utc: string | null
}

export interface EmployeePortalActivity {
  ts_utc: string
  action: string
  ip: string | null
  user_agent: string | null
}

export interface EmployeeIpSummary {
  ip: string
  last_seen_at_utc: string
  last_action: string
  last_lat: number | null
  last_lon: number | null
  last_accuracy_m: number | null
  last_location_status: LocationStatus | null
  last_location_ts_utc: string | null
}

export interface EmployeeLiveLocation {
  lat: number
  lon: number
  accuracy_m: number | null
  ts_utc: string
  location_status: LocationStatus
  event_type: AttendanceType
  device_id: number
}

export interface EmployeeDetail {
  employee: Employee
  last_portal_seen_utc: string | null
  recent_ips: string[]
  ip_summary: EmployeeIpSummary[]
  devices: EmployeeDeviceDetail[]
  latest_location: EmployeeLiveLocation | null
  first_location: EmployeeLiveLocation | null
  recent_locations: EmployeeLiveLocation[]
  home_location: EmployeeLocation | null
  recent_activity: EmployeePortalActivity[]
}

export type EmployeeStatusFilter = 'active' | 'inactive' | 'all'

export interface Device {
  id: number
  employee_id: number
  device_fingerprint: string
  is_active: boolean
  created_at: string
  last_seen?: string | null
}

export interface EmployeeDeviceOverviewDevice {
  id: number
  device_fingerprint: string
  is_active: boolean
  created_at: string
  recovery_ready: boolean
  recovery_code_active_count: number
  recovery_expires_at: string | null
  recovery_pin_updated_at: string | null
  recovery_pin_plain: string | null
  recovery_code_entries: RecoveryCodeAdminEntry[]
}

export interface RecoveryCodeAdminEntry {
  code: string
  status: 'ACTIVE' | 'USED_OR_EXPIRED'
}

export interface EmployeeDeviceOverview {
  employee_id: number
  employee_name: string
  region_id: number | null
  region_name: string | null
  department_id: number | null
  department_name: string | null
  is_employee_active: boolean
  total_devices: number
  active_devices: number
  shown_devices: number
  has_more_devices: boolean
  token_total: number
  token_used: number
  token_pending: number
  token_expired: number
  devices: EmployeeDeviceOverviewDevice[]
}

export interface EmployeeLocation {
  id: number
  employee_id: number
  home_lat: number
  home_lon: number
  radius_m: number
  updated_at: string
}

export interface WorkRule {
  id: number
  department_id: number
  daily_minutes_planned: number
  break_minutes: number
  grace_minutes: number
}

export interface DepartmentWeeklyRule {
  id: number
  department_id: number
  weekday: number
  is_workday: boolean
  planned_minutes: number
  break_minutes: number
  created_at: string
  updated_at: string
}

export interface DepartmentShift {
  id: number
  department_id: number
  name: string
  start_time_local: string
  end_time_local: string
  break_minutes: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export type QrCodeType = 'CHECKIN' | 'CHECKOUT' | 'BOTH'

export interface QrCode {
  id: number
  name: string | null
  code_value: string
  code_type: QrCodeType
  is_active: boolean
  point_ids: number[]
  created_at: string
  updated_at: string
}

export interface QrPoint {
  id: number
  name: string
  lat: number
  lon: number
  radius_m: number
  is_active: boolean
  department_id: number | null
  region_id: number | null
  created_at: string
  updated_at: string
}

export interface AttendanceEvent {
  id: number
  employee_id: number
  device_id: number
  type: AttendanceType
  ts_utc: string
  lat: number | null
  lon: number | null
  accuracy_m: number | null
  location_status: LocationStatus
  flags: Record<string, unknown>
  source: AttendanceEventSource
  created_by_admin: boolean
  note: string | null
  created_at: string | null
  updated_at: string | null
  deleted_at: string | null
  deleted_by_admin: boolean
}

export interface SchedulePlan {
  id: number
  department_id: number
  target_type: SchedulePlanTargetType
  target_employee_id: number | null
  target_employee_ids: number[]
  shift_id: number | null
  daily_minutes_planned: number | null
  break_minutes: number | null
  grace_minutes: number | null
  start_date: string
  end_date: string
  is_locked: boolean
  is_active: boolean
  note: string | null
  created_at: string
  updated_at: string
}

export type AuditActorType = 'ADMIN' | 'SYSTEM'

export interface AuditLog {
  id: number
  ts_utc: string
  actor_type: AuditActorType
  actor_id: string
  action: string
  entity_type: string | null
  entity_id: string | null
  ip: string | null
  user_agent: string | null
  success: boolean
  details: Record<string, unknown>
}

export type NotificationJobStatus = 'PENDING' | 'SENDING' | 'SENT' | 'CANCELED' | 'FAILED'

export interface NotificationJob {
  id: number
  employee_id: number | null
  admin_user_id: number | null
  job_type: string
  payload: Record<string, unknown>
  scheduled_at_utc: string
  status: NotificationJobStatus
  attempts: number
  last_error: string | null
  idempotency_key: string
  created_at: string
  updated_at: string
}

export interface NotificationDeliveryLog {
  audit_id: number
  sent_at_utc: string
  sender_admin: string
  target: string
  title: string | null
  recipient_type: 'employee' | 'admin'
  recipient_id: number | null
  recipient_name: string | null
  device_id: number | null
  endpoint: string | null
  ip: string | null
  status: 'SENT' | 'FAILED'
  error: string | null
}

export interface AdminPushSubscription {
  id: number
  device_id: number
  employee_id: number
  endpoint: string
  is_active: boolean
  user_agent: string | null
  last_error: string | null
  created_at: string
  updated_at: string
  last_seen_at: string
}

export interface AdminDevicePushSubscription {
  id: number
  admin_user_id: number | null
  admin_username: string
  endpoint: string
  is_active: boolean
  user_agent: string | null
  last_error: string | null
  created_at: string
  updated_at: string
  last_seen_at: string
}

export interface AdminDeviceInviteCreateResponse {
  token: string
  invite_url: string
  expires_at: string
}

export interface AdminDeviceClaimResponse {
  ok: boolean
  admin_username: string
  subscription_id: number
}

export interface AdminDeviceHealResponse {
  ok: boolean
  admin_username: string
  subscription_id: number
  test_push_ok: boolean | null
  test_push_error: string | null
  test_push_status_code: number | null
}

export interface AdminPushSelfCheckResponse {
  push_enabled: boolean
  actor_username: string
  actor_admin_user_id: number | null
  active_total_subscriptions: number
  active_claims_for_actor: number
  active_claims_for_actor_by_id: number
  active_claims_for_actor_by_username: number
  active_claims_healthy: number
  active_claims_with_error: number
  active_claims_stale: number
  latest_claim_seen_at: string | null
  latest_claim_error: string | null
  last_self_test_at: string | null
  last_self_test_total_targets: number | null
  last_self_test_sent: number | null
  last_self_test_failed: number | null
  last_self_test_success: boolean | null
  ready_for_receive: boolean
  has_other_active_subscriptions: boolean
  self_check_ok: boolean
  self_check_error: string | null
}

export interface AdminPushSelfTestResponse {
  ok: boolean
  total_targets: number
  sent: number
  failed: number
  deactivated: number
  admin_user_ids: number[]
  admin_usernames: string[]
}

export interface AdminDailyReportJobHealth {
  report_date: string
  evaluated_at_utc: string | null
  evaluated_local_time: string | null
  idempotency_key: string
  job_exists: boolean
  job_id: number | null
  archive_exists: boolean
  archive_id: number | null
  archive_created_at_utc: string | null
  archive_employee_count: number
  archive_file_size_bytes: number
  status: string | null
  scheduled_at_utc: string | null
  job_created_at_utc: string | null
  job_updated_at_utc: string | null
  attempts: number
  last_error: string | null
  push_total_targets: number
  push_sent: number
  push_failed: number
  email_sent: number
  delivery_succeeded: boolean
  target_zero: boolean
  alarms: string[]
}

export interface AdminNotificationEmailTarget {
  id: number
  email: string
  is_active: boolean
  created_by_username: string | null
  updated_by_username: string | null
  created_at: string
  updated_at: string
}

export interface AdminNotificationEmailTargetsResponse {
  recipients: AdminNotificationEmailTarget[]
  active_recipients: string[]
  active_count: number
}

export interface AdminNotificationEmailTestResponse {
  ok: boolean
  sent: number
  mode: string
  recipients: string[]
  configured: boolean
  error: string | null
  channel: Record<string, unknown>
}

export interface AdminDailyReportArchive {
  id: number
  report_date: string
  department_id: number | null
  region_id: number | null
  file_name: string
  file_size_bytes: number
  employee_count: number
  created_at: string
}

export interface AdminDailyReportArchiveNotifyResponse {
  ok: boolean
  archive_id: number
  archive_url: string
  total_targets: number
  sent: number
  failed: number
  deactivated: number
  admin_user_ids: number[]
  admin_usernames: string[]
}

export interface AdminDailyReportArchivePasswordDownloadPayload {
  username: string
  password: string
}

export type AttendanceExtraCheckinApprovalStatus = 'PENDING' | 'APPROVED' | 'CONSUMED' | 'EXPIRED'

export interface AttendanceExtraCheckinApproval {
  approval_id: number
  employee_id: number
  employee_name: string
  device_id: number | null
  local_day: string
  status: AttendanceExtraCheckinApprovalStatus
  requested_at: string
  expires_at: string
  approved_at: string | null
  approved_by_username: string | null
  consumed_at: string | null
  push_total_targets: number
  push_sent: number
  push_failed: number
  last_push_at: string | null
}

export interface AttendanceExtraCheckinApprovalApproveResponse {
  ok: boolean
  approval: AttendanceExtraCheckinApproval
  already_processed: boolean
}

export interface AdminManualNotificationSendResponse {
  ok: boolean
  total_targets: number
  sent: number
  failed: number
  deactivated: number
  employee_ids: number[]
  admin_user_ids: number[]
  admin_usernames: string[]
  employee_total_targets: number
  employee_sent: number
  employee_failed: number
  employee_deactivated: number
  admin_total_targets: number
  admin_sent: number
  admin_failed: number
  admin_deactivated: number
  admin_target_missing: boolean
}

export interface ManualDayOverride {
  id: number
  employee_id: number
  day_date: string
  in_ts: string | null
  out_ts: string | null
  is_absent: boolean
  rule_source_override: 'SHIFT' | 'WEEKLY' | 'WORK_RULE' | null
  rule_shift_id_override: number | null
  note: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface LeaveRecord {
  id: number
  employee_id: number
  start_date: string
  end_date: string
  type: LeaveType
  status: LeaveStatus
  note: string | null
  created_at: string
}

export interface DeviceInviteCreateResponse {
  token: string
  invite_url: string
}

export interface DashboardEmployeeMonthMetrics {
  year: number
  month: number
  worked_minutes: number
  plan_overtime_minutes: number
  extra_work_minutes: number
  overtime_minutes: number
  incomplete_days: number
}

export interface DashboardEmployeeLastEvent {
  event_id: number
  event_type: AttendanceType
  ts_utc: string
  location_status: LocationStatus
  device_id: number
  lat: number | null
  lon: number | null
  accuracy_m: number | null
}

export interface DashboardEmployeeSnapshot {
  employee: Employee
  today_status: 'NOT_STARTED' | 'IN_PROGRESS' | 'FINISHED'
  total_devices: number
  active_devices: number
  devices: EmployeeDeviceDetail[]
  current_month: DashboardEmployeeMonthMetrics
  previous_month: DashboardEmployeeMonthMetrics
  last_event: DashboardEmployeeLastEvent | null
  latest_location: EmployeeLiveLocation | null
  generated_at_utc: string
}

export type ControlRoomLocationState = 'LIVE' | 'STALE' | 'DORMANT' | 'NONE'
export type ControlRoomAlertSeverity = 'info' | 'warning' | 'critical'
export type ControlRoomRiskStatus = 'NORMAL' | 'WATCH' | 'CRITICAL'

export interface ControlRoomEmployeeAlert {
  code: string
  label: string
  severity: ControlRoomAlertSeverity
}

export interface ControlRoomTooltip {
  title: string
  body: string
}

export interface ControlRoomRiskFactor {
  code: string
  label: string
  value: string
  impact_score: number
  description: string
}

export interface ControlRoomMeasure {
  action_type: 'SUSPEND' | 'DISABLE_TEMP' | 'REVIEW' | 'RISK_OVERRIDE'
  label: string
  reason: string
  note: string
  duration_days: number | null
  expires_at: string | null
  created_at: string
  created_by: string
  ip: string | null
  override_score: number | null
}

export interface ControlRoomNote {
  note: string
  created_at: string
  created_by: string
  ip: string | null
}

export interface ControlRoomAuditEntry {
  audit_id: number
  action: string
  label: string
  ts_utc: string
  actor_id: string
  ip: string | null
  details: Record<string, unknown>
}

export interface ControlRoomEmployeeState {
  employee: Employee
  department_name: string | null
  shift_name: string | null
  shift_window_label: string | null
  today_status: 'NOT_STARTED' | 'IN_PROGRESS' | 'FINISHED'
  location_state: ControlRoomLocationState
  last_event: DashboardEmployeeLastEvent | null
  last_checkin_utc: string | null
  last_checkout_utc: string | null
  latest_location: EmployeeLiveLocation | null
  last_portal_seen_utc: string | null
  last_activity_utc: string | null
  recent_ip: string | null
  location_label: string | null
  active_devices: number
  total_devices: number
  current_month: DashboardEmployeeMonthMetrics
  worked_today_minutes: number
  weekly_total_minutes: number
  violation_count_7d: number
  risk_score: number
  risk_status: ControlRoomRiskStatus
  absence_minutes_7d: number
  active_measure: ControlRoomMeasure | null
  latest_note: ControlRoomNote | null
  attention_flags: ControlRoomEmployeeAlert[]
  tooltip_items: ControlRoomTooltip[]
  risk_factors: ControlRoomRiskFactor[]
}

export interface ControlRoomMapPoint {
  employee_id: number
  employee_name: string
  department_name: string | null
  lat: number
  lon: number
  ts_utc: string
  accuracy_m: number | null
  today_status: 'NOT_STARTED' | 'IN_PROGRESS' | 'FINISHED'
  location_state: ControlRoomLocationState
  label: string
}

export interface ControlRoomRecentEvent {
  event_id: number
  employee_id: number
  employee_name: string
  department_name: string | null
  event_type: AttendanceType
  ts_utc: string
  location_status: LocationStatus
  device_id: number
  lat: number | null
  lon: number | null
  accuracy_m: number | null
}

export interface ControlRoomTrendPoint {
  label: string
  value: number
}

export interface ControlRoomHistogramBucket {
  label: string
  min_score: number
  max_score: number
  count: number
}

export interface ControlRoomDepartmentMetric {
  department_name: string
  employee_count: number
  average_checkin_minutes: number | null
  late_rate_percent: number
  average_active_minutes: number
}

export interface ControlRoomRiskFormulaItem {
  code: string
  label: string
  max_score: number
  description: string
}

export interface ControlRoomActiveFilters {
  q: string | null
  region_id: number | null
  department_id: number | null
  start_date: string | null
  end_date: string | null
  map_date: string | null
  include_inactive: boolean
  risk_min: number | null
  risk_max: number | null
  risk_status: ControlRoomRiskStatus | null
  sort_by: string
  sort_dir: 'asc' | 'desc'
  limit: number
  offset: number
}

export interface ControlRoomSummary {
  total_employees: number
  active_employees: number
  not_started_count: number
  in_progress_count: number
  finished_count: number
  normal_count: number
  watch_count: number
  critical_count: number
  average_checkin_minutes: number | null
  late_rate_percent: number
  average_active_minutes: number
  most_common_violation_window: string | null
  risk_histogram: ControlRoomHistogramBucket[]
  weekly_trend: ControlRoomTrendPoint[]
  department_metrics: ControlRoomDepartmentMetric[]
}

export interface ControlRoomOverview {
  generated_at_utc: string
  total: number
  offset: number
  limit: number
  summary: ControlRoomSummary
  active_filters: ControlRoomActiveFilters
  risk_formula: ControlRoomRiskFormulaItem[]
  items: ControlRoomEmployeeState[]
  map_points: ControlRoomMapPoint[]
  recent_events: ControlRoomRecentEvent[]
}

export interface ControlRoomEmployeeDetail {
  generated_at_utc: string
  employee_state: ControlRoomEmployeeState
  risk_formula: ControlRoomRiskFormulaItem[]
  recent_measures: ControlRoomMeasure[]
  recent_notes: ControlRoomNote[]
  recent_audit_entries: ControlRoomAuditEntry[]
}

export interface MonthlyEmployeeDay {
  date: string
  status: 'OK' | 'INCOMPLETE' | 'LEAVE' | 'OFF'
  in: string | null
  out: string | null
  in_lat: number | null
  in_lon: number | null
  out_lat: number | null
  out_lon: number | null
  worked_minutes: number
  overtime_minutes: number
  plan_overtime_minutes: number
  legal_extra_work_minutes: number
  legal_overtime_minutes: number
  missing_minutes: number
  rule_source: 'SHIFT' | 'WEEKLY' | 'WORK_RULE'
  applied_planned_minutes: number
  applied_break_minutes: number
  leave_type: LeaveType | null
  shift_id: number | null
  shift_name: string | null
  flags: string[]
}

export interface MonthlyEmployeeWeek {
  week_start: string
  week_end: string
  normal_minutes: number
  extra_work_minutes: number
  overtime_minutes: number
  flags: string[]
}

export interface MonthlyEmployeeTotals {
  worked_minutes: number
  overtime_minutes: number
  plan_overtime_minutes: number
  legal_extra_work_minutes: number
  legal_overtime_minutes: number
  incomplete_days: number
}

export type OvertimeRoundingMode = 'OFF' | 'REG_HALF_HOUR'

export interface LaborProfile {
  id: number
  name: string
  weekly_normal_minutes_default: number
  daily_max_minutes: number
  enforce_min_break_rules: boolean
  night_work_max_minutes_default: number
  night_work_exceptions_note_enabled: boolean
  overtime_annual_cap_minutes: number
  overtime_premium: number
  extra_work_premium: number
  overtime_rounding_mode: OvertimeRoundingMode
  created_at: string
  updated_at: string
}

export interface MonthlyEmployeeResponse {
  employee_id: number
  year: number
  month: number
  days: MonthlyEmployeeDay[]
  totals: MonthlyEmployeeTotals
  worked_minutes_net: number
  weekly_totals: MonthlyEmployeeWeek[]
  annual_overtime_used_minutes: number
  annual_overtime_remaining_minutes: number
  annual_overtime_cap_exceeded: boolean
  labor_profile: LaborProfile | null
}

export interface DepartmentSummaryItem {
  department_id: number
  department_name: string
  region_id?: number | null
  region_name?: string | null
  worked_minutes: number
  overtime_minutes: number
  plan_overtime_minutes: number
  legal_extra_work_minutes: number
  legal_overtime_minutes: number
  employee_count: number
}

export interface AdminAuthResponse {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token?: string | null
}

export interface AdminPermissionValue {
  read: boolean
  write: boolean
}

export type AdminPermissions = Record<string, AdminPermissionValue>

export interface AdminUser {
  id: number
  username: string
  full_name: string | null
  is_active: boolean
  is_super_admin: boolean
  mfa_enabled: boolean
  mfa_secret_configured: boolean
  claim_total: number
  claim_active_total: number
  claim_inactive_total: number
  permissions: AdminPermissions
  created_at: string
  updated_at: string
}

export interface AdminPushClaimDetail {
  id: number
  admin_user_id: number | null
  admin_username: string
  is_active: boolean
  endpoint: string
  endpoint_fingerprint: string
  user_agent: string | null
  last_error: string | null
  created_at: string
  updated_at: string
  last_seen_at: string
}

export type AdminDeviceInviteStatus = 'PENDING' | 'USED' | 'EXPIRED'

export interface AdminDeviceInviteDetail {
  id: number
  status: AdminDeviceInviteStatus
  expires_at: string
  is_used: boolean
  attempt_count: number
  max_attempts: number
  created_by_admin_user_id: number | null
  created_by_username: string
  used_by_admin_user_id: number | null
  used_by_username: string | null
  created_at: string
  used_at: string | null
}

export interface AdminUserClaimDetail {
  admin_user: AdminUser
  claim_total: number
  claim_active_total: number
  claim_inactive_total: number
  claims: AdminPushClaimDetail[]
  created_invites: AdminDeviceInviteDetail[]
  used_invites: AdminDeviceInviteDetail[]
}

export interface AdminUserMfaStatus {
  admin_user_id: number
  username: string
  mfa_enabled: boolean
  has_secret: boolean
  recovery_code_active_count: number
  recovery_code_total_count: number
  recovery_code_expires_at: string | null
  updated_at: string | null
}

export interface AdminUserMfaSetupStartResponse {
  admin_user_id: number
  username: string
  issuer: string
  secret_key: string
  otpauth_uri: string
}

export interface AdminUserMfaSetupConfirmResponse {
  ok: boolean
  mfa_enabled: boolean
  recovery_codes: string[]
  recovery_code_expires_at: string
}

export interface AdminUserMfaRecoveryRegenerateResponse {
  ok: boolean
  recovery_codes: string[]
  recovery_code_expires_at: string
}

export interface AdminMeResponse {
  sub: string
  username: string
  admin_user_id: number | null
  full_name?: string | null
  role: string
  is_super_admin: boolean
  permissions: AdminPermissions
  iat: number
  exp: number
}

export interface ApiErrorShape {
  error?: {
    code: string
    message: string
    request_id?: string
  }
}
