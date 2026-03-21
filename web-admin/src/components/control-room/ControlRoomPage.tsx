import { useEffect, useMemo, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'

import {
  getControlRoomOverview,
  getDepartments,
  getEmployees,
  getLocationMonitorEmployeeMapPoints,
  getLocationMonitorEmployeeTimelineEvents,
  getRegions,
} from '../../api/admin'
import { ErrorBlock } from '../ErrorBlock'
import { LoadingBlock } from '../LoadingBlock'
import { PageHeader } from '../PageHeader'
import { controlRoomQueryKeys } from './queryKeys'
import { EmployeeDailyRouteTable, type EmployeeDailyRouteRow } from './EmployeeDailyRouteTable'
import { ControlRoomUnifiedMap } from './ControlRoomUnifiedMap'
import {
  dayCountForRange,
  formatDateTime,
  latestAvailablePoint,
  parseDateValue,
  rangeLabel,
} from './utils'
import { defaultFilters, type FilterFormState, toOverviewParams } from '../management-console/types'
import type { ControlRoomEmployeeState, LocationMonitorDayRecord, LocationMonitorMapPoint } from '../../types/api'

type MapMode = 'fleet' | 'employeeDay'
type MobileView = 'days' | 'map'

const MAP_DAY_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Istanbul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function useIsMobile(breakpoint = 1024): boolean {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.innerWidth < breakpoint
  })

  useEffect(() => {
    if (typeof window === 'undefined') return

    const mediaQuery = window.matchMedia(`(max-width:${breakpoint - 1}px)`)
    const update = () => setIsMobile(mediaQuery.matches)
    update()

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', update)
      return () => mediaQuery.removeEventListener('change', update)
    }

    mediaQuery.addListener(update)
    return () => mediaQuery.removeListener(update)
  }, [breakpoint])

  return isMobile
}

function activeFilterEntries(filters: FilterFormState, employeeNames: Map<number, string>): string[] {
  const entries: string[] = []
  if (filters.employee_id) {
    const employeeId = Number(filters.employee_id)
    const employeeLabel = employeeNames.get(employeeId)
    entries.push(employeeLabel ? `Personel: ${employeeLabel}` : `Personel #${filters.employee_id}`)
  }
  if (filters.q.trim()) entries.push(`Arama: ${filters.q.trim()}`)
  if (filters.region_id) entries.push(`Bolge #${filters.region_id}`)
  if (filters.department_id) entries.push(`Departman #${filters.department_id}`)
  if (filters.include_inactive) entries.push('Pasif calisanlar dahil')
  return entries
}

function prioritySort(left: ControlRoomEmployeeState, right: ControlRoomEmployeeState): number {
  const riskOrder = { CRITICAL: 0, WATCH: 1, NORMAL: 2 }
  const riskDelta = riskOrder[left.risk_status] - riskOrder[right.risk_status]
  if (riskDelta !== 0) return riskDelta

  if (left.risk_score !== right.risk_score) {
    return right.risk_score - left.risk_score
  }

  return new Date(right.last_activity_utc ?? 0).getTime() - new Date(left.last_activity_utc ?? 0).getTime()
}

function pointDay(value: string): string {
  const parsed = parseDateValue(value)
  return parsed ? MAP_DAY_FORMAT.format(parsed) : value.slice(0, 10)
}

function distanceMeters(left: LocationMonitorMapPoint, right: LocationMonitorMapPoint): number {
  const toRadians = (value: number) => (value * Math.PI) / 180
  const earthRadius = 6_371_000
  const latDelta = toRadians(right.lat - left.lat)
  const lonDelta = toRadians(right.lon - left.lon)
  const leftLat = toRadians(left.lat)
  const rightLat = toRadians(right.lat)

  const haversine =
    Math.sin(latDelta / 2) * Math.sin(latDelta / 2) +
    Math.cos(leftLat) * Math.cos(rightLat) * Math.sin(lonDelta / 2) * Math.sin(lonDelta / 2)

  return 2 * earthRadius * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
}

