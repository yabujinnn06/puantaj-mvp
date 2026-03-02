import { useEffect, useMemo, useRef, useState } from 'react'

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

const WIDE_ROW_HEIGHT = 92
const VIEWPORT_HEIGHT = 620
const OVERSCAN = 6

type TableLayoutMode = 'wide' | 'condensed' | 'stacked'

function resolveLayoutMode(width: number): TableLayoutMode {
  if (width <= 920) return 'stacked'
  if (width <= 1380) return 'condensed'
  return 'wide'
}

function buildRowSignals(item: ControlRoomEmployeeState): string[] {
  const parts: string[] = []
  if (item.active_measure?.label) {
    parts.push(item.active_measure.label)
  }
  for (const alert of item.attention_flags.slice(0, 2)) {
    parts.push(alert.label)
  }
  if (!parts.length && item.latest_note) {
    parts.push('İnceleme notu var')
  }
  if (!parts.length) {
    parts.push(item.shift_window_label ?? 'Plan bilgisi yok')
  }
  return parts
}

function CompactRow({
  item,
  onOpenEmployee,
  selected,
}: {
  item: ControlRoomEmployeeState
  onOpenEmployee: (employeeId: number) => void
  selected: boolean
}) {
  const signalLabels = buildRowSignals(item)

  return (
    <button
      type="button"
      className={`mc-table-row mc-table-row--compact ${selected ? 'is-selected' : ''}`}
      onClick={() => onOpenEmployee(item.employee.id)}
    >
      <div className="mc-table-compact__hero">
        <div className="mc-table-cell mc-table-cell--stack">
          <strong>{item.employee.full_name}</strong>
          <span>{item.department_name ?? 'Departman bilgisi yok'}</span>
          <span>{todayStatusLabel(item.today_status)}</span>
        </div>
        <div className="mc-table-compact__risk">
          <span className={`mc-risk-pill ${riskClass(item.risk_status)}`}>{item.risk_score}</span>
          <span className={`mc-status-pill ${riskClass(item.risk_status)}`}>
            {riskStatusLabel(item.risk_status)}
          </span>
        </div>
      </div>

      <div className="mc-table-compact__metrics">
        <article className="mc-table-metric">
          <span className="mc-table-metric__label">Bugün</span>
          <strong className="mc-table-metric__value">
            <MinuteDisplay minutes={item.worked_today_minutes} />
          </strong>
        </article>
        <article className="mc-table-metric">
          <span className="mc-table-metric__label">Hafta</span>
          <strong className="mc-table-metric__value">
            <MinuteDisplay minutes={item.weekly_total_minutes} />
          </strong>
        </article>
        <article className="mc-table-metric">
          <span className="mc-table-metric__label">İhlal</span>
          <strong className="mc-table-metric__value">{item.violation_count_7d}</strong>
          <small>{item.shift_window_label ?? 'Plan bilgisi yok'}</small>
        </article>
      </div>

      <div className="mc-table-compact__signals">
        {signalLabels.map((label) => (
          <span key={label} className="mc-table-signal">
            {label}
          </span>
        ))}
      </div>

      <div className="mc-table-compact__footer">
        <article className="mc-table-metric mc-table-metric--wide">
          <span className="mc-table-metric__label">Son aktivite</span>
          <strong className="mc-table-metric__value">{formatDateTime(item.last_activity_utc)}</strong>
          <small>{formatRelative(item.last_activity_utc)}</small>
        </article>
        <article className="mc-table-metric mc-table-metric--wide">
          <span className="mc-table-metric__label">Konum</span>
          <strong className="mc-table-metric__value">{item.location_label ?? '-'}</strong>
          <small>{locationStateLabel(item.location_state)}</small>
        </article>
        <article className="mc-table-metric mc-table-metric--wide">
          <span className="mc-table-metric__label">IP / cihaz</span>
          <strong className="mc-table-metric__value">{item.recent_ip ?? '-'}</strong>
          <small>
            {item.active_devices}/{item.total_devices} aktif cihaz
          </small>
        </article>
      </div>
    </button>
  )
}

