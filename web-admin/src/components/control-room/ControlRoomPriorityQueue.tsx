import { MinuteDisplay } from '../MinuteDisplay'
import type { ControlRoomEmployeeState } from '../../types/api'
import {
  controlRoomLocationLabel,
  controlRoomRiskLabel,
  formatRelative,
  queueReason,
  todayStatusLabel,
} from './utils'

export function ControlRoomPriorityQueue({
  items,
  selectedEmployeeId,
  onSelectEmployee,
  onOpenEmployeeDetail,
}: {
  items: ControlRoomEmployeeState[]
  selectedEmployeeId: number | null
  onSelectEmployee: (employeeId: number) => void
  onOpenEmployeeDetail: (employeeId: number) => void
}) {
  return (
    <section className="cr-queue-panel">
      <header className="cr-queue-panel__header">
        <div>
          <p className="cr-ops-kicker">Oncelik kuyrugu</p>
          <h3>Kim önce bakış istiyor?</h3>
        </div>
        <span className="cr-queue-panel__count">{items.length} kisi</span>
      </header>

      <div className="cr-queue-list">
        {items.length ? (
          items.map((item, index) => (
            <article
              key={item.employee.id}
              className={`cr-queue-card ${selectedEmployeeId === item.employee.id ? 'is-selected' : ''}`}
            >
              <button
                type="button"
                className="cr-queue-card__main"
                onClick={() => onSelectEmployee(item.employee.id)}
              >
                <div className="cr-queue-card__rank">{String(index + 1).padStart(2, '0')}</div>
                <div className="cr-queue-card__body">
                  <div className="cr-queue-card__head">
                    <strong>{item.employee.full_name}</strong>
                    <span className={`cr-queue-card__risk is-${item.risk_status.toLowerCase()}`}>
                      {item.risk_score}
                    </span>
                  </div>
                  <div className="cr-queue-card__meta">
                    <span>{controlRoomRiskLabel(item.risk_status)}</span>
                    <span>{controlRoomLocationLabel(item.location_state)}</span>
                    <span>{todayStatusLabel(item.today_status)}</span>
                  </div>
                  <p className="cr-queue-card__reason">{queueReason(item)}</p>
                  <div className="cr-queue-card__foot">
                    <span>
                      Bugün <MinuteDisplay minutes={item.worked_today_minutes} />
                    </span>
                    <span>{formatRelative(item.last_activity_utc)}</span>
                  </div>
                </div>
              </button>

              <button
                type="button"
                className="cr-queue-card__detail"
                onClick={() => onOpenEmployeeDetail(item.employee.id)}
              >
                Dosya
              </button>
            </article>
          ))
        ) : (
          <div className="cr-feed-empty">Öncelikli kuyruk bos.</div>
        )}
      </div>
    </section>
  )
}
