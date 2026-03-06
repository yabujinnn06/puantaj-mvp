import type { ControlRoomSummary } from '../../types/api'
import { systemStatusLabel } from './utils'

function KpiCard({
  label,
  value,
  meta,
  emphasis = false,
}: {
  label: string
  value: string | number
  meta: string
  emphasis?: boolean
}) {
  return (
    <article className={`mc-kpi ${emphasis ? 'mc-kpi--emphasis' : ''}`}>
      <span className="mc-kpi__label">{label}</span>
      <strong className="mc-kpi__value">{value}</strong>
      <span className="mc-kpi__meta">{meta}</span>
    </article>
  )
}

export function ManagementConsoleKpiCards({ summary }: { summary: ControlRoomSummary }) {
  return (
    <section className="mc-kpi-grid" aria-label="Genel bakış metrikleri">
      <KpiCard
        label="Aktif çalışan"
        value={summary.active_employees}
        meta={`${summary.total_employees} kayıttan filtrelendi`}
        emphasis
      />
      <KpiCard label="Kritik risk" value={summary.critical_count} meta="Anlık kritik eşik" />
      <KpiCard label="İzlemeli" value={summary.watch_count} meta="Yakın takip gereken" />
      <KpiCard label="Ortalama risk" value={summary.average_risk_score.toFixed(1)} meta="Filtreli evren ortalaması" />
      <KpiCard label="Aktif mesai" value={summary.active_overtime_count} meta="Açık ve plan üstü vardiya" />
      <KpiCard label="Günlük ihlal" value={summary.daily_violation_count} meta="Bugün oluşan toplam ihlal" />
      <KpiCard
        label="Sistem durumu"
        value={systemStatusLabel(summary.system_status)}
        meta={`Yoğun pencere: ${summary.most_common_violation_window ?? '-'}`}
      />
    </section>
  )
}
