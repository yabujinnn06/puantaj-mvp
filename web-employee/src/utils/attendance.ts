import type { AttendanceActionResponse, LocationStatus } from '../types/api'

export function locationStatusLabel(status: LocationStatus): string {
  if (status === 'VERIFIED_HOME') {
    return 'Evde Onaylı'
  }
  if (status === 'UNVERIFIED_LOCATION') {
    return 'Ev Dışı'
  }
  return 'Konum Yok'
}

export function locationStatusClass(status: LocationStatus): string {
  if (status === 'VERIFIED_HOME') {
    return 'state-ok'
  }
  if (status === 'UNVERIFIED_LOCATION') {
    return 'state-warn'
  }
  return 'state-err'
}

export function formatTs(tsUtc: string): string {
  const date = new Date(tsUtc)
  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(date)
}

export function prettyFlagValue(value: unknown): string {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(2)
  }
  if (typeof value === 'boolean') {
    return value ? 'Evet' : 'Hayır'
  }
  if (value === null || value === undefined) {
    return '-'
  }
  return String(value)
}

export interface ParsedQrPayload {
  type: 'IN' | 'OUT'
  site_id: string
  shift_id?: number
}

function parseShiftId(shiftRaw: unknown): number | undefined {
  if (typeof shiftRaw === 'number' && Number.isInteger(shiftRaw) && shiftRaw > 0) {
    return shiftRaw
  }
  if (typeof shiftRaw === 'string') {
    const trimmed = shiftRaw.trim()
    if (!trimmed) return undefined
    const parsed = Number(trimmed)
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed
    }
  }
  return undefined
}

function normalizeQrPayload(siteIdRaw: unknown, typeRaw: unknown, shiftRaw?: unknown): ParsedQrPayload | null {
  if (typeof siteIdRaw !== 'string' || typeof typeRaw !== 'string') {
    return null
  }

  const siteId = siteIdRaw.trim()
  const type = typeRaw.trim().toUpperCase()
  if (!siteId || (type !== 'IN' && type !== 'OUT')) {
    return null
  }

  const shift_id = parseShiftId(shiftRaw)
  if (shift_id !== undefined) {
    return { site_id: siteId, type, shift_id }
  }
  return { site_id: siteId, type }
}

function parseFromJson(cleaned: string): ParsedQrPayload | null {
  try {
    const parsed = JSON.parse(cleaned) as { site_id?: unknown; type?: unknown; shift_id?: unknown }
    return normalizeQrPayload(parsed.site_id, parsed.type, parsed.shift_id)
  } catch {
    return null
  }
}

function parseFromQueryString(cleaned: string): ParsedQrPayload | null {
  let candidate = cleaned

  try {
    if (cleaned.includes('://')) {
      const parsedUrl = new URL(cleaned)
      candidate = parsedUrl.search ? parsedUrl.search.slice(1) : parsedUrl.pathname
    }
  } catch {
    // full URL olmayabilir, ham querystring olarak devam et
  }

  if (candidate.startsWith('?')) {
    candidate = candidate.slice(1)
  }

  const params = new URLSearchParams(candidate)
  const siteId = params.get('site_id')
  const type = params.get('type')
  const shiftId = params.get('shift_id')
  return normalizeQrPayload(siteId, type, shiftId)
}

function parseLegacyPipe(cleaned: string): ParsedQrPayload | null {
  const parts = cleaned.split('|')
  if (parts.length !== 2) {
    return null
  }
  return normalizeQrPayload(parts[1], parts[0], undefined)
}

export function parseQrPayload(rawValue: string): ParsedQrPayload | null {
  const cleaned = rawValue.trim()
  if (!cleaned) {
    return null
  }

  const jsonPayload = parseFromJson(cleaned)
  if (jsonPayload) {
    return jsonPayload
  }

  const queryPayload = parseFromQueryString(cleaned)
  if (queryPayload) {
    return queryPayload
  }

  return parseLegacyPipe(cleaned)
}

export function flagLabel(key: string, value: unknown): string {
  if (key === 'DUPLICATE_EVENT') {
    return 'Mükerrer kayıt'
  }
  if (key === 'MANUAL_CHECKOUT') {
    return 'Manuel çıkış'
  }
  if (key === 'home_location_not_set' || (key === 'reason' && value === 'home_location_not_set')) {
    return 'Ev konumu tanımlı değil'
  }
  return key
}

export function hasDuplicateFlag(response: AttendanceActionResponse): boolean {
  return response.flags.DUPLICATE_EVENT === true
}
