export type LocationStatus = 'VERIFIED_HOME' | 'UNVERIFIED_LOCATION' | 'NO_LOCATION'

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
}

export interface EmployeeAppPresencePingRequest {
  device_fingerprint: string
  source?: 'APP_OPEN' | 'YABUBIRD_ENTER'
  lat?: number
  lon?: number
  accuracy_m?: number | null
}

export interface EmployeeAppPresencePingResponse {
  ok: boolean
  employee_id: number
  logged_at: string
}

export interface YabuBirdJoinRequest {
  device_fingerprint: string
  mode?: 'PUBLIC' | 'HOST' | 'ROOM' | 'SOLO'
  room_code?: string | null
  lat?: number
  lon?: number
  accuracy_m?: number | null
}

export interface YabuBirdStateUpdateRequest {
  device_fingerprint: string
  room_id: number
  presence_id: number
  y: number
  velocity: number
  score: number
  flap_count?: number
  is_alive: boolean
  lat?: number
  lon?: number
  accuracy_m?: number | null
}

export interface YabuBirdFinishRequest {
  device_fingerprint: string
  room_id: number
  presence_id: number
  score: number
  survived_ms: number
  lat?: number
  lon?: number
  accuracy_m?: number | null
}

export interface YabuBirdLeaveRequest {
  device_fingerprint: string
  room_id: number
  presence_id: number
  lat?: number
  lon?: number
  accuracy_m?: number | null
}

export interface YabuBirdReactionRequest {
  device_fingerprint: string
  room_id: number
  presence_id: number
  emoji: '😀' | '😂' | '😎' | '😭' | '👏' | '🔥' | '👍' | '😡'
}

export interface YabuBirdRoom {
  id: number
  room_key: string
  room_type: 'PUBLIC' | 'PARTY' | 'SOLO'
  room_label: string
  share_code: string | null
  seed: number
  status: string
  player_count: number
  started_at: string
  ended_at: string | null
  created_at: string
  updated_at: string
}

export interface YabuBirdPresence {
  id: number
  room_id: number
  room_key: string | null
  room_type: 'PUBLIC' | 'PARTY' | 'SOLO' | null
  room_label: string | null
  share_code: string | null
  employee_id: number
  employee_name: string
  color_hex: string
  is_connected: boolean
  is_alive: boolean
  latest_score: number
  latest_y: number
  latest_velocity: number
  flap_count: number
  started_at: string
  last_seen_at: string
  finished_at: string | null
}

export interface YabuBirdScore {
  id: number
  employee_id: number
  employee_name: string
  score: number
  survived_ms: number
  room_id: number | null
  room_key: string | null
  room_type: 'PUBLIC' | 'PARTY' | 'SOLO' | null
  room_label: string | null
  share_code: string | null
  created_at: string
}

export interface YabuBirdReaction {
  id: number
  room_id: number
  presence_id: number | null
  employee_id: number
  employee_name: string
  emoji: '😀' | '😂' | '😎' | '😭' | '👏' | '🔥' | '👍' | '😡'
  created_at: string
}

export interface YabuBirdLiveStateResponse {
  room: YabuBirdRoom
  you: YabuBirdPresence
  players: YabuBirdPresence[]
  leaderboard: YabuBirdScore[]
  reactions: YabuBirdReaction[]
  personal_best: number
}

export interface YabuBirdLeaderboardResponse {
  leaderboard: YabuBirdScore[]
  live_room: YabuBirdRoom | null
  live_rooms: YabuBirdRoom[]
  live_players: YabuBirdPresence[]
  personal_best: number
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
