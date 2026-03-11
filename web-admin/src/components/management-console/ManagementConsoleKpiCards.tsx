import type { ControlRoomSummary } from '../../types/api'
import { formatClockMinutes, systemStatusClass, systemStatusLabel } from './utils'

function KpiCard({
  label,
  value,
  meta,
  tone = 'neutral',
}: {
  label: string
  value: string | number
  meta: string
  tone?: 'neutral' | 'accent' | 'watch' | 'critical'
}) {
  return (
    <article className={`mc-kpi mc-kpi--${tone}`}>
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
        meta={`${summary.in_progress_count} aktif vardiya · ${summary.finished_count} günü kapattı`}
        tone="accent"
      />
      <KpiCard
        label="Kritik risk"
        value={summary.critical_count}
        meta={`${summary.watch_count} izlemeli ile birlikte takip`}
        tone="critical"
      />
      <KpiCard
        label="İzlemeli"
        value={summary.watch_count}
        meta={`${summary.normal_count} normal çalışan görünümü`}
        tone="watch"
      />
      <KpiCard
        label="Ortalama risk"
        value={summary.average_risk_score.toFixed(1)}
        meta={`Geç kalma oranı %${summary.late_rate_percent}`}
      />
      <KpiCard
        label="Aktif mesai"
        value={summary.active_overtime_count}
        meta={`${summary.daily_violation_count} günlük ihlal`}
      />
      <KpiCard
        label="Ortalama giriş"
        value={formatClockMinutes(summary.average_checkin_minutes)}
        meta={`Aktif süre ${Math.round(summary.average_active_minutes / 60)} sa`}
      />
      <KpiCard
        label="Sistem durumu"
        value={systemStatusLabel(summary.system_status)}
        meta={`Yoğun pencere: ${summary.most_common_violation_window ?? '-'}`}
        tone={systemStatusClass(summary.system_status) === 'is-critical' ? 'critical' : systemStatusClass(summary.system_status) === 'is-watch' ? 'watch' : 'neutral'}
      />
    </section>
  )
}