function calculateRouteDistance(points: LocationMonitorMapPoint[]): number | null {
  if (points.length < 2) return null

  let totalDistance = 0
  for (let index = 1; index < points.length; index += 1) {
    totalDistance += distanceMeters(points[index - 1], points[index])
  }
  return totalDistance
}

function groupPointsByDay(points: LocationMonitorMapPoint[]): Map<string, LocationMonitorMapPoint[]> {
  const groups = new Map<string, LocationMonitorMapPoint[]>()

  for (const point of [...points].sort((left, right) => new Date(left.ts_utc).getTime() - new Date(right.ts_utc).getTime())) {
    const day = pointDay(point.ts_utc)
    groups.set(day, [...(groups.get(day) ?? []), point])
  }

  return groups
}

function dailyGeofence(day: LocationMonitorDayRecord, points: LocationMonitorMapPoint[]): {
  label: string
  tone: EmployeeDailyRouteRow['geofenceTone']
} {
  const lastPoint = points[points.length - 1] ?? latestAvailablePoint(day)
  if (day.outside_geofence_count > 0 || lastPoint?.geofence_status === 'OUTSIDE') {
    return { label: 'Disari', tone: 'outside' }
  }
  if (lastPoint?.geofence_status === 'INSIDE') {
    return { label: 'Iceride', tone: 'inside' }
  }
  return { label: 'Bilinmiyor', tone: 'unknown' }
}

function firstTimestamp(day: LocationMonitorDayRecord, points: LocationMonitorMapPoint[]): string | null {
  return day.check_in ?? day.first_app_open_utc ?? day.first_demo_start_utc ?? points[0]?.ts_utc ?? null
}

function lastTimestamp(day: LocationMonitorDayRecord, points: LocationMonitorMapPoint[]): string | null {
  return (
    day.check_out ??
    day.last_app_close_utc ??
    day.last_demo_end_utc ??
    points[points.length - 1]?.ts_utc ??
    latestAvailablePoint(day)?.ts_utc ??
    null
  )
}

function CompactFilters({
  filters,
  employees,
  regions,
  departments,
  activeEntries,
  onChange,
  onApply,
  onReset,
}: {
  filters: FilterFormState
  employees: Array<{ id: number; full_name: string }>
  regions: Array<{ id: number; name: string }>
  departments: Array<{ id: number; name: string }>
  activeEntries: string[]
  onChange: (next: FilterFormState) => void
  onApply: () => void
  onReset: () => void
}) {
  return (
    <section className="cr-inline-filters">
      <div className="cr-inline-filters__grid">
        <label className="cr-ops-field">
          <span>Personel</span>
          <select
            value={filters.employee_id}
            onChange={(event) =>
              onChange({
                ...filters,
                employee_id: event.target.value,
                q: event.target.value ? '' : filters.q,
              })
            }
          >
            <option value="">Tum personeller</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {`#${employee.id} - ${employee.full_name}`}
              </option>
            ))}
          </select>
        </label>
        <label className="cr-ops-field">
          <span>Arama</span>
          <input
            value={filters.q}
            onChange={(event) =>
              onChange({
                ...filters,
                q: event.target.value,
                employee_id: event.target.value.trim() ? '' : filters.employee_id,
              })
            }
            placeholder="Ad, soyad veya #ID"
          />
        </label>
        <label className="cr-ops-field">
          <span>Bolge</span>
          <select
            value={filters.region_id}
            onChange={(event) => onChange({ ...filters, region_id: event.target.value })}
          >
            <option value="">Tum bolgeler</option>
            {regions.map((region) => (
              <option key={region.id} value={region.id}>
                {region.name}
              </option>
            ))}
          </select>
        </label>
        <label className="cr-ops-field">
          <span>Departman</span>
          <select
            value={filters.department_id}
            onChange={(event) => onChange({ ...filters, department_id: event.target.value })}
          >
            <option value="">Tum departmanlar</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>
        <label className="cr-ops-field">
          <span>Baslangic</span>
          <input
            type="date"
            value={filters.start_date}
            onChange={(event) => onChange({ ...filters, start_date: event.target.value })}
          />
        </label>
        <label className="cr-ops-field">
          <span>Bitis</span>
          <input
            type="date"
            value={filters.end_date}
            onChange={(event) => onChange({ ...filters, end_date: event.target.value })}
          />
        </label>
      </div>

      <div className="cr-inline-filters__footer">
        <div className="cr-ops-active-tags">
          {activeEntries.length ? (
            activeEntries.map((entry) => (
              <span key={entry} className="cr-ops-active-tag">
                {entry}
              </span>
            ))
          ) : (
            <span className="cr-ops-active-tag">Aktif filtre yok</span>
          )}
        </div>
        <div className="cr-inline-filters__actions">
          <button type="button" className="cr-ops-action is-secondary" onClick={onReset}>
            Sifirla
          </button>
          <button type="button" className="cr-ops-action" onClick={onApply}>
            Uygula
          </button>
        </div>
      </div>
    </section>
  )
}

