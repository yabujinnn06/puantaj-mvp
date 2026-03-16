import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
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
import { LocationMonitor3DView } from '../components/location-monitor/LocationMonitor3DView'
import { LocationMonitorMap } from '../components/location-monitor/LocationMonitorMap'
import { dateValue } from '../components/management-console/types'
import type {
  LocationGeofenceStatus,
  LocationMonitorDayRecord,
  LocationMonitorInsight,
  LocationMonitorMapPoint,
  LocationMonitorPointSource,
  LocationStatus,
  LocationTrustStatus,
} from '../types/api'

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

type DatePresetKey = 'TODAY' | 'YESTERDAY' | 'LAST_3_DAYS' | 'LAST_7_DAYS' | 'THIS_WEEK' | 'THIS_MONTH' | 'CUSTOM'
type MapMode = '2D' | '3D'

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

function pointSourceLabel(value: LocationMonitorMapPoint['source']): string {
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

export function LocationMonitorPage() {
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('')
  const [employeeQuery, setEmployeeQuery] = useState('')
  const [regionId, setRegionId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [includeInactive, setIncludeInactive] = useState(false)
  const [startDate, setStartDate] = useState(dateValue(-6))
  const [endDate, setEndDate] = useState(dateValue(0))
  const [activeDatePreset, setActiveDatePreset] = useState<DatePresetKey>('LAST_7_DAYS')
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [focusedPointId, setFocusedPointId] = useState<string | null>(null)
  const [mapMode, setMapMode] = useState<MapMode>('2D')
  const [enabledSources, setEnabledSources] = useState<LocationMonitorPointSource[]>(ALL_SOURCES)
  const deferredEmployeeQuery = useDeferredValue(employeeQuery)
  const hasInitialEmployeeSelectionRef = useRef(false)

  const employeesQuery = useQuery({ queryKey: ['employees', 'location-monitor-v2'], queryFn: () => getEmployees({ status: 'all' }) })
  const regionsQuery = useQuery({ queryKey: ['regions', 'location-monitor-v2'], queryFn: () => getRegions() })
  const departmentsQuery = useQuery({ queryKey: ['departments', 'location-monitor-v2'], queryFn: () => getDepartments() })

  const filteredEmployees = useMemo(() => {
    const normalizedQuery = deferredEmployeeQuery.trim().toLocaleLowerCase('tr-TR')
    return (employeesQuery.data ?? [])
      .filter((employee) => {
        if (!includeInactive && !employee.is_active) return false
        if (regionId && String(employee.region_id ?? '') !== regionId) return false
        if (departmentId && String(employee.department_id ?? '') !== departmentId) return false
        if (!normalizedQuery) return true
        return `${employee.id} ${employee.full_name} ${employee.region_name ?? ''}`
          .toLocaleLowerCase('tr-TR')
          .includes(normalizedQuery)
      })
      .sort((left, right) => {
        if (left.is_active !== right.is_active) return left.is_active ? -1 : 1
        return left.full_name.localeCompare(right.full_name, 'tr')
      })
  }, [deferredEmployeeQuery, departmentId, employeesQuery.data, includeInactive, regionId])

  useEffect(() => {
    if (!filteredEmployees.length) {
      if (selectedEmployeeId) setSelectedEmployeeId('')
      return
    }
    if (!selectedEmployeeId) {
      if (!hasInitialEmployeeSelectionRef.current) {
        hasInitialEmployeeSelectionRef.current = true
        setSelectedEmployeeId(String(filteredEmployees[0].id))
      }
      return
    }
    const stillVisible = filteredEmployees.some((employee) => String(employee.id) === selectedEmployeeId)
    if (!stillVisible) setSelectedEmployeeId(String(filteredEmployees[0].id))
  }, [filteredEmployees, selectedEmployeeId])

  useEffect(() => {
    const normalized = normalizeDateRange(startDate, endDate)
    if (normalized.startDate !== startDate) setStartDate(normalized.startDate)
    if (normalized.endDate !== endDate) setEndDate(normalized.endDate)
  }, [endDate, startDate])

  const summaryQuery = useQuery({
    queryKey: ['location-monitor-summary', selectedEmployeeId, startDate, endDate],
    queryFn: () => getLocationMonitorEmployeeSummary(Number(selectedEmployeeId), { start_date: startDate, end_date: endDate }),
    enabled: Boolean(selectedEmployeeId && startDate && endDate),
  })

  const mapQuery = useQuery({
    queryKey: ['location-monitor-map', selectedEmployeeId, startDate, endDate, enabledSources],
    queryFn: () =>
      getLocationMonitorEmployeeMapPoints(Number(selectedEmployeeId), {
        start_date: startDate,
        end_date: endDate,
        source: enabledSources.length === ALL_SOURCES.length ? undefined : enabledSources,
      }),
    enabled: Boolean(selectedEmployeeId && startDate && endDate),
  })

  const timelineQuery = useQuery({
    queryKey: ['location-monitor-events', selectedEmployeeId, startDate, endDate],
    queryFn: () => getLocationMonitorEmployeeTimelineEvents(Number(selectedEmployeeId), { start_date: startDate, end_date: endDate }),
    enabled: Boolean(selectedEmployeeId && startDate && endDate),
  })

  useEffect(() => {
    const days = timelineQuery.data?.days ?? []
    if (!days.length) {
      setSelectedDay(null)
      setFocusedPointId(null)
      return
    }
    if (!selectedDay || !days.some((item) => item.date === selectedDay)) {
      setSelectedDay(days[0].date)
      setFocusedPointId(null)
    }
  }, [selectedDay, timelineQuery.data?.days])

  const summary = summaryQuery.data?.summary ?? null
  const mapData = mapQuery.data ?? null
  const timelineData = timelineQuery.data ?? null

  const visibleMapPoints = useMemo(() => {
    const points = mapData?.points ?? []
    const filtered = selectedDay ? points.filter((point) => point.day === selectedDay) : points
    return [...filtered].sort((left, right) => new Date(left.ts_utc).getTime() - new Date(right.ts_utc).getTime())
  }, [mapData?.points, selectedDay])

  const visibleSimplifiedPoints = useMemo(() => {
    const points = mapData?.simplified_points ?? []
    const filtered = selectedDay ? points.filter((point) => point.day === selectedDay) : points
    return [...filtered].sort((left, right) => new Date(left.ts_utc).getTime() - new Date(right.ts_utc).getTime())
  }, [mapData?.simplified_points, selectedDay])

  const visibleTimelineEvents = useMemo(() => {
    const events = timelineData?.events ?? []
    return selectedDay ? events.filter((event) => event.day === selectedDay) : events
  }, [selectedDay, timelineData?.events])

  const selectedDayRecord = useMemo(
    () => timelineData?.days.find((day) => day.date === selectedDay) ?? null,
    [selectedDay, timelineData?.days],
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

  const rangeDayCount = useMemo(() => {
    const parsedStart = parseDateValue(startDate)
    const parsedEnd = parseDateValue(endDate)
    if (!parsedStart || !parsedEnd) return 0
    return Math.max(1, differenceInDays(parsedStart, parsedEnd) + 1)
  }, [endDate, startDate])

  const isLoading = summaryQuery.isLoading || mapQuery.isLoading || timelineQuery.isLoading
  const isError = summaryQuery.isError || mapQuery.isError || timelineQuery.isError

  const applyPreset = (preset: Exclude<DatePresetKey, 'CUSTOM'>) => {
    const nextRange = resolveDatePresetRange(preset)
    setStartDate(nextRange.startDate)
    setEndDate(nextRange.endDate)
    setActiveDatePreset(preset)
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

  const suspiciousJumpCount = pickInsightValue(summaryQuery.data?.insights ?? [], 'SUSPICIOUS_JUMPS')
  const geofenceViolationCount = pickInsightValue(summaryQuery.data?.insights ?? [], 'GEOFENCE_VIOLATION')
  const lowAccuracyRatio = pickInsightValue(summaryQuery.data?.insights ?? [], 'LOW_ACCURACY_RATIO')

  return (
    <div className="max-w-full space-y-6 overflow-x-hidden">
      <section className="rounded-3xl border border-slate-200 bg-white px-5 py-5 shadow-sm sm:px-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">Operasyon Log Merkezi</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">Calisan hareket analizi</h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Normalize edilmis location timeline, geofence uyumu, trust skoru ve hareket izi ayni operasyon ekraninda toplanir.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
            <span className="rounded-full bg-slate-100 px-3 py-1">{rangeDayCount} gun</span>
            <span className="rounded-full bg-slate-100 px-3 py-1">{enabledSources.length} kaynak aktif</span>
            <span className="rounded-full bg-slate-100 px-3 py-1">{mapMode === '2D' ? '2D operasyon modu' : '3D analiz modu'}</span>
          </div>
        </div>
      </section>

      <section className="grid min-w-0 gap-6 xl:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="min-w-0 space-y-4">
          <article className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Filtreler</p>
              <h3 className="mt-1 text-lg font-semibold text-slate-900">Kisi ve tarih</h3>
            </div>
            <div className="space-y-4">
              <EmployeeAutocompleteField
                label="Calisan sec"
                employees={filteredEmployees}
                value={selectedEmployeeId}
                onChange={setSelectedEmployeeId}
                helperText="Secilen personelin hareket analizi yuklenir."
              />
              <label className="block text-sm text-slate-700">
                Calisan ara
                <input
                  value={employeeQuery}
                  onChange={(event) => setEmployeeQuery(event.target.value)}
                  placeholder="Ad, soyad veya #ID"
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <label className="block text-sm text-slate-700">
                  Bolge
                  <select value={regionId} onChange={(event) => setRegionId(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2">
                    <option value="">Tum bolgeler</option>
                    {(regionsQuery.data ?? []).map((region) => (
                      <option key={region.id} value={region.id}>
                        {region.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm text-slate-700">
                  Departman
                  <select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2">
                    <option value="">Tum departmanlar</option>
                    {(departmentsQuery.data ?? []).map((department) => (
                      <option key={department.id} value={department.id}>
                        {department.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Hazir aralik</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {DATE_PRESET_OPTIONS.map((preset) => (
                    <button
                      key={preset.key}
                      type="button"
                      onClick={() => applyPreset(preset.key)}
                      className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
                        activeDatePreset === preset.key ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <div className="mt-4 space-y-3">
                  <label className="block text-sm text-slate-700">
                    Baslangic
                    <input type="date" value={startDate} onChange={(event) => { setStartDate(event.target.value); setActiveDatePreset('CUSTOM') }} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" />
                  </label>
                  <label className="block text-sm text-slate-700">
                    Bitis
                    <input type="date" value={endDate} onChange={(event) => { setEndDate(event.target.value); setActiveDatePreset('CUSTOM') }} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" />
                  </label>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={includeInactive} onChange={(event) => setIncludeInactive(event.target.checked)} className="rounded border-slate-300" />
                Pasif calisanlari da goster
              </label>
            </div>
          </article>
        </aside>

        <div className="min-w-0 space-y-6">
          {isLoading ? <LoadingBlock label="Konum analizi hazirlaniyor..." /> : null}
          {isError ? <ErrorBlock message="Konum analizi yuklenemedi." /> : null}

          {!isLoading && !isError && summary && mapData && timelineData ? (
            <>
              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Calisan Ozeti</p>
                    <h3 className="mt-1 text-2xl font-semibold text-slate-900">{summary.employee.full_name}</h3>
                    <p className="mt-2 text-sm text-slate-600">
                      {summary.department_name ?? 'Departman yok'} · {summary.region_name ?? 'Bolge yok'} · {summary.shift_name ?? 'Vardiya tanimsiz'}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(summary.last_location_status)}`}>
                        {summary.last_location_status ?? 'NO_LOCATION'}
                      </span>
                      <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${trustTone(summary.last_trust_status)}`}>
                        Trust {summary.last_trust_score == null ? '-' : `${summary.last_trust_score}/100`}
                      </span>
                      <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${geofenceTone(summary.last_geofence_status)}`}>
                        {summary.last_geofence_status ?? 'UNKNOWN'}
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Son gorulme</p>
                      <strong className="mt-2 block text-sm text-slate-900">{formatDateTime(summary.last_activity_utc)}</strong>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Geofence mesafe</p>
                      <strong className="mt-2 block text-sm text-slate-900">{formatDistance(summaryQuery.data?.geofence?.distance_m)}</strong>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Cihaz / IP</p>
                      <strong className="mt-2 block text-sm text-slate-900">{summary.last_device_id == null ? '-' : `#${summary.last_device_id}`}</strong>
                      <p className="mt-1 text-xs text-slate-500">{summary.recent_ip ?? '-'}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Bugun / hafta</p>
                      <strong className="mt-2 block text-sm text-slate-900"><MinuteDisplay minutes={summary.worked_today_minutes} /></strong>
                      <p className="mt-1 text-xs text-slate-500">Hafta: <MinuteDisplay minutes={summary.weekly_total_minutes} /></p>
                    </div>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 lg:grid-cols-4">
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Toplam rota</p>
                    <strong className="mt-2 block text-sm text-slate-900">{formatDistance(mapData.route_stats.total_distance_m)}</strong>
                    <p className="mt-1 text-xs text-slate-500">{mapData.route_stats.event_count} nokta</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Geofence ihlali</p>
                    <strong className="mt-2 block text-sm text-slate-900">{geofenceViolationCount ?? 0}</strong>
                    <p className="mt-1 text-xs text-slate-500">Secili aralik</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Supheli sicrama</p>
                    <strong className="mt-2 block text-sm text-slate-900">{suspiciousJumpCount ?? 0}</strong>
                    <p className="mt-1 text-xs text-slate-500">Imkansiz hiz</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Dusuk dogruluk</p>
                    <strong className="mt-2 block text-sm text-slate-900">{lowAccuracyRatio == null ? '-' : `%${lowAccuracyRatio}`}</strong>
                    <p className="mt-1 text-xs text-slate-500">Quality ozeti</p>
                  </div>
                </div>
              </section>

              <section className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_21rem]">
                <article className="min-w-0 overflow-hidden rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Ana Harita</p>
                      <h3 className="mt-1 text-lg font-semibold text-slate-900">Rota, geofence ve olay isaretleri</h3>
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

                  <div className="mt-4 flex flex-wrap gap-2">
                    {SOURCE_OPTIONS.map((option) => {
                      const active = enabledSources.includes(option.value)
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => toggleSource(option.value)}
                          className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                            active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-600'
                          }`}
                        >
                          {option.label}
                        </button>
                      )
                    })}
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-4">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Rota sure</p>
                      <strong className="mt-2 block text-sm text-slate-900"><MinuteDisplay minutes={mapData.route_stats.total_duration_minutes} /></strong>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Sadelestirilmis</p>
                      <strong className="mt-2 block text-sm text-slate-900">{mapData.route_stats.simplified_point_count} nokta</strong>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Bekleme noktasi</p>
                      <strong className="mt-2 block text-sm text-slate-900">{mapData.route_stats.dwell_stop_count}</strong>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Gorunen nokta</p>
                      <strong className="mt-2 block text-sm text-slate-900">{visibleMapPoints.length}</strong>
                    </div>
                  </div>

                  <div className="mt-5">
                    {mapMode === '2D' ? (
                      <LocationMonitorMap
                        points={visibleMapPoints}
                        simplifiedPoints={visibleSimplifiedPoints}
                        repeatedGroups={selectedDay ? [] : mapData.repeated_groups}
                        geofence={summaryQuery.data?.geofence ?? null}
                        focusedPointId={highlightedPoint?.id ?? null}
                      />
                    ) : (
                      <LocationMonitor3DView points={visibleMapPoints} focusedPointId={highlightedPoint?.id ?? null} />
                    )}
                  </div>
                </article>

                <aside className="min-w-0 space-y-6">
                  <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Analitik Ozet</p>
                    <h3 className="mt-1 text-lg font-semibold text-slate-900">Risk ve uyum sinyalleri</h3>
                    <div className="mt-4 space-y-3">
                      {summaryQuery.data?.insights.map((insight) => (
                        <div
                          key={insight.code}
                          className={`rounded-2xl border px-4 py-3 ${
                            insight.severity === 'critical'
                              ? 'border-rose-200 bg-rose-50'
                              : insight.severity === 'warning'
                                ? 'border-amber-200 bg-amber-50'
                                : 'border-slate-200 bg-slate-50'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <strong className="block text-sm text-slate-900">{insight.title}</strong>
                              <p className="mt-1 text-xs leading-5 text-slate-600">{insight.message}</p>
                            </div>
                            <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">{insight.value ?? '-'}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </article>

                  <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Gun Odagi</p>
                        <h3 className="mt-1 text-lg font-semibold text-slate-900">Timeline secimi</h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedDay(null)
                          setFocusedPointId(null)
                        }}
                        className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600"
                      >
                        Tum aralik
                      </button>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {timelineData.days.map((day) => (
                        <button
                          key={day.date}
                          type="button"
                          onClick={() => {
                            setSelectedDay(day.date)
                            setFocusedPointId(latestAvailablePoint(day)?.id ?? null)
                          }}
                          className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                            selectedDay === day.date ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-600'
                          }`}
                        >
                          {formatDay(day.date)}
                        </button>
                      ))}
                    </div>
                  </article>
                </aside>
              </section>

              <section className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
                <article className="min-w-0 overflow-hidden rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Timeline</p>
                      <h3 className="mt-1 text-lg font-semibold text-slate-900">
                        {selectedDay ? `${formatDay(selectedDay)} hareket akisi` : 'Secili aralik olay akisi'}
                      </h3>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{visibleTimelineEvents.length} olay</span>
                  </div>

                  <div className="mt-5 space-y-3">
                    {visibleTimelineEvents.length ? (
                      visibleTimelineEvents.map((event) => {
                        const point = visibleMapPoints.find((item) => item.id === event.id) ?? null
                        return (
                          <button
                            key={event.id}
                            type="button"
                            onClick={() => setFocusedPointId(event.id)}
                            className={`flex w-full items-start justify-between gap-4 rounded-2xl border px-4 py-3 text-left transition ${
                              focusedPointId === event.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white hover:bg-slate-50'
                            }`}
                          >
                            <div className="min-w-0">
                              <strong className="block text-sm">{event.label}</strong>
                              <p className={`mt-1 text-xs ${focusedPointId === event.id ? 'text-slate-200' : 'text-slate-500'}`}>
                                {pointSourceLabel(event.source)} · {formatDateTime(event.ts_utc)}
                              </p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusTone(event.location_status)}`}>
                                  {event.location_status ?? 'NO_LOCATION'}
                                </span>
                                <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${trustTone(event.trust_status)}`}>
                                  {event.trust_status ?? 'NO_DATA'}
                                </span>
                                <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${geofenceTone(event.geofence_status)}`}>
                                  {event.geofence_status ?? 'UNKNOWN'}
                                </span>
                              </div>
                            </div>
                            <div className={`shrink-0 text-right text-xs ${focusedPointId === event.id ? 'text-slate-200' : 'text-slate-500'}`}>
                              <div>{formatClock(event.ts_utc)}</div>
                              <div className="mt-1">{point ? `${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}` : '-'}</div>
                            </div>
                          </button>
                        )
                      })
                    ) : (
                      <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-sm text-slate-500">
                        Secili aralikta timeline olayi bulunmuyor.
                      </div>
                    )}
                  </div>
                </article>

                <article className="min-w-0 overflow-hidden rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Gunluk Kayit</p>
                      <h3 className="mt-1 text-lg font-semibold text-slate-900">Attendance ve fazla mesai</h3>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{timelineData.days.length} gun</span>
                  </div>

                  <div className="mt-4 space-y-3">
                    {timelineData.days.map((day) => {
                      const lastPoint = latestAvailablePoint(day)
                      const selected = day.date === selectedDay
                      return (
                        <button
                          key={day.date}
                          type="button"
                          onClick={() => {
                            setSelectedDay(day.date)
                            setFocusedPointId(lastPoint?.id ?? null)
                          }}
                          className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                            selected ? 'border-sky-400 bg-sky-50' : 'border-slate-200 bg-white hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <strong className="block text-sm text-slate-900">{formatDay(day.date)}</strong>
                              <p className="mt-1 text-xs text-slate-500">{dayStatusLabel(day.status)}</p>
                            </div>
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                              {day.event_count} olay
                            </span>
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-slate-600">
                            <div>Giris: <strong className="text-slate-900">{formatClock(day.check_in)}</strong></div>
                            <div>Cikis: <strong className="text-slate-900">{formatClock(day.check_out)}</strong></div>
                            <div>Calisilan: <strong className="text-slate-900"><MinuteDisplay minutes={day.worked_minutes} /></strong></div>
                            <div>Fazla: <strong className="text-slate-900"><MinuteDisplay minutes={day.overtime_minutes} /></strong></div>
                          </div>
                          {lastPoint ? (
                            <p className="mt-3 text-xs text-slate-500">
                              Son nokta: {pointSourceLabel(lastPoint.source)} · {lastPoint.lat.toFixed(4)}, {lastPoint.lon.toFixed(4)}
                            </p>
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                </article>
              </section>
            </>
          ) : null}
        </div>
      </section>
    </div>
  )
}
