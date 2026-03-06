import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import {
  auditControlRoomFilters,
  createDeviceInvite,
  getControlRoomOverview,
  getDashboardEmployeeSnapshot,
  getDepartments,
  getDevices,
  getEmployees,
  getLeaves,
  getRegions,
} from '../api/admin'
import { getApiErrorMessage } from '../api/error'
import { CopyField } from '../components/CopyField'
import { EmployeeAutocompleteField } from '../components/EmployeeAutocompleteField'
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
import { formatClockMinutes, formatDateTime, locationStatusLabel, riskStatusLabel, systemStatusClass, systemStatusLabel } from '../components/management-console/utils'
import { useToast } from '../hooks/useToast'

const inviteSchema = z.object({
  employee_id: z.coerce.number().int().positive(),
  expires_in_minutes: z.coerce.number().int().positive().max(1440),
})

const monthLabel = (year: number, month: number) =>
  `${new Intl.DateTimeFormat('tr-TR', { month: 'long' }).format(new Date(Date.UTC(year, month - 1, 1)))} ${year}`
const attendanceTypeLabel = (type: 'IN' | 'OUT') => (type === 'IN' ? 'Giriş' : 'Çıkış')
const todayLabel = (status: 'NOT_STARTED' | 'IN_PROGRESS' | 'FINISHED') =>
  status === 'FINISHED' ? 'Gün tamamlandı' : status === 'IN_PROGRESS' ? 'Mesai sürüyor' : 'Henüz başlamadı'
const leaveLabel = (status: 'APPROVED' | 'PENDING' | 'REJECTED') =>
  status === 'APPROVED' ? 'Onaylı' : status === 'REJECTED' ? 'Reddedildi' : 'Bekliyor'
const leaveClass = (status: 'APPROVED' | 'PENDING' | 'REJECTED') =>
  status === 'APPROVED' ? 'mc-status-pill is-normal' : status === 'REJECTED' ? 'mc-status-pill is-critical' : 'mc-status-pill is-watch'
const shortFingerprint = (value: string) => (value.length <= 18 ? value : `${value.slice(0, 8)}...${value.slice(-8)}`)

function copyWithFallback(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text)
  return new Promise((resolve, reject) => {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'absolute'
    textarea.style.left = '-9999px'
    document.body.appendChild(textarea)
    textarea.select()
    try {
      document.execCommand('copy') ? resolve() : reject(new Error('copy-failed'))
    } catch (error) {
      reject(error)
    } finally {
      document.body.removeChild(textarea)
    }
  })
}

