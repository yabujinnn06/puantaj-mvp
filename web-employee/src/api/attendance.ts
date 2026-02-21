import axios from 'axios'

import { apiClient } from './client'
import type {
  ApiErrorShape,
  AttendanceActionResponse,
  AttendanceCheckinRequest,
  AttendanceCheckoutRequest,
  DeviceClaimRequest,
  DeviceClaimResponse,
  EmployeeQrScanRequest,
  EmployeeQrScanDeniedResponse,
  EmployeePushConfigResponse,
  EmployeePushSubscribeRequest,
  EmployeePushSubscribeResponse,
  EmployeePushUnsubscribeRequest,
  EmployeePushUnsubscribeResponse,
  EmployeeHomeLocationSetRequest,
  EmployeeHomeLocationSetResponse,
  EmployeeStatusResponse,
  PasskeyRecoverOptionsResponse,
  PasskeyRecoverVerifyRequest,
  PasskeyRecoverVerifyResponse,
  PasskeyRegisterOptionsRequest,
  PasskeyRegisterOptionsResponse,
  PasskeyRegisterVerifyRequest,
  PasskeyRegisterVerifyResponse,
  RecoveryCodeIssueRequest,
  RecoveryCodeIssueResponse,
  RecoveryCodeRecoverRequest,
  RecoveryCodeRecoverResponse,
  RecoveryCodeStatusResponse,
} from '../types/api'

export interface ParsedApiError {
  message: string
  code?: string
  requestId?: string
}

const errorCodeMap: Record<string, string> = {
  INVALID_TOKEN: 'Geçersiz oturum belirteci.',
  FORBIDDEN: 'Bu işlem için yetkiniz yok.',
  EMPLOYEE_INACTIVE: 'Çalışan pasif durumda olduğu için işlem yapılamıyor.',
  DEVICE_NOT_CLAIMED: 'Cihaz bağlı değil. Lütfen davet linkine tıklayın.',
  HOME_LOCATION_ALREADY_SET: 'Ev konumu zaten kayıtlı. Değişiklik için İK ile iletişime geçin.',
  CHECKIN_REQUIRED: 'Önce QR ile giriş yapmalısınız.',
  ALREADY_CHECKED_IN: 'Bugün zaten giriş yaptınız. Mesaiyi bitirmeniz bekleniyor.',
  ALREADY_CHECKED_OUT: 'Bugün için çıkış işlemi zaten yapılmış.',
  DAY_ALREADY_FINISHED: 'Bugünkü mesai tamamlandı. Yeni giriş yarın yapılabilir.',
  PASSKEY_DISABLED: 'Passkey özelliği şu anda devre dışı.',
  PASSKEY_RUNTIME_UNAVAILABLE: 'Passkey altyapısı hazır değil.',
  PASSKEY_CHALLENGE_NOT_FOUND: 'Passkey doğrulama oturumu bulunamadı.',
  PASSKEY_CHALLENGE_USED: 'Bu passkey doğrulama oturumu daha önce kullanılmış.',
  PASSKEY_CHALLENGE_EXPIRED: 'Passkey doğrulama süresi doldu.',
  PASSKEY_REGISTRATION_FAILED: 'Passkey kaydı doğrulanamadı.',
  PASSKEY_AUTH_FAILED: 'Passkey doğrulaması başarısız oldu.',
  PASSKEY_NOT_REGISTERED: 'Bu cihaz için passkey kaydı bulunamadı.',
  RECOVERY_PIN_INVALID: 'Recovery PIN hatali.',
  RECOVERY_CODE_INVALID: 'Recovery code hatali.',
  RECOVERY_CODES_NOT_READY: 'Bu hesapta aktif recovery code yok veya suresi dolmus.',
  QR_POINT_OUT_OF_RANGE: 'Bu QR kod sadece tanımlı konum içinde okutulabilir.',
  QR_CODE_NOT_FOUND: 'QR kod bulunamadı veya pasif durumda.',
  QR_CODE_HAS_NO_ACTIVE_POINTS: 'Bu QR koda aktif konum noktası atanmadı.',
  QR_DOUBLE_SCAN_BLOCKED: 'Aynı çalışan için QR okutmalar arasında en az 5 dakika olmalıdır.',
  PUSH_NOT_CONFIGURED: 'Bildirim servisi şu anda aktif değil.',
  INVALID_PUSH_SUBSCRIPTION: 'Bildirim abonelik verisi geçersiz.',
}

const backendDetailMap: Record<string, string> = {
  'Invite token not found': 'Davet bağlantısı geçersiz veya bulunamadı.',
  'Invite token expired': 'Davet bağlantısının süresi dolmuş.',
  'Invite token already used': 'Bu davet bağlantısı daha önce kullanılmış.',
  'Device fingerprint already belongs to another employee':
    'Bu cihaz başka bir çalışana bağlı görünüyor. İK ile iletişime geçin.',
}

