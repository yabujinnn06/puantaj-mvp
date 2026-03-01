import type { ControlRoomOverviewParams } from '../../api/admin'
import type { ControlRoomRiskStatus } from '../../types/api'

export const MANAGEMENT_CONSOLE_TIMEZONE = 'Europe/Istanbul'
export const DEFAULT_LIMIT = 50
export const LIMIT_OPTIONS = [25, 50, 100]
export const MAP_EVENT_PAGE_SIZE = 400

export const SORT_OPTIONS = [
  { value: 'risk_score', label: 'Risk skoru' },
  { value: 'last_activity', label: 'Son aktivite' },
  { value: 'last_checkin', label: 'Son giriş' },
  { value: 'last_checkout', label: 'Son çıkış' },
  { value: 'worked_today', label: 'Bugünkü süre' },
  { value: 'weekly_total', label: 'Haftalık süre' },
  { value: 'violation_count_7d', label: 'İhlal sayısı' },
  { value: 'employee_name', label: 'Personel adı' },
  { value: 'department_name', label: 'Departman' },
] as const

export type SortField = (typeof SORT_OPTIONS)[number]['value']

export type FilterFormState = {
  q: string
  region_id: string
  department_id: string
  start_date: string
  end_date: string
  map_date: string
  include_inactive: boolean
  risk_min: string
  risk_max: string
  risk_status: '' | ControlRoomRiskStatus
  sort_by: SortField
  sort_dir: 'asc' | 'desc'
  limit: number
}

export type ActionState =
  | { kind: 'action'; actionType: 'SUSPEND' | 'DISABLE_TEMP' | 'REVIEW' }
  | { kind: 'override' }
  | { kind: 'note' }
  | null

export function dateValue(offsetDays = 0): string {
  const value = new Date()
  value.setDate(value.getDate() + offsetDays)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: MANAGEMENT_CONSOLE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value)
}

export function defaultFilters(): FilterFormState {
  return {
    q: '',
    region_id: '',
    department_id: '',
    start_date: dateValue(-6),
    end_date: dateValue(0),
    map_date: dateValue(0),
    include_inactive: false,
    risk_min: '',
    risk_max: '',
    risk_status: '',
    sort_by: 'risk_score',
    sort_dir: 'desc',
    limit: DEFAULT_LIMIT,
  }
}

export function parseNumber(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function toOverviewParams(filters: FilterFormState, page: number): ControlRoomOverviewParams {
  return {
    q: filters.q.trim() || undefined,
    region_id: parseNumber(filters.region_id),
    department_id: parseNumber(filters.department_id),
    start_date: filters.start_date || undefined,
    end_date: filters.end_date || undefined,
    map_date: filters.map_date || undefined,
    include_inactive: filters.include_inactive,
    risk_min: parseNumber(filters.risk_min),
    risk_max: parseNumber(filters.risk_max),
    risk_status: filters.risk_status || undefined,
    sort_by: filters.sort_by,
    sort_dir: filters.sort_dir,
    limit: filters.limit,
    offset: (page - 1) * filters.limit,
  }
}
