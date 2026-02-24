import { apiClient, publicApiClient } from './client'
import type {
  AdminDailyReportArchive,
  AdminDailyReportJobHealth,
  AdminNotificationEmailTargetsResponse,
  AdminNotificationEmailTestResponse,
  AdminDailyReportArchivePasswordDownloadPayload,
  AdminDailyReportArchiveNotifyResponse,
  AdminDeviceClaimResponse,
  AdminDeviceHealResponse,
  AdminDeviceInviteCreateResponse,
  AdminDevicePushSubscription,
  AdminManualNotificationSendResponse,
  AttendanceExtraCheckinApproval,
  AttendanceExtraCheckinApprovalApproveResponse,
  AdminPushSelfCheckResponse,
  AdminPushSelfTestResponse,
  AdminAuthResponse,
  AdminMeResponse,
  AdminPermissions,
  AdminPushSubscription,
  AdminPushClaimDetail,
  AdminUserClaimDetail,
  AdminUser,
  AdminUserMfaRecoveryRegenerateResponse,
  AdminUserMfaSetupConfirmResponse,
  AdminUserMfaSetupStartResponse,
  AdminUserMfaStatus,
  AuditLog,
  AttendanceEvent,
  AttendanceType,
  Department,
  DepartmentShift,
  DepartmentSummaryItem,
  DepartmentWeeklyRule,
  DashboardEmployeeSnapshot,
  Device,
  EmployeeDeviceOverview,
  DeviceInviteCreateResponse,
  Employee,
  EmployeeDetail,
  EmployeeLocation,
  EmployeeStatusFilter,
  LaborProfile,
  LeaveRecord,
  LocationStatus,
  ManualDayOverride,
  MonthlyEmployeeResponse,
  NotificationJob,
  NotificationDeliveryLog,
  NotificationJobStatus,
  OvertimeRoundingMode,
  Region,
  QrCode,
  QrCodeType,
  QrPoint,
  SchedulePlan,
  SchedulePlanTargetType,
  WorkRule,
} from '../types/api'

export interface ArchivePasswordDownloadResult {
  blob: Blob
  file_name: string | null
}

export interface LoginPayload {
  username: string
  password: string
  mfa_code?: string
  mfa_recovery_code?: string
}

export interface RefreshPayload {
  refresh_token: string
}

export interface LogoutPayload {
  refresh_token: string
}

export interface AdminUserCreatePayload {
  username: string
  password: string
  full_name?: string | null
  is_active?: boolean
  is_super_admin?: boolean
  permissions?: AdminPermissions
}

export interface AdminUserUpdatePayload {
  username?: string | null
  full_name?: string | null
  password?: string | null
  is_active?: boolean
  is_super_admin?: boolean
  permissions?: AdminPermissions
}

export interface AdminUserMfaConfirmPayload {
  code: string
}

export interface AdminUserMfaCriticalActionPayload {
  current_password: string
}

export interface AdminUserClaimActiveUpdatePayload {
  is_active: boolean
}

export interface CreateDepartmentPayload {
  name: string
  region_id?: number | null
}

export interface UpdateDepartmentPayload {
  name: string
  region_id?: number | null
}

export interface CreateEmployeePayload {
  full_name: string
  region_id?: number | null
  department_id?: number | null
  shift_id?: number | null
  is_active?: boolean
}

export interface EmployeesParams {
  include_inactive?: boolean
  status?: EmployeeStatusFilter
  department_id?: number
  region_id?: number
}

export interface UpdateEmployeeActivePayload {
  is_active: boolean
}

export interface UpdateEmployeeShiftPayload {
  shift_id: number | null
}

export interface UpdateEmployeeDepartmentPayload {
  department_id: number | null
}

export interface UpdateEmployeeRegionPayload {
  region_id: number | null
}

export interface UpdateEmployeeProfilePayload {
  full_name?: string
  department_id?: number | null
}

export interface UpdateDeviceActivePayload {
  is_active: boolean
}

export interface UpsertEmployeeLocationPayload {
  home_lat: number
  home_lon: number
  radius_m: number
}

export interface UpsertWorkRulePayload {
  department_id: number
  daily_minutes_planned: number
  break_minutes: number
  grace_minutes: number
}

export interface UpsertDepartmentWeeklyRulePayload {
  department_id: number
  weekday: number
  is_workday: boolean
  planned_minutes: number
  break_minutes: number
}

export interface UpsertDepartmentShiftPayload {
  id?: number
  department_id: number
  name: string
  start_time_local: string
  end_time_local: string
  break_minutes: number
  is_active: boolean
}

