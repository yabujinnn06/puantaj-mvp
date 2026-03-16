import { Link } from 'react-router-dom'

import { useAuth } from '../../hooks/useAuth'
import { formatDateTime, systemStatusClass, systemStatusLabel } from './utils'

export function ManagementConsoleHeader({
  generatedAtUtc,
  systemStatus,
  onRefresh,
}: {
  generatedAtUtc: string
  systemStatus: 'HEALTHY' | 'ATTENTION' | 'CRITICAL'
  onRefresh: () => void
}) {
  const { hasPermission } = useAuth()

  return (
    <header className="mc-header mc-header--control-room">
      <div className="mc-header__row">
        <div className="mc-header__copy">
          <p className="mc-kicker">YONETIM KONSOLU</p>
          <h2>Ana Panel</h2>
          <p>
            Calisan operasyon matrisi ana odak olarak korunur; bildirim ve yardimci analitik katmanlari
            destekleyici rolde calisir.
          </p>
        </div>

        <div className="mc-header__actions">
          <span className={`mc-status-pill ${systemStatusClass(systemStatus)}`}>
            Sistem: {systemStatusLabel(systemStatus)}
          </span>
          {hasPermission('notifications') ? (
            <Link to="/notifications" className="mc-button mc-button--ghost">
              Bildirimler
            </Link>
          ) : null}
          {hasPermission('attendance_events') ? (
            <Link to="/attendance-events" className="mc-button mc-button--ghost">
              Yoklama kayitlari
            </Link>
          ) : null}
          {hasPermission('log') ? (
            <Link to="/log" className="mc-button mc-button--ghost">
              Log
            </Link>
          ) : null}
          <button type="button" className="mc-button mc-button--primary" onClick={onRefresh}>
            Veriyi yenile
          </button>
        </div>
      </div>

      <div className="mc-header__meta-strip">
        <span>Son senkron: {formatDateTime(generatedAtUtc)}</span>
        <span>Gorunum: operasyon matrisi oncelikli</span>
        <span>Rail: bildirim ve operasyon sinyalleri</span>
      </div>
    </header>
  )
}
