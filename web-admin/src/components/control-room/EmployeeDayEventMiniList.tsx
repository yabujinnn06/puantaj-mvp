import type { LocationMonitorTimelineEvent } from '../../types/api'
import { formatClock, locationStatusLabel, pointSourceLabel } from './utils'

function eventTone(event: LocationMonitorTimelineEvent): 'critical' | 'watch' | 'verified' | 'neutral' {
  if (
    event.location_status === 'SUSPICIOUS_JUMP' ||
    event.location_status === 'MOCK_GPS_SUSPECTED' ||
    event.location_status === 'OUTSIDE_GEOFENCE' ||
    event.geofence_status === 'OUTSIDE'
  ) {
    return 'critical'
  }
  if (
    event.location_status === 'LOW_ACCURACY' ||
    event.location_status === 'STALE_LOCATION' ||
    event.location_status === 'UNVERIFIED_LOCATION' ||
    event.trust_status === 'LOW' ||
    event.trust_status === 'SUSPICIOUS'
  ) {
    return 'watch'
  }
  if (
    event.location_status === 'VERIFIED' ||
    event.location_status === 'VERIFIED_HOME' ||
    event.location_status === 'INSIDE_GEOFENCE' ||
    event.geofence_status === 'INSIDE' ||
    event.trust_status === 'HIGH'
  ) {
    return 'verified'
  }
  return 'neutral'
}

function eventStatusLabel(event: LocationMonitorTimelineEvent): string {
  if (event.location_status) return locationStatusLabel(event.location_status)
  if (event.geofence_status === 'OUTSIDE') return 'Geofence disi'
  if (event.geofence_status === 'INSIDE') return 'Geofence ici'
  if (event.trust_status === 'HIGH') return 'Guvenilir'
  if (event.trust_status === 'MEDIUM') return 'Izleniyor'
  if (event.trust_status === 'LOW' || event.trust_status === 'SUSPICIOUS') return 'Şüpheli'
  return pointSourceLabel(event.source)
}

function eventSummary(event: LocationMonitorTimelineEvent): string {
  if (event.location_status === 'SUSPICIOUS_JUMP') {
    return 'Şüpheli sicrama deseni kaydedildi.'
  }
  if (event.location_status === 'MOCK_GPS_SUSPECTED') {
    return 'Konum kaynagi manipule görünüyor.'
  }
  if (event.location_status === 'OUTSIDE_GEOFENCE' || event.geofence_status === 'OUTSIDE') {
    return 'Beklenen alan disinda sinyal alındı.'
  }
  if (event.location_status === 'LOW_ACCURACY') {
    return 'Konum kalitesi düşük oldugu için kontrol edilmeli.'
  }
  if (event.location_status === 'STALE_LOCATION') {
    return 'Konum sinyali gecikmeli ulasmis görünüyor.'
  }
  if (event.source === 'CHECKIN') {
    return 'Mesai baslangici kaydı oluştu.'
  }
  if (event.source === 'CHECKOUT') {
    return 'Mesai bitisi kaydı oluştu.'
  }
  if (event.source === 'APP_OPEN') {
    return 'Uygulama oturumu acildi.'
  }
  if (event.source === 'APP_CLOSE') {
    return 'Uygulama oturumu kapandi.'
  }
  if (event.source === 'DEMO_START') {
    return 'Demo sureci basladi.'
  }
  if (event.source === 'DEMO_END') {
    return 'Demo sureci tamamladi.'
  }
  return 'Rota akisini suren güncel konum kaydı.'
}

export function EmployeeDayEventMiniList({
  events,
  selectedEventId,
  loading,
  error,
  onSelectEvent,
}: {
  events: LocationMonitorTimelineEvent[]
  selectedEventId: string | null
  loading: boolean
  error: boolean
  onSelectEvent: (eventId: string) => void
}) {
  return (
    <section className="cr-day-event-mini" aria-label="Seçili gün olay listesi">
      <header className="cr-day-event-mini__header">
        <div>
          <p className="cr-ops-kicker">Gün olaylari</p>
          <h4>Harita ile senkron mini akis</h4>
        </div>
        <span className="cr-day-event-mini__count">{events.length}</span>
      </header>

      {loading && !events.length ? <div className="cr-feed-empty">Olaylar yükleniyor...</div> : null}
      {error && !events.length ? <div className="cr-feed-empty">Gün olaylari alinmadi.</div> : null}

      <div className="cr-day-event-mini__list">
        {events.length ? (
          events.map((event) => {
            const tone = eventTone(event)
            const selected = selectedEventId === event.id
            return (
              <button
                key={event.id}
                type="button"
                className={`cr-day-event-mini__item is-${tone} ${selected ? 'is-selected' : ''}`}
                onClick={() => onSelectEvent(event.id)}
              >
                <div className="cr-day-event-mini__row">
                  <span className="cr-day-event-mini__time">{formatClock(event.ts_utc)}</span>
                  <span className={`cr-day-event-mini__tone is-${tone}`}>{eventStatusLabel(event)}</span>
                </div>
                <strong className="cr-day-event-mini__label">{event.label}</strong>
                <p className="cr-day-event-mini__summary">{eventSummary(event)}</p>
              </button>
            )
          })
        ) : (
          !loading && <div className="cr-feed-empty">Seçili gün için olay kaydı bulunmuyor.</div>
        )}
      </div>
    </section>
  )
}
