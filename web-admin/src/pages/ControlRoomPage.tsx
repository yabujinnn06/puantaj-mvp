import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'

import {
  auditControlRoomFilters,
  getControlRoomOverview,
  getDepartments,
  getRegions,
} from '../api/admin'
import { ErrorBlock } from '../components/ErrorBlock'
import { LoadingBlock } from '../components/LoadingBlock'
import { MinuteDisplay } from '../components/MinuteDisplay'
import { ManagementConsoleEmployeeDetailModal } from '../components/management-console/ManagementConsoleEmployeeDetailModal'
import { ManagementConsoleFilters } from '../components/management-console/ManagementConsoleFilters'
import { ManagementConsoleHeader } from '../components/management-console/ManagementConsoleHeader'
import { ManagementConsoleKpiCards } from '../components/management-console/ManagementConsoleKpiCards'
import { ManagementConsoleMapPanel } from '../components/management-console/ManagementConsoleMapPanel'
import { ManagementConsoleMatrixTable } from '../components/management-console/ManagementConsoleMatrixTable'
import { ManagementConsoleNotificationPanel } from '../components/management-console/ManagementConsoleNotificationPanel'
import { defaultFilters, parseNumber, toOverviewParams, type FilterFormState, type SortField } from '../components/management-console/types'
import {
  formatClockMinutes,
  formatDateTime,
  riskStatusLabel,
  systemStatusClass,
  systemStatusLabel,
} from '../components/management-console/utils'

