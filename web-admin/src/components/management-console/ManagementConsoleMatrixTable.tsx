import { useEffect, useMemo, useState } from 'react'

import { MinuteDisplay } from '../MinuteDisplay'
import type { ControlRoomEmployeeState } from '../../types/api'
import type { FilterFormState, SortField } from './types'
import {
  formatDateTime,
  formatRelative,
  locationStateLabel,
  riskClass,
  riskStatusLabel,
  sortIcon,
  todayStatusLabel,
} from './utils'

const ROW_HEIGHT = 86
const VIEWPORT_HEIGHT = 620
const OVERSCAN = 6

export function ManagementConsoleMatrixTable({
  items,
  total,
  page,
  totalPages,
  filters,
  onSort,
  onOpenEmployee,
  selectedEmployeeId,
  onPageChange,
}: {
  items: ControlRoomEmployeeState[]
  total: number
  page: number
  totalPages: number
  filters: FilterFormState
  onSort: (field: SortField) => void
  onOpenEmployee: (employeeId: number) => void
  selectedEmployeeId: number | null
  onPageChange: (page: number) => void
}) {
  const [scrollTop, setScrollTop] = useState(0)
  const [isCompactViewport, setIsCompactViewport] = useState(false)

  useEffect(() => {
    const applyViewport = () => {
      setIsCompactViewport(window.innerWidth <= 960)
    }

    applyViewport()
    window.addEventListener('resize', applyViewport)
    return () => {
      window.removeEventListener('resize', applyViewport)
    }
  }, [])

  const startIndex = isCompactViewport ? 0 : Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const visibleCount = isCompactViewport ? items.length : Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT) + OVERSCAN * 2
  const endIndex = Math.min(items.length, startIndex + visibleCount)
  const visibleItems = useMemo(() => items.slice(startIndex, endIndex), [endIndex, items, startIndex])
  const topSpacer = isCompactViewport ? 0 : startIndex * ROW_HEIGHT
  const bottomSpacer = isCompactViewport ? 0 : Math.max(0, (items.length - endIndex) * ROW_HEIGHT)
  const visibleStart = items.length ? (page - 1) * filters.limit + 1 : 0
  const visibleEnd = items.length ? Math.min(page * filters.limit, total) : 0

  return (
    <section className="mc-panel mc-panel--table">
      <div className="mc-panel__head">
        <div>
          <p className="mc-kicker">OPERASYONEL GÜVENLİK MATRİSİ</p>
          <h3 className="mc-panel__title">Risk bazlı davranış, ihlal ve vardiya uyumu tablosu</h3>
        </div>
        <div className="mc-meta">
          <span>{total} kayıt</span>
          <span>Sayfa {page} / {totalPages}</span>
        </div>
      </div>

      <div className="mc-table-head" role="row">
        {[
          ['employee_name', 'Personel'],
          ['department_name', 'Departman'],
          ['risk_score', 'Risk'],
          ['risk_status', 'Durum'],
          ['worked_today', 'Bugün'],
          ['weekly_total', 'Hafta'],
          ['violation_count_7d', 'İhlal'],
          ['last_activity', 'Son aktivite'],
          ['recent_ip', 'IP'],
          ['location_label', 'Konum'],
        ].map(([field, label]) => (
          <div key={field} className="mc-table-head__cell">
            {field === 'risk_status' || field === 'recent_ip' || field === 'location_label' ? (
              label
            ) : (
              <button type="button" className="mc-table-head__button" onClick={() => onSort(field as SortField)}>
                {label}
                <span>{sortIcon(filters.sort_by === field, filters.sort_dir)}</span>
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="mc-table-viewport" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
        <div style={{ height: topSpacer }} aria-hidden="true" />
        {visibleItems.map((item) => (
          <button
            key={item.employee.id}
            type="button"
            className={`mc-table-row ${selectedEmployeeId === item.employee.id ? 'is-selected' : ''}`}
            onClick={() => onOpenEmployee(item.employee.id)}
          >
            <div className="mc-table-cell mc-table-cell--stack">
              <strong>{item.employee.full_name}</strong>
              <span>{todayStatusLabel(item.today_status)}</span>
            </div>
            <div className="mc-table-cell">{item.department_name ?? '-'}</div>
            <div className="mc-table-cell">
              <span className={`mc-risk-pill ${riskClass(item.risk_status)}`}>{item.risk_score}</span>
            </div>
            <div className="mc-table-cell">
              <span className={`mc-status-pill ${riskClass(item.risk_status)}`}>
                {riskStatusLabel(item.risk_status)}
              </span>
            </div>
            <div className="mc-table-cell">
              <MinuteDisplay minutes={item.worked_today_minutes} />
            </div>
            <div className="mc-table-cell">
              <MinuteDisplay minutes={item.weekly_total_minutes} />
            </div>
            <div className="mc-table-cell mc-table-cell--stack">
              <strong>{item.violation_count_7d}</strong>
              <span>{item.shift_window_label ?? 'Plan bilgisi yok'}</span>
            </div>
            <div className="mc-table-cell mc-table-cell--stack">
              <strong>{formatDateTime(item.last_activity_utc)}</strong>
              <span>{formatRelative(item.last_activity_utc)}</span>
            </div>
            <div className="mc-table-cell">{item.recent_ip ?? '-'}</div>
            <div className="mc-table-cell mc-table-cell--stack">
              <strong>{item.location_label ?? '-'}</strong>
              <span>{locationStateLabel(item.location_state)}</span>
            </div>
          </button>
        ))}
        <div style={{ height: bottomSpacer }} aria-hidden="true" />
      </div>

      <div className="mc-pagination">
        <button
          type="button"
          className="mc-button mc-button--secondary"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
        >
          Önceki
        </button>
        <span>
          Görünen kayıtlar: {visibleStart} - {visibleEnd}
        </span>
        <button
          type="button"
          className="mc-button mc-button--secondary"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
        >
          Sonraki
        </button>
      </div>
    </section>
  )
}