export interface UpsertSchedulePlanPayload {
  id?: number
  department_id: number
  target_type: SchedulePlanTargetType
  target_employee_id?: number | null
  target_employee_ids?: number[] | null
  shift_id?: number | null
  daily_minutes_planned?: number | null
  break_minutes?: number | null
  grace_minutes?: number | null
  start_date: string
  end_date: string
  is_locked?: boolean
  is_active?: boolean
  note?: string | null
}

export interface SchedulePlanParams {
  department_id?: number
  employee_id?: number
  active_only?: boolean
  start_date?: string
  end_date?: string
}

export interface AttendanceEventParams {
  employee_id?: number
  department_id?: number
  start_date?: string
  end_date?: string
  type?: AttendanceType
  location_status?: LocationStatus
  duplicates_only?: boolean
  include_deleted?: boolean
  limit?: number
}

export interface ManualAttendanceEventPayload {
  employee_id: number
  type: AttendanceType
  ts_utc?: string
  ts_local?: string
  lat?: number | null
  lon?: number | null
  accuracy_m?: number | null
  note?: string | null
  shift_id?: number | null
  allow_duplicate?: boolean
}

export interface ManualAttendanceEventUpdatePayload {
  type?: AttendanceType
  ts_utc?: string
  ts_local?: string
  note?: string | null
  shift_id?: number | null
  allow_duplicate?: boolean
  force_edit?: boolean
}

export interface AuditLogParams {
  action?: string
  entity_type?: string
  entity_id?: string
  success?: boolean
  limit?: number
}

export interface NotificationJobsParams {
  status?: NotificationJobStatus
  offset?: number
  limit?: number
}

export interface NotificationDeliveryLogsParams {
  limit?: number
}

export interface NotificationSubscriptionsParams {
  employee_id?: number
}

export interface AdminNotificationSubscriptionsParams {
  admin_user_id?: number
}

export interface AdminNotificationEmailTargetsUpdatePayload {
  emails: string[]
}

export interface AdminNotificationEmailTestPayload {
  recipients?: string[]
  subject?: string
  message?: string
}

export interface ManualNotificationPayload {
  title: string
  message: string
  password: string
  target?: 'employees' | 'admins' | 'both'
  employee_ids?: number[]
  admin_user_ids?: number[]
}

export interface CreateAdminDeviceInvitePayload {
  expires_in_minutes: number
}

export interface ClaimAdminDevicePayload {
  token: string
  subscription: Record<string, unknown>
}

export interface ClaimAdminDevicePublicPayload {
  token: string
  username: string
  password: string
  subscription: Record<string, unknown>
}

export interface HealAdminDevicePayload {
  subscription: Record<string, unknown>
  send_test?: boolean
}

export interface DailyReportArchivesParams {
  start_date?: string
  end_date?: string
  department_id?: number
  region_id?: number
  employee_id?: number
  employee_query?: string
  limit?: number
}

export interface NotifyDailyReportArchivePayload {
  admin_user_ids?: number[]
}

export interface AttendanceExtraCheckinApprovalApprovePayload {
  token: string
  username: string
  password: string
}

export interface CreateLeavePayload {
  employee_id: number
  start_date: string
  end_date: string
  type: 'ANNUAL' | 'SICK' | 'UNPAID' | 'EXCUSE' | 'PUBLIC_HOLIDAY'
  status?: 'APPROVED' | 'PENDING' | 'REJECTED'
  note?: string | null
}

export interface LeavesParams {
  employee_id?: number
  year?: number
  month?: number
}

export interface DeviceInvitePayload {
  employee_id?: number
  employee_name?: string
  expires_in_minutes: number
}

export interface DashboardEmployeeSnapshotParams {
  employee_id?: number
  employee_name?: string
}

export interface MonthlyEmployeeParams {
  employee_id: number
  year: number
  month: number
}

export interface DepartmentSummaryParams {
  year: number
  month: number
  department_id?: number
  region_id?: number
  include_inactive?: boolean
}

export interface EmployeeDeviceOverviewParams {
  employee_id?: number
  region_id?: number
  include_inactive?: boolean
  include_recovery_secrets?: boolean
  q?: string
  offset?: number
  limit?: number
  device_limit?: number
}

export interface ManualDayOverridePayload {
  day_date: string
  in_time?: string | null
  out_time?: string | null
  is_absent?: boolean
  rule_source_override?: 'AUTO' | 'SHIFT' | 'WEEKLY' | 'WORK_RULE'
  rule_shift_id_override?: number | null
  note?: string | null
}

export interface PuantajExportParams {
  mode: 'employee' | 'department' | 'all' | 'date_range'
  year?: number
  month?: number
  employee_id?: number
  department_id?: number
  start_date?: string
  end_date?: string
  include_daily_sheet?: boolean
  include_inactive?: boolean
}

