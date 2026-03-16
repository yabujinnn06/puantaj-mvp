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
import { ManagementConsoleMatrixTable } from '../components/management-console/ManagementConsoleMatrixTable'
import { ManagementConsoleNotificationPanel } from '../components/management-console/ManagementConsoleNotificationPanel'
import { defaultFilters, toOverviewParams, type FilterFormState, type SortField } from '../components/management-console/types'
import {
  formatClockMinutes,
  formatDateTime,
  riskClass,
  riskStatusLabel,
  systemStatusClass,
  systemStatusLabel,
} from '../components/management-console/utils'
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
  status === 'APPROVED'
    ? 'mc-status-pill is-normal'
    : status === 'REJECTED'
      ? 'mc-status-pill is-critical'
      : 'mc-status-pill is-watch'
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
  const overviewQuery = useQuery({
    queryKey: ['control-room-overview', overviewParams],
    queryFn: () => getControlRoomOverview(overviewParams),
  })
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
    const sort_dir: FilterFormState['sort_dir'] =
      appliedFilters.sort_by === field && appliedFilters.sort_dir === 'desc' ? 'asc' : 'desc'
    const next = { ...appliedFilters, sort_by: field, sort_dir }
    setFilterForm(next)
    setAppliedFilters(next)
    setPage(1)
    filterAuditMutation.mutate({
      filters: { ...toOverviewParams(next, 1) } as Record<string, unknown>,
      total_results: overviewQuery.data?.total,
    })
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
      pushToast({
        variant: 'error',
        title: 'Kopyalama başarısız',
        description: 'Tarayıcı panoya kopyalamaya izin vermedi.',
      })
    }
  }

  if (
    regionsQuery.isLoading ||
    departmentsQuery.isLoading ||
    employeesQuery.isLoading ||
    devicesQuery.isLoading ||
    leavesQuery.isLoading ||
    overviewQuery.isLoading
  ) {
    return <LoadingBlock label="ERP paneli yükleniyor..." />
  }

  if (
    regionsQuery.isError ||
    departmentsQuery.isError ||
    employeesQuery.isError ||
    devicesQuery.isError ||
    leavesQuery.isError ||
    overviewQuery.isError ||
    !overviewQuery.data
  ) {
    return <ErrorBlock message="Ana panel verileri alınamadı." />
  }

  const employees = employeesQuery.data ?? []
  const devices = devicesQuery.data ?? []
  const leaves = leavesQuery.data ?? []
  const summary = overviewQuery.data.summary
  const totalPages = Math.max(
    1,
    Math.ceil((overviewQuery.data.total ?? 0) / (overviewQuery.data.limit || appliedFilters.limit)),
  )
  const histogramMax = Math.max(1, ...(summary.risk_histogram ?? []).map((item) => item.count))
  const trendMax = Math.max(1, ...(summary.weekly_trend ?? []).map((item) => item.value))
  const selectedEmployee = employees.find((item) => String(item.id) === employeeTargetId) ?? null
  const selectedOverviewItem =
    overviewQuery.data.items.find((item) => String(item.employee.id) === employeeTargetId) ?? null
  const focusEmployee = selectedOverviewItem ?? overviewQuery.data.items[0] ?? null
  const departmentNameById = new Map(
    (departmentsQuery.data ?? []).map((department) => [department.id, department.name]),
  )
  const selectedDepartmentName =
    selectedEmployee?.department_id != null
      ? (departmentNameById.get(selectedEmployee.department_id) ?? `Departman #${selectedEmployee.department_id}`)
      : 'Atanmamış'

  const activeFilterEntries = [
    overviewQuery.data.active_filters.q ? `Sorgu: ${overviewQuery.data.active_filters.q}` : null,
    overviewQuery.data.active_filters.start_date && overviewQuery.data.active_filters.end_date
      ? `Analiz: ${overviewQuery.data.active_filters.start_date} - ${overviewQuery.data.active_filters.end_date}`
      : null,
    overviewQuery.data.active_filters.region_id
      ? `Bölge #${overviewQuery.data.active_filters.region_id}`
      : null,
    overviewQuery.data.active_filters.department_id
      ? `Departman #${overviewQuery.data.active_filters.department_id}`
      : null,
    overviewQuery.data.active_filters.risk_status
      ? `Durum: ${riskStatusLabel(overviewQuery.data.active_filters.risk_status)}`
      : null,
    overviewQuery.data.active_filters.include_inactive ? 'Pasif personel dahil' : null,
    `Sıralama: ${overviewQuery.data.active_filters.sort_by} / ${overviewQuery.data.active_filters.sort_dir === 'desc' ? 'Azalan' : 'Artan'}`,
    `Limit: ${overviewQuery.data.active_filters.limit}`,
  ].filter(Boolean) as string[]

  const recentLeaves = [...leaves].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5)
  const recentEvents = overviewQuery.data.recent_events.slice(0, 4)
  const pendingLeaveCount = leaves.filter((leave) => leave.status === 'PENDING').length
  const topDepartments = summary.department_metrics.slice(0, 5)
  const activeDeviceCount = devices.filter((device) => device.is_active).length
  const focusSignals = focusEmployee
    ? [focusEmployee.active_measure?.label, ...focusEmployee.attention_flags.slice(0, 2).map((flag) => flag.label)]
        .filter(Boolean)
        .slice(0, 3)
    : []

  return (
    <>
      <div className="mc-console mc-console--erp mc-console--control-room">
        <ManagementConsoleHeader
          generatedAtUtc={overviewQuery.data.generated_at_utc}
          systemStatus={summary.system_status}
          onRefresh={() => void overviewQuery.refetch()}
        />

        <ManagementConsoleKpiCards summary={summary} />

        <ManagementConsoleFilters
          filterForm={filterForm}
          regions={regionsQuery.data ?? []}
          departments={departmentsQuery.data ?? []}
          activeFilterEntries={activeFilterEntries}
          onChange={setFilterForm}
          onApply={applyFilters}
          onReset={resetFilters}
        />

        <section className="mc-workbench">
          <section className="mc-panel mc-workbench__focus">
            <div className="mc-panel__head mc-panel__head--tight">
              <div>
                <p className="mc-kicker">PERSONEL ODAĞI</p>
                <h3 className="mc-panel__title">Seçili personel özeti ve operasyon bağlamı</h3>
              </div>
              {focusEmployee ? (
                <div className="mc-workbench__head-actions">
                  <span className={`mc-status-pill ${riskClass(focusEmployee.risk_status)}`}>
                    {riskStatusLabel(focusEmployee.risk_status)}
                  </span>
                  <button
                    type="button"
                    className="mc-button mc-button--secondary"
                    onClick={() => openEmployee(focusEmployee.employee.id)}
                  >
                    Operasyon dosyasını aç
                  </button>
                </div>
              ) : null}
            </div>

            <EmployeeAutocompleteField
              label="Personel seç"
              employees={employees}
              value={employeeTargetId}
              onChange={setEmployeeTargetId}
              placeholder="Çalışan adı veya #ID"
              helperText="Matriste seçtiğiniz satır bu alanı otomatik doldurur."
            />

            {focusEmployee ? (
              <>
                <section className="mc-focus-card">
                  <div className="mc-focus-card__identity">
                    <div>
                      <p className="mc-focus-card__eyebrow">
                        {selectedOverviewItem ? 'Seçili personel' : 'Önerilen odak'}
                      </p>
                      <h3>{focusEmployee.employee.full_name}</h3>
                      <p>
                        #{focusEmployee.employee.id} · {focusEmployee.department_name ?? 'Departman atanmadı'} ·{' '}
                        {focusEmployee.shift_window_label ?? 'Plan bilgisi yok'}
                      </p>
                    </div>
                    <div className="mc-focus-card__status">
                      <strong>Risk {focusEmployee.risk_score}</strong>
                      <span>{todayLabel(focusEmployee.today_status)}</span>
                    </div>
                  </div>

                  <div className="mc-focus-card__metrics">
                    <article className="mc-focus-metric">
                      <span>Bugün</span>
                      <strong>
                        <MinuteDisplay minutes={focusEmployee.worked_today_minutes} />
                      </strong>
                      <small>{focusEmployee.shift_name ?? 'Varsayılan vardiya'}</small>
                    </article>
                    <article className="mc-focus-metric">
                      <span>Hafta</span>
                      <strong>
                        <MinuteDisplay minutes={focusEmployee.weekly_total_minutes} />
                      </strong>
                      <small>{focusEmployee.violation_count_7d} ihlal / 7 gün</small>
                    </article>
                    <article className="mc-focus-metric">
                      <span>Son aktivite</span>
                      <strong>{formatDateTime(focusEmployee.last_activity_utc)}</strong>
                      <small>{focusEmployee.recent_ip ?? 'IP yok'}</small>
                    </article>
                  </div>

                  {focusSignals.length ? (
                    <div className="mc-focus-card__signals">
                      {focusSignals.map((label) => (
                        <span key={label} className="mc-chip">
                          {label}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </section>

                {employeeTargetId && snapshotQuery.isLoading ? (
                  <LoadingBlock label="Personel özeti yükleniyor..." />
                ) : null}
                {employeeTargetId && snapshotQuery.isError ? (
                  <ErrorBlock message="Personel özeti alınamadı." />
                ) : null}

                {snapshotQuery.data ? (
                  <div className="mc-focus-support">
                    <article className="mc-panel mc-panel--subtle">
                      <div className="mc-panel__head mc-panel__head--tight">
                        <div>
                          <p className="mc-kicker">AYLIK RİTİM</p>
                          <h3 className="mc-panel__title">
                            {monthLabel(
                              snapshotQuery.data.current_month.year,
                              snapshotQuery.data.current_month.month,
                            )}
                          </h3>
                        </div>
                      </div>
                      <div className="mc-focus-data-list">
                        <div className="mc-focus-data-row">
                          <span>Bu ay net</span>
                          <strong>
                            <MinuteDisplay minutes={snapshotQuery.data.current_month.worked_minutes} />
                          </strong>
                        </div>
                        <div className="mc-focus-data-row">
                          <span>Plan üstü</span>
                          <strong>
                            <MinuteDisplay minutes={snapshotQuery.data.current_month.plan_overtime_minutes} />
                          </strong>
                        </div>
                        <div className="mc-focus-data-row">
                          <span>Yasal mesai</span>
                          <strong>
                            <MinuteDisplay minutes={snapshotQuery.data.current_month.overtime_minutes} />
                          </strong>
                        </div>
                        <div className="mc-focus-data-row">
                          <span>Eksik gün</span>
                          <strong>{snapshotQuery.data.current_month.incomplete_days}</strong>
                        </div>
                      </div>
                    </article>

                    <article className="mc-panel mc-panel--subtle">
                      <div className="mc-panel__head mc-panel__head--tight">
                        <div>
                          <p className="mc-kicker">SON SİNYAL</p>
                          <h3 className="mc-panel__title">Puantaj ve cihaz görünümü</h3>
                        </div>
                      </div>
                      <div className="mc-focus-data-list">
                        <div className="mc-focus-data-row">
                          <span>Son puantaj</span>
                          <strong>
                            {snapshotQuery.data.last_event
                              ? `${attendanceTypeLabel(snapshotQuery.data.last_event.event_type)} · ${formatDateTime(snapshotQuery.data.last_event.ts_utc)}`
                              : 'Kayıt yok'}
                          </strong>
                        </div>
                        <div className="mc-focus-data-row">
                          <span>Cihaz</span>
                          <strong>
                            {snapshotQuery.data.last_event ? `#${snapshotQuery.data.last_event.device_id}` : '-'}
                          </strong>
                        </div>
                        <div className="mc-focus-data-row">
                          <span>Portal izi</span>
                          <strong>{formatDateTime(focusEmployee.last_portal_seen_utc)}</strong>
                        </div>
                        <div className="mc-focus-data-row">
                          <span>Takip ekranı</span>
                          <strong>Konum takibi ayri merkezde</strong>
                        </div>
                      </div>
                    </article>

                    <article className="mc-panel mc-panel--subtle">
                      <div className="mc-panel__head mc-panel__head--tight">
                        <div>
                          <p className="mc-kicker">CİHAZ AYAK İZİ</p>
                          <h3 className="mc-panel__title">Portal ve cihaz parkuru</h3>
                        </div>
                      </div>
                      <div className="mc-focus-data-list">
                        <div className="mc-focus-data-row">
                          <span>Aktif cihaz</span>
                          <strong>
                            {snapshotQuery.data.active_devices}/{snapshotQuery.data.total_devices}
                          </strong>
                        </div>
                        <div className="mc-focus-data-row">
                          <span>Portal izi</span>
                          <strong>{formatDateTime(focusEmployee.last_portal_seen_utc)}</strong>
                        </div>
                        <div className="mc-focus-data-row">
                          <span>İlk cihaz izi</span>
                          <strong>
                            {snapshotQuery.data.devices[0]
                              ? shortFingerprint(snapshotQuery.data.devices[0].device_fingerprint)
                              : 'Cihaz yok'}
                          </strong>
                        </div>
                      </div>
                    </article>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="mc-empty-state">Odak kartı için matriste bir personel seçin.</div>
            )}
          </section>

          <aside className="mc-workbench__utility">
            <section className="mc-panel mc-panel--utility">
              <div className="mc-panel__head mc-panel__head--tight">
                <div>
                  <p className="mc-kicker">UTILITY PANEL</p>
                  <h3 className="mc-panel__title">Claim token üretimi</h3>
                </div>
              </div>
              <div className="mc-utility-callout">
                <strong>{selectedEmployee ? selectedEmployee.full_name : 'Personel seçimi bekleniyor'}</strong>
                <p>
                  {selectedEmployee
                    ? `#${selectedEmployee.id} · ${selectedDepartmentName} · ${selectedEmployee.is_active ? 'Aktif' : 'Pasif'}`
                    : 'Token üretmek için odak personeli seçin.'}
                </p>
              </div>
              <label className="mc-field">
                <span>Token süresi (dakika)</span>
                <input
                  value={expiresInMinutes}
                  onChange={(event) => setExpiresInMinutes(event.target.value)}
                  placeholder="30"
                />
              </label>
              <button
                type="button"
                className="mc-button mc-button--primary"
                disabled={inviteMutation.isPending || !employeeTargetId}
                onClick={createInvite}
              >
                {inviteMutation.isPending ? 'Oluşturuluyor...' : 'Claim token oluştur'}
              </button>
              {inviteResult ? (
                <div className="mc-utility-copy-stack">
                  <CopyField label="Token" value={inviteResult.token} onCopy={(value) => void copyText(value)} />
                  <CopyField label="URL" value={inviteResult.invite_url} onCopy={(value) => void copyText(value)} />
                  <div className="mc-inline-note">
                    Geçerlilik sonu: {formatDateTime(inviteResult.expires_at)}
                  </div>
                </div>
              ) : null}
              {actionError ? <div className="form-validation">{actionError}</div> : null}
            </section>

            <section className="mc-panel mc-panel--secondary-card">
              <div className="mc-panel__head mc-panel__head--tight">
                <div>
                  <p className="mc-kicker">CANLI AKIŞ</p>
                  <h3 className="mc-panel__title">Son yoklama kayıtları</h3>
                </div>
              </div>
              <div className="mc-utility-list">
                {recentEvents.map((event) => (
                  <article key={event.event_id} className="mc-utility-list__row">
                    <div>
                      <strong>{event.employee_name}</strong>
                      <p>
                        {event.department_name ?? 'Departman yok'} · cihaz #{event.device_id}
                      </p>
                    </div>
                    <div className="mc-utility-list__meta">
                      <strong>{attendanceTypeLabel(event.event_type)}</strong>
                      <small>{formatDateTime(event.ts_utc)}</small>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="mc-panel mc-panel--secondary-card">
              <div className="mc-panel__head mc-panel__head--tight">
                <div>
                  <p className="mc-kicker">İZİN RADARI</p>
                  <h3 className="mc-panel__title">Bekleyen ve son açılan izinler</h3>
                </div>
                <span className="mc-status-pill is-watch">{pendingLeaveCount} bekleyen</span>
              </div>
              <div className="mc-utility-list">
                {recentLeaves.slice(0, 3).map((leave) => (
                  <article key={leave.id} className="mc-utility-list__row">
                    <div>
                      <strong>Personel #{leave.employee_id}</strong>
                      <p>
                        {leave.start_date} - {leave.end_date}
                      </p>
                    </div>
                    <div className="mc-utility-list__meta">
                      <span className={leaveClass(leave.status)}>{leaveLabel(leave.status)}</span>
                      <small>{formatDateTime(leave.created_at)}</small>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </aside>
        </section>

        <div className="mc-layout-toolbar mc-layout-toolbar--control-room">
          <div className="mc-layout-toolbar__summary">
            <strong>Canlı kapsam</strong>
            <span>
              Son güncelleme {formatDateTime(overviewQuery.data.generated_at_utc)} · Sistem durumu{' '}
              <span className={`mc-status-pill ${systemStatusClass(summary.system_status)}`}>
                {systemStatusLabel(summary.system_status)}
              </span>
            </span>
          </div>
          <button
            type="button"
            className="mc-button mc-button--ghost"
            onClick={() => setSideRailCollapsed((current) => !current)}
          >
            {sideRailCollapsed ? 'Sağ raili aç' : 'Sağ raili daralt'}
          </button>
        </div>

        <div className={`mc-layout mc-layout--control-room ${sideRailCollapsed ? 'is-collapsed' : ''}`}>
          <div className="mc-layout__main mc-layout__main--control-room">
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

            <div className="mc-secondary-grid mc-secondary-grid--control-room">
              <section className="mc-panel mc-panel--secondary-card">
                <div className="mc-panel__head mc-panel__head--tight">
                  <div>
                    <p className="mc-kicker">RİSK DAĞILIMI</p>
                    <h3 className="mc-panel__title">Skor yoğunluğu</h3>
                  </div>
                </div>
                <div className="mc-histogram">
                  {summary.risk_histogram.map((bucket) => (
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

              <section className="mc-panel mc-panel--secondary-card">
                <div className="mc-panel__head mc-panel__head--tight">
                  <div>
                    <p className="mc-kicker">HAFTALIK EĞİLİM</p>
                    <h3 className="mc-panel__title">Risk ve ihlal trendi</h3>
                  </div>
                </div>
                <div className="mc-trend">
                  {summary.weekly_trend.map((point) => (
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

              <section className="mc-panel mc-panel--wide mc-panel--secondary-card">
                <div className="mc-panel__head mc-panel__head--tight">
                  <div>
                    <p className="mc-kicker">DEPARTMAN ÖZETİ</p>
                    <h3 className="mc-panel__title">Operasyon ve vardiya disiplini görünümü</h3>
                  </div>
                  <span className="mc-chip">
                    {activeDeviceCount}/{devices.length} aktif cihaz
                  </span>
                </div>
                <div className="mc-erp-department-list">
                  {topDepartments.map((metric) => (
                    <article key={metric.department_name} className="mc-erp-department-row">
                      <div>
                        <strong>{metric.department_name}</strong>
                        <p>{metric.employee_count} personel</p>
                      </div>
                      <div className="mc-erp-department-row__meta">
                        <span>Giriş {formatClockMinutes(metric.average_checkin_minutes)}</span>
                        <span>Geç kalma %{metric.late_rate_percent}</span>
                        <span>
                          Aktif süre <MinuteDisplay minutes={metric.average_active_minutes} />
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          </div>

          {!sideRailCollapsed ? (
            <aside className="mc-layout__rail mc-layout__rail--control-room">
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
