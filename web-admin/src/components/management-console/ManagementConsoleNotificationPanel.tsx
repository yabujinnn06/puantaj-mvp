import { useQuery } from '@tanstack/react-query'

import { getNotificationJobs } from '../../api/admin'
import { formatDateTime, notificationAudienceLabel, notificationStatusLabel, riskClass } from './utils'

export function ManagementConsoleNotificationPanel({
  selectedEmployeeId,
  startDate,
  endDate,
  onOpenEmployee,
}: {
  selectedEmployeeId: number | null
  startDate?: string
  endDate?: string
  onOpenEmployee: (employeeId: number) => void
}) {
  const notificationsQuery = useQuery({
    queryKey: ['management-console-notifications', { selectedEmployeeId, startDate, endDate }],
    queryFn: () =>
      getNotificationJobs({
        employee_id: selectedEmployeeId ?? undefined,
        start_date: startDate,
        end_date: endDate,
        offset: 0,
        limit: 8,
      }),
    staleTime: 30_000,
  })

  return (
    <section className="mc-panel">
      <div className="mc-panel__head">
        <div>
          <p className="mc-kicker">BİLDİRİM AKIŞI</p>
          <h3 className="mc-panel__title">Son kurallar, alarmlar ve gönderim durumu</h3>
        </div>
        <div className="mc-meta">
          <span>{notificationsQuery.data?.total ?? 0} kayıt</span>
          <span>{selectedEmployeeId ? `Personel #${selectedEmployeeId}` : 'Tüm kapsam'}</span>
        </div>
      </div>

      <div className="mc-notification-list">
        {notificationsQuery.isLoading ? (
          <div className="mc-empty-state">Bildirim akışı yükleniyor...</div>
        ) : notificationsQuery.isError ? (
          <div className="mc-empty-state">Bildirim akışı alınamadı.</div>
        ) : notificationsQuery.data?.items.length ? (
          notificationsQuery.data.items.map((job) => (
            <article key={job.id} className="mc-notification-card">
              <div className="mc-notification-card__head">
                <div>
                  <strong>{job.title ?? job.notification_type ?? 'Bildirim'}</strong>
                  <span>{job.notification_type ?? 'Tanımsız tür'}</span>
                </div>
                <span className={`mc-status-pill ${riskClass(job.risk_level)}`}>
                  {job.risk_level ?? 'Bilgi'}
                </span>
              </div>
              <p>{job.description ?? 'Açıklama bulunmuyor.'}</p>
              <div className="mc-notification-card__meta">
                <span>{notificationAudienceLabel(job.audience)}</span>
                <span>{notificationStatusLabel(job.status)}</span>
                <span>{formatDateTime(job.event_ts_utc ?? job.created_at)}</span>
              </div>
              <div className="mc-notification-card__footer">
                <span>Event ID: {job.event_id ?? '-'}</span>
                {job.employee_id ? (
                  <button
                    type="button"
                    className="mc-button mc-button--ghost"
                    onClick={() => onOpenEmployee(job.employee_id as number)}
                  >
                    Personeli aç
                  </button>
                ) : null}
              </div>
            </article>
          ))
        ) : (
          <div className="mc-empty-state">Seçilen kapsam için bildirim bulunmuyor.</div>
        )}
      </div>
    </section>
  )
}