export interface PuantajRangeExportParams {
  start_date: string
  end_date: string
  mode: 'consolidated' | 'employee_sheets' | 'department_sheets'
  department_id?: number
  employee_id?: number
}

export interface ComplianceSettingsPayload {
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
}

export interface CreateRegionPayload {
  name: string
  is_active?: boolean
}

export interface UpdateRegionPayload {
  name: string
  is_active: boolean
}

export interface CreateQrCodePayload {
  name?: string | null
  code_value: string
  code_type?: QrCodeType
  is_active?: boolean
}

export interface UpdateQrCodePayload {
  name?: string | null
  code_value?: string
  code_type?: QrCodeType
  is_active?: boolean
}

export interface AssignQrCodePointsPayload {
  point_ids: number[]
}

export interface GetQrCodesParams {
  active_only?: boolean
}

export interface CreateQrPointPayload {
  name: string
  lat: number
  lon: number
  radius_m?: number
  is_active?: boolean
  department_id?: number | null
  region_id?: number | null
}

export interface UpdateQrPointPayload {
  name?: string
  lat?: number
  lon?: number
  radius_m?: number
  is_active?: boolean
  department_id?: number | null
  region_id?: number | null
}

export interface GetQrPointsParams {
  active_only?: boolean
  department_id?: number
  region_id?: number
}

export async function loginAdmin(payload: LoginPayload): Promise<AdminAuthResponse> {
  const response = await apiClient.post<AdminAuthResponse>('/api/admin/auth/login', payload)
  return response.data
}

export async function refreshAdminToken(payload: RefreshPayload): Promise<AdminAuthResponse> {
  const response = await apiClient.post<AdminAuthResponse>('/api/admin/auth/refresh', payload)
  return response.data
}

export async function logoutAdmin(payload: LogoutPayload): Promise<{ ok: boolean }> {
  const response = await apiClient.post<{ ok: boolean }>('/api/admin/auth/logout', payload)
  return response.data
}

export async function getAdminMe(): Promise<AdminMeResponse> {
  const response = await apiClient.get<AdminMeResponse>('/api/admin/auth/me')
  return response.data
}

export async function getAdminUsers(): Promise<AdminUser[]> {
  const response = await apiClient.get<AdminUser[]>('/api/admin/admin-users')
  return response.data
}

export async function getAdminUserClaimDetail(adminUserId: number): Promise<AdminUserClaimDetail> {
  const response = await apiClient.get<AdminUserClaimDetail>(
    `/api/admin/admin-users/${adminUserId}/claim-detail`,
  )
  return response.data
}

export async function updateAdminUserClaimActive(
  adminUserId: number,
  claimId: number,
  payload: AdminUserClaimActiveUpdatePayload,
): Promise<AdminPushClaimDetail> {
  const response = await apiClient.patch<AdminPushClaimDetail>(
    `/api/admin/admin-users/${adminUserId}/claims/${claimId}/active`,
    payload,
  )
  return response.data
}

export async function getRegions(params?: { include_inactive?: boolean }): Promise<Region[]> {
  const response = await apiClient.get<Region[]>('/api/admin/regions', { params })
  return response.data
}

export async function createRegion(payload: CreateRegionPayload): Promise<Region> {
  const response = await apiClient.post<Region>('/api/admin/regions', payload)
  return response.data
}

export async function updateRegion(regionId: number, payload: UpdateRegionPayload): Promise<Region> {
  const response = await apiClient.patch<Region>(`/api/admin/regions/${regionId}`, payload)
  return response.data
}

export async function createAdminUser(payload: AdminUserCreatePayload): Promise<AdminUser> {
  const response = await apiClient.post<AdminUser>('/api/admin/admin-users', payload)
  return response.data
}

export async function updateAdminUser(
  adminUserId: number,
  payload: AdminUserUpdatePayload,
): Promise<AdminUser> {
  const response = await apiClient.patch<AdminUser>(`/api/admin/admin-users/${adminUserId}`, payload)
  return response.data
}

export async function deleteAdminUser(adminUserId: number): Promise<void> {
  await apiClient.delete(`/api/admin/admin-users/${adminUserId}`)
}

export async function getAdminUserMfaStatus(adminUserId: number): Promise<AdminUserMfaStatus> {
  const response = await apiClient.get<AdminUserMfaStatus>(`/api/admin/admin-users/${adminUserId}/mfa`)
  return response.data
}

