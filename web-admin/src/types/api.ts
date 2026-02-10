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

export interface MonthlyEmployeeDay {
  date: string
  status: 'OK' | 'INCOMPLETE' | 'LEAVE' | 'OFF'
  in: string | null
  out: string | null
  worked_minutes: number
  overtime_minutes: number
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
  permissions: AdminPermissions
  created_at: string
  updated_at: string
}

export interface AdminMeResponse {
  sub: string
  username: string
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