export function ControlRoomPage() {
  const [filterForm, setFilterForm] = useState<FilterFormState>(defaultFilters())
  const [appliedFilters, setAppliedFilters] = useState<FilterFormState>(defaultFilters())
  const [page, setPage] = useState(1)
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [sideRailCollapsed, setSideRailCollapsed] = useState(false)

  const regionsQuery = useQuery({
    queryKey: ['regions', 'management-console'],
    queryFn: () => getRegions(),
  })
  const departmentsQuery = useQuery({
    queryKey: ['departments', 'management-console'],
    queryFn: () => getDepartments(),
  })

  const overviewParams = useMemo(() => toOverviewParams(appliedFilters, page), [appliedFilters, page])
  const overviewQuery = useQuery({
    queryKey: ['control-room-overview', overviewParams],
    queryFn: () => getControlRoomOverview(overviewParams),
  })

  const filterAuditMutation = useMutation({
    mutationFn: auditControlRoomFilters,
  })

  const openEmployee = (employeeId: number) => {
    setSelectedEmployeeId(employeeId)
    setDetailOpen(true)
  }

  const applyFilters = () => {
    const next = { ...filterForm }
    setAppliedFilters(next)
    setPage(1)
    filterAuditMutation.mutate({
      filters: { ...toOverviewParams(next, 1) } as Record<string, unknown>,
      total_results: overviewQuery.data?.total,
    })
  }

  const resetFilters = () => {
    const next = defaultFilters()
    setFilterForm(next)
    setAppliedFilters(next)
    setPage(1)
  }

  const handleSort = (field: SortField) => {
    const nextDir: FilterFormState['sort_dir'] =
      appliedFilters.sort_by === field && appliedFilters.sort_dir === 'desc' ? 'asc' : 'desc'
    const nextFilters: FilterFormState = { ...appliedFilters, sort_by: field, sort_dir: nextDir }
    setFilterForm(nextFilters)
    setAppliedFilters(nextFilters)
    setPage(1)
    filterAuditMutation.mutate({
      filters: { ...toOverviewParams(nextFilters, 1) } as Record<string, unknown>,
      total_results: overviewQuery.data?.total,
    })
  }

  const activeFilterEntries = useMemo(() => {
    const filters = overviewQuery.data?.active_filters
    if (!filters) return []
    return [
      filters.q ? `Sorgu: ${filters.q}` : null,
      filters.start_date && filters.end_date ? `Analiz: ${filters.start_date} - ${filters.end_date}` : null,
      filters.map_date ? `Harita günü: ${filters.map_date}` : null,
      filters.region_id ? `Bölge #${filters.region_id}` : null,
      filters.department_id ? `Departman #${filters.department_id}` : null,
      filters.risk_status ? `Durum: ${riskStatusLabel(filters.risk_status)}` : null,
      filters.risk_min != null || filters.risk_max != null
        ? `Risk aralığı: ${filters.risk_min ?? 0}-${filters.risk_max ?? 100}`
        : null,
      filters.include_inactive ? 'Pasif personel dahil' : null,
      `Sıralama: ${filters.sort_by} / ${filters.sort_dir === 'desc' ? 'Azalan' : 'Artan'}`,
      `Limit: ${filters.limit}`,
    ].filter(Boolean) as string[]
  }, [overviewQuery.data?.active_filters])

  const totalPages = Math.max(
    1,
    Math.ceil((overviewQuery.data?.total ?? 0) / (overviewQuery.data?.limit || appliedFilters.limit)),
  )
  const summary = overviewQuery.data?.summary
  const histogramMax = Math.max(1, ...(summary?.risk_histogram ?? []).map((item) => item.count))
  const trendMax = Math.max(1, ...(summary?.weekly_trend ?? []).map((item) => item.value))

  if (overviewQuery.isLoading) {
    return <LoadingBlock label="Yönetim konsolu yükleniyor..." />
  }

  if (overviewQuery.isError || !overviewQuery.data) {
    return <ErrorBlock message="Yönetim konsolu verileri alınamadı." />
  }

  return (
    <>
      <div className="mc-console">
        <ManagementConsoleHeader
          generatedAtUtc={overviewQuery.data.generated_at_utc}
          systemStatus={summary?.system_status ?? 'HEALTHY'}
          onRefresh={() => void overviewQuery.refetch()}
        />

        <ManagementConsoleKpiCards summary={overviewQuery.data.summary} />

        <ManagementConsoleFilters
          filterForm={filterForm}
          regions={regionsQuery.data ?? []}
          departments={departmentsQuery.data ?? []}
          activeFilterEntries={activeFilterEntries}
          onChange={setFilterForm}
          onApply={applyFilters}
          onReset={resetFilters}
        />

        <div className="mc-layout-toolbar">
          <div className="mc-layout-toolbar__summary">
            <strong>Canlı kapsam</strong>
            <span>
              Son güncelleme {formatDateTime(overviewQuery.data.generated_at_utc)} · Sistem durumu{' '}
              <span className={`mc-status-pill ${systemStatusClass(summary?.system_status ?? 'HEALTHY')}`}>
                {systemStatusLabel(summary?.system_status ?? 'HEALTHY')}
              </span>
            </span>
          </div>
          <button
            type="button"
            className="mc-button mc-button--ghost"
            onClick={() => setSideRailCollapsed((current) => !current)}
          >
            {sideRailCollapsed ? 'Sağ paneli aç' : 'Sağ paneli daralt'}
          </button>
        </div>

        <div className={`mc-layout ${sideRailCollapsed ? 'is-collapsed' : ''}`}>
          <div className="mc-layout__main">
            <ManagementConsoleMatrixTable
              items={overviewQuery.data.items}
              total={overviewQuery.data.total}
              page={page}
              totalPages={totalPages}
              filters={appliedFilters}
              onSort={handleSort}
              onOpenEmployee={openEmployee}
              selectedEmployeeId={selectedEmployeeId}
              onPageChange={setPage}
            />

            <div className="mc-secondary-grid">
              <section className="mc-panel">
                <div className="mc-panel__head">
                  <div>
                    <p className="mc-kicker">RİSK DAĞILIMI</p>
                    <h3 className="mc-panel__title">Risk skoru yoğunluğu</h3>
                  </div>
                </div>
                <div className="mc-histogram">
                  {(summary?.risk_histogram ?? []).map((bucket) => (
                    <article key={bucket.label} className="mc-histogram__row">
                      <span>{bucket.label}</span>
                      <div className="mc-histogram__track">
                        <div
                          className="mc-histogram__fill"
                          style={{ width: `${(bucket.count / histogramMax) * 100}%` }}
                        />
                      </div>
                      <strong>{bucket.count}</strong>
                    </article>
                  ))}
                </div>
              </section>

              <section className="mc-panel">
                <div className="mc-panel__head">
                  <div>
                    <p className="mc-kicker">HAFTALIK EĞİLİM</p>
                    <h3 className="mc-panel__title">Risk ve ihlal trendi</h3>
                  </div>
                </div>
                <div className="mc-trend">
                  {(summary?.weekly_trend ?? []).map((point) => (
                    <article key={point.label} className="mc-trend__item">
                      <strong>{point.value.toFixed(1)}</strong>
                      <div className="mc-trend__bar">
                        <div
                          className="mc-trend__fill"
                          style={{ height: `${Math.max(12, (point.value / trendMax) * 100)}%` }}
                        />
                      </div>
                      <span>{point.label}</span>
                    </article>
                  ))}
                </div>
              </section>

              <section className="mc-panel mc-panel--wide">
                <div className="mc-panel__head">
                  <div>
                    <p className="mc-kicker">DEPARTMAN PERFORMANSI</p>
                    <h3 className="mc-panel__title">Operasyon ve vardiya disiplini özeti</h3>
                  </div>
                </div>
                <div className="mc-department-grid">
                  {(summary?.department_metrics ?? []).slice(0, 6).map((metric) => (
                    <article key={metric.department_name} className="mc-department-card">
                      <strong>{metric.department_name}</strong>
                      <span>{metric.employee_count} personel</span>
                      <span>Ortalama giriş: {formatClockMinutes(metric.average_checkin_minutes)}</span>
                      <span>Geç kalma oranı: %{metric.late_rate_percent}</span>
                      <span>Ortalama aktif süre: <MinuteDisplay minutes={metric.average_active_minutes} /></span>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          </div>

          {!sideRailCollapsed ? (
            <aside className="mc-layout__rail">
              <ManagementConsoleMapPanel
                selectedEmployeeId={selectedEmployeeId}
                departmentId={parseNumber(appliedFilters.department_id)}
                regionId={parseNumber(appliedFilters.region_id)}
                startDate={appliedFilters.start_date}
                endDate={appliedFilters.end_date}
                onSelectEmployee={openEmployee}
              />
              <ManagementConsoleNotificationPanel
                selectedEmployeeId={selectedEmployeeId}
                startDate={appliedFilters.start_date}
                endDate={appliedFilters.end_date}
                onOpenEmployee={openEmployee}
              />
            </aside>
          ) : null}
        </div>
      </div>

      <ManagementConsoleEmployeeDetailModal
        employeeId={selectedEmployeeId}
        open={detailOpen && selectedEmployeeId != null}
        onClose={() => setDetailOpen(false)}
      />
    </>
  )
}
