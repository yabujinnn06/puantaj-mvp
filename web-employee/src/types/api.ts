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

export interface ApiErrorShape {
  error?: {
    code?: string
    message?: string
    request_id?: string
  }
  detail?: string
}
