import type { ControlRoomOverviewParams } from '../../api/admin'
import type {
  ControlRoomEmployeeState,
  ControlRoomLocationState,
  ControlRoomRecentEvent,
  ControlRoomRiskStatus,
  LocationGeofenceStatus,
  LocationMonitorDayRecord,
  LocationMonitorInsight,
  LocationMonitorMapPoint,
  LocationMonitorPointSource,
  LocationMonitorTimelineEvent,
  LocationStatus,
  LocationTrustStatus,
} from '../../types/api'
import { dateValue } from '../../utils/dateValue'

const TIME_FORMAT = new Intl.DateTimeFormat('tr-TR', {
  hour: '2-digit',
  minute: '2-digit',
})

const DATE_FORMAT = new Intl.DateTimeFormat('tr-TR', {
  dateStyle: 'medium',
})

const DATE_TIME_FORMAT = new Intl.DateTimeFormat('tr-TR', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

const DAY_FORMAT = new Intl.DateTimeFormat('tr-TR', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
})

const INPUT_DAY_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Istanbul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 24 * 60 * 60 * 1000
const MAX_RANGE_DAYS = 120

export type FocusDatePresetKey =
  | 'TODAY'
  | 'YESTERDAY'
  | 'LAST_3_DAYS'
  | 'LAST_7_DAYS'
  | 'THIS_WEEK'
  | 'THIS_MONTH'
  | 'CUSTOM'

export type ControlRoomQuickFilter = 'critical' | 'watch' | 'live' | 'active-shift'

export const QUICK_FILTER_OPTIONS: Array<{
  key: ControlRoomQuickFilter
  label: string
  description: string
}> = [
  {
    key: 'critical',
    label: 'Kritik',
    description: 'Yuksek riskli personeli onde tutar.',
  },
  {
    key: 'watch',
    label: 'Izlemeli',
    description: 'Takip gerektiren personeli ayiklar.',
  },
  {
    key: 'live',
    label: 'Canli',
    description: 'Canli veya yeni konum sinyali olanlari gosterir.',
  },
  {
    key: 'active-shift',
    label: 'Aktif vardiya',
    description: 'O an vardiyada olan personeli one cikarir.',
  },
]

export const DATE_PRESET_OPTIONS: Array<{
  key: Exclude<FocusDatePresetKey, 'CUSTOM'>
  label: string
}> = [
  { key: 'TODAY', label: 'Bugun' },
  { key: 'YESTERDAY', label: 'Dun' },
  { key: 'LAST_3_DAYS', label: 'Son 3 gun' },
  { key: 'LAST_7_DAYS', label: 'Son 7 gun' },
  { key: 'THIS_WEEK', label: 'Bu hafta' },
  { key: 'THIS_MONTH', label: 'Bu ay' },
]

export const SOURCE_OPTIONS: Array<{ value: LocationMonitorPointSource; label: string }> = [
  { value: 'CHECKIN', label: 'Mesai' },
  { value: 'CHECKOUT', label: 'Mesai bitis' },
  { value: 'APP_OPEN', label: 'App giris' },
  { value: 'APP_CLOSE', label: 'App cikis' },
  { value: 'DEMO_START', label: 'Demo baslangic' },
  { value: 'DEMO_END', label: 'Demo bitis' },
  { value: 'LOCATION_PING', label: 'Ping' },
]

export const ALL_SOURCES = SOURCE_OPTIONS.map((item) => item.value)

export function parseDateValue(value: string): Date | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const dateOnlyMatch = DATE_ONLY_RE.exec(trimmed)
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch
    return new Date(Number(year), Number(month) - 1, Number(day))
  }
  const parsed = new Date(trimmed.includes(' ') ? trimmed.replace(' ', 'T') : trimmed)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function toInputDate(value: Date): string {
  return INPUT_DAY_FORMAT.format(value)
}

function addDays(value: Date, amount: number): Date {
  const next = new Date(value)
  next.setDate(next.getDate() + amount)
  return next
}

function differenceInDays(start: Date, end: Date): number {
  const normalizedStart = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  const normalizedEnd = new Date(end.getFullYear(), end.getMonth(), end.getDate())
  return Math.round((normalizedEnd.getTime() - normalizedStart.getTime()) / DAY_MS)
}