export function ControlRoomPage() {
  const { pushToast } = useToast()
  const [filterForm, setFilterForm] = useState<FilterFormState>(defaultFilters())
  const [appliedFilters, setAppliedFilters] = useState<FilterFormState>(defaultFilters())
  const [page, setPage] = useState(1)
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [sideRailCollapsed, setSideRailCollapsed] = useState(false)
  const [employeeTargetId, setEmployeeTargetId] = useState('')
  const [expiresInMinutes, setExpiresInMinutes] = useState('30')
  const [inviteResult, setInviteResult] = useState<{ token: string; invite_url: string; expires_at: string } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const regionsQuery = useQuery({ queryKey: ['regions', 'management-console'], queryFn: () => getRegions() })
  const departmentsQuery = useQuery({ queryKey: ['departments', 'management-console'], queryFn: () => getDepartments() })
  const employeesQuery = useQuery({ queryKey: ['employees', 'management-console'], queryFn: () => getEmployees({ status: 'all' }) })
  const devicesQuery = useQuery({ queryKey: ['devices', 'management-console'], queryFn: getDevices })
  const leavesQuery = useQuery({ queryKey: ['leaves', 'management-console'], queryFn: () => getLeaves({}) })

  const overviewParams = useMemo(() => toOverviewParams(appliedFilters, page), [appliedFilters, page])
  const overviewQuery = useQuery({ queryKey: ['control-room-overview', overviewParams], queryFn: () => getControlRoomOverview(overviewParams) })
  const snapshotQuery = useQuery({
    queryKey: ['dashboard-employee-snapshot', employeeTargetId],
    queryFn: () => getDashboardEmployeeSnapshot({ employee_id: Number(employeeTargetId) }),
    enabled: Boolean(employeeTargetId),
    staleTime: 20_000,
  })

  const filterAuditMutation = useMutation({ mutationFn: auditControlRoomFilters })
  const inviteMutation = useMutation({
    mutationFn: async (payload: { employee_id?: number; employee_name?: string; expires_in_minutes: number }) => {
      const response = await createDeviceInvite(payload)
      return { ...response, expires_at: new Date(Date.now() + payload.expires_in_minutes * 60_000).toISOString() }
    },
    onSuccess: (data) => {
      setInviteResult({ token: data.token, invite_url: data.invite_url, expires_at: data.expires_at })
      setActionError(null)
    },
    onError: (error) => setActionError(getApiErrorMessage(error, 'Claim token oluşturulamadı.')),
  })

  const openEmployee = (employeeId: number) => {
    setSelectedEmployeeId(employeeId)
    setEmployeeTargetId(String(employeeId))
    setDetailOpen(true)
  }
  const applyFilters = () => {
    const next = { ...filterForm }
    setAppliedFilters(next)
    setPage(1)
    filterAuditMutation.mutate({ filters: { ...toOverviewParams(next, 1) } as Record<string, unknown>, total_results: overviewQuery.data?.total })
  }
  const resetFilters = () => {
    const next = defaultFilters()
    setFilterForm(next)
    setAppliedFilters(next)
    setPage(1)
  }
  const handleSort = (field: SortField) => {
    const sort_dir: FilterFormState['sort_dir'] = appliedFilters.sort_by === field && appliedFilters.sort_dir === 'desc' ? 'asc' : 'desc'
    const next = { ...appliedFilters, sort_by: field, sort_dir }
    setFilterForm(next)
    setAppliedFilters(next)
    setPage(1)
    filterAuditMutation.mutate({ filters: { ...toOverviewParams(next, 1) } as Record<string, unknown>, total_results: overviewQuery.data?.total })
  }
  const createInvite = () => {
    setInviteResult(null)
    setActionError(null)
    const parsed = inviteSchema.safeParse({ employee_id: employeeTargetId, expires_in_minutes: expiresInMinutes })
    if (!parsed.success) {
      setActionError(parsed.error.issues[0]?.message ?? 'Form alanlarını kontrol et.')
      return
    }
    inviteMutation.mutate(parsed.data)
  }

  const copyText = async (value: string) => {
    try {
      await copyWithFallback(value)
      pushToast({ variant: 'success', title: 'Kopyalandı', description: 'Değer panoya alındı.' })
    } catch {
      pushToast({ variant: 'error', title: 'Kopyalama başarısız', description: 'Tarayıcı panoya kopyalamaya izin vermedi.' })
    }
  }

  if (
    regionsQuery.isLoading ||
    departmentsQuery.isLoading ||
    employeesQuery.isLoading ||
    devicesQuery.isLoading ||
    leavesQuery.isLoading ||
    overviewQuery.isLoading
  ) return <LoadingBlock label="ERP paneli yükleniyor..." />

  if (
    regionsQuery.isError ||
    departmentsQuery.isError ||
    employeesQuery.isError ||
    devicesQuery.isError ||
    leavesQuery.isError ||
    overviewQuery.isError ||
    !overviewQuery.data
  ) return <ErrorBlock message="Ana panel verileri alınamadı." />

  const employees = employeesQuery.data ?? []
  const devices = devicesQuery.data ?? []
  const leaves = leavesQuery.data ?? []
  const summary = overviewQuery.data.summary
  const totalPages = Math.max(1, Math.ceil((overviewQuery.data.total ?? 0) / (overviewQuery.data.limit || appliedFilters.limit)))
  const histogramMax = Math.max(1, ...(summary.risk_histogram ?? []).map((item) => item.count))
  const trendMax = Math.max(1, ...(summary.weekly_trend ?? []).map((item) => item.value))
  const selectedEmployee = employees.find((item) => String(item.id) === employeeTargetId) ?? null
  const selectedOverviewItem = overviewQuery.data.items.find((item) => String(item.employee.id) === employeeTargetId) ?? null
  const departmentNameById = new Map((departmentsQuery.data ?? []).map((department) => [department.id, department.name]))
  const selectedDepartmentName =
    selectedEmployee?.department_id != null ? (departmentNameById.get(selectedEmployee.department_id) ?? `Departman #${selectedEmployee.department_id}`) : 'Atanmamış'
  const activeFilterEntries = [
    overviewQuery.data.active_filters.q ? `Sorgu: ${overviewQuery.data.active_filters.q}` : null,
    overviewQuery.data.active_filters.start_date && overviewQuery.data.active_filters.end_date
      ? `Analiz: ${overviewQuery.data.active_filters.start_date} - ${overviewQuery.data.active_filters.end_date}`
      : null,
    overviewQuery.data.active_filters.map_date ? `Harita günü: ${overviewQuery.data.active_filters.map_date}` : null,
    overviewQuery.data.active_filters.region_id ? `Bölge #${overviewQuery.data.active_filters.region_id}` : null,
    overviewQuery.data.active_filters.department_id ? `Departman #${overviewQuery.data.active_filters.department_id}` : null,
    overviewQuery.data.active_filters.risk_status ? `Durum: ${riskStatusLabel(overviewQuery.data.active_filters.risk_status)}` : null,
    overviewQuery.data.active_filters.include_inactive ? 'Pasif personel dahil' : null,
    `Sıralama: ${overviewQuery.data.active_filters.sort_by} / ${overviewQuery.data.active_filters.sort_dir === 'desc' ? 'Azalan' : 'Artan'}`,
    `Limit: ${overviewQuery.data.active_filters.limit}`,
  ].filter(Boolean) as string[]
  const recentLeaves = [...leaves].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5)
  const pendingLeaveCount = leaves.filter((leave) => leave.status === 'PENDING').length
  const recentEvents = overviewQuery.data.recent_events.slice(0, 6)
  const topDepartments = summary.department_metrics.slice(0, 5)
  const activeDeviceCount = devices.filter((device) => device.is_active).length

  return (
    <>
      <div className="mc-console mc-console--erp">
        <ManagementConsoleHeader generatedAtUtc={overviewQuery.data.generated_at_utc} systemStatus={summary.system_status} onRefresh={() => void overviewQuery.refetch()} />
        <ManagementConsoleKpiCards summary={summary} />

        <section className="mc-erp-shell">
          <section className="mc-panel mc-erp-focus">
            <div className="mc-panel__head">
              <div>
                <p className="mc-kicker">PERSONEL ODAĞI</p>
                <h3 className="mc-panel__title">Tek personel görünümü ve claim aksiyonu</h3>
              </div>
              {selectedOverviewItem ? (
                <div className="mc-erp-chip-row">
                  <span className="mc-chip">Risk {selectedOverviewItem.risk_score}</span>
                  <span className="mc-chip">{todayLabel(selectedOverviewItem.today_status)}</span>
                  <span className="mc-chip">{riskStatusLabel(selectedOverviewItem.risk_status)}</span>
                </div>
              ) : null}
            </div>

            <EmployeeAutocompleteField
              label="Personel seç"
              employees={employees}
              value={employeeTargetId}
              onChange={setEmployeeTargetId}
              placeholder="Çalışan adı veya #ID"
              helperText="Tablodan satır seçimi de bu alanı otomatik doldurur."
            />

            {!employeeTargetId ? <div className="mc-empty-state">Özeti açmak için bir personel seçin.</div> : null}
            {employeeTargetId && snapshotQuery.isLoading ? <LoadingBlock label="Personel özeti yükleniyor..." /> : null}
            {employeeTargetId && snapshotQuery.isError ? <ErrorBlock message="Personel özeti alınamadı." /> : null}

            {snapshotQuery.data ? (
              <>
                <div className="mc-erp-employee-head">
                  <div>
                    <strong>{selectedEmployee?.full_name ?? snapshotQuery.data.employee.full_name}</strong>
                    <p>#{snapshotQuery.data.employee.id} · {selectedDepartmentName} · {formatDateTime(snapshotQuery.data.generated_at_utc)}</p>
                  </div>
                  <div className="mc-erp-chip-row">
                    <span className="mc-chip">{todayLabel(snapshotQuery.data.today_status)}</span>
                    <span className="mc-chip">Cihaz {snapshotQuery.data.active_devices}/{snapshotQuery.data.total_devices}</span>
                  </div>
                </div>

                <div className="mc-erp-mini-grid">
                  <article className="mc-erp-stat"><span>Bu ay net süre</span><strong><MinuteDisplay minutes={snapshotQuery.data.current_month.worked_minutes} /></strong><small>{snapshotQuery.data.current_month.incomplete_days} eksik gün</small></article>
                  <article className="mc-erp-stat"><span>Plan üstü süre</span><strong><MinuteDisplay minutes={snapshotQuery.data.current_month.plan_overtime_minutes} /></strong><small>Kurala göre ekstra</small></article>
                  <article className="mc-erp-stat"><span>Yasal fazla mesai</span><strong><MinuteDisplay minutes={snapshotQuery.data.current_month.overtime_minutes} /></strong><small>Bordro takibi</small></article>
                  <article className="mc-erp-stat"><span>Son konum</span><strong>{snapshotQuery.data.latest_location ? `${snapshotQuery.data.latest_location.lat.toFixed(5)}, ${snapshotQuery.data.latest_location.lon.toFixed(5)}` : '-'}</strong><small>{snapshotQuery.data.latest_location ? locationStatusLabel(snapshotQuery.data.latest_location.location_status) : 'Konum yok'}</small></article>
                </div>

                <div className="mc-erp-focus-grid">
                  <section className="mc-erp-card">
                    <div className="mc-erp-card__head"><strong>Aylık karşılaştırma</strong><span>{monthLabel(snapshotQuery.data.current_month.year, snapshotQuery.data.current_month.month)}</span></div>
                    <div className="mc-erp-card__body">
                      <div className="mc-erp-data-row"><span>Bu ay net</span><strong><MinuteDisplay minutes={snapshotQuery.data.current_month.worked_minutes} /></strong></div>
                      <div className="mc-erp-data-row"><span>Bu ay plan üstü</span><strong><MinuteDisplay minutes={snapshotQuery.data.current_month.plan_overtime_minutes} /></strong></div>
                      <div className="mc-erp-data-row"><span>Geçen ay net</span><strong><MinuteDisplay minutes={snapshotQuery.data.previous_month.worked_minutes} /></strong></div>
                      <div className="mc-erp-data-row"><span>Geçen ay yasal</span><strong><MinuteDisplay minutes={snapshotQuery.data.previous_month.overtime_minutes} /></strong></div>
                    </div>
                  </section>
                  <section className="mc-erp-card">
                    <div className="mc-erp-card__head"><strong>Canlı sinyal</strong><span>Son olay ve konum</span></div>
                    <div className="mc-erp-card__body">
                      <div className="mc-erp-data-row"><span>Son puantaj</span><strong>{snapshotQuery.data.last_event ? `${attendanceTypeLabel(snapshotQuery.data.last_event.event_type)} · ${formatDateTime(snapshotQuery.data.last_event.ts_utc)}` : 'Kayıt yok'}</strong></div>
                      <div className="mc-erp-data-row"><span>Konum durumu</span><strong>{snapshotQuery.data.last_event ? locationStatusLabel(snapshotQuery.data.last_event.location_status) : '-'}</strong></div>
                      <div className="mc-erp-data-row"><span>Doğruluk</span><strong>{snapshotQuery.data.latest_location?.accuracy_m != null ? `${Math.round(snapshotQuery.data.latest_location.accuracy_m)} m` : '-'}</strong></div>
                      <div className="mc-erp-data-row"><span>Cihaz</span><strong>{snapshotQuery.data.last_event ? `#${snapshotQuery.data.last_event.device_id}` : '-'}</strong></div>
                    </div>
                  </section>
                </div>

                <section className="mc-erp-card">
                  <div className="mc-erp-card__head"><strong>Cihaz parkuru</strong><span>İlk 6 kayıt</span></div>
                  {snapshotQuery.data.devices.length === 0 ? <div className="mc-empty-state">Bu personele bağlı cihaz bulunmuyor.</div> : (
                    <div className="mc-erp-device-list">
                      {snapshotQuery.data.devices.slice(0, 6).map((device) => (
                        <article key={device.id} className="mc-erp-device-row">
                          <div><strong>#{device.id} · {shortFingerprint(device.device_fingerprint)}</strong><p>Oluşturma: {formatDateTime(device.created_at)}</p></div>
                          <div className="mc-erp-device-row__meta"><span className={device.is_active ? 'mc-status-pill is-normal' : 'mc-status-pill is-critical'}>{device.is_active ? 'Aktif' : 'Pasif'}</span><small>Portal izi: {formatDateTime(device.last_seen_at_utc)}</small></div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              </>
            ) : null}
          </section>

          <aside className="mc-erp-side">
            <section className="mc-panel mc-erp-panel">
              <div className="mc-panel__head"><div><p className="mc-kicker">HIZLI AKSİYON</p><h3 className="mc-panel__title">Claim token üretimi</h3></div></div>
              <label className="mc-field"><span>Token süresi (dakika)</span><input value={expiresInMinutes} onChange={(event) => setExpiresInMinutes(event.target.value)} placeholder="30" /></label>
              {selectedEmployee ? <div className="mc-erp-summary-card"><strong>{selectedEmployee.full_name}</strong><p>#{selectedEmployee.id} · {selectedDepartmentName} · {selectedEmployee.is_active ? 'Aktif' : 'Pasif'}</p></div> : <div className="mc-empty-state">Token için önce personel seçin.</div>}
              <button type="button" className="mc-button mc-button--primary" disabled={inviteMutation.isPending || !employeeTargetId} onClick={createInvite}>{inviteMutation.isPending ? 'Oluşturuluyor...' : 'Claim token oluştur'}</button>
              {inviteResult ? <div className="mc-erp-copy-stack"><CopyField label="Token" value={inviteResult.token} onCopy={(value) => void copyText(value)} /><CopyField label="URL" value={inviteResult.invite_url} onCopy={(value) => void copyText(value)} /><div className="mc-erp-inline-note">Tahmini geçerlilik sonu: {formatDateTime(inviteResult.expires_at)}</div></div> : null}
              {actionError ? <div className="form-validation">{actionError}</div> : null}
            </section>

            <section className="mc-panel mc-erp-panel">
              <div className="mc-panel__head"><div><p className="mc-kicker">CANLI AKIŞ</p><h3 className="mc-panel__title">Son yoklama kayıtları</h3></div></div>
              <div className="mc-erp-feed">
                {recentEvents.map((event) => (
                  <article key={event.event_id} className="mc-erp-feed__row">
                    <div><strong>{event.employee_name}</strong><p>{event.department_name ?? 'Departman yok'} · cihaz #{event.device_id}</p></div>
                    <div className="mc-erp-feed__meta"><strong>{attendanceTypeLabel(event.event_type)}</strong><small>{formatDateTime(event.ts_utc)}</small></div>
                  </article>
                ))}
              </div>
            </section>

            <section className="mc-panel mc-erp-panel">
              <div className="mc-panel__head"><div><p className="mc-kicker">İZİN RADARI</p><h3 className="mc-panel__title">Bekleyen ve son açılan izinler</h3></div><span className="mc-status-pill is-watch">{pendingLeaveCount} bekleyen</span></div>
              <div className="mc-erp-feed">
                {recentLeaves.map((leave) => (
                  <article key={leave.id} className="mc-erp-feed__row">
                    <div><strong>Personel #{leave.employee_id}</strong><p>{leave.start_date} - {leave.end_date}</p></div>
                    <div className="mc-erp-feed__meta"><span className={leaveClass(leave.status)}>{leaveLabel(leave.status)}</span><small>{formatDateTime(leave.created_at)}</small></div>
                  </article>
                ))}
              </div>
            </section>
          </aside>
        </section>

        <ManagementConsoleFilters filterForm={filterForm} regions={regionsQuery.data ?? []} departments={departmentsQuery.data ?? []} activeFilterEntries={activeFilterEntries} onChange={setFilterForm} onApply={applyFilters} onReset={resetFilters} />

        <div className="mc-layout-toolbar">
          <div className="mc-layout-toolbar__summary">
            <strong>Canlı kapsam</strong>
            <span>Son güncelleme {formatDateTime(overviewQuery.data.generated_at_utc)} · Sistem durumu <span className={`mc-status-pill ${systemStatusClass(summary.system_status)}`}>{systemStatusLabel(summary.system_status)}</span></span>
          </div>
          <button type="button" className="mc-button mc-button--ghost" onClick={() => setSideRailCollapsed((current) => !current)}>{sideRailCollapsed ? 'Sağ paneli aç' : 'Sağ paneli daralt'}</button>
        </div>

        <div className={`mc-layout ${sideRailCollapsed ? 'is-collapsed' : ''}`}>
          <div className="mc-layout__main">
            <ManagementConsoleMatrixTable items={overviewQuery.data.items} total={overviewQuery.data.total} page={page} totalPages={totalPages} filters={appliedFilters} onSort={handleSort} onOpenEmployee={openEmployee} selectedEmployeeId={selectedEmployeeId} onPageChange={setPage} />

            <div className="mc-secondary-grid">
              <section className="mc-panel">
                <div className="mc-panel__head"><div><p className="mc-kicker">RİSK DAĞILIMI</p><h3 className="mc-panel__title">Skor yoğunluğu</h3></div></div>
                <div className="mc-histogram">{summary.risk_histogram.map((bucket) => <article key={bucket.label} className="mc-histogram__row"><span>{bucket.label}</span><div className="mc-histogram__track"><div className="mc-histogram__fill" style={{ width: `${(bucket.count / histogramMax) * 100}%` }} /></div><strong>{bucket.count}</strong></article>)}</div>
              </section>
              <section className="mc-panel">
                <div className="mc-panel__head"><div><p className="mc-kicker">HAFTALIK EĞİLİM</p><h3 className="mc-panel__title">Risk ve ihlal trendi</h3></div></div>
                <div className="mc-trend">{summary.weekly_trend.map((point) => <article key={point.label} className="mc-trend__item"><strong>{point.value.toFixed(1)}</strong><div className="mc-trend__bar"><div className="mc-trend__fill" style={{ height: `${Math.max(12, (point.value / trendMax) * 100)}%` }} /></div><span>{point.label}</span></article>)}</div>
              </section>
              <section className="mc-panel mc-panel--wide">
                <div className="mc-panel__head"><div><p className="mc-kicker">DEPARTMAN YOĞUNLUĞU</p><h3 className="mc-panel__title">Operasyon ve vardiya disiplini özeti</h3></div><span className="mc-chip">{activeDeviceCount}/{devices.length} aktif cihaz</span></div>
                <div className="mc-erp-department-list">
                  {topDepartments.map((metric) => (
                    <article key={metric.department_name} className="mc-erp-department-row">
                      <div><strong>{metric.department_name}</strong><p>{metric.employee_count} personel</p></div>
                      <div className="mc-erp-department-row__meta"><span>Giriş {formatClockMinutes(metric.average_checkin_minutes)}</span><span>Geç kalma %{metric.late_rate_percent}</span><span>Aktif süre <MinuteDisplay minutes={metric.average_active_minutes} /></span></div>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          </div>

          {!sideRailCollapsed ? (
            <aside className="mc-layout__rail">
              <ManagementConsoleMapPanel selectedEmployeeId={selectedEmployeeId} departmentId={parseNumber(appliedFilters.department_id)} regionId={parseNumber(appliedFilters.region_id)} startDate={appliedFilters.start_date} endDate={appliedFilters.end_date} onSelectEmployee={openEmployee} />
              <ManagementConsoleNotificationPanel selectedEmployeeId={selectedEmployeeId} startDate={appliedFilters.start_date} endDate={appliedFilters.end_date} onOpenEmployee={openEmployee} />
            </aside>
          ) : null}
        </div>
      </div>

      <ManagementConsoleEmployeeDetailModal employeeId={selectedEmployeeId} open={detailOpen && selectedEmployeeId != null} onClose={() => setDetailOpen(false)} />
    </>
  )
}
