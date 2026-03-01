import { Link } from 'react-router-dom'

import { PageHeader } from '../PageHeader'
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
    <div className="mc-header">
      <PageHeader
        title="Ana Panel"
        description="Yönetim Konsolu. Operasyon akışı, risk analizi, harita izleme ve müdahale araçları tek kontrol yüzeyinde birleşir."
        action={
          <div className="mc-header__actions">
            <div className={`mc-status-pill ${systemStatusClass(systemStatus)}`}>
              Sistem durumu: {systemStatusLabel(systemStatus)}
            </div>
            <Link to="/notifications" className="mc-button mc-button--ghost">
              Bildirimler
            </Link>
            <Link to="/attendance-events" className="mc-button mc-button--ghost">
              Yoklama kayıtları
            </Link>
            <button type="button" className="mc-button mc-button--secondary" onClick={onRefresh}>
              Yenile
            </button>
          </div>
        }
      />

      <section className="mc-hero">
        <div className="mc-hero__copy">
          <p className="mc-kicker">YÖNETİM KONSOLU</p>
          <h2 className="mc-hero__title">Tüm organizasyonun canlı akışı burada toplanır.</h2>
          <p className="mc-hero__text">
            Operasyonel Güvenlik Matrisi, risk yoğunluğu, personel hareketleri, bildirim akışı ve
            müdahale araçları tek merkezde birlikte çalışır.
          </p>
        </div>
        <div className="mc-hero__meta">
          <span>Son güncelleme</span>
          <strong>{formatDateTime(generatedAtUtc)}</strong>
          <small>Kontrol katmanı çevrim içi ve izleme aktif</small>
        </div>
      </section>
    </div>
  )
}