export function normalizeDateRange(startDate: string, endDate: string): {
  startDate: string
  endDate: string
} {
  const parsedStart = parseDateValue(startDate)
  const parsedEnd = parseDateValue(endDate)
  if (!parsedStart || !parsedEnd) return { startDate, endDate }

  let normalizedStart = new Date(parsedStart.getFullYear(), parsedStart.getMonth(), parsedStart.getDate())
  let normalizedEnd = new Date(parsedEnd.getFullYear(), parsedEnd.getMonth(), parsedEnd.getDate())
  if (normalizedStart.getTime() > normalizedEnd.getTime()) {
    normalizedStart = new Date(normalizedEnd)
  }
  const rangeDays = differenceInDays(normalizedStart, normalizedEnd) + 1
  if (rangeDays > MAX_RANGE_DAYS) {
    normalizedStart = addDays(normalizedEnd, -(MAX_RANGE_DAYS - 1))
  }

  return {
    startDate: toInputDate(normalizedStart),
    endDate: toInputDate(normalizedEnd),
  }
}

export function resolveDatePresetRange(
  preset: Exclude<FocusDatePresetKey, 'CUSTOM'>,
): { startDate: string; endDate: string } {
  const today = parseDateValue(dateValue(0)) ?? new Date()
  if (preset === 'TODAY') {
    const value = toInputDate(today)
    return { startDate: value, endDate: value }
  }
  if (preset === 'YESTERDAY') {
    const value = toInputDate(addDays(today, -1))
    return { startDate: value, endDate: value }
  }
  if (preset === 'LAST_3_DAYS') {
    return normalizeDateRange(toInputDate(addDays(today, -2)), toInputDate(today))
  }
  if (preset === 'THIS_WEEK') {
    const weekStart = addDays(today, today.getDay() === 0 ? -6 : 1 - today.getDay())
    return normalizeDateRange(toInputDate(weekStart), toInputDate(today))
  }
  if (preset === 'THIS_MONTH') {
    return normalizeDateRange(toInputDate(new Date(today.getFullYear(), today.getMonth(), 1)), toInputDate(today))
  }
  return normalizeDateRange(toInputDate(addDays(today, -6)), toInputDate(today))
}

export function dayCountForRange(startDate: string, endDate: string): number {
  const parsedStart = parseDateValue(startDate)
  const parsedEnd = parseDateValue(endDate)
  if (!parsedStart || !parsedEnd) return 0
  return Math.max(1, differenceInDays(parsedStart, parsedEnd) + 1)
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-'
  const parsed = parseDateValue(value)
  return parsed ? DATE_TIME_FORMAT.format(parsed) : '-'
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '-'
  const parsed = parseDateValue(value)
  return parsed ? DATE_FORMAT.format(parsed) : '-'
}

export function formatClock(value: string | null | undefined): string {
  if (!value) return '-'
  const parsed = parseDateValue(value)
  return parsed ? TIME_FORMAT.format(parsed) : '-'
}

export function formatDay(value: string): string {
  const parsed = parseDateValue(value)
  return parsed ? DAY_FORMAT.format(parsed) : value
}

export function formatRelative(value: string | null | undefined): string {
  if (!value) return 'Veri yok'
  const diffMs = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(diffMs)) return '-'
  const minutes = Math.max(0, Math.round(diffMs / 60000))
  if (minutes < 1) return 'Simdi'
  if (minutes < 60) return `${minutes} dk once`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} sa once`
  return `${Math.floor(hours / 24)} gun once`
}

export function formatDistance(meters: number | null | undefined): string {
  if (meters == null || !Number.isFinite(meters) || meters <= 0) return '-'
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`
}

