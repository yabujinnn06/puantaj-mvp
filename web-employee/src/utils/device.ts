const DEVICE_FINGERPRINT_KEY = 'pf_device_fingerprint'
const LEGACY_DEVICE_FINGERPRINT_KEY = 'puantaj_employee_device_fingerprint'
const DEVICE_BINDING_KEY = 'puantaj_employee_device_binding'
const DEVICE_FINGERPRINT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 3

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

function clearDeviceFingerprintCookie(): void {
  if (typeof document === 'undefined') {
    return
  }
  const secure =
    typeof window !== 'undefined' && window.location.protocol === 'https:'
      ? ';secure'
      : ''
  document.cookie = `${DEVICE_FINGERPRINT_KEY}=;path=/;max-age=0;samesite=lax${secure}`
}

function clearLegacyDeviceFingerprintStorage(): void {
  if (typeof window === 'undefined') {
    return
  }
  window.localStorage.removeItem(DEVICE_FINGERPRINT_KEY)
  window.localStorage.removeItem(LEGACY_DEVICE_FINGERPRINT_KEY)
  window.localStorage.removeItem(DEVICE_BINDING_KEY)
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
  const cookieValue = readDeviceFingerprintCookie()
  if (cookieValue) {
    clearLegacyDeviceFingerprintStorage()
    return cookieValue
  }

  if (typeof window !== 'undefined') {
    const existing = window.localStorage.getItem(DEVICE_FINGERPRINT_KEY)
    if (existing) {
      clearLegacyDeviceFingerprintStorage()
      writeDeviceFingerprintCookie(existing)
      return existing
    }

    const legacy = window.localStorage.getItem(LEGACY_DEVICE_FINGERPRINT_KEY)
    if (legacy) {
      clearLegacyDeviceFingerprintStorage()
      writeDeviceFingerprintCookie(legacy)
      return legacy
    }
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
  writeDeviceFingerprintCookie(value)
  clearLegacyDeviceFingerprintStorage()
}

export function clearStoredDeviceFingerprint(): void {
  clearLegacyDeviceFingerprintStorage()
  clearDeviceFingerprintCookie()
}
