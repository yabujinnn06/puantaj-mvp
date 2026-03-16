import { Link } from 'react-router-dom'

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
  return (
    <header className="mc-header mc-header--control-room">
      <div className="mc-header__row">
        <div className="mc-header__copy">
          <p className="mc-kicker">YÖNETİM KONSOLU</p>
          <h2>Ana Panel</h2>
          <p>
            Calisan operasyon matrisi ana odak olarak korunur; konum takibi ayri ekranda, bildirim ve
            yardimci analitik katmanlari ise destekleyici rolde calisir.
          </p>
        </div>

        <div className="mc-header__actions">
          <span className={`mc-status-pill ${systemStatusClass(systemStatus)}`}>
            Sistem: {systemStatusLabel(systemStatus)}
          </span>
          <Link to="/notifications" className="mc-button mc-button--ghost">
            Bildirimler
          </Link>
          <Link to="/attendance-events" className="mc-button mc-button--ghost">
            Yoklama kayıtları
          </Link>
          <Link to="/log" className="mc-button mc-button--ghost">
            Log
          </Link>
          <button type="button" className="mc-button mc-button--primary" onClick={onRefresh}>
            Veriyi yenile
          </button>
        </div>
      </div>

      <div className="mc-header__meta-strip">
        <span>Son senkron: {formatDateTime(generatedAtUtc)}</span>
        <span>Görünüm: operasyon matrisi öncelikli</span>
        <span>Rail: bildirim ve operasyon sinyalleri</span>
      </div>
    </header>
  )
}