export function parseApiError(error: unknown, fallback: string): ParsedApiError {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as
      | ApiErrorShape
      | EmployeeQrScanDeniedResponse
      | string
      | undefined
    if (typeof data === 'string') {
      return { message: data }
    }

    const errorObj =
      typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'object'
        ? (data.error as { code?: string; request_id?: string; message?: string })
        : undefined
    const code = errorObj?.code
    const requestId = errorObj?.request_id
    const detail =
      typeof data === 'object' && data !== null && 'detail' in data
        ? (data.detail as string | undefined)
        : undefined
    const backendMessage = errorObj?.message
    const deniedReason =
      typeof data === 'object' && data !== null && 'reason' in data
        ? (data.reason as string | undefined)
        : undefined
    const deniedDistance =
      typeof data === 'object' && data !== null && 'closest_distance_m' in data
        ? (data.closest_distance_m as number | null | undefined)
        : undefined

    if (deniedReason === 'QR_POINT_OUT_OF_RANGE') {
      const distanceText =
        typeof deniedDistance === 'number' ? `${Math.round(deniedDistance)}m` : 'bilinmiyor'
      return {
        code: deniedReason,
        requestId,
        message: `Bu QR kod bu konumda geçerli değil. En yakın nokta: ${distanceText}.`,
      }
    }

    if (code && code.startsWith('PASSKEY_') && backendMessage) {
      return { code, requestId, message: backendMessage }
    }
    if (detail && backendDetailMap[detail]) {
      return { code, requestId, message: backendDetailMap[detail] }
    }
    if (code && errorCodeMap[code]) {
      return { code, requestId, message: errorCodeMap[code] }
    }
    if (backendMessage) {
      return { code, requestId, message: backendMessage }
    }
    if (detail) {
      return { code, requestId, message: detail }
    }
    if (error.message) {
      return { message: error.message }
    }
  }

  if (error instanceof Error && error.message) {
    return { message: error.message }
  }
  return { message: fallback }
}

export async function claimDevice(payload: DeviceClaimRequest): Promise<DeviceClaimResponse> {
  const response = await apiClient.post<DeviceClaimResponse>('/api/device/claim', payload)
  return response.data
}

export async function checkin(payload: AttendanceCheckinRequest): Promise<AttendanceActionResponse> {
  const response = await apiClient.post<AttendanceActionResponse>('/api/attendance/checkin', payload)
  return response.data
}

export async function checkout(payload: AttendanceCheckoutRequest): Promise<AttendanceActionResponse> {
  const response = await apiClient.post<AttendanceActionResponse>('/api/attendance/checkout', payload)
  return response.data
}

export async function scanEmployeeQr(payload: EmployeeQrScanRequest): Promise<AttendanceActionResponse> {
  const response = await apiClient.post<AttendanceActionResponse>('/api/employee/qr/scan', payload)
  return response.data
}

export async function setEmployeeHomeLocation(
  payload: EmployeeHomeLocationSetRequest,
): Promise<EmployeeHomeLocationSetResponse> {
  const response = await apiClient.post<EmployeeHomeLocationSetResponse>(
    '/api/employee/home-location',
    payload,
  )
  return response.data
}

export async function getEmployeeStatus(deviceFingerprint: string): Promise<EmployeeStatusResponse> {
  const response = await apiClient.get<EmployeeStatusResponse>('/api/employee/status', {
    params: { device_fingerprint: deviceFingerprint },
  })
  return response.data
}

export async function getEmployeePushConfig(): Promise<EmployeePushConfigResponse> {
  const response = await apiClient.get<EmployeePushConfigResponse>('/api/employee/push/config')
  return response.data
}

export async function subscribeEmployeePush(
  payload: EmployeePushSubscribeRequest,
): Promise<EmployeePushSubscribeResponse> {
  const response = await apiClient.post<EmployeePushSubscribeResponse>(
    '/api/employee/push/subscribe',
    payload,
  )
  return response.data
}

export async function unsubscribeEmployeePush(
  payload: EmployeePushUnsubscribeRequest,
): Promise<EmployeePushUnsubscribeResponse> {
  const response = await apiClient.post<EmployeePushUnsubscribeResponse>(
    '/api/employee/push/unsubscribe',
    payload,
  )
  return response.data
}

export async function getPasskeyRegisterOptions(
  payload: PasskeyRegisterOptionsRequest,
): Promise<PasskeyRegisterOptionsResponse> {
  const response = await apiClient.post<PasskeyRegisterOptionsResponse>(
    '/api/device/passkey/register/options',
    payload,
  )
  return response.data
}

export async function verifyPasskeyRegistration(
  payload: PasskeyRegisterVerifyRequest,
): Promise<PasskeyRegisterVerifyResponse> {
  const response = await apiClient.post<PasskeyRegisterVerifyResponse>(
    '/api/device/passkey/register/verify',
    payload,
  )
  return response.data
}

export async function getPasskeyRecoverOptions(): Promise<PasskeyRecoverOptionsResponse> {
  const response = await apiClient.post<PasskeyRecoverOptionsResponse>('/api/device/passkey/recover/options')
  return response.data
}

export async function verifyPasskeyRecover(
  payload: PasskeyRecoverVerifyRequest,
): Promise<PasskeyRecoverVerifyResponse> {
  const response = await apiClient.post<PasskeyRecoverVerifyResponse>(
    '/api/device/passkey/recover/verify',
    payload,
  )
  return response.data
}

export async function issueRecoveryCodes(
  payload: RecoveryCodeIssueRequest,
): Promise<RecoveryCodeIssueResponse> {
  const response = await apiClient.post<RecoveryCodeIssueResponse>(
    '/api/device/recovery-codes/issue',
    payload,
  )
  return response.data
}

export async function getRecoveryCodeStatus(
  deviceFingerprint: string,
): Promise<RecoveryCodeStatusResponse> {
  const response = await apiClient.get<RecoveryCodeStatusResponse>(
    '/api/device/recovery-codes/status',
    { params: { device_fingerprint: deviceFingerprint } },
  )
  return response.data
}

export async function recoverDeviceWithCode(
  payload: RecoveryCodeRecoverRequest,
): Promise<RecoveryCodeRecoverResponse> {
  const response = await apiClient.post<RecoveryCodeRecoverResponse>(
    '/api/device/recovery-codes/recover',
    payload,
  )
  return response.data
}