export async function startAdminUserMfaSetup(adminUserId: number): Promise<AdminUserMfaSetupStartResponse> {
  const response = await apiClient.post<AdminUserMfaSetupStartResponse>(
    `/api/admin/admin-users/${adminUserId}/mfa/setup/start`,
  )
  return response.data
}

export async function confirmAdminUserMfaSetup(
  adminUserId: number,
  payload: AdminUserMfaConfirmPayload,
): Promise<AdminUserMfaSetupConfirmResponse> {
  const response = await apiClient.post<AdminUserMfaSetupConfirmResponse>(
    `/api/admin/admin-users/${adminUserId}/mfa/setup/confirm`,
    payload,
  )
  return response.data
}

export async function regenerateAdminUserMfaRecoveryCodes(
  adminUserId: number,
  payload: AdminUserMfaCriticalActionPayload,
): Promise<AdminUserMfaRecoveryRegenerateResponse> {
  const response = await apiClient.post<AdminUserMfaRecoveryRegenerateResponse>(
    `/api/admin/admin-users/${adminUserId}/mfa/recovery-codes/regenerate`,
    payload,
  )
  return response.data
}

export async function resetAdminUserMfa(
  adminUserId: number,
  payload: AdminUserMfaCriticalActionPayload,
): Promise<{ ok: boolean }> {
  const response = await apiClient.post<{ ok: boolean }>(`/api/admin/admin-users/${adminUserId}/mfa/reset`, payload)
  return response.data
}

export async function getDepartments(): Promise<Department[]> {
  const response = await apiClient.get<Department[]>('/admin/departments')
  return response.data
}

export async function getDepartmentsFiltered(params?: { region_id?: number }): Promise<Department[]> {
  const response = await apiClient.get<Department[]>('/admin/departments', { params })
  return response.data
}

export async function createDepartment(payload: CreateDepartmentPayload): Promise<Department> {
  const response = await apiClient.post<Department>('/admin/departments', payload)
  return response.data
}

export async function updateDepartment(
  departmentId: number,
  payload: UpdateDepartmentPayload,
): Promise<Department> {
  const response = await apiClient.patch<Department>(`/admin/departments/${departmentId}`, payload)
  return response.data
}

export async function getEmployees(params: EmployeesParams = {}): Promise<Employee[]> {
  const response = await apiClient.get<Employee[]>('/admin/employees', { params })
  return response.data
}

export async function createEmployee(payload: CreateEmployeePayload): Promise<Employee> {
  const response = await apiClient.post<Employee>('/admin/employees', payload)
  return response.data
}

export async function getEmployeeDetail(employeeId: number): Promise<EmployeeDetail> {
  const response = await apiClient.get<EmployeeDetail>(`/api/admin/employees/${employeeId}/detail`)
  return response.data
}

export async function updateEmployeeProfile(
  employeeId: number,
  payload: UpdateEmployeeProfilePayload,
): Promise<Employee> {
  const response = await apiClient.patch<Employee>(`/api/admin/employees/${employeeId}`, payload)
  return response.data
}

export async function updateEmployeeActive(
  employeeId: number,
  payload: UpdateEmployeeActivePayload,
): Promise<Employee> {
  const response = await apiClient.patch<Employee>(`/api/admin/employees/${employeeId}/active`, payload)
  return response.data
}

export async function updateEmployeeShift(
  employeeId: number,
  payload: UpdateEmployeeShiftPayload,
): Promise<Employee> {
  const response = await apiClient.patch<Employee>(`/api/admin/employees/${employeeId}/shift`, payload)
  return response.data
}

export async function updateEmployeeDepartment(
  employeeId: number,
  payload: UpdateEmployeeDepartmentPayload,
): Promise<Employee> {
  const response = await apiClient.patch<Employee>(`/api/admin/employees/${employeeId}/department`, payload)
  return response.data
}

export async function updateEmployeeRegion(
  employeeId: number,
  payload: UpdateEmployeeRegionPayload,
): Promise<Employee> {
  const response = await apiClient.patch<Employee>(`/api/admin/employees/${employeeId}/region`, payload)
  return response.data
}

export async function getEmployeeLocation(employeeId: number): Promise<EmployeeLocation> {
  const response = await apiClient.get<EmployeeLocation>(`/admin/employee-locations/${employeeId}`)
  return response.data
}

export async function upsertEmployeeLocation(
  employeeId: number,
  payload: UpsertEmployeeLocationPayload,
): Promise<EmployeeLocation> {
  const response = await apiClient.put<EmployeeLocation>(`/admin/employee-locations/${employeeId}`, payload)
  return response.data
}

export async function getWorkRules(): Promise<WorkRule[]> {
  const response = await apiClient.get<WorkRule[]>('/admin/work-rules')
  return response.data
}

