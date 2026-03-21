import { useEffect, useMemo, useState } from 'react'

import type { ControlRoomEmployeeState, ControlRoomRecentEvent } from '../../types/api'
import {
  controlRoomLocationLabel,
  controlRoomRiskLabel,
  eventSeverity,
  eventSeverityLabel,
  eventSignalLabel,
  eventWhyImportant,
  formatDateTime,
  formatRelative,
} from './utils'

function severityStripeClass(value: 'critical' | 'watch' | 'info'): string {
  if (value === 'critical') return 'is-critical'
  if (value === 'watch') return 'is-watch'
  return 'is-live'
}

export function ControlRoomEventFeed({
  events,
  employeeStates,
  selectedEventId,
  onSelectEvent,
  onPinToMap,
  onOpenEmployeeDetail,
  initialVisibleCount,
  incrementCount = 10,
  scrollable = false,
  hideHeader = false,
}: {
  events: ControlRoomRecentEvent[]
  employeeStates: Map<number, ControlRoomEmployeeState>
  selectedEventId: number | null
  onSelectEvent: (employeeId: number, eventId: number) => void
  onPinToMap: (employeeId: number, eventId: number) => void
  onOpenEmployeeDetail: (employeeId: number) => void
  initialVisibleCount?: number
  incrementCount?: number
  scrollable?: boolean
  hideHeader?: boolean
}) {
  const [visibleCount, setVisibleCount] = useState(initialVisibleCount ?? events.length)

  useEffect(() => {
    setVisibleCount(initialVisibleCount ?? events.length)
  }, [events, initialVisibleCount])

  const visibleEvents = useMemo(
    () => events.slice(0, visibleCount),
    [events, visibleCount],
  )

  return (
    <section className="cr-feed-panel">
      {!hideHeader ? (
        <header className="cr-feed-panel__header">
          <div>
            <p className="cr-ops-kicker">Canli olay akisi</p>
            <h3>Event feed</h3>
          </div>
          <span className="cr-feed-panel__count">
            {visibleEvents.length === events.length ? events.length : `${visibleEvents.length} / ${events.length}`} kayit
          </span>
        </header>
      ) : null}

      <div className={`cr-feed-list ${scrollable ? 'is-scrollable' : ''}`}>
        {visibleEvents.length ? (
          visibleEvents.map((event) => {
            const employeeState = employeeStates.get(event.employee_id) ?? null
            const severity = eventSeverity(event, employeeState)

            return (
              <article
                key={event.event_id}
                className={`cr-feed-card ${selectedEventId === event.event_id ? 'is-selected' : ''}`}
              >
                <button
                  type="button"
                  className="cr-feed-card__main"
                  onClick={() => onSelectEvent(event.employee_id, event.event_id)}
                >
                  <span className={`cr-feed-card__stripe ${severityStripeClass(severity)}`} aria-hidden="true" />
                  <div className="cr-feed-card__body">
                    <div className="cr-feed-card__head">
                      <strong>{event.employee_name}</strong>
                      <time dateTime={event.ts_utc}>{formatRelative(event.ts_utc)}</time>
                    </div>
                    <div className="cr-feed-card__signal">{eventSignalLabel(event)}</div>
                    <div className="cr-feed-card__meta">
                      <span>{eventSeverityLabel(severity)}</span>
                      <span>
                        {employeeState
                          ? `${controlRoomRiskLabel(employeeState.risk_status)} / ${controlRoomLocationLabel(employeeState.location_state)}`
                          : 'Operasyon sinyali'}
                      </span>
                    </div>
                    <p className="cr-feed-card__why">{eventWhyImportant(event, employeeState)}</p>
                    <div className="cr-feed-card__stamp">{formatDateTime(event.ts_utc)}</div>
                  </div>
                </button>

                <div className="cr-feed-card__actions">
                  <button
                    type="button"
                    onClick={() => onPinToMap(event.employee_id, event.event_id)}
                  >
                    Haritada ac
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenEmployeeDetail(event.employee_id)}
                  >
                    Dosyayi ac
                  </button>
                </div>
              </article>
            )
          })
        ) : (
          <div className="cr-feed-empty">Secili kapsam icin yeni event yok.</div>
        )}
      </div>

      {events.length > visibleEvents.length ? (
        <div className="cr-feed-panel__footer">
          <button
            type="button"
            className="cr-feed-panel__more"
            onClick={() => setVisibleCount((current) => Math.min(events.length, current + incrementCount))}
          >
            Daha fazla olay goster
          </button>
        </div>
      ) : null}
    </section>
  )
}
