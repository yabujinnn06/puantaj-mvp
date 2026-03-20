import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'

import {
  getDepartments,
  getEmployees,
  getLocationMonitorEmployeeMapPoints,
  getLocationMonitorEmployeeSummary,
  getLocationMonitorEmployeeTimelineEvents,
  getRegions,
} from '../api/admin'
import { EmployeeAutocompleteField } from '../components/EmployeeAutocompleteField'
import { ErrorBlock } from '../components/ErrorBlock'
import { LoadingBlock } from '../components/LoadingBlock'
import { MinuteDisplay } from '../components/MinuteDisplay'
import { LocationMonitorMap } from '../components/location-monitor/LocationMonitorMap'
import type {
  Department,
  Employee,
  LocationGeofenceStatus,
  LocationMonitorDayRecord,
  LocationMonitorInsight,
  LocationMonitorMapPoint,
  LocationMonitorPointSource,
  LocationMonitorTimelineEvent,
  LocationStatus,
  LocationTrustStatus,
  Region,
} from '../types/api'
import { dateValue } from '../utils/dateValue'

const LazyLocationMonitor3DView = lazy(async () => {
  const module = await import('../components/location-monitor/LocationMonitor3DView')
  return { default: module.LocationMonitor3DView }
})

const TIME_FORMAT = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' })
const DATE_TIME_FORMAT = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })
const DAY_FORMAT = new Intl.DateTimeFormat('tr-TR', { weekday: 'short', day: '2-digit', month: 'short' })
const INPUT_DAY_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Istanbul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 24 * 60 * 60 * 1000
const MAX_RANGE_DAYS = 120
const INITIAL_EVENT_RENDER_COUNT = 12
const INITIAL_DAY_RENDER_COUNT = 10

type DatePresetKey = 'TODAY' | 'YESTERDAY' | 'LAST_3_DAYS' | 'LAST_7_DAYS' | 'THIS_WEEK' | 'THIS_MONTH' | 'CUSTOM'
type MapMode = '2D' | '3D'

type FilterState = {
  employeeId: string
  regionId: string
  departmentId: string
  includeInactive: boolean
  startDate: string
  endDate: string
  activeDatePreset: DatePresetKey
}

const DATE_PRESET_OPTIONS: Array<{ key: Exclude<DatePresetKey, 'CUSTOM'>; label: string }> = [
  { key: 'TODAY', label: 'Bugun' },
  { key: 'YESTERDAY', label: 'Dun' },
  { key: 'LAST_3_DAYS', label: 'Son 3 gun' },
  { key: 'LAST_7_DAYS', label: 'Son 7 gun' },
  { key: 'THIS_WEEK', label: 'Bu hafta' },
  { key: 'THIS_MONTH', label: 'Bu ay' },
]

const SOURCE_OPTIONS: Array<{ value: LocationMonitorPointSource; label: string }> = [
  { value: 'CHECKIN', label: 'Mesai' },
  { value: 'CHECKOUT', label: 'Mesai bitis' },
  { value: 'APP_OPEN', label: 'App giris' },
  { value: 'APP_CLOSE', label: 'App cikis' },
  { value: 'DEMO_START', label: 'Demo baslangic' },
  { value: 'DEMO_END', label: 'Demo bitis' },
  { value: 'LOCATION_PING', label: 'Ping' },
]

const ALL_SOURCES = SOURCE_OPTIONS.map((item) => item.value)

function initialFilterState(): FilterState {
  return {
    employeeId: '',
    regionId: '',
    departmentId: '',
    includeInactive: false,
    startDate: dateValue(-6),
    endDate: dateValue(0),
    activeDatePreset: 'LAST_7_DAYS',
  }
}