export async function createWorkRule(payload: UpsertWorkRulePayload): Promise<WorkRule> {
  const response = await apiClient.post<WorkRule>('/admin/work-rules', payload)
  return response.data
}

export const upsertWorkRule = createWorkRule

export async function getDepartmentWeeklyRules(params?: { department_id?: number }): Promise<DepartmentWeeklyRule[]> {
  const response = await apiClient.get<DepartmentWeeklyRule[]>('/admin/department-weekly-rules', { params })
  return response.data
}

export async function upsertDepartmentWeeklyRule(
  payload: UpsertDepartmentWeeklyRulePayload,
): Promise<DepartmentWeeklyRule> {
  const response = await apiClient.post<DepartmentWeeklyRule>('/admin/department-weekly-rules', payload)
  return response.data
}

export async function getDepartmentShifts(params?: {
  department_id?: number
  active_only?: boolean
}): Promise<DepartmentShift[]> {
  const response = await apiClient.get<DepartmentShift[]>('/admin/department-shifts', { params })
  return response.data
}

export async function upsertDepartmentShift(payload: UpsertDepartmentShiftPayload): Promise<DepartmentShift> {
  const response = await apiClient.post<DepartmentShift>('/admin/department-shifts', payload)
  return response.data
}

export async function deleteDepartmentShift(shiftId: number): Promise<{ ok: boolean; id: number }> {
  const response = await apiClient.delete<{ ok: boolean; id: number }>(`/admin/department-shifts/${shiftId}`)
  return response.data
}

export async function getQrCodes(params: GetQrCodesParams = {}): Promise<QrCode[]> {
  const response = await apiClient.get<QrCode[]>('/api/admin/qr/codes', { params })
  return response.data
}

export async function createQrCode(payload: CreateQrCodePayload): Promise<QrCode> {
  const response = await apiClient.post<QrCode>('/api/admin/qr/codes', payload)
  return response.data
}

export async function updateQrCode(codeId: number, payload: UpdateQrCodePayload): Promise<QrCode> {
  const response = await apiClient.patch<QrCode>(`/api/admin/qr/codes/${codeId}`, payload)
  return response.data
}

export async function assignQrCodePoints(
  codeId: number,
  payload: AssignQrCodePointsPayload,
): Promise<QrCode> {
  const response = await apiClient.post<QrCode>(`/api/admin/qr/codes/${codeId}/points`, payload)
  return response.data
}

export async function unassignQrCodePoint(codeId: number, pointId: number): Promise<{ ok: boolean; id: number }> {
  const response = await apiClient.delete<{ ok: boolean; id: number }>(
    `/api/admin/qr/codes/${codeId}/points/${pointId}`,
  )
  return response.data
}

export async function getQrPoints(params: GetQrPointsParams = {}): Promise<QrPoint[]> {
  const response = await apiClient.get<QrPoint[]>('/api/admin/qr/points', { params })
  return response.data
}

export async function createQrPoint(payload: CreateQrPointPayload): Promise<QrPoint> {
  const response = await apiClient.post<QrPoint>('/api/admin/qr/points', payload)
  return response.data
}

export async function updateQrPoint(pointId: number, payload: UpdateQrPointPayload): Promise<QrPoint> {
  const response = await apiClient.patch<QrPoint>(`/api/admin/qr/points/${pointId}`, payload)
  return response.data
}

export async function deactivateQrPoint(pointId: number): Promise<{ ok: boolean; id: number }> {
  const response = await apiClient.delete<{ ok: boolean; id: number }>(`/api/admin/qr/points/${pointId}`)
  return response.data
}

export async function upsertSchedulePlan(payload: UpsertSchedulePlanPayload): Promise<SchedulePlan> {
  const response = await apiClient.post<SchedulePlan>('/api/admin/schedule-plans', payload)
  return response.data
}

export async function getSchedulePlans(params: SchedulePlanParams = {}): Promise<SchedulePlan[]> {
  const response = await apiClient.get<SchedulePlan[]>('/api/admin/schedule-plans', { params })
  return response.data
}

export async function cancelSchedulePlan(planId: number): Promise<{ ok: boolean; id: number }> {
  const response = await apiClient.delete<{ ok: boolean; id: number }>(`/api/admin/schedule-plans/${planId}`)
  return response.data
}

export async function getAttendanceEvents(params: AttendanceEventParams = {}): Promise<AttendanceEvent[]> {
  const response = await apiClient.get<AttendanceEvent[]>('/admin/attendance-events', { params })
  return response.data
}