export function ControlRoomPage() {
  const isMobile = useIsMobile()
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [mapMode, setMapMode] = useState<MapMode>('fleet')
  const [mobileView, setMobileView] = useState<MobileView>('days')
  const [draftFilters, setDraftFilters] = useState<FilterFormState>(() => defaultFilters())
  const [appliedFilters, setAppliedFilters] = useState<FilterFormState>(() => defaultFilters())
  const [filtersOpen, setFiltersOpen] = useState(!isMobile)

  useEffect(() => {
    if (!isMobile) {
      setFiltersOpen(true)
    }
  }, [isMobile])

  const overviewParams = useMemo(
    () => ({
      ...toOverviewParams(appliedFilters, 1),
    }),
    [appliedFilters],
  )

  const overviewQuery = useQuery({
    queryKey: controlRoomQueryKeys.overview(overviewParams),
    queryFn: () => getControlRoomOverview(overviewParams),
    staleTime: 30_000,
    placeholderData: (previousData) => previousData,
  })

  const regionsQuery = useQuery({
    queryKey: controlRoomQueryKeys.regions,
    queryFn: () => getRegions(),
    staleTime: 5 * 60_000,
  })

  const departmentsQuery = useQuery({
    queryKey: controlRoomQueryKeys.departments,
    queryFn: () => getDepartments(),
    staleTime: 5 * 60_000,
  })

  const employeesQuery = useQuery({
    queryKey: controlRoomQueryKeys.employees,
    queryFn: () => getEmployees({ include_inactive: true, status: 'all' }),
    staleTime: 5 * 60_000,
  })

  const overview = overviewQuery.data ?? null
  const employees = employeesQuery.data ?? []
  const employeeNames = useMemo(
    () => new Map(employees.map((employee) => [employee.id, employee.full_name])),
    [employees],
  )

  const employeeStateMap = useMemo(
    () => new Map((overview?.items ?? []).map((item) => [item.employee.id, item])),
    [overview?.items],
  )

  const selectedEmployeeState =
    (selectedEmployeeId != null ? employeeStateMap.get(selectedEmployeeId) : null) ?? null

  const mapPoints = useMemo(() => {
    return (overview?.map_points ?? [])
      .map((point) => {
        const employeeState = employeeStateMap.get(point.employee_id)
        if (!employeeState) return null
        return {
          employeeId: point.employee_id,
          employeeName: point.employee_name,
          departmentName: point.department_name,
          lat: point.lat,
          lon: point.lon,
          tsUtc: point.ts_utc,
          label: point.label,
          locationState: point.location_state,
          riskStatus: employeeState.risk_status,
          todayStatus: point.today_status,
        }
      })
      .filter((point): point is NonNullable<typeof point> => point != null)
  }, [employeeStateMap, overview?.map_points])

  const employeesInScope = useMemo(
    () => [...(overview?.items ?? [])].sort(prioritySort),
    [overview?.items],
  )

  const employeeTimelineQueries = useQueries({
    queries: employeesInScope.map((employeeState) => ({
      queryKey: controlRoomQueryKeys.focusTimeline(employeeState.employee.id, {
        start_date: appliedFilters.start_date,
        end_date: appliedFilters.end_date,
        latest_only: false,
      }),
      queryFn: () =>
        getLocationMonitorEmployeeTimelineEvents(employeeState.employee.id, {
          start_date: appliedFilters.start_date,
          end_date: appliedFilters.end_date,
          latest_only: false,
        }),
      staleTime: 30_000,
      placeholderData: (previousData: Awaited<ReturnType<typeof getLocationMonitorEmployeeTimelineEvents>> | undefined) =>
        previousData,
    })),
  })

  const employeeMapQueries = useQueries({
    queries: employeesInScope.map((employeeState) => ({
      queryKey: controlRoomQueryKeys.focusMap(employeeState.employee.id, {
        start_date: appliedFilters.start_date,
        end_date: appliedFilters.end_date,
        latest_only: false,
      }),
      queryFn: () =>
        getLocationMonitorEmployeeMapPoints(employeeState.employee.id, {
          start_date: appliedFilters.start_date,
          end_date: appliedFilters.end_date,
          latest_only: false,
        }),
      staleTime: 30_000,
      placeholderData: (previousData: Awaited<ReturnType<typeof getLocationMonitorEmployeeMapPoints>> | undefined) =>
        previousData,
    })),
  })

  const dailyRows = useMemo<EmployeeDailyRouteRow[]>(() => {
    const rows: EmployeeDailyRouteRow[] = []

    employeesInScope.forEach((employeeState, index) => {
      const timelineData = employeeTimelineQueries[index]?.data
      const mapData = employeeMapQueries[index]?.data
      if (!timelineData) return

      const simplifiedByDay = groupPointsByDay(mapData?.simplified_points ?? [])
      const pointsByDay = groupPointsByDay(mapData?.points ?? [])

      timelineData.days.forEach((day) => {
        const routePoints = simplifiedByDay.get(day.date) ?? pointsByDay.get(day.date) ?? []
        const rawPoints = pointsByDay.get(day.date) ?? []
        const geofence = dailyGeofence(day, rawPoints)

        rows.push({
          employeeId: employeeState.employee.id,
          employeeName: employeeState.employee.full_name,
          date: day.date,
          firstTimestamp: firstTimestamp(day, rawPoints),
          lastTimestamp: lastTimestamp(day, rawPoints),
          pointCount: rawPoints.length || day.event_count,
          distanceMeters: calculateRouteDistance(routePoints.length ? routePoints : rawPoints),
          geofenceLabel: geofence.label,
          geofenceTone: geofence.tone,
          suspiciousJumpCount: day.suspicious_jump_count,
          lowAccuracyCount: day.low_accuracy_count,
          workedMinutes: day.worked_minutes,
        })
      })
    })

    const filteredRows = selectedEmployeeId != null
      ? rows.filter((row) => row.employeeId === selectedEmployeeId)
      : rows

    return filteredRows.sort((left, right) => {
      if (left.date !== right.date) {
        return new Date(right.date).getTime() - new Date(left.date).getTime()
      }
      return left.employeeName.localeCompare(right.employeeName, 'tr')
    })
  }, [employeeMapQueries, employeeTimelineQueries, employeesInScope, selectedEmployeeId])

  const hasOverviewData = Boolean(overview)
  const dailyRowsLoading =
    employeeTimelineQueries.some((query) => query.isPending) || employeeMapQueries.some((query) => query.isPending)

  const selectedRow =
    (selectedEmployeeId != null && selectedDay != null
      ? dailyRows.find((row) => row.employeeId === selectedEmployeeId && row.date === selectedDay)
      : null) ?? null

  useEffect(() => {
    if (selectedEmployeeId == null) return
    if (employeeStateMap.has(selectedEmployeeId)) return
    setSelectedEmployeeId(null)
    setSelectedDay(null)
    setMapMode('fleet')
  }, [employeeStateMap, selectedEmployeeId])

  useEffect(() => {
    if (selectedDay == null || selectedEmployeeId == null) return
    if (dailyRows.some((row) => row.employeeId === selectedEmployeeId && row.date === selectedDay)) return
    if (dailyRowsLoading) return
    setSelectedDay(null)
    setMapMode('fleet')
  }, [dailyRows, dailyRowsLoading, selectedDay, selectedEmployeeId])

  const selectedDayQueryEnabled = selectedEmployeeId != null && selectedDay != null

  const selectedDayTimelineQuery = useQuery({
    enabled: selectedDayQueryEnabled,
    queryKey:
      selectedDayQueryEnabled && selectedEmployeeId != null && selectedDay != null
        ? controlRoomQueryKeys.focusTimeline(selectedEmployeeId, {
            start_date: appliedFilters.start_date,
            end_date: appliedFilters.end_date,
            day: selectedDay,
            latest_only: false,
          })
        : ['control-room', 'selected-day', 'timeline', 'idle'],
    queryFn: () =>
      getLocationMonitorEmployeeTimelineEvents(selectedEmployeeId!, {
        start_date: appliedFilters.start_date,
        end_date: appliedFilters.end_date,
        day: selectedDay!,
        latest_only: false,
      }),
    staleTime: 20_000,
    placeholderData: (previousData) => previousData,
  })

  const selectedDayMapQuery = useQuery({
    enabled: selectedDayQueryEnabled,
    queryKey:
      selectedDayQueryEnabled && selectedEmployeeId != null && selectedDay != null
        ? controlRoomQueryKeys.focusMap(selectedEmployeeId, {
            start_date: appliedFilters.start_date,
            end_date: appliedFilters.end_date,
            day: selectedDay,
            latest_only: false,
          })
        : ['control-room', 'selected-day', 'map', 'idle'],
    queryFn: () =>
      getLocationMonitorEmployeeMapPoints(selectedEmployeeId!, {
        start_date: appliedFilters.start_date,
        end_date: appliedFilters.end_date,
        day: selectedDay!,
        latest_only: false,
      }),
    staleTime: 20_000,
    placeholderData: (previousData) => previousData,
  })

  const appliedDayRange = dayCountForRange(appliedFilters.start_date, appliedFilters.end_date)
  const filterTags = useMemo(
    () => activeFilterEntries(appliedFilters, employeeNames),
    [appliedFilters, employeeNames],
  )

  const handleApplyFilters = () => {
    setAppliedFilters(draftFilters)
    setSelectedDay(null)
    setMapMode('fleet')
  }

  const handleResetFilters = () => {
    const next = defaultFilters()
    setDraftFilters(next)
    setAppliedFilters(next)
    setSelectedEmployeeId(null)
    setSelectedDay(null)
    setMapMode('fleet')
  }

  const handleSelectEmployee = (employeeId: number) => {
    setSelectedEmployeeId(employeeId)
    setSelectedDay(null)
    setMapMode('fleet')
  }

  const handleSelectRow = (employeeId: number, day: string) => {
    setSelectedEmployeeId(employeeId)
    setSelectedDay(day)
    setMapMode('employeeDay')
    if (isMobile) {
      setMobileView('map')
    }
  }

  const handleCloseDayView = () => {
    setSelectedDay(null)
    setMapMode('fleet')
    if (isMobile) {
      setMobileView('days')
    }
  }

  const mapHeader = (
    <header className="cr-ops-section-head">
      <div>
        <p className="cr-ops-kicker">Harita</p>
        <h3>
          {mapMode === 'employeeDay' && selectedRow
            ? `${selectedRow.employeeName} / ${selectedRow.date}`
            : selectedEmployeeState
              ? `${selectedEmployeeState.employee.full_name} secili, gun bekleniyor`
              : 'Fleet marker gorunumu'}
        </h3>
        <p>
          {mapMode === 'employeeDay' && selectedRow
            ? 'Secilen gunun tum noktalarini ve rota izini ayni harita ustunde gosterir.'
            : 'Marker secimi calisan filtreler, gun secimi ise haritayi rota gorunumune tasir.'}
        </p>
      </div>
      <div className="cr-ops-section-meta">
        {mapMode === 'employeeDay' && selectedDayTimelineQuery.data ? (
          <>
            <span>{selectedDayTimelineQuery.data.events.length} olay</span>
            <span>{selectedDayMapQuery.data?.points.length ?? 0} nokta</span>
          </>
        ) : (
          <>
            <span>{mapPoints.length} marker</span>
            <span>{dailyRows.length} gun satiri</span>
          </>
        )}
        {mapMode === 'employeeDay' ? (
          <button type="button" className="cr-ops-action" onClick={handleCloseDayView}>
            Kapat
          </button>
        ) : null}
      </div>
    </header>
  )

  return (
    <div className="cr-ops-page cr-ops-page--tracking">
      <PageHeader
        title="Employee Tracking"
        description="Gunluk rota listesi ve harita ayni ekranda calisir. Fleet marker secimiyle calisan filtrelenir, gun secimiyle tek tikta rota sonucu gelir."
        action={
          <div className="cr-ops-header-actions">
            <button type="button" className="cr-ops-action" onClick={() => void overviewQuery.refetch()}>
              Veriyi yenile
            </button>
            {selectedEmployeeId != null ? (
              <button
                type="button"
                className="cr-ops-action is-secondary"
                onClick={() => {
                  setSelectedEmployeeId(null)
                  setSelectedDay(null)
                  setMapMode('fleet')
                }}
              >
                Secimi temizle
              </button>
            ) : null}
            <button
              type="button"
              className="cr-ops-action is-secondary"
              onClick={() => setFiltersOpen((current) => !current)}
            >
              {filtersOpen ? 'Filtreleri gizle' : 'Filtreler'}
            </button>
          </div>
        }
      />

      <section className="cr-ops-command-bar cr-ops-command-bar--hud">
        <div className="cr-ops-command-bar__identity">
          <div>
            <p className="cr-ops-kicker">Tracking HUD</p>
            <h2>{mapMode === 'employeeDay' ? 'Employee day mode' : 'Fleet mode'}</h2>
            <p>
              {selectedRow
                ? `${selectedRow.employeeName} icin ${selectedRow.date} gunu secili. Harita tum konum noktalarini ve rota izini gosteriyor.`
                : selectedEmployeeState
                  ? `${selectedEmployeeState.employee.full_name} secili. Gun tablosundan bir satir secerek harita sonucunu acin.`
                  : `Varsayilan fleet mod acik. ${appliedDayRange} gunluk pencere ve ${rangeLabel(appliedFilters.start_date, appliedFilters.end_date)} aktif.`}
            </p>
          </div>
          <div className="cr-ops-command-bar__badges">
            <span className="cr-ops-inline-badge">Mode: {mapMode}</span>
            <span className="cr-ops-inline-badge">{mapPoints.length} marker</span>
            {selectedEmployeeState ? (
              <span className="cr-ops-inline-badge">{selectedEmployeeState.employee.full_name}</span>
            ) : null}
            {overview?.generated_at_utc ? (
              <span className="cr-ops-inline-badge">Son sync {formatDateTime(overview.generated_at_utc)}</span>
            ) : null}
          </div>
        </div>

        {isMobile ? (
          <div className="cr-mobile-view-toggle" role="tablist" aria-label="Mobile tracking views">
            {(['days', 'map'] as MobileView[]).map((view) => (
              <button
                key={view}
                type="button"
                className={mobileView === view ? 'is-active' : ''}
                onClick={() => setMobileView(view)}
              >
                {view === 'days' ? 'Gunler' : 'Harita'}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      {filtersOpen ? (
        <CompactFilters
          filters={draftFilters}
          employees={employees}
          regions={regionsQuery.data ?? []}
          departments={departmentsQuery.data ?? []}
          activeEntries={filterTags}
          onChange={setDraftFilters}
          onApply={handleApplyFilters}
          onReset={handleResetFilters}
        />
      ) : filterTags.length ? (
        <div className="cr-ops-active-tags" aria-label="Aktif filtreler">
          {filterTags.map((entry) => (
            <span key={entry} className="cr-ops-active-tag">
              {entry}
            </span>
          ))}
        </div>
      ) : null}

      {overviewQuery.isPending && !hasOverviewData ? (
        <LoadingBlock label="Employee tracking verisi hazirlaniyor..." />
      ) : null}

      {overviewQuery.isError && !hasOverviewData ? (
        <section className="cr-ops-error">
          <ErrorBlock message="Employee tracking overview verisi yuklenemedi." />
          <button type="button" className="cr-ops-action" onClick={() => void overviewQuery.refetch()}>
            Tekrar dene
          </button>
        </section>
      ) : null}

      {hasOverviewData ? (
        <>
          {!isMobile ? (
            <section className="cr-tracking-layout">
              <aside className="cr-tracking-layout__list">
                <EmployeeDailyRouteTable
                  rows={dailyRows}
                  selectedEmployeeId={selectedEmployeeId}
                  selectedDay={selectedDay}
                  loading={dailyRowsLoading}
                  onSelectRow={handleSelectRow}
                  onClearEmployee={() => {
                    setSelectedEmployeeId(null)
                    setSelectedDay(null)
                    setMapMode('fleet')
                  }}
                />
              </aside>

              <article className="cr-tracking-layout__map">
                <section className="cr-ops-map-card">
                  {mapHeader}
                  <ControlRoomUnifiedMap
                    mapMode={mapMode}
                    selectedEmployeeId={selectedEmployeeId}
                    selectedEmployeeName={selectedEmployeeState?.employee.full_name ?? null}
                    selectedDay={selectedDay}
                    overviewPoints={mapPoints}
                    dayMapData={selectedDayMapQuery.data ?? null}
                    dayLoading={selectedDayMapQuery.isFetching}
                    dayError={selectedDayMapQuery.isError}
                    onSelectEmployee={handleSelectEmployee}
                  />
                </section>
              </article>
            </section>
          ) : mobileView === 'days' ? (
            <EmployeeDailyRouteTable
              rows={dailyRows}
              selectedEmployeeId={selectedEmployeeId}
              selectedDay={selectedDay}
              loading={dailyRowsLoading}
              mobile
              onSelectRow={handleSelectRow}
              onClearEmployee={() => {
                setSelectedEmployeeId(null)
                setSelectedDay(null)
                setMapMode('fleet')
              }}
            />
          ) : (
            <section className="cr-ops-map-card">
              {mapHeader}
              <ControlRoomUnifiedMap
                mapMode={mapMode}
                selectedEmployeeId={selectedEmployeeId}
                selectedEmployeeName={selectedEmployeeState?.employee.full_name ?? null}
                selectedDay={selectedDay}
                overviewPoints={mapPoints}
                dayMapData={selectedDayMapQuery.data ?? null}
                dayLoading={selectedDayMapQuery.isFetching}
                dayError={selectedDayMapQuery.isError}
                onSelectEmployee={handleSelectEmployee}
              />
            </section>
          )}
        </>
      ) : null}
    </div>
  )
}