export function formatCoordinates(lat: number | null | undefined, lon: number | null | undefined): string {
  if (lat == null || lon == null) return '-'
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`
}

export function pointSourceLabel(
  value: LocationMonitorMapPoint['source'] | LocationMonitorTimelineEvent['source'],
): string {
  if (value === 'CHECKIN') return 'Mesai girisi'
  if (value === 'CHECKOUT') return 'Mesai cikisi'
  if (value === 'APP_OPEN') return 'Uygulama girisi'
  if (value === 'APP_CLOSE') return 'Uygulama cikisi'
  if (value === 'DEMO_START') return 'Demo baslangici'
  if (value === 'DEMO_END') return 'Demo bitisi'
  if (value === 'LOCATION_PING') return 'Konum pingi'
  return 'Son konum'
}

export function controlRoomRiskLabel(value: ControlRoomRiskStatus): string {
  if (value === 'CRITICAL') return 'Kritik'
  if (value === 'WATCH') return 'Izlemeli'
  return 'Normal'
}

export function controlRoomLocationLabel(value: ControlRoomLocationState): string {
  if (value === 'LIVE') return 'Canli'
  if (value === 'STALE') return 'Yakin'
  if (value === 'DORMANT') return 'Bayat'
  return 'Veri yok'
}

export function locationStatusLabel(value: LocationStatus | null | undefined): string {
  if (value === 'VERIFIED' || value === 'VERIFIED_HOME') return 'Dogrulandi'
  if (value === 'INSIDE_GEOFENCE') return 'Geofence ici'
  if (value === 'OUTSIDE_GEOFENCE') return 'Geofence disi'
  if (value === 'UNVERIFIED_LOCATION') return 'Supheli lokasyon'
  if (value === 'LOW_ACCURACY') return 'Dusuk dogruluk'
  if (value === 'STALE_LOCATION') return 'Bayat konum'
  if (value === 'SUSPICIOUS_JUMP') return 'Supheli sicrama'
  if (value === 'MOCK_GPS_SUSPECTED') return 'Mock GPS supheli'
  return 'Konum yok'
}

export function todayStatusLabel(value: ControlRoomEmployeeState['today_status']): string {
  if (value === 'IN_PROGRESS') return 'Aktif vardiya'
  if (value === 'FINISHED') return 'Gun tamamladi'
  return 'Giris bekleniyor'
}

export function dayStatusLabel(value: LocationMonitorDayRecord['status']): string {
  if (value === 'OK') return 'Tamamlandi'
  if (value === 'INCOMPLETE') return 'Eksik'
  if (value === 'LEAVE') return 'Izin'
  return 'Bos'
}

export function locationStatusTone(value: LocationStatus | null | undefined): string {
  if (value === 'VERIFIED' || value === 'VERIFIED_HOME' || value === 'INSIDE_GEOFENCE') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  }
  if (value === 'SUSPICIOUS_JUMP' || value === 'MOCK_GPS_SUSPECTED' || value === 'OUTSIDE_GEOFENCE') {
    return 'border-rose-200 bg-rose-50 text-rose-700'
  }
  if (value === 'LOW_ACCURACY' || value === 'STALE_LOCATION' || value === 'UNVERIFIED_LOCATION') {
    return 'border-amber-200 bg-amber-50 text-amber-700'
  }
  return 'border-slate-200 bg-slate-100 text-slate-600'
}

export function trustTone(value: LocationTrustStatus | null): string {
  if (value === 'HIGH') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (value === 'MEDIUM') return 'border-amber-200 bg-amber-50 text-amber-700'
  if (value === 'LOW') return 'border-orange-200 bg-orange-50 text-orange-700'
  if (value === 'SUSPICIOUS') return 'border-rose-200 bg-rose-50 text-rose-700'
  return 'border-slate-200 bg-slate-100 text-slate-600'
}

export function geofenceTone(value: LocationGeofenceStatus | null): string {
  if (value === 'INSIDE') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (value === 'OUTSIDE') return 'border-rose-200 bg-rose-50 text-rose-700'
  return 'border-slate-200 bg-slate-100 text-slate-600'
}

export function insightTone(value: LocationMonitorInsight['severity']): string {
  if (value === 'critical') return 'border-rose-200 bg-rose-50'
  if (value === 'warning') return 'border-amber-200 bg-amber-50'
  return 'border-slate-200 bg-slate-50'
}

export function latestAvailablePoint(day: LocationMonitorDayRecord): LocationMonitorMapPoint | null {
  return (
    day.last_location_point ??
    day.last_demo_end_point ??
    day.last_app_close_point ??
    day.check_out_point ??
    day.first_demo_start_point ??
    day.first_app_open_point ??
    day.check_in_point
  )
}

export function pickInsightValue(insights: LocationMonitorInsight[], code: string): number | null {
  return insights.find((item) => item.code === code)?.value ?? null
}

export function sourceKey(values: LocationMonitorPointSource[]): string {
  return [...values].sort().join('|')
}

export function eventSeverity(
  event: ControlRoomRecentEvent,
  employeeState: ControlRoomEmployeeState | null | undefined,
): 'critical' | 'watch' | 'info' {
  if (
    event.location_status === 'SUSPICIOUS_JUMP' ||
    event.location_status === 'MOCK_GPS_SUSPECTED' ||
    event.location_status === 'OUTSIDE_GEOFENCE' ||
    employeeState?.risk_status === 'CRITICAL'
  ) {
    return 'critical'
  }
  if (
    event.location_status === 'LOW_ACCURACY' ||
    event.location_status === 'STALE_LOCATION' ||
    event.location_status === 'UNVERIFIED_LOCATION' ||
    employeeState?.risk_status === 'WATCH'
  ) {
    return 'watch'
  }
  return 'info'
}

export function eventSeverityLabel(value: 'critical' | 'watch' | 'info'): string {
  if (value === 'critical') return 'Kritik'
  if (value === 'watch') return 'Izlemeli'
  return 'Canli'
}

export function eventSignalLabel(event: ControlRoomRecentEvent): string {
  const prefix = event.event_type === 'IN' ? 'Giris' : 'Cikis'
  return `${prefix} / ${locationStatusLabel(event.location_status)}`
}

export function eventWhyImportant(
  event: ControlRoomRecentEvent,
  employeeState: ControlRoomEmployeeState | null | undefined,
): string {
  if (event.location_status === 'SUSPICIOUS_JUMP') {
    return 'Imkansiz hiz veya ziplama deseni yeni bir inceleme istiyor.'
  }
  if (event.location_status === 'MOCK_GPS_SUSPECTED') {
    return 'Konum kaynaginda manipulasyon supheleri var.'
  }
  if (event.location_status === 'OUTSIDE_GEOFENCE') {
    return 'Beklenen geofence disinda yeni bir sinyal olustu.'
  }
  if (employeeState?.active_measure?.label) {
    return `${employeeState.active_measure.label} etkisi altinda yeni olay kaydi geldi.`
  }
  if (employeeState?.attention_flags[0]?.label) {
    return `${employeeState.attention_flags[0].label} sonrasi en guncel saha kaydi bu olay.`
  }
  if (event.location_status === 'LOW_ACCURACY') {
    return 'Konum kalitesi dusuk; karar vermeden once rota detayi kontrol edilmeli.'
  }
  return 'Son saha sinyali operasyon akisinda guncel durumun ana gostergesi.'
}

export function queueReason(state: ControlRoomEmployeeState): string {
  if (state.active_measure?.label) return state.active_measure.label
  if (state.attention_flags[0]?.label) return state.attention_flags[0].label
  if (state.location_state === 'LIVE') return 'Canli saha hareketi'
  if (state.last_activity_utc) return `Son aktivite ${formatRelative(state.last_activity_utc)}`
  return state.shift_window_label ?? 'Plan bilgisi bekleniyor'
}

export function buildQuickFilterParams(
  quickFilters: ControlRoomQuickFilter[],
): Pick<ControlRoomOverviewParams, 'risk_status' | 'location_state' | 'today_status'> {
  return {
    risk_status: quickFilters.includes('critical')
      ? 'CRITICAL'
      : quickFilters.includes('watch')
        ? 'WATCH'
        : undefined,
    location_state: quickFilters.includes('live') ? 'LIVE' : undefined,
    today_status: quickFilters.includes('active-shift') ? 'IN_PROGRESS' : undefined,
  }
}

export function toggleQuickFilter(
  filters: ControlRoomQuickFilter[],
  nextFilter: ControlRoomQuickFilter,
): ControlRoomQuickFilter[] {
  const hasFilter = filters.includes(nextFilter)
  if (hasFilter) {
    return filters.filter((value) => value !== nextFilter)
  }

  const nextValues = filters.filter((value) => {
    if (nextFilter === 'critical' || nextFilter === 'watch') {
      return value !== 'critical' && value !== 'watch'
    }
    return value !== nextFilter
  })

  return [...nextValues, nextFilter]
}

export function matchesQuickFilters(
  state: ControlRoomEmployeeState,
  quickFilters: ControlRoomQuickFilter[],
): boolean {
  if (quickFilters.includes('critical') && state.risk_status !== 'CRITICAL') return false
  if (quickFilters.includes('watch') && state.risk_status !== 'WATCH') return false
  if (quickFilters.includes('live') && state.location_state !== 'LIVE') return false
  if (quickFilters.includes('active-shift') && state.today_status !== 'IN_PROGRESS') return false
  return true
}

export function rangeLabel(startDate: string, endDate: string): string {
  if (!startDate || !endDate) return '-'
  return `${startDate} - ${endDate}`
}
