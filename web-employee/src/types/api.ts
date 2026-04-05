export type LocationStatus = 'VERIFIED_HOME' | 'UNVERIFIED_LOCATION' | 'NO_LOCATION'
export type LeaveType = 'ANNUAL' | 'SICK' | 'UNPAID' | 'EXCUSE' | 'PUBLIC_HOLIDAY'
export type LeaveStatus = 'APPROVED' | 'PENDING' | 'REJECTED'
export type EmployeeConversationCategory = 'ATTENDANCE' | 'SHIFT' | 'DEVICE' | 'DOCUMENT' | 'OTHER'
export type EmployeeConversationStatus = 'OPEN' | 'CLOSED'

export interface DeviceClaimRequest {
  token: string
  device_fingerprint: string
}

export interface DeviceClaimResponse {
  ok: boolean
  employee_id: number
  device_id: number
}

export interface AttendanceCheckinRequest {
  device_fingerprint: string
  qr: {
    site_id: string
    type: 'IN'
    shift_id?: number
  }
  lat?: number
  lon?: number
  accuracy_m?: number
}

export interface AttendanceCheckoutRequest {
  device_fingerprint: string
  lat?: number
  lon?: number
  accuracy_m?: number
  manual?: boolean
}

export interface AttendanceActionResponse {
  ok: boolean
  employee_id: number
  event_id: number
  event_type: 'IN' | 'OUT'
  ts_utc: string
  location_status: LocationStatus
  flags: Record<string, unknown>
  shift_id?: number | null
}

export interface EmployeeQrScanRequest {
  code_value: string
  lat: number
  lon: number
  accuracy_m?: number | null
  device_fingerprint: string
}

export interface EmployeeQrScanDeniedResponse {
  reason: string
  closest_distance_m: number | null
}

export interface EmployeeHomeLocationSetRequest {
  device_fingerprint: string
  home_lat: number
  home_lon: number
  radius_m: number
}

export interface EmployeeHomeLocationSetResponse {
  ok: boolean
  employee_id: number
  home_lat: number
  home_lon: number
  radius_m: number
}

export interface EmployeeStatusResponse {
  employee_id: number
  employee_name?: string | null
  region_name?: string | null
  department_name?: string | null
  shift_name?: string | null
  shift_start_local?: string | null
  shift_end_local?: string | null
  today_status: 'NOT_STARTED' | 'IN_PROGRESS' | 'FINISHED'
  last_in_ts: string | null
  last_out_ts: string | null
  last_location_status: LocationStatus | null
  last_flags: Record<string, unknown>
  has_open_shift?: boolean
  suggested_action?: string | null
  last_checkin_time_utc?: string | null
  home_location_required?: boolean
  passkey_registered?: boolean | null
  demo_active?: boolean | null
  last_demo_started_at_utc?: string | null
  last_demo_ended_at_utc?: string | null
}

export interface EmployeeDemoSessionResponse {
  started_at_utc: string
  ended_at_utc?: string | null
  duration_minutes: number
  is_active: boolean
}

export interface EmployeeDemoDayResponse {
  employee_id: number
  day_local: string
  session_count: number
  active_session_count: number
  total_minutes: number
  sessions: EmployeeDemoSessionResponse[]
}

export interface EmployeeLeaveRequest {
  device_fingerprint: string
  start_date: string
  end_date: string
  type: LeaveType
  note: string
  question?: string | null
}

export interface EmployeeLeaveRecord {
  id: number
  employee_id: number
  start_date: string
  end_date: string
  type: LeaveType
  status: LeaveStatus
  note: string | null
  requested_by_employee: boolean
  decision_note: string | null
  decided_at: string | null
  created_at: string
  attachment_count?: number
  message_count?: number
  last_message_at?: string | null
  latest_message_preview?: string | null
}

export interface EmployeeLeaveAttachmentRecord {
  id: number
  leave_id: number
  employee_id: number
  uploaded_by_actor: string
  uploaded_by_label: string
  file_name: string
  content_type: string
  file_size_bytes: number
  created_at: string
}

export interface EmployeeLeaveMessageRecord {
  id: number
  leave_id: number
  employee_id: number
  sender_actor: string
  sender_label: string
  message: string
  created_at: string
}

export interface EmployeeLeaveThreadRecord {
  leave: EmployeeLeaveRecord
  attachments: EmployeeLeaveAttachmentRecord[]
  messages: EmployeeLeaveMessageRecord[]
}

