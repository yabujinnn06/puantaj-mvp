import { MinuteDisplay } from '../MinuteDisplay'
import { formatClock, formatDate, formatDistance } from './utils'

export type EmployeeDailyRouteRow = {
  employeeId: number
  employeeName: string
  date: string
  firstTimestamp: string | null
  lastTimestamp: string | null
  pointCount: number
  distanceMeters: number | null
  geofenceLabel: string
  geofenceTone: 'inside' | 'outside' | 'unknown'
  suspiciousJumpCount: number
  lowAccuracyCount: number
  workedMinutes: number
}

function GeofenceBadge({
  label,
  tone,
}: {
  label: string
  tone: EmployeeDailyRouteRow['geofenceTone']
}) {
  return <span className={`cr-daily-badge is-${tone}`}>{label}</span>
}

export function EmployeeDailyRouteTable({
  rows,
  selectedEmployeeId,
  selectedDay,
  loading,
  mobile = false,
  onSelectRow,
  onClearEmployee,
}: {
  rows: EmployeeDailyRouteRow[]
  selectedEmployeeId: number | null
  selectedDay: string | null
  loading: boolean
  mobile?: boolean
  onSelectRow: (employeeId: number, day: string) => void
  onClearEmployee: () => void
}) {
  if (mobile) {
    return (
      <section className="cr-daily-table-panel">
        <header className="cr-daily-table-panel__header">
          <div>
            <p className="cr-ops-kicker">Günler</p>
            <h3>Günlük rota listesi</h3>
          </div>
          <div className="cr-daily-table-panel__actions">
            {selectedEmployeeId != null ? (
              <button type="button" className="cr-ops-action is-secondary" onClick={onClearEmployee}>
                Tüm personeller
              </button>
            ) : null}
            <span className="cr-daily-table-panel__count">{rows.length} satir</span>
          </div>
        </header>

        {loading && rows.length === 0 ? <div className="cr-feed-empty">Günlük rota listesi hazırlanıyor...</div> : null}

        <div className="cr-daily-mobile-list">
          {rows.length ? (
            rows.map((row) => {
              const selected = row.employeeId === selectedEmployeeId && row.date === selectedDay
              return (
                <button
                  key={`${row.employeeId}-${row.date}`}
                  type="button"
                  className={`cr-daily-mobile-card ${selected ? 'is-selected' : ''}`}
                  onClick={() => onSelectRow(row.employeeId, row.date)}
                >
                  <div className="cr-daily-mobile-card__head">
                    <div>
                      <strong>{row.employeeName}</strong>
                      <span>{formatDate(row.date)}</span>
                    </div>
                    <GeofenceBadge label={row.geofenceLabel} tone={row.geofenceTone} />
                  </div>
                  <div className="cr-daily-mobile-card__grid">
                    <span>
                      Ilk <strong>{formatClock(row.firstTimestamp)}</strong>
                    </span>
                    <span>
                      Son <strong>{formatClock(row.lastTimestamp)}</strong>
                    </span>
                    <span>
                      Nokta <strong>{row.pointCount}</strong>
                    </span>
                    <span>
                      Mesafe <strong>{formatDistance(row.distanceMeters)}</strong>
                    </span>
                    <span>
                      Sicrama <strong>{row.suspiciousJumpCount}</strong>
                    </span>
                    <span>
                      Low acc <strong>{row.lowAccuracyCount}</strong>
                    </span>
                  </div>
                </button>
              )
            })
          ) : (
            <div className="cr-feed-empty">Seçili filtreler için günlük rota satiri bulunamadı.</div>
          )}
        </div>
      </section>
    )
  }

  return (
    <section className="cr-daily-table-panel">
      <header className="cr-daily-table-panel__header">
        <div>
          <p className="cr-ops-kicker">Günlük rota listesi</p>
          <h3>Çalışan + gün seçimi</h3>
        </div>
        <div className="cr-daily-table-panel__actions">
          {selectedEmployeeId != null ? (
            <button type="button" className="cr-ops-action is-secondary" onClick={onClearEmployee}>
              Tüm personeller
            </button>
          ) : null}
          <span className="cr-daily-table-panel__count">{rows.length} satir</span>
        </div>
      </header>

      {loading && rows.length === 0 ? <div className="cr-feed-empty">Günlük rota listesi hazırlanıyor...</div> : null}

      <div className="cr-daily-table-shell">
        <table className="cr-daily-table">
          <thead>
            <tr>
              <th>Tarih</th>
              <th>Çalışan</th>
              <th>Ilk saat</th>
              <th>Son saat</th>
              <th>Nokta</th>
              <th>Mesafe</th>
              <th>Geofence</th>
              <th>Suspicious jump</th>
              <th>Low accuracy</th>
              <th>Calisilan</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => {
                const selected = row.employeeId === selectedEmployeeId && row.date === selectedDay

                return (
                  <tr
                    key={`${row.employeeId}-${row.date}`}
                    className={selected ? 'is-selected' : ''}
                    onClick={() => onSelectRow(row.employeeId, row.date)}
                  >
                    <td>{formatDate(row.date)}</td>
                    <td>{row.employeeName}</td>
                    <td>{formatClock(row.firstTimestamp)}</td>
                    <td>{formatClock(row.lastTimestamp)}</td>
                    <td>{row.pointCount}</td>
                    <td>{formatDistance(row.distanceMeters)}</td>
                    <td>
                      <GeofenceBadge label={row.geofenceLabel} tone={row.geofenceTone} />
                    </td>
                    <td>{row.suspiciousJumpCount}</td>
                    <td>{row.lowAccuracyCount}</td>
                    <td><MinuteDisplay minutes={row.workedMinutes} /></td>
                  </tr>
                )
              })
            ) : (
              <tr>
                <td colSpan={10}>
                  <div className="cr-feed-empty">Seçili filtreler için günlük rota satiri bulunamadı.</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
