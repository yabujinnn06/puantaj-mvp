const DEVICE_FINGERPRINT_KEY = 'pf_device_fingerprint'
const LEGACY_DEVICE_FINGERPRINT_KEY = 'puantaj_employee_device_fingerprint'
const DEVICE_BINDING_KEY = 'puantaj_employee_device_binding'

export interface DeviceBinding {
  employeeId: number
  deviceId: number
  deviceFingerprint: string
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
    return existing
  }

  const legacy = localStorage.getItem(LEGACY_DEVICE_FINGERPRINT_KEY)
  if (legacy) {
    localStorage.setItem(DEVICE_FINGERPRINT_KEY, legacy)
    return legacy
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
  localStorage.setItem(DEVICE_FINGERPRINT_KEY, fingerprint)
  return fingerprint
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
