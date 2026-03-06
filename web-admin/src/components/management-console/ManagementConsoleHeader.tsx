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
    <header className="mc-header">
      <div className="mc-header__row">
        <div className="mc-header__copy">
          <p className="mc-kicker">ERP OPERASYON MERKEZİ</p>
          <h2>Ana Panel</h2>
          <p>
            Yönetim konsolu, canlı risk matrisi, claim işlemleri, konum izleme ve bildirim akışı tek sayfada toplandı.
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
            Yoklama Kayıtları
          </Link>
          <button type="button" className="mc-button mc-button--primary" onClick={onRefresh}>
            Veriyi Yenile
          </button>
        </div>
      </div>

      <div className="mc-erp-banner">
        <article className="mc-erp-banner__item">
          <span>Son senkron</span>
          <strong>{formatDateTime(generatedAtUtc)}</strong>
          <small>Panel verisi güncel tutuluyor</small>
        </article>
        <article className="mc-erp-banner__item">
          <span>Çalışma modu</span>
          <strong>ERP görünümü</strong>
          <small>Yoğun bilgi, dar boşluk, tek odak</small>
        </article>
        <article className="mc-erp-banner__item">
          <span>Operasyon hattı</span>
          <strong>Risk + Yoklama + Cihaz</strong>
          <small>Ayrı dashboard akışları birleştirildi</small>
        </article>
      </div>
    </header>
  )
}