export async function createManualAttendanceEvent(
  payload: ManualAttendanceEventPayload,
): Promise<AttendanceEvent> {
  const response = await apiClient.post<AttendanceEvent>('/api/admin/attendance-events', payload)
  return response.data
}

export async function updateManualAttendanceEvent(
  eventId: number,
  payload: ManualAttendanceEventUpdatePayload,
): Promise<AttendanceEvent> {
  const response = await apiClient.patch<AttendanceEvent>(`/api/admin/attendance-events/${eventId}`, payload)
  return response.data
}

export async function softDeleteAttendanceEvent(eventId: number, force = false): Promise<{ ok: boolean; id: number }> {
  const response = await apiClient.delete<{ ok: boolean; id: number }>(
    `/api/admin/attendance-events/${eventId}`,
    { params: { force } },
  )
  return response.data
}

export async function getAuditLogs(params: AuditLogParams = {}): Promise<AuditLog[]> {
  const response = await apiClient.get<AuditLog[]>('/api/admin/audit-logs', { params })
  return response.data
}

export async function getNotificationJobs(
  params: NotificationJobsParams = {},
): Promise<NotificationJob[]> {
  const response = await apiClient.get<NotificationJob[]>('/api/admin/notifications/jobs', { params })
  return response.data
}

export async function getNotificationDeliveryLogs(
  params: NotificationDeliveryLogsParams = {},
): Promise<NotificationDeliveryLog[]> {
  const response = await apiClient.get<NotificationDeliveryLog[]>('/api/admin/notifications/delivery-logs', { params })
  return response.data
}

export async function cancelNotificationJob(jobId: number): Promise<NotificationJob> {
  const response = await apiClient.post<NotificationJob>(`/api/admin/notifications/jobs/${jobId}/cancel`)
  return response.data
}

export async function getNotificationSubscriptions(
  params: NotificationSubscriptionsParams = {},
): Promise<AdminPushSubscription[]> {
  const response = await apiClient.get<AdminPushSubscription[]>(
    '/api/admin/notifications/subscriptions',
    { params },
  )
  return response.data
}

export async function getAdminNotificationSubscriptions(
  params: AdminNotificationSubscriptionsParams = {},
): Promise<AdminDevicePushSubscription[]> {
  const response = await apiClient.get<AdminDevicePushSubscription[]>(
    '/api/admin/notifications/admin-subscriptions',
    { params },
  )
  return response.data
}

export async function getAdminPushConfig(): Promise<{ enabled: boolean; vapid_public_key: string | null }> {
  const response = await apiClient.get<{ enabled: boolean; vapid_public_key: string | null }>(
    '/api/admin/notifications/push/config',
  )
  return response.data
}

export async function getAdminPushPublicConfig(): Promise<{ enabled: boolean; vapid_public_key: string | null }> {
  const response = await publicApiClient.get<{ enabled: boolean; vapid_public_key: string | null }>(
    '/api/admin/notifications/push/config/public',
  )
  return response.data
}

export async function getAdminDailyReportHealth(): Promise<AdminDailyReportJobHealth> {
  const response = await apiClient.get<AdminDailyReportJobHealth>(
    '/api/admin/notifications/daily-report-health',
  )
  return response.data
}

export async function getAdminNotificationEmailTargets(): Promise<AdminNotificationEmailTargetsResponse> {
  const response = await apiClient.get<AdminNotificationEmailTargetsResponse>(
    '/api/admin/notifications/email-targets',
  )
  return response.data
}

export async function updateAdminNotificationEmailTargets(
  payload: AdminNotificationEmailTargetsUpdatePayload,
): Promise<AdminNotificationEmailTargetsResponse> {
  const response = await apiClient.put<AdminNotificationEmailTargetsResponse>(
    '/api/admin/notifications/email-targets',
    payload,
  )
  return response.data
}

export async function sendAdminNotificationEmailTest(
  payload: AdminNotificationEmailTestPayload = {},
): Promise<AdminNotificationEmailTestResponse> {
  const response = await apiClient.post<AdminNotificationEmailTestResponse>(
    '/api/admin/notifications/email-test',
    payload,
  )
  return response.data
}

export async function getAdminPushSelfCheck(): Promise<AdminPushSelfCheckResponse> {
  const response = await apiClient.get<AdminPushSelfCheckResponse>(
    '/api/admin/notifications/admin-self-check',
  )
  return response.data
}

export async function sendAdminPushSelfTest(): Promise<AdminPushSelfTestResponse> {
  const response = await apiClient.post<AdminPushSelfTestResponse>(
    '/api/admin/notifications/admin-self-test',
  )
  return response.data
}