function parseDateValue(value: string): Date | null {
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

function normalizeDateRange(startDate: string, endDate: string): { startDate: string; endDate: string } {
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
  return { startDate: toInputDate(normalizedStart), endDate: toInputDate(normalizedEnd) }
}

function resolveDatePresetRange(preset: Exclude<DatePresetKey, 'CUSTOM'>): { startDate: string; endDate: string } {
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

function normalizeFilterState(state: FilterState): FilterState {
  const normalizedRange = normalizeDateRange(state.startDate, state.endDate)
  return {
    ...state,
    startDate: normalizedRange.startDate,
    endDate: normalizedRange.endDate,
  }
}

function filtersEqual(left: FilterState, right: FilterState): boolean {
  return (
    left.employeeId === right.employeeId &&
    left.regionId === right.regionId &&
    left.departmentId === right.departmentId &&
    left.includeInactive === right.includeInactive &&
    left.startDate === right.startDate &&
    left.endDate === right.endDate &&
    left.activeDatePreset === right.activeDatePreset
  )
}

function formatDateTime(value: string | null): string {
  if (!value) return '-'
  const parsed = parseDateValue(value)
  return parsed ? DATE_TIME_FORMAT.format(parsed) : '-'
}

function formatClock(value: string | null): string {
  if (!value) return '-'
  const parsed = parseDateValue(value)
  return parsed ? TIME_FORMAT.format(parsed) : '-'
}

function formatDay(value: string): string {
  const parsed = parseDateValue(value)
  return parsed ? DAY_FORMAT.format(parsed) : value
}

function formatDistance(meters: number | null | undefined): string {
  if (meters == null || !Number.isFinite(meters) || meters <= 0) return '-'
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`
}

function formatCoordinates(lat: number | null | undefined, lon: number | null | undefined): string {
  if (lat == null || lon == null) return '-'
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`
}

function pointSourceLabel(value: LocationMonitorMapPoint['source'] | LocationMonitorTimelineEvent['source']): string {
  if (value === 'CHECKIN') return 'Mesai girisi'
  if (value === 'CHECKOUT') return 'Mesai cikisi'
  if (value === 'APP_OPEN') return 'Uygulama girisi'
  if (value === 'APP_CLOSE') return 'Uygulama cikisi'
  if (value === 'DEMO_START') return 'Demo baslangici'
  if (value === 'DEMO_END') return 'Demo bitisi'
  if (value === 'LOCATION_PING') return 'Konum pingi'
  return 'Son konum'
}

function dayStatusLabel(value: LocationMonitorDayRecord['status']): string {
  if (value === 'OK') return 'Tamamlandi'
  if (value === 'INCOMPLETE') return 'Eksik'
  if (value === 'LEAVE') return 'Izin'
  return 'Bos'
}

function statusTone(value: LocationStatus | null): string {
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

function trustTone(value: LocationTrustStatus | null): string {
  if (value === 'HIGH') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (value === 'MEDIUM') return 'border-amber-200 bg-amber-50 text-amber-700'
  if (value === 'LOW') return 'border-orange-200 bg-orange-50 text-orange-700'
  if (value === 'SUSPICIOUS') return 'border-rose-200 bg-rose-50 text-rose-700'
  return 'border-slate-200 bg-slate-100 text-slate-600'
}

function geofenceTone(value: LocationGeofenceStatus | null): string {
  if (value === 'INSIDE') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (value === 'OUTSIDE') return 'border-rose-200 bg-rose-50 text-rose-700'
  return 'border-slate-200 bg-slate-100 text-slate-600'
}

function insightTone(value: LocationMonitorInsight['severity']): string {
  if (value === 'critical') return 'border-rose-200 bg-rose-50'
  if (value === 'warning') return 'border-amber-200 bg-amber-50'
  return 'border-slate-200 bg-slate-50'
}

function latestAvailablePoint(day: LocationMonitorDayRecord): LocationMonitorMapPoint | null {
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

function pickInsightValue(insights: LocationMonitorInsight[], code: string): number | null {
  return insights.find((item) => item.code === code)?.value ?? null
}

function sourceKey(values: LocationMonitorPointSource[]): string {
  return [...values].sort().join('|')
}

function employeeListForFilters(
  employees: Employee[],
  filters: Pick<FilterState, 'regionId' | 'departmentId' | 'includeInactive'>,
): Employee[] {
  return [...employees]
    .filter((employee) => {
      if (!filters.includeInactive && !employee.is_active) return false
      if (filters.regionId && String(employee.region_id ?? '') !== filters.regionId) return false
      if (filters.departmentId && String(employee.department_id ?? '') !== filters.departmentId) return false
      return true
    })
    .sort((left, right) => {
      if (left.is_active !== right.is_active) return left.is_active ? -1 : 1
      return left.full_name.localeCompare(right.full_name, 'tr')
    })
}

function employeeMeta(employee: Employee | null): string {
  if (!employee) return 'Calisan secin'
  const pieces = [`#${employee.id}`]
  if (employee.region_name) pieces.push(employee.region_name)
  return pieces.join(' / ')
}

function buildEventSummary(event: LocationMonitorTimelineEvent): string {
  const parts: string[] = [pointSourceLabel(event.source)]
  if (event.accuracy_m != null) {
    parts.push(`Dogruluk ${Math.round(event.accuracy_m)} m`)
  }
  if (event.provider) {
    parts.push(event.provider)
  }
  return parts.join(' / ')
}

function rangeLabel(startDate: string, endDate: string): string {
  if (!startDate || !endDate) return '-'
  return `${startDate} - ${endDate}`
}

function dayCountForRange(startDate: string, endDate: string): number {
  const parsedStart = parseDateValue(startDate)
  const parsedEnd = parseDateValue(endDate)
  if (!parsedStart || !parsedEnd) return 0
  return Math.max(1, differenceInDays(parsedStart, parsedEnd) + 1)
}

function MetricTile({
  label,
  value,
  detail,
}: {
  label: string
  value: ReactNode
  detail?: ReactNode
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <div className="mt-2 text-sm font-semibold text-slate-900">{value}</div>
      {detail ? <div className="mt-1 text-xs text-slate-500">{detail}</div> : null}
    </div>
  )
}

function Pill({
  children,
  className,
}: {
  children: ReactNode
  className: string
}) {
  return <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${className}`}>{children}</span>
}

function FilterPanel({
  filters,
  employees,
  regions,
  departments,
  isDirty,
  isBusy,
  onPatch,
  onApply,
  onReset,
}: {
  filters: FilterState
  employees: Employee[]
  regions: Region[]
  departments: Department[]
  isDirty: boolean
  isBusy: boolean
  onPatch: (patch: Partial<FilterState>) => void
  onApply: () => void
  onReset: () => void
}) {
  const draftRangeDays = dayCountForRange(filters.startDate, filters.endDate)

  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Filtreler</p>
          <h3 className="mt-1 text-lg font-semibold text-slate-900">Kisi ve zaman</h3>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-600">
          {draftRangeDays} gun
        </span>
      </div>

      <div className="mt-4 space-y-4">
        <EmployeeAutocompleteField
          label="Calisan"
          employees={employees}
          value={filters.employeeId}
          onChange={(value) => onPatch({ employeeId: value })}
          helperText="Mobilde once kisi, sonra hareket izi okunur."
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm text-slate-700">
            Bolge
            <select
              value={filters.regionId}
              onChange={(event) => onPatch({ regionId: event.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
            >
              <option value="">Tum bolgeler</option>
              {regions.map((region) => (
                <option key={region.id} value={region.id}>
                  {region.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm text-slate-700">
            Departman
            <select
              value={filters.departmentId}
              onChange={(event) => onPatch({ departmentId: event.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
            >
              <option value="">Tum departmanlar</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Hazir aralik</p>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {DATE_PRESET_OPTIONS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                onClick={() => {
                  const nextRange = resolveDatePresetRange(preset.key)
                  onPatch({
                    startDate: nextRange.startDate,
                    endDate: nextRange.endDate,
                    activeDatePreset: preset.key,
                  })
                }}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  filters.activeDatePreset === preset.key
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-700'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-slate-700">
              Baslangic
              <input
                type="date"
                value={filters.startDate}
                onChange={(event) =>
                  onPatch({ startDate: event.target.value, activeDatePreset: 'CUSTOM' })
                }
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="block text-sm text-slate-700">
              Bitis
              <input
                type="date"
                value={filters.endDate}
                onChange={(event) =>
                  onPatch({ endDate: event.target.value, activeDatePreset: 'CUSTOM' })
                }
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
              />
            </label>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={filters.includeInactive}
            onChange={(event) => onPatch({ includeInactive: event.target.checked })}
            className="rounded border-slate-300"
          />
          Pasif calisanlari da goster
        </label>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onApply}
          disabled={!filters.employeeId || !isDirty || isBusy}
          className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isBusy ? 'Yukleniyor...' : 'Uygula'}
        </button>
        <button
          type="button"
          onClick={onReset}
          className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
        >
          Sifirla
        </button>
      </div>
    </article>
  )
}

function TimelineEventCard({
  event,
  selected,
  expanded,
  onFocus,
  onToggleExpanded,
}: {
  event: LocationMonitorTimelineEvent
  selected: boolean
  expanded: boolean
  onFocus: () => void
  onToggleExpanded: () => void
}) {
  return (
    <article
      className={`rounded-2xl border px-4 py-4 transition ${
        selected ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="truncate text-sm">{event.label}</strong>
            <Pill className={statusTone(event.location_status)}>
              {event.location_status ?? 'NO_LOCATION'}
            </Pill>
          </div>
          <p className={`mt-1 truncate text-xs ${selected ? 'text-slate-200' : 'text-slate-500'}`}>
            {buildEventSummary(event)}
          </p>
        </div>
        <div className={`shrink-0 text-right ${selected ? 'text-slate-200' : 'text-slate-500'}`}>
          <div className="text-sm font-semibold">{formatClock(event.ts_utc)}</div>
          <div className="mt-1 text-[11px]">{formatDay(event.day)}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Pill className={trustTone(event.trust_status)}>
          {event.trust_status ?? 'NO_DATA'}
        </Pill>
        <Pill className={geofenceTone(event.geofence_status)}>
          {event.geofence_status ?? 'UNKNOWN'}
        </Pill>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onFocus}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
            selected ? 'bg-white/12 text-white' : 'border border-slate-300 text-slate-700'
          }`}
        >
          Haritada odakla
        </button>
        <button
          type="button"
          onClick={onToggleExpanded}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
            selected ? 'bg-white/12 text-white' : 'border border-slate-300 text-slate-700'
          }`}
        >
          {expanded ? 'Detayi gizle' : 'Detayi goster'}
        </button>
      </div>

      {expanded ? (
        <div className={`mt-4 grid gap-3 border-t pt-4 text-xs ${selected ? 'border-white/10 text-slate-200' : 'border-slate-100 text-slate-600'}`}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="block text-[11px] uppercase tracking-[0.16em] opacity-70">Zaman</span>
              <strong className="mt-1 block">{formatDateTime(event.ts_utc)}</strong>
            </div>
            <div>
              <span className="block text-[11px] uppercase tracking-[0.16em] opacity-70">Konum</span>
              <strong className="mt-1 block">{formatCoordinates(event.lat, event.lon)}</strong>
            </div>
            <div>
              <span className="block text-[11px] uppercase tracking-[0.16em] opacity-70">Cihaz / IP</span>
              <strong className="mt-1 block">
                {event.device_id == null ? '-' : `#${event.device_id}`} / {event.ip ?? '-'}
              </strong>
            </div>
            <div>
              <span className="block text-[11px] uppercase tracking-[0.16em] opacity-70">Provider</span>
              <strong className="mt-1 block">{event.provider ?? '-'}</strong>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  )
}

function DayRecordCard({
  day,
  selected,
  expanded,
  onSelect,
  onToggleExpanded,
}: {
  day: LocationMonitorDayRecord
  selected: boolean
  expanded: boolean
  onSelect: () => void
  onToggleExpanded: () => void
}) {
  const lastPoint = latestAvailablePoint(day)

  return (
    <article
      className={`rounded-2xl border px-4 py-4 transition ${
        selected ? 'border-sky-300 bg-sky-50' : 'border-slate-200 bg-white'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <strong className="block text-sm text-slate-900">{formatDay(day.date)}</strong>
          <p className="mt-1 text-xs text-slate-500">{dayStatusLabel(day.status)}</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
          {day.event_count} olay
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-slate-600">
        <div>
          Giris <strong className="text-slate-900">{formatClock(day.check_in)}</strong>
        </div>
        <div>
          Cikis <strong className="text-slate-900">{formatClock(day.check_out)}</strong>
        </div>
        <div>
          Calisilan <strong className="text-slate-900"><MinuteDisplay minutes={day.worked_minutes} /></strong>
        </div>
        <div>
          Fazla <strong className="text-slate-900"><MinuteDisplay minutes={day.overtime_minutes} /></strong>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onSelect}
          className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700"
        >
          {selected ? 'Secili gun' : 'Haritada ac'}
        </button>
        <button
          type="button"
          onClick={onToggleExpanded}
          className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700"
        >
          {expanded ? 'Detayi gizle' : 'Detayi goster'}
        </button>
      </div>

      {expanded ? (
        <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 text-xs text-slate-600">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="block text-[11px] uppercase tracking-[0.16em] text-slate-400">Demo</span>
              <strong className="mt-1 block text-slate-900">
                {formatClock(day.first_demo_start_utc)} / {formatClock(day.last_demo_end_utc)}
              </strong>
            </div>
            <div>
              <span className="block text-[11px] uppercase tracking-[0.16em] text-slate-400">App</span>
              <strong className="mt-1 block text-slate-900">
                {formatClock(day.first_app_open_utc)} / {formatClock(day.last_app_close_utc)}
              </strong>
            </div>
            <div>
              <span className="block text-[11px] uppercase tracking-[0.16em] text-slate-400">Supheli sicrama</span>
              <strong className="mt-1 block text-slate-900">{day.suspicious_jump_count}</strong>
            </div>
            <div>
              <span className="block text-[11px] uppercase tracking-[0.16em] text-slate-400">Dusuk dogruluk</span>
              <strong className="mt-1 block text-slate-900">{day.low_accuracy_count}</strong>
            </div>
          </div>
          {lastPoint ? (
            <div>
              <span className="block text-[11px] uppercase tracking-[0.16em] text-slate-400">Son nokta</span>
              <strong className="mt-1 block text-slate-900">
                {pointSourceLabel(lastPoint.source)} / {formatCoordinates(lastPoint.lat, lastPoint.lon)}
              </strong>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

export function LocationMonitorPage() {
  const initialFilters = useMemo(() => initialFilterState(), [])
  const [draftFilters, setDraftFilters] = useState<FilterState>(initialFilters)
  const [appliedFilters, setAppliedFilters] = useState<FilterState>(initialFilters)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [focusedPointId, setFocusedPointId] = useState<string | null>(null)
  const [mapMode, setMapMode] = useState<MapMode>('2D')
  const [enabledSources, setEnabledSources] = useState<LocationMonitorPointSource[]>(ALL_SOURCES)
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false)
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null)
  const [expandedDayId, setExpandedDayId] = useState<string | null>(null)
  const [visibleEventCount, setVisibleEventCount] = useState(INITIAL_EVENT_RENDER_COUNT)
  const [visibleDayCount, setVisibleDayCount] = useState(INITIAL_DAY_RENDER_COUNT)
  const [showAllInsights, setShowAllInsights] = useState(false)
  const hasInitialEmployeeSelectionRef = useRef(false)

  const employeesQuery = useQuery({
    queryKey: ['employees', 'location-monitor-v3'],
    queryFn: () => getEmployees({ status: 'all' }),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  })
  const regionsQuery = useQuery({
    queryKey: ['regions', 'location-monitor-v3'],
    queryFn: () => getRegions(),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  })
  const departmentsQuery = useQuery({
    queryKey: ['departments', 'location-monitor-v3'],
    queryFn: () => getDepartments(),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  })

  const allEmployees = employeesQuery.data ?? []
  const availableEmployees = useMemo(
    () => employeeListForFilters(allEmployees, draftFilters),
    [allEmployees, draftFilters],
  )

  useEffect(() => {
    if (hasInitialEmployeeSelectionRef.current || !availableEmployees.length) {
      return
    }
    hasInitialEmployeeSelectionRef.current = true
    const firstEmployeeId = String(availableEmployees[0].id)
    setDraftFilters((current) => ({ ...current, employeeId: firstEmployeeId }))
    setAppliedFilters((current) => ({ ...current, employeeId: firstEmployeeId }))
  }, [availableEmployees])

  useEffect(() => {
    if (!draftFilters.employeeId) {
      return
    }
    const stillVisible = availableEmployees.some((employee) => String(employee.id) === draftFilters.employeeId)
    if (!stillVisible) {
      setDraftFilters((current) => ({ ...current, employeeId: '' }))
    }
  }, [availableEmployees, draftFilters.employeeId])

  const normalizedDraftFilters = useMemo(() => normalizeFilterState(draftFilters), [draftFilters])
  const normalizedAppliedFilters = useMemo(() => normalizeFilterState(appliedFilters), [appliedFilters])
  const filtersDirty = !filtersEqual(normalizedDraftFilters, normalizedAppliedFilters)
  const queryEnabled = Boolean(
    normalizedAppliedFilters.employeeId && normalizedAppliedFilters.startDate && normalizedAppliedFilters.endDate,
  )

  const summaryQuery = useQuery({
    queryKey: [
      'location-monitor-summary',
      normalizedAppliedFilters.employeeId,
      normalizedAppliedFilters.startDate,
      normalizedAppliedFilters.endDate,
    ],
    queryFn: () =>
      getLocationMonitorEmployeeSummary(Number(normalizedAppliedFilters.employeeId), {
        start_date: normalizedAppliedFilters.startDate,
        end_date: normalizedAppliedFilters.endDate,
      }),
    enabled: queryEnabled,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    placeholderData: (previousData) => previousData,
  })

  const timelineQuery = useQuery({
    queryKey: [
      'location-monitor-events',
      normalizedAppliedFilters.employeeId,
      normalizedAppliedFilters.startDate,
      normalizedAppliedFilters.endDate,
      selectedDay ?? 'ALL',
    ],
    queryFn: () =>
      getLocationMonitorEmployeeTimelineEvents(Number(normalizedAppliedFilters.employeeId), {
        start_date: normalizedAppliedFilters.startDate,
        end_date: normalizedAppliedFilters.endDate,
        day: selectedDay ?? undefined,
        latest_only: selectedDay == null,
      }),
    enabled: queryEnabled,
    staleTime: 20_000,
    gcTime: 5 * 60_000,
    placeholderData: (previousData) => previousData,
  })

  const mapQuery = useQuery({
    queryKey: [
      'location-monitor-map',
      normalizedAppliedFilters.employeeId,
      normalizedAppliedFilters.startDate,
      normalizedAppliedFilters.endDate,
      selectedDay ?? 'ALL',
      sourceKey(enabledSources),
    ],
    queryFn: () =>
      getLocationMonitorEmployeeMapPoints(Number(normalizedAppliedFilters.employeeId), {
        start_date: normalizedAppliedFilters.startDate,
        end_date: normalizedAppliedFilters.endDate,
        day: selectedDay ?? undefined,
        latest_only: selectedDay == null,
        source: enabledSources.length === ALL_SOURCES.length ? undefined : enabledSources,
      }),
    enabled: queryEnabled,
    staleTime: 20_000,
    gcTime: 5 * 60_000,
    placeholderData: (previousData) => previousData,
  })

  const selectedEmployee = useMemo(
    () => allEmployees.find((employee) => String(employee.id) === normalizedAppliedFilters.employeeId) ?? null,
    [allEmployees, normalizedAppliedFilters.employeeId],
  )

  const summary = summaryQuery.data?.summary ?? null
  const mapData = mapQuery.data ?? null
  const timelineData = timelineQuery.data ?? null
  const timelineDays = timelineData?.days ?? []
  const insights = summaryQuery.data?.insights ?? []

  useEffect(() => {
    setSelectedDay(null)
    setFocusedPointId(null)
    setExpandedEventId(null)
    setExpandedDayId(null)
    setVisibleEventCount(INITIAL_EVENT_RENDER_COUNT)
    setVisibleDayCount(INITIAL_DAY_RENDER_COUNT)
    setShowAllInsights(false)
  }, [
    normalizedAppliedFilters.employeeId,
    normalizedAppliedFilters.startDate,
    normalizedAppliedFilters.endDate,
  ])

  useEffect(() => {
    if (!selectedDay) {
      return
    }
    const stillVisible = timelineDays.some((day) => day.date === selectedDay)
    if (!stillVisible) {
      setSelectedDay(null)
      setFocusedPointId(null)
    }
  }, [selectedDay, timelineDays])

  useEffect(() => {
    setExpandedEventId(null)
    setVisibleEventCount(INITIAL_EVENT_RENDER_COUNT)
  }, [selectedDay])

  const visibleMapPoints = useMemo(() => {
    const points = mapData?.points ?? []
    return [...points].sort((left, right) => new Date(left.ts_utc).getTime() - new Date(right.ts_utc).getTime())
  }, [mapData?.points])

  const visibleSimplifiedPoints = useMemo(() => {
    const points = mapData?.simplified_points ?? []
    return [...points].sort((left, right) => new Date(left.ts_utc).getTime() - new Date(right.ts_utc).getTime())
  }, [mapData?.simplified_points])

  const visibleTimelineEvents = useMemo(() => {
    const events = timelineData?.events ?? []
    return [...events].sort((left, right) => new Date(right.ts_utc).getTime() - new Date(left.ts_utc).getTime())
  }, [timelineData?.events])

  const effectiveSelectedDay = selectedDay ?? timelineData?.events[0]?.day ?? null
  const selectedDayRecord = useMemo(
    () => timelineDays.find((day) => day.date === effectiveSelectedDay) ?? null,
    [effectiveSelectedDay, timelineDays],
  )

  const highlightedPoint = useMemo(() => {
    if (focusedPointId) {
      return visibleMapPoints.find((point) => point.id === focusedPointId) ?? null
    }
    if (selectedDayRecord) {
      return latestAvailablePoint(selectedDayRecord)
    }
    return summary?.latest_location ?? null
  }, [focusedPointId, selectedDayRecord, summary?.latest_location, visibleMapPoints])

  const suspiciousJumpCount = pickInsightValue(insights, 'SUSPICIOUS_JUMPS')
  const geofenceViolationCount = pickInsightValue(insights, 'GEOFENCE_VIOLATION')
  const lowAccuracyRatio = pickInsightValue(insights, 'LOW_ACCURACY_RATIO')
  const renderedInsights = showAllInsights ? insights : insights.slice(0, 3)
  const renderedEvents = visibleTimelineEvents.slice(0, visibleEventCount)
  const renderedDays = timelineDays.slice(0, visibleDayCount)
  const appliedRangeDays = dayCountForRange(normalizedAppliedFilters.startDate, normalizedAppliedFilters.endDate)

  const isInitialLoading =
    queryEnabled &&
    (!summaryQuery.data || !timelineQuery.data || !mapQuery.data) &&
    (summaryQuery.isPending || timelineQuery.isPending || mapQuery.isPending)
  const isRefreshing =
    Boolean(summary && mapData && timelineData) &&
    (summaryQuery.isFetching || timelineQuery.isFetching || mapQuery.isFetching)
  const locationError = summaryQuery.isError || mapQuery.isError || timelineQuery.isError

  const handleApplyFilters = () => {
    const nextFilters = normalizeFilterState({
      ...normalizedDraftFilters,
      employeeId:
        normalizedDraftFilters.employeeId || (availableEmployees[0] ? String(availableEmployees[0].id) : ''),
    })
    setAppliedFilters(nextFilters)
    setMobileFilterOpen(false)
  }

  const handleResetFilters = () => {
    const resetBase = initialFilterState()
    const preservedEmployeeId =
      normalizedAppliedFilters.employeeId ||
      draftFilters.employeeId ||
      (availableEmployees[0] ? String(availableEmployees[0].id) : '')
    setDraftFilters({
      ...resetBase,
      employeeId: preservedEmployeeId,
    })
  }

  const toggleSource = (value: LocationMonitorPointSource) => {
    setEnabledSources((current) => {
      if (current.includes(value)) {
        const next = current.filter((item) => item !== value)
        return next.length ? next : current
      }
      return [...current, value]
    })
  }

  const employeeListError = employeesQuery.isError ? (
    <ErrorBlock message="Calisan listesi yuklenemedi." />
  ) : null

  const appliedSummaryText = selectedEmployee
    ? `${selectedEmployee.full_name} / ${appliedRangeDays} gun`
    : `${appliedRangeDays} gun`

  const retryAll = () => {
    void Promise.all([summaryQuery.refetch(), mapQuery.refetch(), timelineQuery.refetch()])
  }

  return (
    <div className="max-w-full space-y-4 overflow-x-hidden">
      <section className="rounded-3xl border border-slate-200 bg-white px-4 py-4 shadow-sm sm:px-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-700">Operasyon Log Merkezi</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">Calisan hareket analizi</h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Mobilde once ozet, sonra harita, sonra olay akisi gelecek sekilde optimize edildi.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
            <span className="rounded-full bg-slate-100 px-3 py-1">{appliedSummaryText}</span>
            <span className="rounded-full bg-slate-100 px-3 py-1">{enabledSources.length} kaynak</span>
            {isRefreshing ? <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">Guncelleniyor</span> : null}
          </div>
        </div>
      </section>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[20rem_minmax(0,1fr)] xl:items-start">
        <aside className="hidden xl:block xl:min-w-0">
          <FilterPanel
            filters={draftFilters}
            employees={availableEmployees}
            regions={regionsQuery.data ?? []}
            departments={departmentsQuery.data ?? []}
            isDirty={filtersDirty}
            isBusy={Boolean(summaryQuery.isFetching || mapQuery.isFetching || timelineQuery.isFetching)}
            onPatch={(patch) => setDraftFilters((current) => ({ ...current, ...patch }))}
            onApply={handleApplyFilters}
            onReset={handleResetFilters}
          />
        </aside>

        <main className="min-w-0 space-y-4">
          <section className="xl:hidden">
            <article className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Aktif filtre</p>
                  <strong className="mt-1 block truncate text-base text-slate-900">
                    {selectedEmployee?.full_name ?? 'Calisan secin'}
                  </strong>
                  <p className="mt-1 truncate text-xs text-slate-500">
                    {employeeMeta(selectedEmployee)} / {rangeLabel(normalizedAppliedFilters.startDate, normalizedAppliedFilters.endDate)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileFilterOpen((current) => !current)}
                  className="rounded-full border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
                >
                  {mobileFilterOpen ? 'Filtreyi kapat' : 'Filtreler'}
                </button>
              </div>
            </article>

            {mobileFilterOpen ? (
              <div className="mt-4">
                <FilterPanel
                  filters={draftFilters}
                  employees={availableEmployees}
                  regions={regionsQuery.data ?? []}
                  departments={departmentsQuery.data ?? []}
                  isDirty={filtersDirty}
                  isBusy={Boolean(summaryQuery.isFetching || mapQuery.isFetching || timelineQuery.isFetching)}
                  onPatch={(patch) => setDraftFilters((current) => ({ ...current, ...patch }))}
                  onApply={handleApplyFilters}
                  onReset={handleResetFilters}
                />
              </div>
            ) : null}
          </section>

          {employeeListError}

          {!queryEnabled && !employeesQuery.isPending ? (
            <article className="rounded-3xl border border-dashed border-slate-300 bg-white px-5 py-10 text-sm text-slate-500 shadow-sm">
              Filtrelerden bir calisan secildiginde operasyon logu yuklenir.
            </article>
          ) : null}

          {isInitialLoading ? <LoadingBlock label="Log operasyon verisi hazirlaniyor..." /> : null}

          {locationError ? (
            <article className="rounded-3xl border border-rose-200 bg-white p-4 shadow-sm">
              <ErrorBlock message="Log verisi yuklenemedi. Ham hata gosterilmedi; yeniden deneyin." />
              <div className="mt-3">
                <button
                  type="button"
                  onClick={retryAll}
                  className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
                >
                  Tekrar dene
                </button>
              </div>
            </article>
          ) : null}

          {!isInitialLoading && !locationError && summary && mapData && timelineData ? (
            <>
              <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Calisan ozeti</p>
                    <h3 className="mt-1 truncate text-xl font-semibold text-slate-900">{summary.employee.full_name}</h3>
                    <p className="mt-2 truncate text-sm text-slate-600">{employeeMeta(summary.employee)}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Pill className={statusTone(summary.last_location_status)}>
                        {summary.last_location_status ?? 'NO_LOCATION'}
                      </Pill>
                      <Pill className={trustTone(summary.last_trust_status)}>
                        Trust {summary.last_trust_score == null ? '-' : `${summary.last_trust_score}/100`}
                      </Pill>
                      <Pill className={geofenceTone(summary.last_geofence_status)}>
                        {summary.last_geofence_status ?? 'UNKNOWN'}
                      </Pill>
                    </div>
                  </div>

                  <div className="grid w-full gap-3 sm:grid-cols-2 lg:w-auto lg:grid-cols-2">
                    <MetricTile label="Son gorulme" value={formatDateTime(summary.last_activity_utc)} />
                    <MetricTile label="Geofence" value={formatDistance(summaryQuery.data?.geofence?.distance_m)} />
                    <MetricTile
                      label="Cihaz / IP"
                      value={summary.last_device_id == null ? '-' : `#${summary.last_device_id}`}
                      detail={summary.recent_ip ?? '-'}
                    />
                    <MetricTile
                      label="Bugun / hafta"
                      value={<MinuteDisplay minutes={summary.worked_today_minutes} />}
                      detail={<><MinuteDisplay minutes={summary.weekly_total_minutes} /> hafta</>}
                    />
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <MetricTile
                    label="Toplam rota"
                    value={formatDistance(mapData.route_stats.total_distance_m)}
                    detail={`${mapData.route_stats.event_count} nokta`}
                  />
                  <MetricTile
                    label="Geofence ihlali"
                    value={geofenceViolationCount ?? 0}
                    detail="Secili gorunum"
                  />
                  <MetricTile
                    label="Supheli sicrama"
                    value={suspiciousJumpCount ?? 0}
                    detail="Imkansiz hiz"
                  />
                  <MetricTile
                    label="Dusuk dogruluk"
                    value={lowAccuracyRatio == null ? '-' : `%${lowAccuracyRatio}`}
                    detail="Kalite ozeti"
                  />
                </div>
              </section>

              <section className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1fr)_22rem]">
                <article className="min-w-0 overflow-hidden rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Operasyon haritasi</p>
                      <h3 className="mt-1 text-lg font-semibold text-slate-900">
                        {effectiveSelectedDay ? `${formatDay(effectiveSelectedDay)} rota izi` : 'Rota izi'}
                      </h3>
                    </div>
                    <div className="rounded-full border border-slate-200 bg-slate-50 p-1">
                      {(['2D', '3D'] as MapMode[]).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setMapMode(mode)}
                          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                            mapMode === mode ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-white'
                          }`}
                        >
                          {mode}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedDay(null)
                        setFocusedPointId(null)
                      }}
                      className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                        selectedDay == null ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-600'
                      }`}
                    >
                      Son hareket
                    </button>
                    {timelineDays.map((day) => (
                      <button
                        key={day.date}
                        type="button"
                        onClick={() => {
                          setSelectedDay(day.date)
                          setFocusedPointId(latestAvailablePoint(day)?.id ?? null)
                        }}
                        className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                          effectiveSelectedDay === day.date
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : 'border-slate-300 bg-white text-slate-600'
                        }`}
                      >
                        {formatDay(day.date)}
                      </button>
                    ))}
                  </div>

                  <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
                    {SOURCE_OPTIONS.map((option) => {
                      const active = enabledSources.includes(option.value)
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => toggleSource(option.value)}
                          className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                            active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-600'
                          }`}
                        >
                          {option.label}
                        </button>
                      )
                    })}
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <MetricTile
                      label="Rota sure"
                      value={<MinuteDisplay minutes={mapData.route_stats.total_duration_minutes} />}
                    />
                    <MetricTile
                      label="Sadelestirilmis"
                      value={`${mapData.route_stats.simplified_point_count} nokta`}
                    />
                    <MetricTile
                      label="Bekleme noktasi"
                      value={mapData.route_stats.dwell_stop_count}
                    />
                    <MetricTile
                      label="Gorunen nokta"
                      value={visibleMapPoints.length}
                    />
                  </div>

                  <div className="mt-5">
                    {mapMode === '2D' ? (
                      <LocationMonitorMap
                        points={visibleMapPoints}
                        simplifiedPoints={visibleSimplifiedPoints}
                        repeatedGroups={mapData.repeated_groups}
                        geofence={summaryQuery.data?.geofence ?? null}
                        focusedPointId={highlightedPoint?.id ?? null}
                        className="h-[18rem] sm:h-[22rem] xl:h-[30rem]"
                      />
                    ) : (
                      <Suspense fallback={<LoadingBlock label="3D analiz modu yukleniyor..." />}>
                        <LazyLocationMonitor3DView
                          points={visibleMapPoints}
                          focusedPointId={highlightedPoint?.id ?? null}
                          className="h-[18rem] sm:h-[22rem] xl:h-[30rem]"
                        />
                      </Suspense>
                    )}
                  </div>
                </article>

                <aside className="min-w-0 space-y-4">
                  <article className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Analitik ozet</p>
                        <h3 className="mt-1 text-lg font-semibold text-slate-900">Risk ve uyum sinyali</h3>
                      </div>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-600">
                        {insights.length}
                      </span>
                    </div>

                    <div className="mt-4 space-y-3">
                      {renderedInsights.length ? (
                        renderedInsights.map((insight) => (
                          <div key={insight.code} className={`rounded-2xl border px-4 py-3 ${insightTone(insight.severity)}`}>
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <strong className="block text-sm text-slate-900">{insight.title}</strong>
                                <p className="mt-1 text-xs leading-5 text-slate-600">{insight.message}</p>
                              </div>
                              <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                                {insight.value ?? '-'}
                              </span>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-sm text-slate-500">
                          Secili aralikta yorumlanabilir sinyal bulunmuyor.
                        </div>
                      )}
                    </div>

                    {insights.length > 3 ? (
                      <button
                        type="button"
                        onClick={() => setShowAllInsights((current) => !current)}
                        className="mt-4 rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700"
                      >
                        {showAllInsights ? 'Daha az goster' : 'Tumunu goster'}
                      </button>
                    ) : null}
                  </article>

                  <article className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Odak noktasi</p>
                    <h3 className="mt-1 text-lg font-semibold text-slate-900">
                      {highlightedPoint ? highlightedPoint.label : 'Nokta secilmedi'}
                    </h3>
                    <div className="mt-4 grid gap-3">
                      <MetricTile label="Kaynak" value={highlightedPoint ? pointSourceLabel(highlightedPoint.source) : '-'} />
                      <MetricTile label="Saat" value={highlightedPoint ? formatDateTime(highlightedPoint.ts_utc) : '-'} />
                      <MetricTile label="Konum" value={highlightedPoint ? formatCoordinates(highlightedPoint.lat, highlightedPoint.lon) : '-'} />
                    </div>
                  </article>
                </aside>
              </section>

              <section className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1fr)_22rem]">
                <article className="min-w-0 overflow-hidden rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Timeline</p>
                      <h3 className="mt-1 truncate text-lg font-semibold text-slate-900">
                        {effectiveSelectedDay ? `${formatDay(effectiveSelectedDay)} olay akisi` : 'Olay akisi'}
                      </h3>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-600">
                      {visibleTimelineEvents.length} olay
                    </span>
                  </div>

                  <div className="mt-4 space-y-3">
                    {renderedEvents.length ? (
                      renderedEvents.map((event) => (
                        <TimelineEventCard
                          key={event.id}
                          event={event}
                          selected={focusedPointId === event.id}
                          expanded={expandedEventId === event.id}
                          onFocus={() => {
                            setFocusedPointId(event.id)
                            setExpandedEventId(event.id)
                          }}
                          onToggleExpanded={() =>
                            setExpandedEventId((current) => (current === event.id ? null : event.id))
                          }
                        />
                      ))
                    ) : (
                      <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-sm text-slate-500">
                        Secili gorunumde olay bulunmuyor.
                      </div>
                    )}
                  </div>

                  {visibleTimelineEvents.length > renderedEvents.length ? (
                    <button
                      type="button"
                      onClick={() => setVisibleEventCount((current) => current + INITIAL_EVENT_RENDER_COUNT)}
                      className="mt-4 rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
                    >
                      Daha fazla olay goster
                    </button>
                  ) : null}
                </article>

                <article className="min-w-0 overflow-hidden rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Gunluk kayit</p>
                      <h3 className="mt-1 text-lg font-semibold text-slate-900">Attendance ve fazla mesai</h3>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-600">
                      {timelineDays.length} gun
                    </span>
                  </div>

                  <div className="mt-4 space-y-3">
                    {renderedDays.length ? (
                      renderedDays.map((day) => (
                        <DayRecordCard
                          key={day.date}
                          day={day}
                          selected={effectiveSelectedDay === day.date}
                          expanded={expandedDayId === day.date}
                          onSelect={() => {
                            setSelectedDay(day.date)
                            setFocusedPointId(latestAvailablePoint(day)?.id ?? null)
                          }}
                          onToggleExpanded={() => setExpandedDayId((current) => (current === day.date ? null : day.date))}
                        />
                      ))
                    ) : (
                      <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-sm text-slate-500">
                        Bu aralikta gunluk kayit bulunmuyor.
                      </div>
                    )}
                  </div>

                  {timelineDays.length > renderedDays.length ? (
                    <button
                      type="button"
                      onClick={() => setVisibleDayCount((current) => current + INITIAL_DAY_RENDER_COUNT)}
                      className="mt-4 rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
                    >
                      Daha fazla gun goster
                    </button>
                  ) : null}
                </article>
              </section>
            </>
          ) : null}
        </main>
      </div>
    </div>
  )
}