export interface EmployeeConversationRecord {
  id: number
  employee_id: number
  employee_name: string
  category: EmployeeConversationCategory
  subject: string
  status: EmployeeConversationStatus
  created_at: string
  updated_at: string
  closed_at: string | null
  last_message_at: string
  message_count: number
  latest_message_preview: string | null
}

export interface EmployeeConversationMessageRecord {
  id: number
  conversation_id: number
  employee_id: number
  sender_actor: string
  sender_label: string
  message: string
  created_at: string
}

export interface EmployeeConversationThreadRecord {
  conversation: EmployeeConversationRecord
  messages: EmployeeConversationMessageRecord[]
}

export interface EmployeeAppPresencePingRequest {
  device_fingerprint: string
  source?: 'APP_OPEN' | 'APP_CLOSE' | 'DEMO_START' | 'DEMO_END' | 'DEMO_MARK'
  lat?: number
  lon?: number
  accuracy_m?: number | null
}

export interface EmployeeAppPresencePingResponse {
  ok: boolean
  employee_id: number
  logged_at: string
}

export type EmployeeInstallFunnelEventType =
  | 'banner_shown'
  | 'install_cta_clicked'
  | 'ios_onboarding_opened'
  | 'android_onboarding_opened'
  | 'install_prompt_opened'
  | 'install_prompt_accepted'
  | 'install_prompt_dismissed'
  | 'app_installed'
  | 'ios_inapp_browser_detected'
  | 'install_link_copied'

export interface EmployeeInstallFunnelEventRequest {
  device_fingerprint: string
  event: EmployeeInstallFunnelEventType
  occurred_at_ms?: number | null
  context?: Record<string, unknown>
}

export interface EmployeeInstallFunnelEventResponse {
  ok: boolean
}

export interface EmployeePushConfigResponse {
  enabled: boolean
  vapid_public_key: string | null
}

export interface EmployeePushSubscribeRequest {
  device_fingerprint: string
  subscription: Record<string, unknown>
  send_test?: boolean
}

export interface EmployeePushSubscribeResponse {
  ok: boolean
  subscription_id: number
  test_push_ok?: boolean | null
  test_push_error?: string | null
  test_push_status_code?: number | null
}

export interface EmployeePushUnsubscribeRequest {
  device_fingerprint: string
  endpoint: string
}

export interface EmployeePushUnsubscribeResponse {
  ok: boolean
}

export interface PasskeyRegisterOptionsRequest {
  device_fingerprint: string
}

export interface PasskeyRegisterOptionsResponse {
  challenge_id: number
  expires_at: string
  options: Record<string, unknown>
}

export interface PasskeyRegisterVerifyRequest {
  challenge_id: number
  credential: Record<string, unknown>
}

export interface PasskeyRegisterVerifyResponse {
  ok: boolean
  passkey_id: number
}

export interface PasskeyRecoverOptionsResponse {
  challenge_id: number
  expires_at: string
  options: Record<string, unknown>
}

export interface PasskeyRecoverVerifyRequest {
  challenge_id: number
  credential: Record<string, unknown>
}

export interface PasskeyRecoverVerifyResponse {
  ok: boolean
  employee_id: number
  device_id: number
  device_fingerprint: string
}

export interface RecoveryCodeIssueRequest {
  device_fingerprint: string
  recovery_pin: string
}

export interface RecoveryCodeIssueResponse {
  ok: boolean
  employee_id: number
  device_id: number
  code_count: number
  expires_at: string
  recovery_codes: string[]
}

export interface RecoveryCodeStatusResponse {
  employee_id: number
  device_id: number
  recovery_ready: boolean
  active_code_count: number
  expires_at: string | null
}

export interface RecoveryCodeRevealRequest {
  device_fingerprint: string
  recovery_pin: string
}

export interface RecoveryCodeRevealResponse {
  ok: boolean
  employee_id: number
  device_id: number
  active_code_count: number
  expires_at: string | null
  recovery_codes: string[]
}

export interface RecoveryCodeRecoverRequest {
  employee_id: number
  recovery_pin: string
  recovery_code: string
}

export interface RecoveryCodeRecoverResponse {
  ok: boolean
  employee_id: number
  device_id: number
  device_fingerprint: string
}

export interface ApiErrorShape {
  error?: {
    code?: string
    message?: string
    request_id?: string
  }
  detail?: string
}