function WideRow({
  item,
  onOpenEmployee,
  selected,
}: {
  item: ControlRoomEmployeeState
  onOpenEmployee: (employeeId: number) => void
  selected: boolean
}) {
  return (
    <button
      key={item.employee.id}
      type="button"
      className={`mc-table-row ${selected ? 'is-selected' : ''}`}
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
      <div className="mc-table-cell mc-table-cell--mono" title={item.recent_ip ?? '-'}>
        {item.recent_ip ?? '-'}
      </div>
      <div className="mc-table-cell mc-table-cell--stack">
        <strong>{item.location_label ?? '-'}</strong>
        <span>{locationStateLabel(item.location_state)}</span>
      </div>
    </button>
  )
}

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
  const panelRef = useRef<HTMLElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [layoutMode, setLayoutMode] = useState<TableLayoutMode>('wide')

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return

    const applyLayout = (width: number) => {
      setLayoutMode(resolveLayoutMode(width))
    }

    applyLayout(panel.getBoundingClientRect().width)

    if (typeof ResizeObserver === 'undefined') {
      const handleResize = () => {
        applyLayout(panel.getBoundingClientRect().width)
      }
      window.addEventListener('resize', handleResize)
      return () => {
        window.removeEventListener('resize', handleResize)
      }
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      applyLayout(entry.contentRect.width)
    })
    observer.observe(panel)
    return () => {
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    if (layoutMode !== 'wide') {
      setScrollTop(0)
    }
  }, [layoutMode])

  const isVirtualized = layoutMode === 'wide'
  const startIndex = isVirtualized ? Math.max(0, Math.floor(scrollTop / WIDE_ROW_HEIGHT) - OVERSCAN) : 0
  const visibleCount = isVirtualized ? Math.ceil(VIEWPORT_HEIGHT / WIDE_ROW_HEIGHT) + OVERSCAN * 2 : items.length
  const endIndex = Math.min(items.length, startIndex + visibleCount)
  const visibleItems = useMemo(() => items.slice(startIndex, endIndex), [endIndex, items, startIndex])
  const topSpacer = isVirtualized ? startIndex * WIDE_ROW_HEIGHT : 0
  const bottomSpacer = isVirtualized ? Math.max(0, (items.length - endIndex) * WIDE_ROW_HEIGHT) : 0
  const visibleStart = items.length ? (page - 1) * filters.limit + 1 : 0
  const visibleEnd = items.length ? Math.min(page * filters.limit, total) : 0

  return (
    <section ref={panelRef} className={`mc-panel mc-panel--table mc-panel--table-${layoutMode}`}>
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

      {layoutMode === 'wide' ? (
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
      ) : (
        <div className="mc-table-compact__toolbar">
          <span>Dar görünüm etkin. Satırlar okunabilir kart düzenine alındı.</span>
          <span>{visibleStart} - {visibleEnd} gösteriliyor</span>
        </div>
      )}

      <div
        className={`mc-table-viewport ${isVirtualized ? '' : 'is-auto'}`}
        onScroll={isVirtualized ? (event) => setScrollTop(event.currentTarget.scrollTop) : undefined}
      >
        <div style={{ height: topSpacer }} aria-hidden="true" />
        {visibleItems.map((item) =>
          layoutMode === 'wide' ? (
            <WideRow
              key={item.employee.id}
              item={item}
              onOpenEmployee={onOpenEmployee}
              selected={selectedEmployeeId === item.employee.id}
            />
          ) : (
            <CompactRow
              key={item.employee.id}
              item={item}
              onOpenEmployee={onOpenEmployee}
              selected={selectedEmployeeId === item.employee.id}
            />
          ),
        )}
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
