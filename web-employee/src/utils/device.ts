const DEVICE_FINGERPRINT_KEY = 'pf_device_fingerprint'
const LEGACY_DEVICE_FINGERPRINT_KEY = 'puantaj_employee_device_fingerprint'
const DEVICE_BINDING_KEY = 'puantaj_employee_device_binding'
const DEVICE_FINGERPRINT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 3

export interface DeviceBinding {
  employeeId: number
  deviceId: number
  deviceFingerprint: string
}

function readDeviceFingerprintCookie(): string | null {
  if (typeof document === 'undefined') {
    return null
  }
  const target = `${DEVICE_FINGERPRINT_KEY}=`
  const cookieParts = document.cookie.split(';')
  for (const part of cookieParts) {
    const item = part.trim()
    if (!item.startsWith(target)) {
      continue
    }
    const rawValue = item.slice(target.length)
    if (!rawValue) {
      return null
    }
    try {
      return decodeURIComponent(rawValue)
    } catch {
      return rawValue
    }
  }
  return null
}

function writeDeviceFingerprintCookie(value: string): void {
  if (typeof document === 'undefined') {
    return
  }
  const secure =
    typeof window !== 'undefined' && window.location.protocol === 'https:'
      ? ';secure'
      : ''
  document.cookie = `${DEVICE_FINGERPRINT_KEY}=${encodeURIComponent(value)};path=/;max-age=${DEVICE_FINGERPRINT_COOKIE_MAX_AGE_SECONDS};samesite=lax${secure}`
}

function fallbackUuidV4(): string {
  const tpl = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
  return tpl.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16)
    const value = char === 'x' ? random : ((random & 0x3) | 0x8)
    return value.toString(16)
  })
}

export function getStoredDeviceFingerprint(): string | null {
  const existing = localStorage.getItem(DEVICE_FINGERPRINT_KEY)
  if (existing) {
    writeDeviceFingerprintCookie(existing)
    return existing
  }

  const legacy = localStorage.getItem(LEGACY_DEVICE_FINGERPRINT_KEY)
  if (legacy) {
    localStorage.setItem(DEVICE_FINGERPRINT_KEY, legacy)
    writeDeviceFingerprintCookie(legacy)
    return legacy
  }

  const cookieValue = readDeviceFingerprintCookie()
  if (cookieValue) {
    localStorage.setItem(DEVICE_FINGERPRINT_KEY, cookieValue)
    return cookieValue
  }

  return null
}

export function getOrCreateDeviceFingerprint(): string {
  const stored = getStoredDeviceFingerprint()
  if (stored) {
    return stored
  }

  const fingerprint =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : fallbackUuidV4()
  setStoredDeviceFingerprint(fingerprint)
  return fingerprint
}

export function setStoredDeviceFingerprint(value: string): void {
  localStorage.setItem(DEVICE_FINGERPRINT_KEY, value)
  writeDeviceFingerprintCookie(value)
}

export function getDeviceBinding(): DeviceBinding | null {
  const raw = localStorage.getItem(DEVICE_BINDING_KEY)
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as DeviceBinding
    if (
      typeof parsed.employeeId === 'number' &&
      typeof parsed.deviceId === 'number' &&
      typeof parsed.deviceFingerprint === 'string'
    ) {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

export function setDeviceBinding(binding: DeviceBinding): void {
  localStorage.setItem(DEVICE_BINDING_KEY, JSON.stringify(binding))
}
