import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'

import {
  getLocationMonitorEmployeeMapPoints,
  getLocationMonitorEmployeeSummary,
  getLocationMonitorEmployeeTimelineEvents,
} from '../../api/admin'
import { ErrorBlock } from '../ErrorBlock'
import { LoadingBlock } from '../LoadingBlock'
import { MinuteDisplay } from '../MinuteDisplay'
import { LocationMonitorMap } from '../location-monitor/LocationMonitorMap'
import type {
  ControlRoomEmployeeState,
  LocationMonitorDayRecord,
  LocationMonitorPointSource,
  LocationMonitorTimelineEvent,
  LocationStatus,
  LocationTrustStatus,
  LocationGeofenceStatus,
} from '../../types/api'
import { controlRoomQueryKeys } from './queryKeys'
import {
  ALL_SOURCES,
  SOURCE_OPTIONS,
  dayStatusLabel,
  formatClock,
  formatCoordinates,
  formatDateTime,
  formatDay,
  formatDistance,
  geofenceTone,
  insightTone,
  latestAvailablePoint,
  locationStatusTone,
  pickInsightValue,
  pointSourceLabel,
  trustTone,
} from './utils'

const INITIAL_EVENT_RENDER_COUNT = 10
const INITIAL_DAY_RENDER_COUNT = 10

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
    <article className="cr-focus-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </article>
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