export async function createAdminDeviceInvite(
  payload: CreateAdminDeviceInvitePayload,
): Promise<AdminDeviceInviteCreateResponse> {
  const response = await apiClient.post<AdminDeviceInviteCreateResponse>(
    '/api/admin/notifications/admin-device-invite',
    payload,
  )
  return response.data
}

export async function claimAdminDevice(
  payload: ClaimAdminDevicePayload,
): Promise<AdminDeviceClaimResponse> {
  const response = await apiClient.post<AdminDeviceClaimResponse>(
    '/api/admin/notifications/admin-device-claim',
    payload,
  )
  return response.data
}

export async function claimAdminDevicePublic(
  payload: ClaimAdminDevicePublicPayload,
): Promise<AdminDeviceClaimResponse> {
  const response = await publicApiClient.post<AdminDeviceClaimResponse>(
    '/api/admin/notifications/admin-device-claim/public',
    payload,
  )
  return response.data
}

export async function healAdminDevice(
  payload: HealAdminDevicePayload,
): Promise<AdminDeviceHealResponse> {
  const response = await apiClient.post<AdminDeviceHealResponse>(
    '/api/admin/notifications/admin-device-heal',
    payload,
  )
  return response.data
}

export async function sendManualNotification(
  payload: ManualNotificationPayload,
): Promise<AdminManualNotificationSendResponse> {
  const response = await apiClient.post<AdminManualNotificationSendResponse>(
    '/api/admin/notifications/send',
    payload,
  )
  return response.data
}

export async function getDailyReportArchives(
  params: DailyReportArchivesParams = {},
): Promise<AdminDailyReportArchive[]> {
  const response = await apiClient.get<AdminDailyReportArchive[]>('/api/admin/daily-report-archives', {
    params,
  })
  return response.data
}

function extractFileNameFromDisposition(disposition: string | undefined): string | null {
  if (!disposition) {
    return null
  }

  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim())
    } catch {
      return utf8Match[1].trim()
    }
  }

  const simpleMatch = disposition.match(/filename="?([^";]+)"?/i)
  if (!simpleMatch?.[1]) {
    return null
  }
  return simpleMatch[1].trim()
}

export async function downloadDailyReportArchive(archiveId: number): Promise<Blob> {
  const response = await apiClient.get<Blob>(`/api/admin/daily-report-archives/${archiveId}/download`, {
    responseType: 'blob',
  })
  return response.data
}

export async function downloadDailyReportArchiveWithPassword(
  archiveId: number,
  payload: AdminDailyReportArchivePasswordDownloadPayload,
): Promise<ArchivePasswordDownloadResult> {
  const response = await publicApiClient.post<Blob>(
    `/api/admin/daily-report-archives/${archiveId}/password-download`,
    payload,
    { responseType: 'blob' },
  )
  const contentDisposition = response.headers['content-disposition']
  return {
    blob: response.data,
    file_name: extractFileNameFromDisposition(contentDisposition),
  }
}

export async function getAttendanceExtraCheckinApproval(
  token: string,
): Promise<AttendanceExtraCheckinApproval> {
  const response = await publicApiClient.get<AttendanceExtraCheckinApproval>(
    '/api/admin/attendance-extra-checkin-approval',
    { params: { token } },
  )
  return response.data
}

export async function approveAttendanceExtraCheckinApproval(
  payload: AttendanceExtraCheckinApprovalApprovePayload,
): Promise<AttendanceExtraCheckinApprovalApproveResponse> {
  const response = await publicApiClient.post<AttendanceExtraCheckinApprovalApproveResponse>(
    '/api/admin/attendance-extra-checkin-approval/approve',
    payload,
  )
  return response.data
}

export async function notifyDailyReportArchive(
  archiveId: number,
  payload: NotifyDailyReportArchivePayload = {},
): Promise<AdminDailyReportArchiveNotifyResponse> {
  const response = await apiClient.post<AdminDailyReportArchiveNotifyResponse>(
    `/api/admin/daily-report-archives/${archiveId}/notify`,
    payload,
  )
  return response.data
}

export async function getDevices(): Promise<Device[]> {
  const response = await apiClient.get<Device[]>('/admin/devices')
  return response.data
}

export async function getEmployeeDeviceOverview(
  params: EmployeeDeviceOverviewParams = {},
): Promise<EmployeeDeviceOverview[]> {
  const response = await apiClient.get<EmployeeDeviceOverview[]>('/api/admin/employee-device-overview', {
    params,
  })
  return response.data
}

export async function getDashboardEmployeeSnapshot(
  params: DashboardEmployeeSnapshotParams,
): Promise<DashboardEmployeeSnapshot> {
  const response = await apiClient.get<DashboardEmployeeSnapshot>('/api/admin/dashboard/employee-snapshot', {
    params,
  })
  return response.data
}

