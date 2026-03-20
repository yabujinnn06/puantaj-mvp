import { useEffect, useMemo, useReducer, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'

import { getControlRoomOverview, getDepartments, getRegions } from '../../api/admin'
import { ErrorBlock } from '../ErrorBlock'
import { LoadingBlock } from '../LoadingBlock'
import { MinuteDisplay } from '../MinuteDisplay'
import { PageHeader } from '../PageHeader'
import { ManagementConsoleEmployeeDetailModal } from '../management-console/ManagementConsoleEmployeeDetailModal'
import { ManagementConsoleFilters } from '../management-console/ManagementConsoleFilters'
import { ManagementConsoleKpiCards } from '../management-console/ManagementConsoleKpiCards'
import { ManagementConsoleMatrixTable } from '../management-console/ManagementConsoleMatrixTable'
import { controlRoomQueryKeys } from './queryKeys'
import { ControlRoomEventFeed } from './ControlRoomEventFeed'
import { ControlRoomFocusPanel } from './ControlRoomFocusPanel'
import { ControlRoomMobileSheet } from './ControlRoomMobileSheet'
import { ControlRoomOverviewMap } from './ControlRoomOverviewMap'
import { ControlRoomPriorityQueue } from './ControlRoomPriorityQueue'
import { ControlRoomQuickFilters } from './ControlRoomQuickFilters'
import type { ControlRoomQuickFilter } from './utils'
import {
  buildQuickFilterParams,
  controlRoomLocationLabel,
  controlRoomRiskLabel,
  dayCountForRange,
  formatDateTime,
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
  type SortField,
  toOverviewParams,
} from '../management-console/types'
import type { ControlRoomEmployeeState } from '../../types/api'

type ScreenMode = 'overview' | 'focus'
type MobileTab = 'feed' | 'map' | 'queue' | 'detail'

type ControlRoomUiState = {
  screenMode: ScreenMode
  selectedEmployeeId: number | null
  selectedEventId: number | null
  detailEmployeeId: number | null
  mobileTab: MobileTab
  quickFilters: ControlRoomQuickFilter[]
  page: number
}

type ControlRoomUiAction =
  | { type: 'focusEmployee'; employeeId: number; eventId?: number | null; mobileTab?: MobileTab }
  | { type: 'showEmployeeOnMap'; employeeId: number; eventId?: number | null }
  | { type: 'openDetail'; employeeId: number }
  | { type: 'closeDetail' }
  | { type: 'setMobileTab'; value: MobileTab }
  | { type: 'toggleQuickFilter'; value: ControlRoomQuickFilter }
  | { type: 'setPage'; value: number }
  | { type: 'returnOverview' }

const initialUiState: ControlRoomUiState = {
  screenMode: 'overview',
  selectedEmployeeId: null,
  selectedEventId: null,
  detailEmployeeId: null,
  mobileTab: 'feed',
  quickFilters: [],
  page: 1,
}

function uiReducer(state: ControlRoomUiState, action: ControlRoomUiAction): ControlRoomUiState {
  if (action.type === 'focusEmployee') {
    return {
      ...state,
      screenMode: 'focus',
      selectedEmployeeId: action.employeeId,
      selectedEventId: action.eventId ?? null,
      mobileTab: action.mobileTab ?? 'map',
    }
  }

  if (action.type === 'showEmployeeOnMap') {
    return {
      ...state,
      screenMode: 'overview',
      selectedEmployeeId: action.employeeId,
      selectedEventId: action.eventId ?? null,
      mobileTab: 'map',
    }
  }

  if (action.type === 'openDetail') {
    return {
      ...state,
      selectedEmployeeId: action.employeeId,
      detailEmployeeId: action.employeeId,
      mobileTab: 'detail',
    }
  }

  if (action.type === 'closeDetail') {
    return {
      ...state,
      detailEmployeeId: null,
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
      page: 1,
    }
  }

  if (action.type === 'setPage') {
    return {
      ...state,
      page: action.value,
    }
  }

  return {
    ...state,
    screenMode: 'overview',
    selectedEventId: null,
    mobileTab: 'feed',
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

function activeFilterEntries(filters: FilterFormState, quickFilters: ControlRoomQuickFilter[]): string[] {
  const entries: string[] = []
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

function SelectedEmployeeBrief({
  employee,
  onFocus,
  onOpenDetail,
}: {
  employee: ControlRoomEmployeeState | null
  onFocus: () => void
  onOpenDetail: () => void
}) {
  if (!employee) {
    return (
      <section className="cr-dossier-peek">
        <header className="cr-dossier-peek__header">
          <div>
            <p className="cr-ops-kicker">Dossier</p>
            <h3>Secili personel yok</h3>
          </div>
        </header>
        <div className="cr-feed-empty">
          Feed, kuyruk veya harita uzerinden bir personel sectiginizde burada kisa briefing gorunur.
        </div>
      </section>
    )
  }

  return (
    <section className="cr-dossier-peek">
      <header className="cr-dossier-peek__header">
        <div>
          <p className="cr-ops-kicker">Intelligence brief</p>
          <h3>{employee.employee.full_name}</h3>
        </div>
        <span className={`cr-dossier-peek__risk is-${employee.risk_status.toLowerCase()}`}>
          {employee.risk_score}
        </span>
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
      </div>

      <div className="cr-dossier-peek__actions">
        <button type="button" onClick={onFocus}>
          Rota focus'a git
        </button>
        <button type="button" onClick={onOpenDetail}>
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
      ...toOverviewParams(appliedFilters, uiState.page),
      ...quickFilterParams,
    }),
    [appliedFilters, quickFilterParams, uiState.page],
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

  const overview = overviewQuery.data ?? null

  const employeeStateMap = useMemo(
    () => new Map((overview?.items ?? []).map((item) => [item.employee.id, item])),
    [overview?.items],
  )

  const selectedEmployeeState =
    (uiState.selectedEmployeeId != null ? employeeStateMap.get(uiState.selectedEmployeeId) : null) ?? null

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

  const totalPages = Math.max(1, Math.ceil((overview?.total ?? 0) / appliedFilters.limit))
  const appliedDayRange = dayCountForRange(appliedFilters.start_date, appliedFilters.end_date)
  const hasOverviewData = Boolean(overview)
  const showFocusMode = uiState.screenMode === 'focus' && uiState.selectedEmployeeId != null
  const filterTags = useMemo(
    () => activeFilterEntries(appliedFilters, uiState.quickFilters),
    [appliedFilters, uiState.quickFilters],
  )

  useEffect(() => {
    if (!isMobile && uiState.mobileTab === 'detail' && uiState.detailEmployeeId == null) {
      dispatch({ type: 'setMobileTab', value: showFocusMode ? 'map' : 'feed' })
    }
  }, [isMobile, showFocusMode, uiState.detailEmployeeId, uiState.mobileTab])

  const handleApplyFilters = () => {
    setAppliedFilters(draftFilters)
    dispatch({ type: 'setPage', value: 1 })
    setFiltersOpen(false)
  }

  const handleResetFilters = () => {
    const next = defaultFilters()
    setDraftFilters(next)
    setAppliedFilters(next)
    dispatch({ type: 'setPage', value: 1 })
  }

  const handleSort = (field: SortField) => {
    const nextSortDir: FilterFormState['sort_dir'] =
      appliedFilters.sort_by === field ? (appliedFilters.sort_dir === 'asc' ? 'desc' : 'asc') : 'desc'

    const nextFilters = {
      ...appliedFilters,
      sort_by: field,
      sort_dir: nextSortDir,
    }

    setDraftFilters(nextFilters)
    setAppliedFilters(nextFilters)
    dispatch({ type: 'setPage', value: 1 })
  }

  const renderDesktopOverview = () => (
    <>
      {overview?.summary ? <ManagementConsoleKpiCards summary={overview.summary} /> : null}

      <section className="cr-ops-grid">
        <article className="cr-ops-map-card">
          <header className="cr-ops-section-head">
            <div>
              <p className="cr-ops-kicker">Overview map</p>
              <h3>Coklu calisan saha gorunumu</h3>
            </div>
            <div className="cr-ops-section-meta">
              <span>{mapPoints.length} marker</span>
              <span>{appliedDayRange} gun</span>
              <span>Polyline kapali</span>
            </div>
          </header>
          {mapPoints.length ? (
            <ControlRoomOverviewMap
              points={mapPoints}
              selectedEmployeeId={uiState.selectedEmployeeId}
              onSelectEmployee={(employeeId) =>
                dispatch({
                  type: 'focusEmployee',
                  employeeId,
                  mobileTab: 'map',
                })
              }
              onOpenEmployeeDetail={(employeeId) => dispatch({ type: 'openDetail', employeeId })}
            />
          ) : (
            <div className="cr-feed-empty">Haritada gosterilecek aktif konum noktasi yok.</div>
          )}
        </article>

        <div className="cr-ops-rail">
          <ControlRoomPriorityQueue
            items={priorityQueue}
            selectedEmployeeId={uiState.selectedEmployeeId}
            onSelectEmployee={(employeeId) =>
              dispatch({
                type: 'focusEmployee',
                employeeId,
                mobileTab: 'map',
              })
            }
            onOpenEmployeeDetail={(employeeId) => dispatch({ type: 'openDetail', employeeId })}
          />
          <SelectedEmployeeBrief
            employee={selectedEmployeeState}
            onFocus={() =>
              uiState.selectedEmployeeId != null
                ? dispatch({
                    type: 'focusEmployee',
                    employeeId: uiState.selectedEmployeeId,
                    mobileTab: 'map',
                  })
                : undefined
            }
            onOpenDetail={() => {
              if (uiState.selectedEmployeeId != null) {
                dispatch({ type: 'openDetail', employeeId: uiState.selectedEmployeeId })
              }
            }}
          />
        </div>
      </section>

      <section className="cr-ops-secondary-grid">
        <article className="min-w-0">
          <ManagementConsoleMatrixTable
            items={overview?.items ?? []}
            total={overview?.total ?? 0}
            page={uiState.page}
            totalPages={totalPages}
            filters={appliedFilters}
            onSort={handleSort}
            onOpenEmployee={(employeeId) =>
              dispatch({
                type: 'focusEmployee',
                employeeId,
                mobileTab: 'map',
              })
            }
            selectedEmployeeId={uiState.selectedEmployeeId}
            onPageChange={(page) => dispatch({ type: 'setPage', value: page })}
          />
        </article>

        <ControlRoomEventFeed
          events={recentEvents}
          employeeStates={employeeStateMap}
          selectedEventId={uiState.selectedEventId}
          onSelectEvent={(employeeId, eventId) =>
            dispatch({
              type: 'focusEmployee',
              employeeId,
              eventId,
              mobileTab: 'map',
            })
          }
          onPinToMap={(employeeId, eventId) =>
            dispatch({
              type: 'showEmployeeOnMap',
              employeeId,
              eventId,
            })
          }
          onOpenEmployeeDetail={(employeeId) => dispatch({ type: 'openDetail', employeeId })}
        />
      </section>
    </>
  )

  const renderMobileOverviewContent = (): ReactNode => {
    if (uiState.mobileTab === 'map') {
      return (
        <section className="cr-mobile-tab-shell">
          <article className="cr-ops-map-card">
            <header className="cr-ops-section-head">
              <div>
                <p className="cr-ops-kicker">Overview map</p>
                <h3>Saha dagilimi</h3>
              </div>
              <div className="cr-ops-section-meta">
                <span>{mapPoints.length} marker</span>
                <span>Polyline yok</span>
              </div>
            </header>
            {mapPoints.length ? (
              <ControlRoomOverviewMap
                points={mapPoints}
                selectedEmployeeId={uiState.selectedEmployeeId}
                onSelectEmployee={(employeeId) =>
                  dispatch({
                    type: 'focusEmployee',
                    employeeId,
                    mobileTab: 'map',
                  })
                }
                onOpenEmployeeDetail={(employeeId) => dispatch({ type: 'openDetail', employeeId })}
              />
            ) : (
              <div className="cr-feed-empty">Haritada gosterilecek aktif konum yok.</div>
            )}
          </article>
        </section>
      )
    }

    if (uiState.mobileTab === 'queue') {
      return (
        <section className="cr-mobile-tab-shell">
          <ControlRoomPriorityQueue
            items={priorityQueue}
            selectedEmployeeId={uiState.selectedEmployeeId}
            onSelectEmployee={(employeeId) =>
              dispatch({
                type: 'focusEmployee',
                employeeId,
                mobileTab: 'map',
              })
            }
            onOpenEmployeeDetail={(employeeId) => dispatch({ type: 'openDetail', employeeId })}
          />
          <SelectedEmployeeBrief
            employee={selectedEmployeeState}
            onFocus={() => {
              if (uiState.selectedEmployeeId != null) {
                dispatch({
                  type: 'focusEmployee',
                  employeeId: uiState.selectedEmployeeId,
                  mobileTab: 'map',
                })
              }
            }}
            onOpenDetail={() => {
              if (uiState.selectedEmployeeId != null) {
                dispatch({ type: 'openDetail', employeeId: uiState.selectedEmployeeId })
              }
            }}
          />
        </section>
      )
    }

    if (uiState.mobileTab === 'detail') {
      return (
        <section className="cr-mobile-tab-shell">
          <SelectedEmployeeBrief
            employee={selectedEmployeeState}
            onFocus={() => {
              if (uiState.selectedEmployeeId != null) {
                dispatch({
                  type: 'focusEmployee',
                  employeeId: uiState.selectedEmployeeId,
                  mobileTab: 'map',
                })
              }
            }}
            onOpenDetail={() => {
              if (uiState.selectedEmployeeId != null) {
                dispatch({ type: 'openDetail', employeeId: uiState.selectedEmployeeId })
              }
            }}
          />
        </section>
      )
    }

    return (
      <section className="cr-mobile-tab-shell">
        {overview?.summary ? (
          <div className="cr-mobile-snapshot">
            <article>
              <span>Aktif</span>
              <strong>{overview.summary.active_employees}</strong>
            </article>
            <article>
              <span>Kritik</span>
              <strong>{overview.summary.critical_count}</strong>
            </article>
            <article>
              <span>Izlemeli</span>
              <strong>{overview.summary.watch_count}</strong>
            </article>
            <article>
              <span>Canli</span>
              <strong>{mapPoints.length}</strong>
            </article>
          </div>
        ) : null}

        <ControlRoomEventFeed
          events={recentEvents}
          employeeStates={employeeStateMap}
          selectedEventId={uiState.selectedEventId}
          onSelectEvent={(employeeId, eventId) =>
            dispatch({
              type: 'focusEmployee',
              employeeId,
              eventId,
              mobileTab: 'map',
            })
          }
          onPinToMap={(employeeId, eventId) =>
            dispatch({
              type: 'showEmployeeOnMap',
              employeeId,
              eventId,
            })
          }
          onOpenEmployeeDetail={(employeeId) => dispatch({ type: 'openDetail', employeeId })}
        />
      </section>
    )
  }

  return (
    <div className="cr-ops-page">
      <PageHeader
        title="Employee Intelligence Control Room"
        description="Overview modunda coklu calisan haritasi, event feed ve oncelik kuyrugu; focus modunda tek calisan rota izi, timeline ve dossier akisi ayni kontrol merkezinde birlestirildi."
        action={
          <div className="cr-ops-header-actions">
            <button
              type="button"
              className={`cr-ops-mode-toggle ${uiState.screenMode === 'overview' ? 'is-active' : ''}`}
              onClick={() => dispatch({ type: 'returnOverview' })}
            >
              Overview
            </button>
            <button
              type="button"
              className={`cr-ops-mode-toggle ${showFocusMode ? 'is-active' : ''}`}
              onClick={() => {
                if (uiState.selectedEmployeeId != null) {
                  dispatch({
                    type: 'focusEmployee',
                    employeeId: uiState.selectedEmployeeId,
                    mobileTab: 'map',
                  })
                }
              }}
              disabled={uiState.selectedEmployeeId == null}
            >
              Focus
            </button>
            <button
              type="button"
              className="cr-ops-action"
              onClick={() => void overviewQuery.refetch()}
            >
              Veriyi yenile
            </button>
            <button
              type="button"
              className="cr-ops-action is-secondary"
              onClick={() => setFiltersOpen(true)}
            >
              Filtreler
            </button>
          </div>
        }
      />

      <section className="cr-ops-command-bar">
        <div className="cr-ops-command-bar__identity">
          <div>
            <p className="cr-ops-kicker">Operasyon gorunumu</p>
            <h2>{showFocusMode ? 'Secili calisan rota odagi' : 'Canli overview'}</h2>
            <p>
              {showFocusMode && uiState.selectedEmployeeId != null
                ? `Focus personeli #${uiState.selectedEmployeeId} icin rota, timeline ve gunluk kayit akiyor.`
                : `Kisi secmeden veri yuklu; ${appliedDayRange} gunluk pencere ve ${rangeLabel(appliedFilters.start_date, appliedFilters.end_date)} aktif.`}
            </p>
          </div>
          <div className="cr-ops-command-bar__badges">
            <span className="cr-ops-inline-badge">Default: overview</span>
            <span className="cr-ops-inline-badge">Multi map: polyline kapali</span>
            {overview?.generated_at_utc ? (
              <span className="cr-ops-inline-badge">Son sync {formatDateTime(overview.generated_at_utc)}</span>
            ) : null}
          </div>
        </div>

        <div className="cr-ops-command-bar__filters">
          <label className="cr-ops-field">
            <span>Arama</span>
            <input
              value={draftFilters.q}
              onChange={(event) => setDraftFilters((current) => ({ ...current, q: event.target.value }))}
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

      {overviewQuery.isPending && !hasOverviewData && !showFocusMode ? (
        <LoadingBlock label="Overview control room verisi hazirlaniyor..." />
      ) : null}

      {overviewQuery.isError && !hasOverviewData && !showFocusMode ? (
        <section className="cr-ops-error">
          <ErrorBlock message="Control room overview verisi yuklenemedi." />
          <button type="button" className="cr-ops-action" onClick={() => void overviewQuery.refetch()}>
            Tekrar dene
          </button>
        </section>
      ) : null}

      {showFocusMode && uiState.selectedEmployeeId != null ? (
        <ControlRoomFocusPanel
          employeeId={uiState.selectedEmployeeId}
          startDate={appliedFilters.start_date}
          endDate={appliedFilters.end_date}
          mobileTab={uiState.mobileTab}
          selectedEmployeeState={selectedEmployeeState}
          onReturnToOverview={() => dispatch({ type: 'returnOverview' })}
          onOpenEmployeeDetail={(employeeId) => dispatch({ type: 'openDetail', employeeId })}
        />
      ) : hasOverviewData ? (
        <>
          {!isMobile ? renderDesktopOverview() : renderMobileOverviewContent()}
          {isMobile ? (
            <nav className="cr-ops-mobile-nav" aria-label="Mobile control room navigation">
              {(['feed', 'map', 'queue', 'detail'] as MobileTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={uiState.mobileTab === tab ? 'is-active' : ''}
                  onClick={() => dispatch({ type: 'setMobileTab', value: tab })}
                >
                  {tab === 'feed'
                    ? 'Feed'
                    : tab === 'map'
                      ? 'Map'
                      : tab === 'queue'
                        ? 'Queue'
                        : 'Detail'}
                </button>
              ))}
            </nav>
          ) : null}
        </>
      ) : null}

      {!isMobile ? (
        <div className={`cr-ops-filters-desktop ${filtersOpen ? 'is-open' : ''}`}>
          {filtersOpen ? (
            <ManagementConsoleFilters
              filterForm={draftFilters}
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
          title="Tam filtre ayarlari"
          onClose={() => setFiltersOpen(false)}
        >
          <ManagementConsoleFilters
            filterForm={draftFilters}
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
        employeeId={uiState.detailEmployeeId}
        open={uiState.detailEmployeeId != null}
        onClose={() => dispatch({ type: 'closeDetail' })}
        placement="right"
      />
    </div>
  )
}