function buildEventSummary(event: LocationMonitorTimelineEvent): string {
  const parts = [pointSourceLabel(event.source)]
  if (event.accuracy_m != null) {
    parts.push(`Dogruluk ${Math.round(event.accuracy_m)} m`)
  }
  if (event.provider) {
    parts.push(event.provider)
  }
  return parts.join(' / ')
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
    <article className={`cr-focus-event ${selected ? 'is-selected' : ''}`}>
      <div className="cr-focus-event__head">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="truncate text-sm">{event.label}</strong>
            <Pill className={locationStatusTone(event.location_status)}>
              {event.location_status ?? 'NO_LOCATION'}
            </Pill>
          </div>
          <p className="cr-focus-event__summary">{buildEventSummary(event)}</p>
        </div>
        <div className="cr-focus-event__time">
          <div>{formatClock(event.ts_utc)}</div>
          <div>{formatDay(event.day)}</div>
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

      <div className="cr-focus-event__actions">
        <button type="button" onClick={onFocus}>
          Haritada odakla
        </button>
        <button type="button" onClick={onToggleExpanded}>
          {expanded ? 'Detayi gizle' : 'Detayi goster'}
        </button>
      </div>

      {expanded ? (
        <div className="cr-focus-event__detail">
          <div>
            <span>Zaman</span>
            <strong>{formatDateTime(event.ts_utc)}</strong>
          </div>
          <div>
            <span>Konum</span>
            <strong>{formatCoordinates(event.lat, event.lon)}</strong>
          </div>
          <div>
            <span>Cihaz / IP</span>
            <strong>
              {event.device_id == null ? '-' : `#${event.device_id}`} / {event.ip ?? '-'}
            </strong>
          </div>
          <div>
            <span>Provider</span>
            <strong>{event.provider ?? '-'}</strong>
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
    <article className={`cr-focus-day ${selected ? 'is-selected' : ''}`}>
      <div className="cr-focus-day__head">
        <div>
          <strong>{formatDay(day.date)}</strong>
          <p>{dayStatusLabel(day.status)}</p>
        </div>
        <span>{day.event_count} olay</span>
      </div>

      <div className="cr-focus-day__metrics">
        <span>
          Giris <strong>{formatClock(day.check_in)}</strong>
        </span>
        <span>
          Cikis <strong>{formatClock(day.check_out)}</strong>
        </span>
        <span>
          Calisilan <strong><MinuteDisplay minutes={day.worked_minutes} /></strong>
        </span>
        <span>
          Fazla <strong><MinuteDisplay minutes={day.overtime_minutes} /></strong>
        </span>
      </div>

      <div className="cr-focus-day__actions">
        <button type="button" onClick={onSelect}>
          {selected ? 'Secili gun' : 'Haritada ac'}
        </button>
        <button type="button" onClick={onToggleExpanded}>
          {expanded ? 'Detayi gizle' : 'Detayi goster'}
        </button>
      </div>

      {expanded ? (
        <div className="cr-focus-day__detail">
          <div>
            <span>Demo</span>
            <strong>
              {formatClock(day.first_demo_start_utc)} / {formatClock(day.last_demo_end_utc)}
            </strong>
          </div>
          <div>
            <span>App</span>
            <strong>
              {formatClock(day.first_app_open_utc)} / {formatClock(day.last_app_close_utc)}
            </strong>
          </div>
          <div>
            <span>Supheli sicrama</span>
            <strong>{day.suspicious_jump_count}</strong>
          </div>
          <div>
            <span>Dusuk dogruluk</span>
            <strong>{day.low_accuracy_count}</strong>
          </div>
          {lastPoint ? (
            <div className="cr-focus-day__detail-wide">
              <span>Son nokta</span>
              <strong>
                {pointSourceLabel(lastPoint.source)} / {formatCoordinates(lastPoint.lat, lastPoint.lon)}
              </strong>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

function renderSignalPills({
  locationStatus,
  trustStatus,
  geofenceStatus,
}: {
  locationStatus: LocationStatus | null
  trustStatus: LocationTrustStatus | null
  geofenceStatus: LocationGeofenceStatus | null
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Pill className={locationStatusTone(locationStatus)}>{locationStatus ?? 'NO_LOCATION'}</Pill>
      <Pill className={trustTone(trustStatus)}>Trust {trustStatus ?? 'NO_DATA'}</Pill>
      <Pill className={geofenceTone(geofenceStatus)}>{geofenceStatus ?? 'UNKNOWN'}</Pill>
    </div>
  )
}

export function ControlRoomFocusPanel({
  employeeId,
  startDate,
  endDate,
  mobileTab,
  selectedEmployeeState,
  onReturnToOverview,
  onOpenEmployeeDetail,
}: {
  employeeId: number
  startDate: string
  endDate: string
  mobileTab: 'feed' | 'map' | 'queue' | 'detail'
  selectedEmployeeState: ControlRoomEmployeeState | null
  onReturnToOverview: () => void
  onOpenEmployeeDetail: (employeeId: number) => void
}) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [focusedPointId, setFocusedPointId] = useState<string | null>(null)
  const [enabledSources, setEnabledSources] = useState<LocationMonitorPointSource[]>(ALL_SOURCES)
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null)
  const [expandedDayId, setExpandedDayId] = useState<string | null>(null)
  const [visibleEventCount, setVisibleEventCount] = useState(INITIAL_EVENT_RENDER_COUNT)
  const [visibleDayCount, setVisibleDayCount] = useState(INITIAL_DAY_RENDER_COUNT)
  const [showAllInsights, setShowAllInsights] = useState(false)

  const summaryQuery = useQuery({
    queryKey: controlRoomQueryKeys.focusSummary(employeeId, {
      start_date: startDate,
      end_date: endDate,
    }),
    queryFn: () =>
      getLocationMonitorEmployeeSummary(employeeId, {
        start_date: startDate,
        end_date: endDate,
      }),
    staleTime: 30_000,
    placeholderData: (previousData) => previousData,
  })

  const timelineQuery = useQuery({
    queryKey: controlRoomQueryKeys.focusTimeline(employeeId, {
      start_date: startDate,
      end_date: endDate,
      day: selectedDay ?? undefined,
      latest_only: selectedDay == null,
    }),
    queryFn: () =>
      getLocationMonitorEmployeeTimelineEvents(employeeId, {
        start_date: startDate,
        end_date: endDate,
        day: selectedDay ?? undefined,
        latest_only: selectedDay == null,
      }),
    staleTime: 20_000,
    placeholderData: (previousData) => previousData,
  })

  const mapQuery = useQuery({
    queryKey: controlRoomQueryKeys.focusMap(employeeId, {
      start_date: startDate,
      end_date: endDate,
      day: selectedDay ?? undefined,
      latest_only: selectedDay == null,
      source: enabledSources.length === ALL_SOURCES.length ? undefined : enabledSources,
    }),
    queryFn: () =>
      getLocationMonitorEmployeeMapPoints(employeeId, {
        start_date: startDate,
        end_date: endDate,
        day: selectedDay ?? undefined,
        latest_only: selectedDay == null,
        source: enabledSources.length === ALL_SOURCES.length ? undefined : enabledSources,
      }),
    staleTime: 20_000,
    placeholderData: (previousData) => previousData,
  })

  useEffect(() => {
    setSelectedDay(null)
    setFocusedPointId(null)
    setExpandedEventId(null)
    setExpandedDayId(null)
    setVisibleEventCount(INITIAL_EVENT_RENDER_COUNT)
    setVisibleDayCount(INITIAL_DAY_RENDER_COUNT)
    setShowAllInsights(false)
    setEnabledSources(ALL_SOURCES)
  }, [employeeId, endDate, startDate])

  const summary = summaryQuery.data?.summary ?? null
  const mapData = mapQuery.data ?? null
  const timelineData = timelineQuery.data ?? null
  const timelineDays = timelineData?.days ?? []
  const insights = summaryQuery.data?.insights ?? []

  useEffect(() => {
    if (!selectedDay) return
    const exists = timelineDays.some((day) => day.date === selectedDay)
    if (!exists) {
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

  const isLoading =
    (!summaryQuery.data || !timelineQuery.data || !mapQuery.data) &&
    (summaryQuery.isPending || timelineQuery.isPending || mapQuery.isPending)

  const hasError = summaryQuery.isError || timelineQuery.isError || mapQuery.isError

  const toggleSource = (value: LocationMonitorPointSource) => {
    setEnabledSources((current) => {
      if (current.includes(value)) {
        const next = current.filter((item) => item !== value)
        return next.length ? next : current
      }
      return [...current, value]
    })
  }

  if (isLoading) {
    return <LoadingBlock label="Focus rota verisi hazirlaniyor..." />
  }

  if (hasError || !summary || !mapData || !timelineData) {
    return <ErrorBlock message="Calisan focus verisi yuklenemedi." />
  }

  const focusHeader = (
    <section className="cr-focus-header">
      <div className="cr-focus-header__copy">
        <p className="cr-ops-kicker">Focus mode</p>
        <h3>{summary.employee.full_name}</h3>
        <p>
          {selectedEmployeeState?.department_name ?? summary.department_name ?? 'Departman tanimsiz'} /{' '}
          {selectedEmployeeState?.shift_window_label ?? summary.shift_name ?? 'Plan penceresi yok'}
        </p>
        {renderSignalPills({
          locationStatus: summary.last_location_status,
          trustStatus: summary.last_trust_status,
          geofenceStatus: summary.last_geofence_status,
        })}
      </div>
      <div className="cr-focus-header__actions">
        <button type="button" onClick={() => onReturnToOverview()}>
          Overview'a don
        </button>
        <button type="button" onClick={() => onOpenEmployeeDetail(employeeId)}>
          Dosyayi ac
        </button>
      </div>
    </section>
  )

  const focusMapSection = (
    <section className="cr-focus-section">
      <header className="cr-focus-section__header">
        <div>
          <p className="cr-ops-kicker">Rota haritasi</p>
          <h4>{effectiveSelectedDay ? `${formatDay(effectiveSelectedDay)} rota izi` : 'Rota izi'}</h4>
        </div>
        <div className="cr-focus-section__meta">
          <span>{mapData.route_stats.event_count} nokta</span>
          <span>{formatDistance(mapData.route_stats.total_distance_m)}</span>
        </div>
      </header>

      <div className="cr-focus-chip-row">
        <button
          type="button"
          onClick={() => {
            setSelectedDay(null)
            setFocusedPointId(null)
          }}
          className={selectedDay == null ? 'is-active' : ''}
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
            className={effectiveSelectedDay === day.date ? 'is-active' : ''}
          >
            {formatDay(day.date)}
          </button>
        ))}
      </div>

      <div className="cr-focus-chip-row is-secondary">
        {SOURCE_OPTIONS.map((option) => {
          const active = enabledSources.includes(option.value)
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => toggleSource(option.value)}
              className={active ? 'is-active' : ''}
            >
              {option.label}
            </button>
          )
        })}
      </div>

      <div className="cr-focus-metric-grid">
        <MetricTile
          label="Rota sure"
          value={<MinuteDisplay minutes={mapData.route_stats.total_duration_minutes} />}
        />
        <MetricTile label="Sadelestirilmis" value={`${mapData.route_stats.simplified_point_count} nokta`} />
        <MetricTile label="Bekleme noktasi" value={mapData.route_stats.dwell_stop_count} />
        <MetricTile label="Gorunen nokta" value={visibleMapPoints.length} />
      </div>

      <div className="cr-focus-map-shell">
        <LocationMonitorMap
          points={visibleMapPoints}
          simplifiedPoints={visibleSimplifiedPoints}
          repeatedGroups={mapData.repeated_groups}
          geofence={summaryQuery.data?.geofence ?? null}
          focusedPointId={highlightedPoint?.id ?? null}
          className="h-[20rem] sm:h-[24rem] xl:h-[30rem]"
        />
      </div>
    </section>
  )

  const focusInsightSection = (
    <aside className="cr-focus-side">
      <section className="cr-focus-section">
        <header className="cr-focus-section__header">
          <div>
            <p className="cr-ops-kicker">Analitik ozet</p>
            <h4>Risk ve uyum sinyali</h4>
          </div>
          <span className="cr-focus-section__pill">{insights.length}</span>
        </header>

        <div className="cr-focus-insight-list">
          {renderedInsights.length ? (
            renderedInsights.map((insight) => (
              <article key={insight.code} className={`cr-focus-insight ${insightTone(insight.severity)}`}>
                <div className="cr-focus-insight__head">
                  <strong>{insight.title}</strong>
                  <span>{insight.value ?? '-'}</span>
                </div>
                <p>{insight.message}</p>
              </article>
            ))
          ) : (
            <div className="cr-feed-empty">Secili aralikta yorumlanabilir sinyal bulunmuyor.</div>
          )}
        </div>

        {insights.length > 3 ? (
          <button type="button" className="cr-focus-link" onClick={() => setShowAllInsights((current) => !current)}>
            {showAllInsights ? 'Daha az goster' : 'Tumunu goster'}
          </button>
        ) : null}
      </section>

      <section className="cr-focus-section">
        <header className="cr-focus-section__header">
          <div>
            <p className="cr-ops-kicker">Odak noktasi</p>
            <h4>{highlightedPoint ? highlightedPoint.label : 'Nokta secilmedi'}</h4>
          </div>
        </header>

        <div className="cr-focus-metric-stack">
          <MetricTile label="Kaynak" value={highlightedPoint ? pointSourceLabel(highlightedPoint.source) : '-'} />
          <MetricTile label="Saat" value={highlightedPoint ? formatDateTime(highlightedPoint.ts_utc) : '-'} />
          <MetricTile
            label="Konum"
            value={highlightedPoint ? formatCoordinates(highlightedPoint.lat, highlightedPoint.lon) : '-'}
          />
          <MetricTile
            label="Risk ozet"
            value={
              <>
                {geofenceViolationCount ?? 0} geofence / {suspiciousJumpCount ?? 0} sicrama
              </>
            }
            detail={lowAccuracyRatio == null ? undefined : `Dusuk dogruluk %${lowAccuracyRatio}`}
          />
        </div>
      </section>
    </aside>
  )

  const focusFeedSection = (
    <div className="cr-focus-timeline-shell">
      <section className="cr-focus-section">
        <header className="cr-focus-section__header">
          <div>
            <p className="cr-ops-kicker">Timeline</p>
            <h4>{effectiveSelectedDay ? `${formatDay(effectiveSelectedDay)} olay akisi` : 'Olay akisi'}</h4>
          </div>
          <span className="cr-focus-section__pill">{visibleTimelineEvents.length} olay</span>
        </header>

        <div className="cr-focus-event-list">
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
            <div className="cr-feed-empty">Secili gorunumde olay bulunmuyor.</div>
          )}
        </div>

        {visibleTimelineEvents.length > renderedEvents.length ? (
          <button
            type="button"
            className="cr-focus-link"
            onClick={() => setVisibleEventCount((current) => current + INITIAL_EVENT_RENDER_COUNT)}
          >
            Daha fazla olay goster
          </button>
        ) : null}
      </section>

      <section className="cr-focus-section">
        <header className="cr-focus-section__header">
          <div>
            <p className="cr-ops-kicker">Gunluk kayit</p>
            <h4>Attendance ve fazla mesai</h4>
          </div>
          <span className="cr-focus-section__pill">{timelineDays.length} gun</span>
        </header>

        <div className="cr-focus-day-list">
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
            <div className="cr-feed-empty">Bu aralikta gunluk kayit bulunmuyor.</div>
          )}
        </div>

        {timelineDays.length > renderedDays.length ? (
          <button
            type="button"
            className="cr-focus-link"
            onClick={() => setVisibleDayCount((current) => current + INITIAL_DAY_RENDER_COUNT)}
          >
            Daha fazla gun goster
          </button>
        ) : null}
      </section>
    </div>
  )

  const mobileDetail = (
    <section className="cr-focus-section">
      <header className="cr-focus-section__header">
        <div>
          <p className="cr-ops-kicker">Intelligence brief</p>
          <h4>Kimlik, risk posture ve aksiyon</h4>
        </div>
      </header>

      <div className="cr-focus-metric-grid">
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
          detail={
            <>
              <MinuteDisplay minutes={summary.weekly_total_minutes} /> hafta
            </>
          }
        />
      </div>

      <div className="cr-focus-detail-actions">
        <button type="button" onClick={() => onOpenEmployeeDetail(employeeId)}>
          Tum dosyayi ac
        </button>
        <button type="button" onClick={() => onReturnToOverview()}>
          Overview'a don
        </button>
      </div>
    </section>
  )

  const isMobileMap = mobileTab === 'map'
  const isMobileDetail = mobileTab === 'detail'

  return (
    <div className="cr-focus-page">
      {focusHeader}

      <section className="cr-focus-summary-grid">
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
          detail={
            <>
              <MinuteDisplay minutes={summary.weekly_total_minutes} /> hafta
            </>
          }
        />
      </section>

      <div className="hidden lg:grid lg:grid-cols-[minmax(0,1.55fr)_22rem] lg:gap-4">
        {focusMapSection}
        {focusInsightSection}
      </div>

      <div className="hidden lg:block">{focusFeedSection}</div>

      <div className="space-y-4 lg:hidden">
        {isMobileMap ? (
          <>
            {focusMapSection}
            {focusInsightSection}
          </>
        ) : isMobileDetail ? (
          mobileDetail
        ) : (
          focusFeedSection
        )}
      </div>
    </div>
  )
}