export async function updateDeviceActive(
  deviceId: number,
  payload: UpdateDeviceActivePayload,
): Promise<Device> {
  const response = await apiClient.patch<Device>(`/api/admin/devices/${deviceId}/active`, payload)
  return response.data
}

export async function getLeaves(params: LeavesParams = {}): Promise<LeaveRecord[]> {
  const response = await apiClient.get<LeaveRecord[]>('/api/admin/leaves', { params })
  return response.data
}

export async function createLeave(payload: CreateLeavePayload): Promise<LeaveRecord> {
  const response = await apiClient.post<LeaveRecord>('/api/admin/leaves', payload)
  return response.data
}

export async function deleteLeave(leaveId: number): Promise<void> {
  await apiClient.delete(`/api/admin/leaves/${leaveId}`)
}

export async function createDeviceInvite(
  payload: DeviceInvitePayload,
): Promise<DeviceInviteCreateResponse> {
  const response = await apiClient.post<DeviceInviteCreateResponse>('/api/admin/device-invite', payload)
  return response.data
}

export async function getMonthlyEmployee(
  params: MonthlyEmployeeParams,
): Promise<MonthlyEmployeeResponse> {
  const response = await apiClient.get<MonthlyEmployeeResponse>('/api/admin/monthly/employee', { params })
  return response.data
}

export async function getDepartmentSummary(
  params: DepartmentSummaryParams,
): Promise<DepartmentSummaryItem[]> {
  const response = await apiClient.get<DepartmentSummaryItem[]>('/api/admin/monthly/department-summary', {
    params,
  })
  return response.data
}

export async function upsertManualDayOverride(
  employeeId: number,
  payload: ManualDayOverridePayload,
): Promise<ManualDayOverride> {
  const response = await apiClient.post<ManualDayOverride>('/api/admin/manual-overrides/day', payload, {
    params: { employee_id: employeeId },
  })
  return response.data
}

export async function getManualDayOverrides(
  employeeId: number,
  year: number,
  month: number,
): Promise<ManualDayOverride[]> {
  const response = await apiClient.get<ManualDayOverride[]>('/api/admin/manual-overrides/day', {
    params: {
      employee_id: employeeId,
      year,
      month,
    },
  })
  return response.data
}

export async function deleteManualDayOverride(overrideId: number): Promise<void> {
  await apiClient.delete(`/api/admin/manual-overrides/day/${overrideId}`)
}

export async function getComplianceSettings(): Promise<LaborProfile> {
  const response = await apiClient.get<LaborProfile>('/api/admin/compliance-settings')
  return response.data
}

export async function updateComplianceSettings(
  payload: ComplianceSettingsPayload,
): Promise<LaborProfile> {
  const response = await apiClient.put<LaborProfile>('/api/admin/compliance-settings', payload)
  return response.data
}

export async function downloadPuantajExport(params: PuantajExportParams): Promise<Blob> {
  const response = await apiClient.get<Blob>('/api/admin/exports/puantaj.xlsx', {
    params,
    responseType: 'blob',
  })
  return response.data
}

export async function downloadEmployeeMonthlyExport(params: {
  employee_id: number
  year: number
  month: number
}): Promise<Blob> {
  const response = await apiClient.get<Blob>('/api/admin/export/employee-monthly', {
    params,
    responseType: 'blob',
  })
  return response.data
}

export async function downloadDepartmentMonthlyExport(params: {
  department_id: number
  year: number
  month: number
  include_inactive?: boolean
}): Promise<Blob> {
  const response = await apiClient.get<Blob>('/api/admin/export/department-monthly', {
    params,
    responseType: 'blob',
  })
  return response.data
}

export async function downloadAllMonthlyExport(params: {
  year: number
  month: number
  include_inactive?: boolean
}): Promise<Blob> {
  const response = await apiClient.get<Blob>('/api/admin/export/all-monthly', {
    params,
    responseType: 'blob',
  })
  return response.data
}

export async function downloadDateRangeExport(params: {
  start: string
  end: string
  department_id?: number
  employee_id?: number
}): Promise<Blob> {
  const response = await apiClient.get<Blob>('/api/admin/export/date-range', {
    params,
    responseType: 'blob',
  })
  return response.data
}

export async function downloadPuantajRangeExport(
  params: PuantajRangeExportParams,
): Promise<Blob> {
  const response = await apiClient.get<Blob>('/api/admin/export/puantaj-range.xlsx', {
    params,
    responseType: 'blob',
  })
  return response.data
}
