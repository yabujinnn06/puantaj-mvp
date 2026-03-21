import { useEffect, useMemo, useReducer, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import {
  getControlRoomOverview,
  getDepartments,
  getEmployees,
  getLocationMonitorEmployeeMapPoints,
  getRegions,
} from '../../api/admin'
import { ErrorBlock } from '../ErrorBlock'
import { LoadingBlock } from '../LoadingBlock'
import { MinuteDisplay } from '../MinuteDisplay'
import { PageHeader } from '../PageHeader'
import { ManagementConsoleEmployeeDetailModal } from '../management-console/ManagementConsoleEmployeeDetailModal'
import { ManagementConsoleFilters } from '../management-console/ManagementConsoleFilters'
import { controlRoomQueryKeys } from './queryKeys'
import { ControlRoomEventFeed } from './ControlRoomEventFeed'
import { ControlRoomMobileSheet } from './ControlRoomMobileSheet'
import { ControlRoomPriorityQueue } from './ControlRoomPriorityQueue'
import { ControlRoomQuickFilters } from './ControlRoomQuickFilters'
import { ControlRoomUnifiedMap } from './ControlRoomUnifiedMap'
import type { ControlRoomQuickFilter } from './utils'
import {
  buildQuickFilterParams,
  controlRoomLocationLabel,
  controlRoomRiskLabel,
  dayCountForRange,
  formatDateTime,
  formatDistance,
  formatRelative,
  matchesQuickFilters,
  queueReason,
  rangeLabel,
  toggleQuickFilter,
  todayStatusLabel,
} from './utils'
import {
  defaultFilters,
  type FilterFormState,
  toOverviewParams,
} from '../management-console/types'
import type { ControlRoomEmployeeState } from '../../types/api'

type MapMode = 'fleet' | 'employeeRoute'
type MobileTab = 'map' | 'queue' | 'feed'

type ControlRoomUiState = {
  mapMode: MapMode
  selectedEmployeeId: number | null
  selectedEventId: number | null
  modalEmployeeId: number | null
  mobileTab: MobileTab
  quickFilters: ControlRoomQuickFilter[]
  feedOpen: boolean
}

type ControlRoomUiAction =
  | { type: 'selectEmployee'; employeeId: number; eventId?: number | null; mobileTab?: MobileTab }
  | { type: 'clearSelection' }
  | { type: 'showRoute' }
  | { type: 'hideRoute' }
  | { type: 'openModal'; employeeId: number }
  | { type: 'closeModal' }
  | { type: 'setMobileTab'; value: MobileTab }
  | { type: 'toggleQuickFilter'; value: ControlRoomQuickFilter }
  | { type: 'toggleFeed' }

const initialUiState: ControlRoomUiState = {
  mapMode: 'fleet',
  selectedEmployeeId: null,
  selectedEventId: null,
  modalEmployeeId: null,
  mobileTab: 'map',
  quickFilters: [],
  feedOpen: false,
}

function uiReducer(state: ControlRoomUiState, action: ControlRoomUiAction): ControlRoomUiState {
  if (action.type === 'selectEmployee') {
    return {
      ...state,
      selectedEmployeeId: action.employeeId,
      selectedEventId: action.eventId ?? null,
      mobileTab: action.mobileTab ?? 'map',
    }
  }

  if (action.type === 'clearSelection') {
    return {
      ...state,
      mapMode: 'fleet',
      selectedEmployeeId: null,
      selectedEventId: null,
    }
  }

  if (action.type === 'showRoute') {
    if (state.selectedEmployeeId == null) return state
    return {
      ...state,
      mapMode: 'employeeRoute',
      mobileTab: 'map',
    }
  }

  if (action.type === 'hideRoute') {
    return {
      ...state,
      mapMode: 'fleet',
    }
  }

  if (action.type === 'openModal') {
    return {
      ...state,
      selectedEmployeeId: action.employeeId,
      modalEmployeeId: action.employeeId,
    }
  }

  if (action.type === 'closeModal') {
    return {
      ...state,
      modalEmployeeId: null,
    }
  }

  if (action.type === 'setMobileTab') {
    return {
      ...state,
      mobileTab: action.value,
    }
  }

  if (action.type === 'toggleQuickFilter') {
    return {
      ...state,
      quickFilters: toggleQuickFilter(state.quickFilters, action.value),
    }
  }

  return {
    ...state,
    feedOpen: !state.feedOpen,
  }
}

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

function activeFilterEntries(
  filters: FilterFormState,
  quickFilters: ControlRoomQuickFilter[],
  employeeNames: Map<number, string>,
): string[] {
  const entries: string[] = []
  if (filters.employee_id) {
    const employeeId = Number(filters.employee_id)
    const employeeLabel = employeeNames.get(employeeId)
    entries.push(employeeLabel ? `Personel: ${employeeLabel}` : `Personel #${filters.employee_id}`)
  }
  if (filters.q.trim()) entries.push(`Arama: ${filters.q.trim()}`)
  if (filters.region_id) entries.push(`Bolge #${filters.region_id}`)
  if (filters.department_id) entries.push(`Departman #${filters.department_id}`)
  if (filters.risk_min) entries.push(`Risk min ${filters.risk_min}`)
  if (filters.risk_max) entries.push(`Risk max ${filters.risk_max}`)
  if (filters.risk_status) entries.push(`Risk ${controlRoomRiskLabel(filters.risk_status)}`)
  if (filters.include_inactive) entries.push('Pasif calisanlar dahil')
  if (quickFilters.includes('critical')) entries.push('Quick: Kritik')
  if (quickFilters.includes('watch')) entries.push('Quick: Izlemeli')
  if (quickFilters.includes('live')) entries.push('Quick: Canli')
  if (quickFilters.includes('active-shift')) entries.push('Quick: Aktif vardiya')
  return entries
}

function prioritySort(left: ControlRoomEmployeeState, right: ControlRoomEmployeeState): number {
  const riskOrder = { CRITICAL: 0, WATCH: 1, NORMAL: 2 }
  const riskDelta = riskOrder[left.risk_status] - riskOrder[right.risk_status]
  if (riskDelta !== 0) return riskDelta

  const measureDelta = Number(Boolean(right.active_measure)) - Number(Boolean(left.active_measure))
  if (measureDelta !== 0) return measureDelta

  const flagDelta = right.attention_flags.length - left.attention_flags.length
  if (flagDelta !== 0) return flagDelta

  if (left.risk_score !== right.risk_score) {
    return right.risk_score - left.risk_score
  }

  return new Date(right.last_activity_utc ?? 0).getTime() - new Date(left.last_activity_utc ?? 0).getTime()
}

function SelectedEmployeeInspector({
  employee,
  mapMode,
  routeLoading,
  routePointCount,
  routeDistance,
  onShowRoute,
  onHideRoute,
  onClearSelection,
  onOpenDetail,
}: {
  employee: ControlRoomEmployeeState | null
  mapMode: MapMode
  routeLoading: boolean
  routePointCount: number
  routeDistance: string
  onShowRoute: () => void
  onHideRoute: () => void
  onClearSelection: () => void
  onOpenDetail: () => void
}) {
  if (!employee) {
    return (
      <section className="cr-dossier-peek cr-inspector-card">
        <header className="cr-dossier-peek__header">
          <div>
            <p className="cr-ops-kicker">Map inspector</p>
            <h3>Haritadan personel secin</h3>
          </div>
        </header>
        <div className="cr-feed-empty">
          Fleet marker'a bir kez tiklayin. Harita odaklanir, secili personel inspector'u acilir ve rota aksiyonu aktif olur.
        </div>
      </section>
    )
  }

  return (
    <section className="cr-dossier-peek cr-inspector-card">
      <header className="cr-dossier-peek__header">
        <div>
          <p className="cr-ops-kicker">Mini inspector</p>
          <h3>{employee.employee.full_name}</h3>
        </div>
        <div className="cr-inspector-card__head-actions">
          <span className={`cr-dossier-peek__risk is-${employee.risk_status.toLowerCase()}`}>
            {employee.risk_score}
          </span>
          <button type="button" className="cr-inspector-card__clear" onClick={onClearSelection}>
            Secimi temizle
          </button>
        </div>
      </header>

      <div className="cr-dossier-peek__meta">
        <span>{controlRoomRiskLabel(employee.risk_status)}</span>
        <span>{controlRoomLocationLabel(employee.location_state)}</span>
        <span>{todayStatusLabel(employee.today_status)}</span>
      </div>

      <p className="cr-dossier-peek__reason">{queueReason(employee)}</p>

      <div className="cr-dossier-peek__grid">
        <article>
          <span>Son aktivite</span>
          <strong>{formatDateTime(employee.last_activity_utc)}</strong>
          <small>{formatRelative(employee.last_activity_utc)}</small>
        </article>
        <article>
          <span>Bugun / hafta</span>
          <strong>
            <MinuteDisplay minutes={employee.worked_today_minutes} />
          </strong>
          <small>
            <MinuteDisplay minutes={employee.weekly_total_minutes} /> hafta
          </small>
        </article>
        <article>
          <span>Harita modu</span>
          <strong>{mapMode === 'employeeRoute' ? 'Employee route' : 'Fleet'}</strong>
          <small>
            {mapMode === 'employeeRoute'
              ? `${routePointCount} nokta / ${routeDistance}`
              : 'Marker tabanli coklu saha gorunumu'}
          </small>
        </article>
      </div>

      <div className="cr-dossier-peek__actions">
        {mapMode === 'employeeRoute' ? (
          <button type="button" onClick={onHideRoute}>
            Kapat
          </button>
        ) : (
          <button type="button" onClick={onShowRoute} disabled={routeLoading}>
            {routeLoading ? 'Rota yukleniyor...' : 'Rota'}
          </button>
        )}
        <button type="button" className="is-secondary" onClick={onOpenDetail}>
          Dosyayi ac
        </button>
      </div>
    </section>
  )
}

export function ControlRoomPage() {
  const isMobile = useIsMobile()
  const [uiState, dispatch] = useReducer(uiReducer, initialUiState)
  const [draftFilters, setDraftFilters] = useState<FilterFormState>(() => defaultFilters())
  const [appliedFilters, setAppliedFilters] = useState<FilterFormState>(() => defaultFilters())
  const [filtersOpen, setFiltersOpen] = useState(false)

  const quickFilterParams = useMemo(
    () => buildQuickFilterParams(uiState.quickFilters),
    [uiState.quickFilters],
  )

  const overviewParams = useMemo(
    () => ({
      ...toOverviewParams(appliedFilters, 1),
      ...quickFilterParams,
    }),
    [appliedFilters, quickFilterParams],
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

  const routeQueryEnabled = uiState.selectedEmployeeId != null && uiState.mapMode === 'employeeRoute'
  const routeQuery = useQuery({
    enabled: routeQueryEnabled,
    queryKey:
      routeQueryEnabled && uiState.selectedEmployeeId != null
        ? controlRoomQueryKeys.focusMap(uiState.selectedEmployeeId, {
            start_date: appliedFilters.start_date,
            end_date: appliedFilters.end_date,
            latest_only: false,
          })
        : ['control-room-route-overlay', 'idle'],
    queryFn: () =>
      getLocationMonitorEmployeeMapPoints(uiState.selectedEmployeeId!, {
        start_date: appliedFilters.start_date,
        end_date: appliedFilters.end_date,
        latest_only: false,
      }),
    staleTime: 20_000,
    placeholderData: (previousData) => previousData,
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
    (uiState.selectedEmployeeId != null ? employeeStateMap.get(uiState.selectedEmployeeId) : null) ?? null

  useEffect(() => {
    if (uiState.selectedEmployeeId == null) return
    if (employeeStateMap.has(uiState.selectedEmployeeId)) return
    dispatch({ type: 'clearSelection' })
  }, [employeeStateMap, uiState.selectedEmployeeId])

  const priorityQueue = useMemo(
    () => [...(overview?.items ?? [])].sort(prioritySort).slice(0, 8),
    [overview?.items],
  )

  const mapPoints = useMemo(() => {
    return (overview?.map_points ?? [])
      .map((point) => {
        const employeeState = employeeStateMap.get(point.employee_id)
        if (!employeeState) return null
        if (!matchesQuickFilters(employeeState, uiState.quickFilters)) return null
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
  }, [employeeStateMap, overview?.map_points, uiState.quickFilters])

  const recentEvents = useMemo(() => {
    return (overview?.recent_events ?? []).filter((event) => {
      const employeeState = employeeStateMap.get(event.employee_id)
      return employeeState ? matchesQuickFilters(employeeState, uiState.quickFilters) : true
    })
  }, [employeeStateMap, overview?.recent_events, uiState.quickFilters])

  const appliedDayRange = dayCountForRange(appliedFilters.start_date, appliedFilters.end_date)
  const hasOverviewData = Boolean(overview)
  const filterTags = useMemo(
    () => activeFilterEntries(appliedFilters, uiState.quickFilters, employeeNames),
    [appliedFilters, employeeNames, uiState.quickFilters],
  )

  const handleApplyFilters = () => {
    setAppliedFilters(draftFilters)
    setFiltersOpen(false)
  }

  const handleResetFilters = () => {
    const next = defaultFilters()
    setDraftFilters(next)
    setAppliedFilters(next)
  }

  const inspector = (
    <SelectedEmployeeInspector
      employee={selectedEmployeeState}
      mapMode={uiState.mapMode}
      routeLoading={routeQuery.isFetching}
      routePointCount={routeQuery.data?.route_stats.event_count ?? 0}
      routeDistance={formatDistance(routeQuery.data?.route_stats.total_distance_m)}
      onShowRoute={() => dispatch({ type: 'showRoute' })}
      onHideRoute={() => dispatch({ type: 'hideRoute' })}
      onClearSelection={() => dispatch({ type: 'clearSelection' })}
      onOpenDetail={() => {
        if (uiState.selectedEmployeeId != null) {
          dispatch({ type: 'openModal', employeeId: uiState.selectedEmployeeId })
        }
      }}
    />
  )

  const eventFeed = (
    <ControlRoomEventFeed
      events={recentEvents}
      employeeStates={employeeStateMap}
      selectedEventId={uiState.selectedEventId}
      initialVisibleCount={isMobile ? 10 : 12}
      incrementCount={8}
      scrollable
      onSelectEvent={(employeeId, eventId) =>
        dispatch({
          type: 'selectEmployee',
          employeeId,
          eventId,
          mobileTab: 'map',
        })
      }
      onPinToMap={(employeeId, eventId) =>
        dispatch({
          type: 'selectEmployee',
          employeeId,
          eventId,
          mobileTab: 'map',
        })
      }
      onOpenEmployeeDetail={(employeeId) => dispatch({ type: 'openModal', employeeId })}
      hideHeader={!isMobile}
    />
  )

  const queue = (
    <ControlRoomPriorityQueue
      items={priorityQueue}
      selectedEmployeeId={uiState.selectedEmployeeId}
      onSelectEmployee={(employeeId) =>
        dispatch({
          type: 'selectEmployee',
          employeeId,
          mobileTab: 'map',
        })
      }
      onOpenEmployeeDetail={(employeeId) => dispatch({ type: 'openModal', employeeId })}
    />
  )

  return (
    <div className="cr-ops-page cr-ops-page--map-first">
      <PageHeader
        title="Employee Control Board"
        description="Harita ana urun olarak kalir. Fleet marker secimi, secili personel inspector'u ve rota overlay ayni ekranda tek akista calisir."
        action={
          <div className="cr-ops-header-actions">
            <button type="button" className="cr-ops-action" onClick={() => void overviewQuery.refetch()}>
              Veriyi yenile
            </button>
            {!isMobile ? (
              <button type="button" className="cr-ops-action is-secondary" onClick={() => dispatch({ type: 'toggleFeed' })}>
                {uiState.feedOpen ? 'Feed gizle' : 'Feed ac'}
              </button>
            ) : null}
            <button type="button" className="cr-ops-action is-secondary" onClick={() => setFiltersOpen(true)}>
              Filtreler
            </button>
          </div>
        }
      />

      <section className="cr-ops-command-bar cr-ops-command-bar--hud">
        <div className="cr-ops-command-bar__identity">
          <div>
            <p className="cr-ops-kicker">Map-first control board</p>
            <h2>{uiState.mapMode === 'employeeRoute' ? 'Secili employee route overlay' : 'Fleet marker gorunumu'}</h2>
            <p>
              {selectedEmployeeState
                ? `${selectedEmployeeState.employee.full_name} secili. ${
                    uiState.mapMode === 'employeeRoute'
                      ? 'Rota overlay ayni harita ustunde acik.'
                      : 'Marker secildi; rota icin tek adimlik aksiyon hazir.'
                  }`
                : `Harita varsayilan olarak fleet modda aciliyor. ${appliedDayRange} gunluk pencere ve ${rangeLabel(appliedFilters.start_date, appliedFilters.end_date)} aktif.`}
            </p>
          </div>
          <div className="cr-ops-command-bar__badges">
            <span className="cr-ops-inline-badge">Mode: {uiState.mapMode === 'employeeRoute' ? 'employeeRoute' : 'fleet'}</span>
            <span className="cr-ops-inline-badge">{mapPoints.length} marker</span>
            {selectedEmployeeState ? (
              <span className="cr-ops-inline-badge">{selectedEmployeeState.employee.full_name}</span>
            ) : null}
            {overview?.generated_at_utc ? (
              <span className="cr-ops-inline-badge">Son sync {formatDateTime(overview.generated_at_utc)}</span>
            ) : null}
          </div>
        </div>

        <div className="cr-ops-command-bar__filters">
          <label className="cr-ops-field">
            <span>Personel</span>
            <select
              value={draftFilters.employee_id}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  employee_id: event.target.value,
                  q: event.target.value ? '' : current.q,
                }))
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
              value={draftFilters.q}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  q: event.target.value,
                  employee_id: event.target.value.trim() ? '' : current.employee_id,
                }))
              }
              placeholder="Ad, soyad veya #ID"
            />
          </label>
          <label className="cr-ops-field">
            <span>Bolge</span>
            <select
              value={draftFilters.region_id}
              onChange={(event) => setDraftFilters((current) => ({ ...current, region_id: event.target.value }))}
            >
              <option value="">Tum bolgeler</option>
              {(regionsQuery.data ?? []).map((region) => (
                <option key={region.id} value={region.id}>
                  {region.name}
                </option>
              ))}
            </select>
          </label>
          <label className="cr-ops-field">
            <span>Departman</span>
            <select
              value={draftFilters.department_id}
              onChange={(event) =>
                setDraftFilters((current) => ({ ...current, department_id: event.target.value }))
              }
            >
              <option value="">Tum departmanlar</option>
              {(departmentsQuery.data ?? []).map((department) => (
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
              value={draftFilters.start_date}
              onChange={(event) =>
                setDraftFilters((current) => ({ ...current, start_date: event.target.value }))
              }
            />
          </label>
          <label className="cr-ops-field">
            <span>Bitis</span>
            <input
              type="date"
              value={draftFilters.end_date}
              onChange={(event) => setDraftFilters((current) => ({ ...current, end_date: event.target.value }))}
            />
          </label>
          <button type="button" className="cr-ops-action" onClick={handleApplyFilters}>
            Uygula
          </button>
        </div>
      </section>

      <section className="cr-ops-filter-strip">
        <ControlRoomQuickFilters
          activeFilters={uiState.quickFilters}
          onToggle={(value) => dispatch({ type: 'toggleQuickFilter', value })}
        />
        {filterTags.length ? (
          <div className="cr-ops-active-tags" aria-label="Aktif filtreler">
            {filterTags.slice(0, isMobile ? 4 : filterTags.length).map((entry) => (
              <span key={entry} className="cr-ops-active-tag">
                {entry}
              </span>
            ))}
          </div>
        ) : null}
      </section>

      {overviewQuery.isPending && !hasOverviewData ? (
        <LoadingBlock label="Control board harita verisi hazirlaniyor..." />
      ) : null}

      {overviewQuery.isError && !hasOverviewData ? (
        <section className="cr-ops-error">
          <ErrorBlock message="Control board overview verisi yuklenemedi." />
          <button type="button" className="cr-ops-action" onClick={() => void overviewQuery.refetch()}>
            Tekrar dene
          </button>
        </section>
      ) : null}

      {hasOverviewData ? (
        <>
          {!isMobile ? (
            <>
              <section className="cr-board-layout">
                <article className="cr-board-map">
                  <ControlRoomUnifiedMap
                    mapMode={uiState.mapMode}
                    selectedEmployeeId={uiState.selectedEmployeeId}
                    selectedEmployeeName={selectedEmployeeState?.employee.full_name ?? null}
                    overviewPoints={mapPoints}
                    routeData={routeQuery.data ?? null}
                    routeLoading={routeQuery.isFetching}
                    routeError={routeQuery.isError}
                    onSelectEmployee={(employeeId) =>
                      dispatch({
                        type: 'selectEmployee',
                        employeeId,
                      })
                    }
                  />
                </article>

                <aside className="cr-board-rail">
                  {inspector}
                  {queue}
                </aside>
              </section>

              <section className={`cr-feed-drawer ${uiState.feedOpen ? 'is-open' : ''}`}>
                <header className="cr-feed-drawer__header">
                  <div>
                    <p className="cr-ops-kicker">Secondary feed</p>
                    <h3>Event drawer</h3>
                  </div>
                  <div className="cr-feed-drawer__meta">
                    <span>{recentEvents.length} olay</span>
                    <button type="button" className="cr-ops-action is-secondary" onClick={() => dispatch({ type: 'toggleFeed' })}>
                      {uiState.feedOpen ? 'Gizle' : 'Ac'}
                    </button>
                  </div>
                </header>

                {uiState.feedOpen ? eventFeed : (
                  <div className="cr-feed-drawer__empty">
                    Event feed ana navigasyon degil. Ihtiyac oldugunda bu drawer'dan acabilirsiniz.
                  </div>
                )}
              </section>
            </>
          ) : (
            <>
              {uiState.mobileTab === 'map' ? (
                <section className="cr-board-map cr-board-map--mobile">
                  <ControlRoomUnifiedMap
                    mapMode={uiState.mapMode}
                    selectedEmployeeId={uiState.selectedEmployeeId}
                    selectedEmployeeName={selectedEmployeeState?.employee.full_name ?? null}
                    overviewPoints={mapPoints}
                    routeData={routeQuery.data ?? null}
                    routeLoading={routeQuery.isFetching}
                    routeError={routeQuery.isError}
                    onSelectEmployee={(employeeId) =>
                      dispatch({
                        type: 'selectEmployee',
                        employeeId,
                        mobileTab: 'map',
                      })
                    }
                  />
                </section>
              ) : uiState.mobileTab === 'queue' ? (
                <section className="cr-mobile-tab-shell">{queue}</section>
              ) : (
                <section className="cr-mobile-tab-shell">{eventFeed}</section>
              )}

              {uiState.mobileTab === 'map' && uiState.selectedEmployeeId != null ? (
                <div className="cr-mobile-inspector-sheet">
                  {inspector}
                </div>
              ) : null}

              <nav className="cr-ops-mobile-nav" aria-label="Mobile control room navigation">
                {(['map', 'queue', 'feed'] as MobileTab[]).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    className={uiState.mobileTab === tab ? 'is-active' : ''}
                    onClick={() => dispatch({ type: 'setMobileTab', value: tab })}
                  >
                    {tab === 'map' ? 'Harita' : tab === 'queue' ? 'Kuyruk' : 'Feed'}
                  </button>
                ))}
              </nav>
            </>
          )}
        </>
      ) : null}

      {!isMobile ? (
        <div className={`cr-ops-filters-desktop ${filtersOpen ? 'is-open' : ''}`}>
          {filtersOpen ? (
            <ManagementConsoleFilters
              filterForm={draftFilters}
              employees={employees}
              regions={regionsQuery.data ?? []}
              departments={departmentsQuery.data ?? []}
              activeFilterEntries={filterTags}
              onChange={setDraftFilters}
              onApply={handleApplyFilters}
              onReset={handleResetFilters}
            />
          ) : null}
        </div>
      ) : (
        <ControlRoomMobileSheet
          open={filtersOpen}
          title="Harita filtreleri"
          onClose={() => setFiltersOpen(false)}
        >
          <ManagementConsoleFilters
            filterForm={draftFilters}
            employees={employees}
            regions={regionsQuery.data ?? []}
            departments={departmentsQuery.data ?? []}
            activeFilterEntries={filterTags}
            onChange={setDraftFilters}
            onApply={handleApplyFilters}
            onReset={handleResetFilters}
          />
        </ControlRoomMobileSheet>
      )}

      <ManagementConsoleEmployeeDetailModal
        employeeId={uiState.modalEmployeeId}
        open={uiState.modalEmployeeId != null}
        onClose={() => dispatch({ type: 'closeModal' })}
        placement="right"
      />
    </div>
  )
}
