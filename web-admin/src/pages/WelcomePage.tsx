import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { getControlRoomOverview, getDepartments, getEmployees, getRegions } from '../api/admin'
import { EmployeeAutocompleteField } from '../components/EmployeeAutocompleteField'
import { ErrorBlock } from '../components/ErrorBlock'
import { LoadingBlock } from '../components/LoadingBlock'
import { MinuteDisplay } from '../components/MinuteDisplay'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'
import { controlRoomQueryKeys } from '../components/control-room/queryKeys'
import { formatDateTime, todayStatusLabel } from '../components/control-room/utils'
import type { ControlRoomEmployeeState } from '../types/api'

type WelcomeSortField =
  | 'employee_name'
  | 'worked_today'
  | 'weekly_total'
  | 'overtime'
  | 'plan_overtime'
  | 'extra_work'

type EmploymentFilter = 'all' | 'active' | 'inactive'

type WelcomeTableRow = {
  id: number
  fullName: string
  regionId: number | null
  regionName: string
  departmentId: number | null
  departmentName: string
  isActive: boolean
  todayStatus: ControlRoomEmployeeState['today_status']
  workedTodayMinutes: number
  weeklyTotalMinutes: number
  overtimeMinutes: number
  planOvertimeMinutes: number
  extraWorkMinutes: number
}

const WELCOME_PAGE_SIZES = [12, 24, 48]

function compareRows(
  left: WelcomeTableRow,
  right: WelcomeTableRow,
  field: WelcomeSortField,
  direction: 'asc' | 'desc',
): number {
  const multiplier = direction === 'asc' ? 1 : -1

  if (field === 'employee_name') {
    return left.fullName.localeCompare(right.fullName, 'tr') * multiplier
  }

  const leftValue =
    field === 'worked_today'
      ? left.workedTodayMinutes
      : field === 'weekly_total'
        ? left.weeklyTotalMinutes
        : field === 'plan_overtime'
          ? left.planOvertimeMinutes
          : field === 'extra_work'
            ? left.extraWorkMinutes
            : left.overtimeMinutes

  const rightValue =
    field === 'worked_today'
      ? right.workedTodayMinutes
      : field === 'weekly_total'
        ? right.weeklyTotalMinutes
        : field === 'plan_overtime'
          ? right.planOvertimeMinutes
          : field === 'extra_work'
            ? right.extraWorkMinutes
            : right.overtimeMinutes

  if (leftValue === rightValue) {
    return left.fullName.localeCompare(right.fullName, 'tr')
  }

  return (leftValue - rightValue) * multiplier
}

function sortIndicator(field: WelcomeSortField, activeField: WelcomeSortField, direction: 'asc' | 'desc') {
  if (field !== activeField) return null
  return direction === 'asc' ? '?' : '?'
}

function statusTone(value: ControlRoomEmployeeState['today_status']): string {
  if (value === 'IN_PROGRESS') return 'is-live'
  if (value === 'FINISHED') return 'is-finished'
  return 'is-waiting'
}

function WelcomeHeroMetric({
  label,
  value,
  note,
  tone = 'default',
}: {
  label: string
  value: ReactNode
  note: ReactNode
  tone?: 'default' | 'live' | 'watch' | 'active'
}) {
  return (
    <article className={`welcome-summary-card is-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  )
}

function WelcomeSignalCard({
  label,
  title,
  note,
}: {
  label: string
  title: ReactNode
  note?: ReactNode
}) {
  return (
    <article className="welcome-signal-card">
      <span>{label}</span>
      <strong>{title}</strong>
      {note ? <p>{note}</p> : null}
    </article>
  )
}

export function WelcomePage() {
  const [employeeId, setEmployeeId] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [regionId, setRegionId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [employmentFilter, setEmploymentFilter] = useState<EmploymentFilter>('all')
  const [pageSize, setPageSize] = useState(24)
  const [page, setPage] = useState(1)
  const [sortField, setSortField] = useState<WelcomeSortField>('overtime')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')

  const employeesQuery = useQuery({
    queryKey: controlRoomQueryKeys.employees,
    queryFn: () => getEmployees({ include_inactive: true, status: 'all' }),
    staleTime: 5 * 60_000,
  })

  const regionsQuery = useQuery({
    queryKey: controlRoomQueryKeys.regions,
    queryFn: () => getRegions({ include_inactive: true }),
    staleTime: 5 * 60_000,
  })

  const departmentsQuery = useQuery({
    queryKey: controlRoomQueryKeys.departments,
    queryFn: () => getDepartments(),
    staleTime: 5 * 60_000,
  })

  const overviewLimit = Math.max(100, employeesQuery.data?.length ?? 0)

  const overviewQuery = useQuery({
    enabled: employeesQuery.isSuccess,
    queryKey: ['welcome', 'overtime-overview', overviewLimit],
    queryFn: () =>
      getControlRoomOverview({
        include_inactive: true,
        limit: overviewLimit,
        offset: 0,
        sort_by: 'employee_name',
        sort_dir: 'asc',
      }),
    staleTime: 60_000,
  })

  useEffect(() => {
    setPage(1)
  }, [departmentId, employeeId, employmentFilter, pageSize, regionId, searchTerm, sortDirection, sortField])

  const employees = employeesQuery.data ?? []
  const departments = departmentsQuery.data ?? []
  const overviewItems = overviewQuery.data?.items ?? []

  const stateByEmployeeId = useMemo(
    () => new Map(overviewItems.map((item) => [item.employee.id, item])),
    [overviewItems],
  )

  const departmentById = useMemo(
    () => new Map(departments.map((department) => [department.id, department.name])),
    [departments],
  )

  const filteredDepartments = useMemo(() => {
    if (!regionId) return departments
    return departments.filter((department) => String(department.region_id) === regionId)
  }, [departments, regionId])

  useEffect(() => {
    if (!departmentId) return
    if (filteredDepartments.some((department) => String(department.id) === departmentId)) return
    setDepartmentId('')
  }, [departmentId, filteredDepartments])

  const rows = useMemo<WelcomeTableRow[]>(() => {
    return employees.map((employee) => {
      const state = stateByEmployeeId.get(employee.id)

      return {
        id: employee.id,
        fullName: employee.full_name,
        regionId: state?.employee.region_id ?? employee.region_id ?? null,
        regionName: state?.employee.region_name ?? employee.region_name ?? '-',
        departmentId: state?.employee.department_id ?? employee.department_id ?? null,
        departmentName:
          state?.department_name ??
          (employee.department_id != null ? (departmentById.get(employee.department_id) ?? '-') : '-'),
        isActive: employee.is_active,
        todayStatus: state?.today_status ?? 'NOT_STARTED',
        workedTodayMinutes: state?.worked_today_minutes ?? 0,
        weeklyTotalMinutes: state?.weekly_total_minutes ?? 0,
        overtimeMinutes: state?.current_month.overtime_minutes ?? 0,
        planOvertimeMinutes: state?.current_month.plan_overtime_minutes ?? 0,
        extraWorkMinutes: state?.current_month.extra_work_minutes ?? 0,
      }
    })
  }, [departmentById, employees, stateByEmployeeId])

  const filteredRows = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase()

    return rows.filter((row) => {
      if (employeeId && String(row.id) !== employeeId) return false
      if (regionId && String(row.regionId ?? '') !== regionId) return false
      if (departmentId && String(row.departmentId ?? '') !== departmentId) return false
      if (employmentFilter === 'active' && !row.isActive) return false
      if (employmentFilter === 'inactive' && row.isActive) return false
      if (!normalizedSearch) return true

      return (
        row.fullName.toLowerCase().includes(normalizedSearch) ||
        String(row.id).includes(normalizedSearch.replace('#', ''))
      )
    })
  }, [departmentId, employeeId, employmentFilter, regionId, rows, searchTerm])

  const sortedRows = useMemo(
    () => [...filteredRows].sort((left, right) => compareRows(left, right, sortField, sortDirection)),
    [filteredRows, sortDirection, sortField],
  )

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageStart = (safePage - 1) * pageSize
  const pagedRows = sortedRows.slice(pageStart, pageStart + pageSize)
  const rangeStart = sortedRows.length === 0 ? 0 : pageStart + 1
  const rangeEnd = sortedRows.length === 0 ? 0 : Math.min(pageStart + pageSize, sortedRows.length)

  const summary = useMemo(() => {
    return filteredRows.reduce(
      (acc, row) => {
        acc.total += 1
        acc.active += Number(row.isActive)
        acc.overtime += row.overtimeMinutes
        acc.planOvertime += row.planOvertimeMinutes
        acc.extraWork += row.extraWorkMinutes
        return acc
      },
      {
        total: 0,
        active: 0,
        overtime: 0,
        planOvertime: 0,
        extraWork: 0,
      },
    )
  }, [filteredRows])

  const heroInsights = useMemo(() => {
    const liveCount = filteredRows.filter((row) => row.todayStatus === 'IN_PROGRESS').length
    const finishedCount = filteredRows.filter((row) => row.todayStatus === 'FINISHED').length
    const waitingCount = Math.max(0, filteredRows.length - liveCount - finishedCount)
    const activeRate = summary.total ? Math.round((summary.active / summary.total) * 100) : 0

    const topOvertimeRow = filteredRows.reduce<WelcomeTableRow | null>((current, row) => {
      if (!current || row.overtimeMinutes > current.overtimeMinutes) {
        return row
      }
      return current
    }, null)

    const departmentLoads = new Map<string, { name: string; overtimeMinutes: number; employeeCount: number }>()
    for (const row of filteredRows) {
      const key = row.departmentName || '-'
      const current = departmentLoads.get(key) ?? {
        name: row.departmentName || 'Departman tanımsız',
        overtimeMinutes: 0,
        employeeCount: 0,
      }
      current.overtimeMinutes += row.overtimeMinutes
      current.employeeCount += 1
      departmentLoads.set(key, current)
    }

    const topDepartment =
      [...departmentLoads.values()].sort((left, right) => {
        if (left.overtimeMinutes === right.overtimeMinutes) {
          return right.employeeCount - left.employeeCount
        }
        return right.overtimeMinutes - left.overtimeMinutes
      })[0] ?? null

    return {
      liveCount,
      finishedCount,
      waitingCount,
      activeRate,
      topOvertimeRow,
      topDepartment,
    }
  }, [filteredRows, summary.active, summary.total])

  const handleSort = (field: WelcomeSortField) => {
    if (field === sortField) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }

    setSortField(field)
    setSortDirection(field === 'employee_name' ? 'asc' : 'desc')
  }

  if (employeesQuery.isPending || regionsQuery.isPending || departmentsQuery.isPending || overviewQuery.isPending) {
    return <LoadingBlock label="Hoş geldiniz özeti ve mesai tablosu hazırlanıyor..." />
  }

  if (employeesQuery.isError || regionsQuery.isError || departmentsQuery.isError || overviewQuery.isError) {
    return <ErrorBlock message="Hoş geldiniz sayfası verileri yüklenemedi." />
  }

  return (
    <div className="welcome-page">
      <PageHeader title="Hoş geldiniz" />

      <Panel className="welcome-hero">
        <div className="welcome-hero__grid">
          <div className="welcome-hero__content">
            <div className="welcome-reveal is-delay-1">
              <p className="welcome-hero__eyebrow">OPERASYON GIRISI</p>
              <h2>Mesai yoğunluğu, ekip dengesi ve dikkat isteyen yükler ilk bakışta hazır.</h2>
            </div>

            <div className="welcome-hero__chips welcome-reveal is-delay-3">
              <span className="welcome-chip is-live">Sistem hazır</span>
              <span className="welcome-chip">
                Son güncelleme{' '}
                {overviewQuery.data?.generated_at_utc ? formatDateTime(overviewQuery.data.generated_at_utc) : '-'}
              </span>
              <span className="welcome-chip">{sortedRows.length} kayıt filtrelenebilir</span>
            </div>

            <div className="welcome-summary-grid welcome-reveal is-delay-4">
              <WelcomeHeroMetric
                label="Kapsamdaki kadro"
                value={summary.total}
                note={
                  <>
                    {summary.active} aktif personel, {heroInsights.liveCount} aktif vardiya
                  </>
                }
                tone="active"
              />
              <WelcomeHeroMetric
                label="Aylık fazla mesai"
                value={<MinuteDisplay minutes={summary.overtime} />}
                note={
                  heroInsights.topOvertimeRow ? (
                    <>
                      En yüklü kişi {heroInsights.topOvertimeRow.fullName}
                    </>
                  ) : (
                    'Filtreli görünüm toplamı'
                  )
                }
                tone="watch"
              />
              <WelcomeHeroMetric
                label="Planlanan yük"
                value={<MinuteDisplay minutes={summary.planOvertime} />}
                note={
                  heroInsights.topDepartment ? (
                    <>
                      {heroInsights.topDepartment.name} şu an en yüklü ekip
                    </>
                  ) : (
                    'Departman dağılımı hazır'
                  )
                }
                tone="live"
              />
              <WelcomeHeroMetric
                label="Ek çalışma"
                value={<MinuteDisplay minutes={summary.extraWork} />}
                note={
                  <>
                    {heroInsights.finishedCount} kişi günü kapattı, {heroInsights.waitingCount} kişi beklemede
                  </>
                }
              />
            </div>
          </div>

          <div className="welcome-hero__visual welcome-reveal is-delay-5">
            <div className="welcome-scene">
              <span className="welcome-scene__chip is-top">Hızlı tarama</span>
              <span className="welcome-scene__chip is-left">Kurumsal netlik</span>
              <span className="welcome-scene__chip is-bottom">Konumdan bağımsız özet</span>

              <div className="welcome-hero-logo" aria-hidden="true">
                <div className="welcome-hero-logo__shadow" />
                <div className="welcome-hero-logo__nebula welcome-hero-logo__nebula--back" />
                <div className="welcome-hero-logo__nebula welcome-hero-logo__nebula--front" />
                <div className="welcome-hero-logo__aura" />
                <div className="welcome-hero-logo__orbit welcome-hero-logo__orbit--outer" />
                <div className="welcome-hero-logo__orbit welcome-hero-logo__orbit--mid" />
                <div className="welcome-hero-logo__orbit welcome-hero-logo__orbit--inner" />
                <div className="welcome-hero-logo__orbit welcome-hero-logo__orbit--polar" />
                <div className="welcome-hero-logo__satellite welcome-hero-logo__satellite--outer">
                  <div className="welcome-hero-logo__satellite-core" />
                </div>
                <div className="welcome-hero-logo__satellite welcome-hero-logo__satellite--mid">
                  <div className="welcome-hero-logo__satellite-core" />
                </div>
                <div className="welcome-hero-logo__satellite welcome-hero-logo__satellite--inner">
                  <div className="welcome-hero-logo__satellite-core" />
                </div>
                <div className="welcome-hero-logo__planet">
                  <div className="welcome-hero-logo__depth" />
                  <div className="welcome-hero-logo__halo" />
                  <div className="welcome-hero-logo__ring welcome-hero-logo__ring--back" />
                  <div className="welcome-hero-logo__core">
                    <span className="welcome-hero-logo__monogram">Y</span>
                    <span className="welcome-hero-logo__brand">YABUJIN</span>
                    <span className="welcome-hero-logo__sub">ADMIN CORE</span>
                  </div>
                  <div className="welcome-hero-logo__ring welcome-hero-logo__ring--front" />
                  <div className="welcome-hero-logo__spark welcome-hero-logo__spark--a" />
                  <div className="welcome-hero-logo__spark welcome-hero-logo__spark--b" />
                </div>
              </div>

              <div className="welcome-scene__panel">
                <div>
                  <span>Aktif vardiya</span>
                  <strong>{heroInsights.liveCount}</strong>
                  <small>Gün içinde canlı kapasite</small>
                </div>
                <div>
                  <span>Pasif / bekleyen</span>
                  <strong>{heroInsights.waitingCount}</strong>
                  <small>Giriş bekleyen veya hareketsiz</small>
                </div>
                <div>
                  <span>Aktif oran</span>
                  <strong>%{heroInsights.activeRate}</strong>
                  <small>Filtreli görünüm sağlık oranı</small>
                </div>
              </div>
            </div>

            <div className="welcome-signal-grid">
              <WelcomeSignalCard
                label="Yük odağı"
                title={heroInsights.topOvertimeRow?.fullName ?? 'Veri hazırlanıyor'}
              />
              <WelcomeSignalCard
                label="En yüklü ekip"
                title={heroInsights.topDepartment?.name ?? 'Dağılım bekleniyor'}
              />
            </div>
          </div>
        </div>
      </Panel>

      <Panel className="welcome-table-panel">
        <div className="welcome-table-panel__head welcome-reveal is-delay-6">
          <div>
            <p className="welcome-panel-kicker">FILTRELI TABLO</p>
            <h3>Çalışan bazlı fazla mesai listesi</h3>
          </div>

          <div className="welcome-table-panel__meta">
            <span>{sortedRows.length} satir</span>
            <span>%{heroInsights.activeRate} aktif oran</span>
            <label className="welcome-inline-field">
              <span>Sayfa boyutu</span>
              <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
                {WELCOME_PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="welcome-filter-bar welcome-reveal is-delay-6">
          <div className="welcome-filters">
            <EmployeeAutocompleteField
              className="welcome-filter"
              label="Personel seç"
              employees={employees}
              value={employeeId}
              onChange={(value) => {
                setEmployeeId(value)
                if (value) setSearchTerm('')
              }}
              placeholder="Ad soyad veya #ID ile seç"
              emptyLabel="Tüm personeller"
              labelClassName="grid gap-2 text-sm text-slate-700"
              labelTextClassName="welcome-filter__label"
              inputClassName="welcome-filter__control"
              clearButtonClassName="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              menuClassName="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-lg"
              optionClassName="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
              emptyOptionClassName="flex w-full items-center justify-between border-b border-slate-100 px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-50"
              helperTextClassName="text-xs text-slate-500"
            />

            <label className="welcome-filter">
              <span className="welcome-filter__label">Arama</span>
              <input
                className="welcome-filter__control"
                value={searchTerm}
                onChange={(event) => {
                  setSearchTerm(event.target.value)
                  if (event.target.value.trim()) {
                    setEmployeeId('')
                  }
                }}
                placeholder="Ad, soyad veya #ID ara"
              />
            </label>

            <label className="welcome-filter">
              <span className="welcome-filter__label">Bölge</span>
              <select className="welcome-filter__control" value={regionId} onChange={(event) => setRegionId(event.target.value)}>
                <option value="">Tüm bölgeler</option>
                {(regionsQuery.data ?? []).map((region) => (
                  <option key={region.id} value={region.id}>
                    {region.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="welcome-filter">
              <span className="welcome-filter__label">Departman</span>
              <select
                className="welcome-filter__control"
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value)}
              >
                <option value="">Tüm departmanlar</option>
                {filteredDepartments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="welcome-filter">
              <span className="welcome-filter__label">Personel durumu</span>
              <select
                className="welcome-filter__control"
                value={employmentFilter}
                onChange={(event) => setEmploymentFilter(event.target.value as EmploymentFilter)}
              >
                <option value="all">Tüm durumlar</option>
                <option value="active">Sadece aktif</option>
                <option value="inactive">Sadece pasif</option>
              </select>
            </label>
          </div>
        </div>

        <div className="welcome-table-shell">
          <table className="welcome-table">
            <thead>
              <tr>
                <th>
                  <button type="button" onClick={() => handleSort('employee_name')}>
                    Çalışan {sortIndicator('employee_name', sortField, sortDirection)}
                  </button>
                </th>
                <th>Bölge</th>
                <th>Departman</th>
                <th>Durum</th>
                <th>
                  <button type="button" onClick={() => handleSort('worked_today')}>
                    Bugün {sortIndicator('worked_today', sortField, sortDirection)}
                  </button>
                </th>
                <th>
                  <button type="button" onClick={() => handleSort('weekly_total')}>
                    Hafta {sortIndicator('weekly_total', sortField, sortDirection)}
                  </button>
                </th>
                <th>
                  <button type="button" onClick={() => handleSort('overtime')}>
                    Aylık fazla {sortIndicator('overtime', sortField, sortDirection)}
                  </button>
                </th>
                <th>
                  <button type="button" onClick={() => handleSort('plan_overtime')}>
                    Plan {sortIndicator('plan_overtime', sortField, sortDirection)}
                  </button>
                </th>
                <th>
                  <button type="button" onClick={() => handleSort('extra_work')}>
                    Ek çalışma {sortIndicator('extra_work', sortField, sortDirection)}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {pagedRows.length ? (
                pagedRows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="welcome-employee-cell">
                        <strong>{row.fullName}</strong>
                        <span>#{row.id}</span>
                      </div>
                    </td>
                    <td>{row.regionName}</td>
                    <td>{row.departmentName}</td>
                    <td>
                      <div className="welcome-status-stack">
                        <span className={`welcome-status ${statusTone(row.todayStatus)}`}>
                          {todayStatusLabel(row.todayStatus)}
                        </span>
                        <span className={`welcome-status ${row.isActive ? 'is-verified' : 'is-muted'}`}>
                          {row.isActive ? 'Aktif' : 'Pasif'}
                        </span>
                      </div>
                    </td>
                    <td><MinuteDisplay minutes={row.workedTodayMinutes} /></td>
                    <td><MinuteDisplay minutes={row.weeklyTotalMinutes} /></td>
                    <td><MinuteDisplay minutes={row.overtimeMinutes} /></td>
                    <td><MinuteDisplay minutes={row.planOvertimeMinutes} /></td>
                    <td><MinuteDisplay minutes={row.extraWorkMinutes} /></td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9}>
                    <div className="welcome-empty">Seçili filtreler için uygun fazla mesai kaydı bulunamadı.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="welcome-pagination">
          <p>
            {rangeStart}-{rangeEnd} / {sortedRows.length} satır gösteriliyor
          </p>
          <div className="welcome-pagination__actions">
            <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={safePage <= 1}>
              Geri
            </button>
            <span>Sayfa {safePage} / {totalPages}</span>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={safePage >= totalPages}
            >
              İleri
            </button>
          </div>
        </div>
      </Panel>
    </div>
  )
}
