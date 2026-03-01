import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  auditControlRoomFilters,
  createControlRoomEmployeeAction,
  createControlRoomNote,
  createControlRoomRiskOverride,
  getControlRoomEmployeeDetail,
  getControlRoomOverview,
  getDepartments,
  getEmployees,
  getRegions,
  type ControlRoomOverviewParams,
} from '../api/admin'
import {
  ControlRoomMap,
  type ControlRoomMapMarker,
} from '../components/ControlRoomMap'
import { ErrorBlock } from '../components/ErrorBlock'
import { LoadingBlock } from '../components/LoadingBlock'
import { MinuteDisplay } from '../components/MinuteDisplay'
import { Modal } from '../components/Modal'
import { PageHeader } from '../components/PageHeader'
import { useToast } from '../hooks/useToast'
import type {
  ControlRoomEmployeeState,
  ControlRoomRiskStatus,
  Employee,
  LocationStatus,
} from '../types/api'

const ISTANBUL_TIMEZONE = 'Europe/Istanbul'
const DEFAULT_LIMIT = 24
const LIMIT_OPTIONS = [12, 24, 50, 100]
const SORT_OPTIONS = [
  { value: 'risk_score', label: 'Risk skoru' },
  { value: 'last_activity', label: 'Son aktivite' },
  { value: 'last_checkin', label: 'Son giris' },
  { value: 'last_checkout', label: 'Son cikis' },
  { value: 'worked_today', label: 'Bugunku sure' },
  { value: 'weekly_total', label: 'Haftalik sure' },
  { value: 'violation_count_7d', label: 'Ihlal sayisi' },
  { value: 'employee_name', label: 'Personel adi' },
  { value: 'department_name', label: 'Departman' },
] as const

type SortField = (typeof SORT_OPTIONS)[number]['value']

type FilterFormState = {
  q: string
  region_id: string
  department_id: string
  start_date: string
  end_date: string
  map_date: string
  include_inactive: boolean
  risk_min: string
  risk_max: string
  risk_status: '' | ControlRoomRiskStatus
  sort_by: SortField
  sort_dir: 'asc' | 'desc'
  limit: number
}

type ActionState =
  | { kind: 'action'; actionType: 'SUSPEND' | 'DISABLE_TEMP' | 'REVIEW' }
  | { kind: 'override' }
  | { kind: 'note' }
  | null

function dateValue(offsetDays = 0) {
  const value = new Date()
  value.setDate(value.getDate() + offsetDays)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ISTANBUL_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value)
}

function defaultFilters(): FilterFormState {
  return {
    q: '',
    region_id: '',
    department_id: '',
    start_date: dateValue(-6),
    end_date: dateValue(0),
    map_date: dateValue(0),
    include_inactive: false,
    risk_min: '',
    risk_max: '',
    risk_status: '',
    sort_by: 'risk_score',
    sort_dir: 'desc',
    limit: DEFAULT_LIMIT,
  }
}

function parseNumber(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

function toParams(filters: FilterFormState, page: number): ControlRoomOverviewParams {
  return {
    q: filters.q.trim() || undefined,
    region_id: parseNumber(filters.region_id),
    department_id: parseNumber(filters.department_id),
    start_date: filters.start_date || undefined,
    end_date: filters.end_date || undefined,
    map_date: filters.map_date || undefined,
    include_inactive: filters.include_inactive,
    risk_min: parseNumber(filters.risk_min),
    risk_max: parseNumber(filters.risk_max),
    risk_status: filters.risk_status || undefined,
    sort_by: filters.sort_by,
    sort_dir: filters.sort_dir,
    limit: filters.limit,
    offset: (page - 1) * filters.limit,
  }
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: ISTANBUL_TIMEZONE,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatRelative(value: string | null | undefined) {
  if (!value) return 'Veri yok'
  const diffMs = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(diffMs)) return '-'
  const minutes = Math.max(0, Math.round(diffMs / 60000))
  if (minutes < 1) return 'Simdi'
  if (minutes < 60) return `${minutes} dk once`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} sa once`
  return `${Math.floor(hours / 24)} gun once`
}

function formatClockMinutes(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return '-'
  const normalized = Math.max(0, Math.round(value))
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`
}

function riskStatusLabel(value: ControlRoomRiskStatus) {
  if (value === 'CRITICAL') return 'Kritik'
  if (value === 'WATCH') return 'Izlemeli'
  return 'Normal'
}

function todayStatusLabel(value: ControlRoomEmployeeState['today_status']) {
  if (value === 'IN_PROGRESS') return 'Aktif vardiya'
  if (value === 'FINISHED') return 'Gun kapandi'
  return 'Bugun giris yok'
}

function locationStatusLabel(value: LocationStatus) {
  if (value === 'VERIFIED_HOME') return 'Dogrulandi'
  if (value === 'UNVERIFIED_LOCATION') return 'Sapma'
  return 'Konum yok'
}

function mapLocationLabel(value: ControlRoomEmployeeState['location_state']) {
  if (value === 'LIVE') return 'Canli'
  if (value === 'STALE') return 'Yakinda'
  if (value === 'DORMANT') return 'Eski'
  return 'Veri yok'
}

function riskClass(value: ControlRoomRiskStatus) {
  if (value === 'CRITICAL') return 'is-critical'
  if (value === 'WATCH') return 'is-watch'
  return 'is-normal'
}

function systemStatusLabel(value: 'HEALTHY' | 'ATTENTION' | 'CRITICAL') {
  if (value === 'CRITICAL') return 'Kritik'
  if (value === 'ATTENTION') return 'Izlemeli'
  return 'Stabil'
}

function systemStatusClass(value: 'HEALTHY' | 'ATTENTION' | 'CRITICAL') {
  if (value === 'CRITICAL') return 'is-critical'
  if (value === 'ATTENTION') return 'is-watch'
  return 'is-normal'
}

function tooltipText(item: ControlRoomEmployeeState) {
  if (!item.tooltip_items.length) return 'Ek aciklama yok.'
  return item.tooltip_items.map((entry) => `${entry.title}: ${entry.body}`).join('\n')
}

function employeeMatchScore(employee: Employee, query: string) {
  const normalized = query.trim().toLocaleLowerCase('tr-TR').replace('#', '')
  if (!normalized) return 1
  const name = employee.full_name.toLocaleLowerCase('tr-TR')
  const idText = String(employee.id)
  if (name.startsWith(normalized) || idText.startsWith(normalized)) return 5
  if (name.includes(normalized) || idText.includes(normalized)) return 3
  return 0
}

function EmployeeLookupField({
  value,
  employees,
  onChange,
}: {
  value: string
  employees: Employee[]
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const suggestions = useMemo(
    () =>
      employees
        .map((employee) => ({ employee, score: employeeMatchScore(employee, value) }))
        .filter((entry) => entry.score > 0 || !value.trim())
        .sort(
          (left, right) =>
            right.score - left.score ||
            left.employee.full_name.localeCompare(right.employee.full_name, 'tr-TR'),
        )
        .slice(0, value.trim() ? 10 : 8),
    [employees, value],
  )

  return (
    <label className="ops-field">
      <span>Personel</span>
      <div className="ops-lookup-shell">
        <input
          value={value}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onChange={(event) => {
            onChange(event.target.value)
            setOpen(true)
          }}
          placeholder="Ad, soyad veya #ID"
          autoComplete="off"
        />
        {value ? (
          <button
            type="button"
            className="ops-inline-button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onChange('')
              setOpen(false)
            }}
          >
            Temizle
          </button>
        ) : null}
        {open ? (
          <div className="ops-lookup-menu">
            {suggestions.length ? (
              suggestions.map(({ employee }) => (
                <button
                  key={employee.id}
                  type="button"
                  className="ops-lookup-option"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onChange(employee.full_name)
                    setOpen(false)
                  }}
                >
                  <strong>{employee.full_name}</strong>
                  <span>#{employee.id}</span>
                </button>
              ))
            ) : (
              <div className="ops-lookup-empty">Eslesen personel bulunamadi.</div>
            )}
          </div>
        ) : null}
      </div>
    </label>
  )
}

function MetricCard({ label, value, meta }: { label: string; value: string | number; meta?: string }) {
  return (
    <article className="ops-kpi-card">
      <span className="ops-kpi-label">{label}</span>
      <strong className="ops-kpi-value">{value}</strong>
      {meta ? <span className="ops-kpi-meta">{meta}</span> : null}
    </article>
  )
}

function sortIcon(active: boolean, dir: 'asc' | 'desc') {
  if (!active) return '↕'
  return dir === 'asc' ? '↑' : '↓'
}

export function ControlRoomPage() {
  const queryClient = useQueryClient()
  const { pushToast } = useToast()
  const [filterForm, setFilterForm] = useState<FilterFormState>(defaultFilters())
  const [appliedFilters, setAppliedFilters] = useState<FilterFormState>(defaultFilters())
  const [page, setPage] = useState(1)
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [actionState, setActionState] = useState<ActionState>(null)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [duration, setDuration] = useState<'1' | '3' | '7' | 'indefinite'>('1')
  const [overrideScore, setOverrideScore] = useState('50')
  const [feedQuery, setFeedQuery] = useState('')
  const [feedType, setFeedType] = useState<'' | 'IN' | 'OUT'>('')
  const [feedLocationStatus, setFeedLocationStatus] = useState<LocationStatus | ''>('')
  const [feedOnlySelected, setFeedOnlySelected] = useState(false)

  const regionsQuery = useQuery({ queryKey: ['regions', 'control-room-matrix'], queryFn: () => getRegions() })
  const departmentsQuery = useQuery({ queryKey: ['departments', 'control-room-matrix'], queryFn: () => getDepartments() })
  const employeesQuery = useQuery({ queryKey: ['employees', 'control-room-matrix'], queryFn: () => getEmployees() })

  const overviewParams = useMemo(() => toParams(appliedFilters, page), [appliedFilters, page])
  const overviewQuery = useQuery({
    queryKey: ['control-room-overview', overviewParams],
    queryFn: () => getControlRoomOverview(overviewParams),
  })

  const detailQuery = useQuery({
    queryKey: ['control-room-detail', selectedEmployeeId],
    queryFn: () => getControlRoomEmployeeDetail(selectedEmployeeId as number),
    enabled: detailOpen && selectedEmployeeId !== null,
  })

  const filterAuditMutation = useMutation({ mutationFn: auditControlRoomFilters })
  const actionMutation = useMutation({
    mutationFn: async () => {
      if (!selectedEmployeeId || !actionState) {
        throw new Error('Personel secilmedi.')
      }
      if (actionState.kind === 'action') {
        return createControlRoomEmployeeAction({
          employee_id: selectedEmployeeId,
          action_type: actionState.actionType,
          reason,
          note,
          duration_days: duration === 'indefinite' ? undefined : Number(duration) as 1 | 3 | 7,
          indefinite: duration === 'indefinite',
        })
      }
      if (actionState.kind === 'override') {
        return createControlRoomRiskOverride({
          employee_id: selectedEmployeeId,
          override_score: Math.max(0, Math.min(100, Number(overrideScore) || 0)),
          reason,
          note,
          duration_days: duration === 'indefinite' ? undefined : Number(duration) as 1 | 3 | 7,
          indefinite: duration === 'indefinite',
        })
      }
      return createControlRoomNote({ employee_id: selectedEmployeeId, note })
    },
    onSuccess: (result) => {
      pushToast({ variant: 'success', title: 'Kaydedildi', description: result.message })
      setActionState(null)
      setReason('')
      setNote('')
      setOverrideScore('50')
      setDuration('1')
      void queryClient.invalidateQueries({ queryKey: ['control-room-overview'] })
      if (selectedEmployeeId !== null) {
        void queryClient.invalidateQueries({ queryKey: ['control-room-detail', selectedEmployeeId] })
      }
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Islem tamamlanamadi.'
      pushToast({ variant: 'error', title: 'Islem hatasi', description: message })
    },
  })

  const applyFilters = () => {
    const next = { ...filterForm }
    setAppliedFilters(next)
    setPage(1)
    filterAuditMutation.mutate({ filters: { ...toParams(next, 1) } as Record<string, unknown>, total_results: overviewQuery.data?.total })
  }

  const handleSort = (field: SortField) => {
    const nextDir = appliedFilters.sort_by === field && appliedFilters.sort_dir === 'desc' ? 'asc' : 'desc'
    const nextFilters: FilterFormState = { ...appliedFilters, sort_by: field, sort_dir: nextDir }
    setFilterForm(nextFilters)
    setAppliedFilters(nextFilters)
    setPage(1)
    filterAuditMutation.mutate({ filters: { ...toParams(nextFilters, 1) } as Record<string, unknown>, total_results: overviewQuery.data?.total })
  }

  const openEmployee = (employeeId: number) => {
    setSelectedEmployeeId(employeeId)
    setDetailOpen(true)
  }

  const openAction = (state: ActionState) => {
    setActionState(state)
    setReason('')
    setNote('')
    setDuration('1')
    setOverrideScore('50')
  }

  const selectedEmployee = detailQuery.data?.employee_state ?? overviewQuery.data?.items.find((item) => item.employee.id === selectedEmployeeId) ?? null
  const totalPages = Math.max(1, Math.ceil((overviewQuery.data?.total ?? 0) / (overviewQuery.data?.limit || appliedFilters.limit)))
  const summary = overviewQuery.data?.summary
  const markers = useMemo<ControlRoomMapMarker[]>(
    () =>
      (overviewQuery.data?.map_points ?? []).map((point) => ({
        id: String(point.employee_id),
        lat: point.lat,
        lon: point.lon,
        label: point.label,
        todayStatus: point.today_status,
        locationState: point.location_state,
      })),
    [overviewQuery.data?.map_points],
  )

  const filteredEvents = useMemo(() => {
    const normalizedQuery = feedQuery.trim().toLocaleLowerCase('tr-TR')
    return (overviewQuery.data?.recent_events ?? []).filter((event) => {
      if (feedType && event.event_type !== feedType) return false
      if (feedLocationStatus && event.location_status !== feedLocationStatus) return false
      if (feedOnlySelected && selectedEmployeeId !== null && event.employee_id !== selectedEmployeeId) return false
      if (!normalizedQuery) return true
      return [event.employee_name, event.department_name ?? '', String(event.employee_id)]
        .join(' ')
        .toLocaleLowerCase('tr-TR')
        .includes(normalizedQuery)
    })
  }, [feedLocationStatus, feedOnlySelected, feedQuery, feedType, overviewQuery.data?.recent_events, selectedEmployeeId])

  const activeFilterEntries = useMemo(() => {
    const filters = overviewQuery.data?.active_filters
    if (!filters) return []
    return [
      filters.start_date && filters.end_date ? `Analiz: ${filters.start_date} - ${filters.end_date}` : null,
      filters.map_date ? `Harita gunu: ${filters.map_date}` : null,
      filters.region_id ? `Bolge #${filters.region_id}` : null,
      filters.department_id ? `Departman #${filters.department_id}` : null,
      filters.risk_status ? `Durum: ${riskStatusLabel(filters.risk_status)}` : null,
      filters.risk_min != null || filters.risk_max != null ? `Risk araligi: ${filters.risk_min ?? 0}-${filters.risk_max ?? 100}` : null,
      filters.include_inactive ? 'Pasif personel dahil' : null,
      `Siralama: ${SORT_OPTIONS.find((option) => option.value === filters.sort_by)?.label ?? filters.sort_by} / ${filters.sort_dir === 'desc' ? 'Azalan' : 'Artan'}`,
      `Limit: ${filters.limit}`,
    ].filter(Boolean) as string[]
  }, [overviewQuery.data?.active_filters])

  const histogramMax = Math.max(1, ...(summary?.risk_histogram ?? []).map((item) => item.count))
  const trendMax = Math.max(1, ...(summary?.weekly_trend ?? []).map((item) => item.value))

  if (overviewQuery.isLoading) {
    return <LoadingBlock label="Operasyonel guvenlik matrisi yukleniyor..." />
  }

  if (overviewQuery.isError || !overviewQuery.data) {
    return <ErrorBlock message="Operasyonel guvenlik matrisi verileri alinamadi." />
  }

  return (
    <div className="ops-matrix-page">
      <PageHeader
        title="Ana Panel"
        description="Yonetim Konsolu. Operasyonel Guvenlik Matrisi, risk analizi, mesai takibi ve mudahale araclari bu ekranin merkezinde birlesir."
        action={
          <div className="ops-filter-action-group">
            <Link to="/notifications" className="ops-button ops-button-ghost">
              Bildirimler
            </Link>
            <Link to="/attendance-events" className="ops-button ops-button-ghost">
              Yoklama Kayitlari
            </Link>
            <button type="button" className="ops-button ops-button-secondary" onClick={() => void overviewQuery.refetch()}>
              Yenile
            </button>
          </div>
        }
      />

      <section className="ops-panel">
        <div className="ops-panel-head">
          <div>
            <p className="ops-panel-kicker">YONETIM KONSOLU</p>
            <h3>Canli operasyon akisi, risk yogunlugu ve mudahale katmani tek merkezde.</h3>
          </div>
          <div className="ops-filter-summary-text">
            Sistem durumu:
            {' '}
            <span className={`ops-status-pill ${systemStatusClass(summary?.system_status ?? 'HEALTHY')}`}>
              {systemStatusLabel(summary?.system_status ?? 'HEALTHY')}
            </span>
          </div>
        </div>
        <div className="ops-filter-summary-text">
          Son guncelleme: {formatDateTime(overviewQuery.data.generated_at_utc)}. Filtrelenen kapsam icinde departman, ihlal, risk ve fazla mesai gorunumu ayni panelde izlenir.
        </div>
      </section>

      <section className="ops-filter-panel">
        <div className="ops-panel-head">
          <div>
            <p className="ops-panel-kicker">AKTIF FILTRELER</p>
            <h3>Filtre yigini ve siralama kontrolu</h3>
          </div>
          <div className="ops-filter-summary-text">Son guncelleme: {formatDateTime(overviewQuery.data.generated_at_utc)}</div>
        </div>
        <div className="ops-filter-grid">
          <EmployeeLookupField
            value={filterForm.q}
            employees={employeesQuery.data ?? []}
            onChange={(value) => setFilterForm((current) => ({ ...current, q: value }))}
          />
          <label className="ops-field">
            <span>Bolge</span>
            <select value={filterForm.region_id} onChange={(event) => setFilterForm((current) => ({ ...current, region_id: event.target.value }))}>
              <option value="">Tum bolgeler</option>
              {(regionsQuery.data ?? []).map((region) => (
                <option key={region.id} value={region.id}>{region.name}</option>
              ))}
            </select>
          </label>
          <label className="ops-field">
            <span>Departman</span>
            <select value={filterForm.department_id} onChange={(event) => setFilterForm((current) => ({ ...current, department_id: event.target.value }))}>
              <option value="">Tum departmanlar</option>
              {(departmentsQuery.data ?? []).map((department) => (
                <option key={department.id} value={department.id}>{department.name}</option>
              ))}
            </select>
          </label>
          <label className="ops-field">
            <span>Baslangic tarihi</span>
            <input type="date" value={filterForm.start_date} onChange={(event) => setFilterForm((current) => ({ ...current, start_date: event.target.value }))} />
          </label>
          <label className="ops-field">
            <span>Bitis tarihi</span>
            <input type="date" value={filterForm.end_date} min={filterForm.start_date || undefined} onChange={(event) => setFilterForm((current) => ({ ...current, end_date: event.target.value }))} />
          </label>
          <label className="ops-field">
            <span>Harita gunu</span>
            <input type="date" value={filterForm.map_date} onChange={(event) => setFilterForm((current) => ({ ...current, map_date: event.target.value }))} />
          </label>
          <label className="ops-field">
            <span>Risk min</span>
            <input type="number" min={0} max={100} value={filterForm.risk_min} onChange={(event) => setFilterForm((current) => ({ ...current, risk_min: event.target.value }))} placeholder="0" />
          </label>
          <label className="ops-field">
            <span>Risk max</span>
            <input type="number" min={0} max={100} value={filterForm.risk_max} onChange={(event) => setFilterForm((current) => ({ ...current, risk_max: event.target.value }))} placeholder="100" />
          </label>
          <label className="ops-field">
            <span>Durum</span>
            <select value={filterForm.risk_status} onChange={(event) => setFilterForm((current) => ({ ...current, risk_status: event.target.value as '' | ControlRoomRiskStatus }))}>
              <option value="">Tum durumlar</option>
              <option value="NORMAL">Normal</option>
              <option value="WATCH">Izlemeli</option>
              <option value="CRITICAL">Kritik</option>
            </select>
          </label>
          <label className="ops-field">
            <span>Siralama</span>
            <select value={filterForm.sort_by} onChange={(event) => setFilterForm((current) => ({ ...current, sort_by: event.target.value as SortField }))}>
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="ops-field">
            <span>Yon</span>
            <select value={filterForm.sort_dir} onChange={(event) => setFilterForm((current) => ({ ...current, sort_dir: event.target.value as 'asc' | 'desc' }))}>
              <option value="desc">Azalan</option>
              <option value="asc">Artan</option>
            </select>
          </label>
          <label className="ops-field">
            <span>Sayfa limiti</span>
            <select value={filterForm.limit} onChange={(event) => setFilterForm((current) => ({ ...current, limit: Number(event.target.value) }))}>
              {LIMIT_OPTIONS.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="ops-check-field">
            <input type="checkbox" checked={filterForm.include_inactive} onChange={(event) => setFilterForm((current) => ({ ...current, include_inactive: event.target.checked }))} />
            <span>Pasif personeli dahil et</span>
          </label>
        </div>
        <div className="ops-filter-actions">
          <div className="ops-filter-chip-list">
            {activeFilterEntries.map((entry) => <span key={entry} className="ops-filter-chip">{entry}</span>)}
          </div>
          <div className="ops-filter-action-group">
            <button type="button" className="ops-button ops-button-ghost" onClick={() => { const next = defaultFilters(); setFilterForm(next); setAppliedFilters(next); setPage(1) }}>
              Varsayilanlara don
            </button>
            <button type="button" className="ops-button ops-button-primary" onClick={applyFilters}>
              Filtreleri uygula
            </button>
          </div>
        </div>
      </section>

      <section className="ops-kpi-grid">
        <MetricCard label="Toplam aktif calisan" value={summary?.active_employees ?? 0} meta={`${summary?.total_employees ?? 0} kayit icinde`} />
        <MetricCard label="Kritik riskli calisan" value={summary?.critical_count ?? 0} meta="Anlik kritik seviye" />
        <MetricCard label="Izlemeli calisan" value={summary?.watch_count ?? 0} meta="Yakindan takip gereken" />
        <MetricCard label="Ortalama risk skoru" value={summary?.average_risk_score ?? 0} meta="Filtrelenen evren ortalamasi" />
        <MetricCard label="Aktif mesai sayisi" value={summary?.active_overtime_count ?? 0} meta="Planli sureyi asan acik vardiya" />
        <MetricCard label="Gunluk ihlal sayisi" value={summary?.daily_violation_count ?? 0} meta="Bugun olusan toplam ihlal" />
        <MetricCard label="Aktif vardiya" value={summary?.in_progress_count ?? 0} meta="Bugun acik vardiyasi olanlar" />
        <MetricCard label="Sistem durumu" value={systemStatusLabel(summary?.system_status ?? 'HEALTHY')} meta={`En riskli zaman: ${summary?.most_common_violation_window ?? '-'}`} />
      </section>

      <section className="ops-analytics-grid">
        <article className="ops-panel">
          <div className="ops-panel-head">
            <div>
              <p className="ops-panel-kicker">RISK DAGILIMI</p>
              <h3>Risk skoru histogrami</h3>
            </div>
          </div>
          <div className="ops-bar-list">
            {(summary?.risk_histogram ?? []).map((bucket) => (
              <div key={bucket.label} className="ops-bar-row">
                <span>{bucket.label}</span>
                <div className="ops-bar-track"><div className="ops-bar-fill ops-bar-fill-info" style={{ width: `${(bucket.count / histogramMax) * 100}%` }} /></div>
                <strong>{bucket.count}</strong>
              </div>
            ))}
          </div>
        </article>
        <article className="ops-panel">
          <div className="ops-panel-head">
            <div>
              <p className="ops-panel-kicker">HAFTALIK TREND</p>
              <h3>Ihlal yogunlugu</h3>
            </div>
          </div>
          <div className="ops-trend-list">
            {(summary?.weekly_trend ?? []).map((point) => (
              <div key={point.label} className="ops-trend-item">
                <div className="ops-trend-bar" style={{ height: `${Math.max(12, (point.value / trendMax) * 100)}%` }} />
                <strong>{point.value}</strong>
                <span>{point.label}</span>
              </div>
            ))}
          </div>
        </article>
        <article className="ops-panel ops-panel-span-2">
          <div className="ops-panel-head">
            <div>
              <p className="ops-panel-kicker">DEPARTMAN KPI</p>
              <h3>Departman bazli operasyon metrikleri</h3>
            </div>
          </div>
          <div className="ops-department-grid">
            {(summary?.department_metrics ?? []).map((metric) => (
              <div key={metric.department_name} className="ops-department-card">
                <strong>{metric.department_name}</strong>
                <span>{metric.employee_count} personel</span>
                <span>Ort. giris: {formatClockMinutes(metric.average_checkin_minutes)}</span>
                <span>Gec kalma: %{metric.late_rate_percent}</span>
                <span>Ort. aktif sure: {formatClockMinutes(metric.average_active_minutes)}</span>
              </div>
            ))}
          </div>
        </article>
      </section>
      <section className="ops-main-grid">
        <article className="ops-panel">
          <div className="ops-panel-head">
            <div>
              <p className="ops-panel-kicker">LOKASYON DAGILIMI</p>
              <h3>Harita gorunumu</h3>
            </div>
            <div className="ops-filter-summary-text">Harita gunu: {overviewQuery.data.active_filters.map_date ?? '-'}</div>
          </div>
          {markers.length ? <ControlRoomMap markers={markers} focusedMarkerId={selectedEmployeeId ? String(selectedEmployeeId) : null} /> : <div className="ops-empty-state">Secili gun icin harita verisi bulunmuyor.</div>}
        </article>

        <article className="ops-panel">
          <div className="ops-panel-head">
            <div>
              <p className="ops-panel-kicker">OLAY AKISI</p>
              <h3>Son personel hareketleri</h3>
            </div>
            <div className="ops-filter-summary-text">{filteredEvents.length} olay</div>
          </div>
          <div className="ops-feed-filters">
            <input value={feedQuery} onChange={(event) => setFeedQuery(event.target.value)} placeholder="Personel, departman veya ID ara" />
            <select value={feedType} onChange={(event) => setFeedType(event.target.value as '' | 'IN' | 'OUT')}>
              <option value="">Tum tipler</option>
              <option value="IN">Giris</option>
              <option value="OUT">Cikis</option>
            </select>
            <select value={feedLocationStatus} onChange={(event) => setFeedLocationStatus(event.target.value as LocationStatus | '')}>
              <option value="">Tum lokasyon durumlari</option>
              <option value="VERIFIED_HOME">Dogrulandi</option>
              <option value="UNVERIFIED_LOCATION">Sapma</option>
              <option value="NO_LOCATION">Konum yok</option>
            </select>
            <label className="ops-check-field ops-check-inline">
              <input type="checkbox" checked={feedOnlySelected} onChange={(event) => setFeedOnlySelected(event.target.checked)} />
              <span>Secili personeli izle</span>
            </label>
          </div>
          <div className="ops-feed-list">
            {filteredEvents.length ? filteredEvents.map((event) => (
              <button key={event.event_id} type="button" className="ops-feed-item" onClick={() => openEmployee(event.employee_id)}>
                <div>
                  <strong>{event.employee_name}</strong>
                  <span>{event.department_name ?? 'Departman yok'}</span>
                </div>
                <div>
                  <strong>{event.event_type === 'IN' ? 'Giris' : 'Cikis'}</strong>
                  <span>{locationStatusLabel(event.location_status)}</span>
                </div>
                <div>
                  <strong>{formatDateTime(event.ts_utc)}</strong>
                  <span>#{event.device_id}</span>
                </div>
              </button>
            )) : <div className="ops-empty-state">Filtreye uygun olay bulunmuyor.</div>}
          </div>
        </article>
      </section>

      <section className="ops-panel ops-table-panel">
        <div className="ops-panel-head">
          <div>
            <p className="ops-panel-kicker">OPERASYONEL GUVENLIK MATRISI</p>
            <h3>Risk bazli davranis, ihlal ve mesai tablosu</h3>
          </div>
          <div className="ops-pagination-head">
            <span>{overviewQuery.data.total} kayit</span>
            <span>Sayfa {page} / {totalPages}</span>
          </div>
        </div>

        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead>
              <tr>
                {[
                  ['employee_name', 'Personel Adi'],
                  ['department_name', 'Departman'],
                  ['last_checkin', 'Son Giris Tarihi'],
                  ['last_checkout', 'Son Cikis Tarihi'],
                  ['worked_today', 'Toplam Calisma Suresi (Bugun)'],
                  ['weekly_total', 'Haftalik Toplam Sure'],
                  ['violation_count_7d', 'Kural Ihlali (7 gun)'],
                  ['risk_score', 'Risk Skoru'],
                  ['risk_status', 'Durum'],
                  ['last_activity', 'Son Aktivite'],
                  ['recent_ip', 'IP'],
                  ['location_label', 'Lokasyon'],
                ].map(([field, label]) => (
                  <th key={field}>
                    {field === 'risk_status' || field === 'recent_ip' || field === 'location_label' ? (
                      label
                    ) : (
                      <button type="button" className="ops-sort-button" onClick={() => handleSort(field as SortField)}>
                        {label} <span>{sortIcon(appliedFilters.sort_by === field, appliedFilters.sort_dir)}</span>
                      </button>
                    )}
                  </th>
                ))}
                <th>Detay</th>
              </tr>
            </thead>
            <tbody>
              {overviewQuery.data.items.map((item) => (
                <tr key={item.employee.id}>
                  <td>
                    <div className="ops-cell-stack">
                      <strong>{item.employee.full_name}</strong>
                      <span>{todayStatusLabel(item.today_status)}</span>
                    </div>
                  </td>
                  <td>{item.department_name ?? '-'}</td>
                  <td>{formatDateTime(item.last_checkin_utc)}</td>
                  <td>{formatDateTime(item.last_checkout_utc)}</td>
                  <td><MinuteDisplay minutes={item.worked_today_minutes} /></td>
                  <td><MinuteDisplay minutes={item.weekly_total_minutes} /></td>
                  <td>
                    <div className="ops-cell-stack">
                      <strong>{item.violation_count_7d}</strong>
                      <span title={tooltipText(item)}>{item.tooltip_items.length ? 'Aciklama var' : 'Ek aciklama yok'}</span>
                    </div>
                  </td>
                  <td><span className={`ops-risk-pill ${riskClass(item.risk_status)}`}>{item.risk_score}</span></td>
                  <td><span className={`ops-status-pill ${riskClass(item.risk_status)}`}>{riskStatusLabel(item.risk_status)}</span></td>
                  <td>
                    <div className="ops-cell-stack">
                      <strong>{formatDateTime(item.last_activity_utc)}</strong>
                      <span>{formatRelative(item.last_activity_utc)}</span>
                    </div>
                  </td>
                  <td>{item.recent_ip ?? '-'}</td>
                  <td>
                    <div className="ops-cell-stack">
                      <strong>{item.location_label ?? '-'}</strong>
                      <span>{mapLocationLabel(item.location_state)}</span>
                    </div>
                  </td>
                  <td>
                    <button type="button" className="ops-button ops-button-info" onClick={() => openEmployee(item.employee.id)}>
                      Detay
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="ops-card-list">
          {overviewQuery.data.items.map((item) => (
            <article key={item.employee.id} className="ops-card">
              <div className="ops-card-head">
                <div>
                  <h4>{item.employee.full_name}</h4>
                  <p>{item.department_name ?? 'Departman yok'}</p>
                </div>
                <div className={`ops-card-score ${riskClass(item.risk_status)}`}>
                  <strong>{item.risk_score}</strong>
                  <span>{riskStatusLabel(item.risk_status)}</span>
                </div>
              </div>
              <div className="ops-card-primary">
                <span className={`ops-status-pill ${riskClass(item.risk_status)}`}>{riskStatusLabel(item.risk_status)}</span>
                <span>{todayStatusLabel(item.today_status)}</span>
                <span>{item.violation_count_7d} ihlal</span>
                <span>{formatRelative(item.last_activity_utc)}</span>
              </div>
              <div className="ops-card-grid">
                <div><span>Bugun</span><strong><MinuteDisplay minutes={item.worked_today_minutes} /></strong></div>
                <div><span>Haftalik</span><strong><MinuteDisplay minutes={item.weekly_total_minutes} /></strong></div>
                <div><span>Son giris</span><strong>{formatDateTime(item.last_checkin_utc)}</strong></div>
                <div><span>Son cikis</span><strong>{formatDateTime(item.last_checkout_utc)}</strong></div>
              </div>
              <details className="ops-card-details">
                <summary>Teknik detaylar</summary>
                <div className="ops-card-grid ops-card-grid-detail">
                  <div><span>IP</span><strong>{item.recent_ip ?? '-'}</strong></div>
                  <div><span>Lokasyon</span><strong>{item.location_label ?? '-'}</strong></div>
                  <div><span>Aktif cihaz</span><strong>{item.active_devices} / {item.total_devices}</strong></div>
                  <div><span>Aciklama</span><strong title={tooltipText(item)}>{item.tooltip_items[0]?.title ?? 'Ek aciklama yok'}</strong></div>
                </div>
              </details>
              <div className="ops-card-actions">
                <button type="button" className="ops-button ops-button-info" onClick={() => openEmployee(item.employee.id)}>Detay</button>
              </div>
            </article>
          ))}
        </div>

        <div className="ops-pagination-footer">
          <button type="button" className="ops-button ops-button-secondary" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1}>Onceki</button>
          <span>Sayfa {page} / {totalPages}</span>
          <button type="button" className="ops-button ops-button-secondary" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page >= totalPages}>Sonraki</button>
        </div>
      </section>

      <section className="ops-panel">
        <div className="ops-panel-head">
          <div>
            <p className="ops-panel-kicker">SKOR FORMULU</p>
            <h3>Risk skoru acik hesaplama mantigi</h3>
          </div>
        </div>
        <div className="ops-formula-grid">
          {overviewQuery.data.risk_formula.map((item) => (
            <article key={item.code} className="ops-formula-card">
              <strong>{item.label}</strong>
              <span>Tavan puan: {item.max_score}</span>
              <p>{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      <Modal
        open={detailOpen}
        title={selectedEmployee ? `${selectedEmployee.employee.full_name} - Operasyon dosyasi` : 'Operasyon dosyasi'}
        onClose={() => setDetailOpen(false)}
        placement="right"
        maxWidthClass="max-w-4xl"
      >
        {detailQuery.isLoading && detailQuery.data == null ? (
          <LoadingBlock label="Personel detayi yukleniyor..." />
        ) : detailQuery.isError ? (
          <ErrorBlock message="Personel detay bilgisi alinamadi." />
        ) : selectedEmployee ? (
          <div className="ops-detail-shell">
            <div className="ops-detail-hero">
              <div>
                <p className="ops-panel-kicker">OPERASYON OZETI</p>
                <h3>{selectedEmployee.employee.full_name}</h3>
                <p>{selectedEmployee.department_name ?? 'Departman yok'} • {todayStatusLabel(selectedEmployee.today_status)}</p>
              </div>
              <div className={`ops-detail-score ${riskClass(selectedEmployee.risk_status)}`}>
                <strong>{selectedEmployee.risk_score}</strong>
                <span>{riskStatusLabel(selectedEmployee.risk_status)}</span>
              </div>
            </div>
            <div className="ops-detail-actions">
              <button type="button" className="ops-button ops-button-warning" onClick={() => openAction({ kind: 'action', actionType: 'REVIEW' })}>Incelemeye Al</button>
              <button type="button" className="ops-button ops-button-secondary" onClick={() => openAction({ kind: 'action', actionType: 'DISABLE_TEMP' })}>Gecici Devre Disi</button>
              <button type="button" className="ops-button ops-button-danger" onClick={() => openAction({ kind: 'action', actionType: 'SUSPEND' })}>Askiya Al</button>
              <button type="button" className="ops-button ops-button-info" onClick={() => openAction({ kind: 'override' })}>Risk Override</button>
              <button type="button" className="ops-button ops-button-primary" onClick={() => openAction({ kind: 'note' })}>Not Ekle</button>
              <Link to={`/employees/${selectedEmployee.employee.id}`} className="ops-button ops-button-ghost">Calisan detayina git</Link>
            </div>
            <div className="ops-detail-grid">
              <div className="ops-detail-card"><span>Son giris</span><strong>{formatDateTime(selectedEmployee.last_checkin_utc)}</strong></div>
              <div className="ops-detail-card"><span>Son cikis</span><strong>{formatDateTime(selectedEmployee.last_checkout_utc)}</strong></div>
              <div className="ops-detail-card"><span>Bugun</span><strong><MinuteDisplay minutes={selectedEmployee.worked_today_minutes} /></strong></div>
              <div className="ops-detail-card"><span>Haftalik</span><strong><MinuteDisplay minutes={selectedEmployee.weekly_total_minutes} /></strong></div>
              <div className="ops-detail-card"><span>IP</span><strong>{selectedEmployee.recent_ip ?? '-'}</strong></div>
              <div className="ops-detail-card"><span>Lokasyon</span><strong>{selectedEmployee.location_label ?? '-'}</strong></div>
            </div>
            <div className="ops-detail-section">
              <h4>Risk faktorleri</h4>
              <div className="ops-detail-list">
                {detailQuery.data?.employee_state.risk_factors.map((factor) => (
                  <div key={factor.code} className="ops-detail-row">
                    <div>
                      <strong>{factor.label}</strong>
                      <p>{factor.description}</p>
                    </div>
                    <div className="ops-detail-row-side">
                      <span>{factor.value}</span>
                      <strong>+{factor.impact_score}</strong>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="ops-detail-section">
              <h4>Aktif onlem ve notlar</h4>
              <div className="ops-detail-list">
                {detailQuery.data?.recent_measures.length ? detailQuery.data.recent_measures.map((measure, index) => (
                  <div key={`${measure.created_at}-${index}`} className="ops-detail-row">
                    <div>
                      <strong>{measure.label}</strong>
                      <p>{measure.reason}</p>
                    </div>
                    <div className="ops-detail-row-side">
                      <span>{measure.duration_days ? `${measure.duration_days} gun` : 'Suresiz'}</span>
                      <strong>{formatDateTime(measure.created_at)}</strong>
                    </div>
                  </div>
                )) : <div className="ops-empty-state">Kayitli kontrol onlemi yok.</div>}
                {detailQuery.data?.recent_notes.length ? detailQuery.data.recent_notes.map((entry, index) => (
                  <div key={`${entry.created_at}-${index}`} className="ops-detail-row ops-detail-row-note">
                    <div>
                      <strong>{entry.created_by}</strong>
                      <p>{entry.note}</p>
                    </div>
                    <div className="ops-detail-row-side">
                      <strong>{formatDateTime(entry.created_at)}</strong>
                    </div>
                  </div>
                )) : null}
              </div>
            </div>
            <div className="ops-detail-section">
              <h4>Audit izi</h4>
              <div className="ops-detail-list ops-detail-list-scroll">
                {detailQuery.data?.recent_audit_entries.length ? detailQuery.data.recent_audit_entries.map((entry) => (
                  <div key={entry.audit_id} className="ops-detail-row">
                    <div>
                      <strong>{entry.label}</strong>
                      <p>{JSON.stringify(entry.details)}</p>
                    </div>
                    <div className="ops-detail-row-side">
                      <span>{entry.actor_id}</span>
                      <strong>{formatDateTime(entry.ts_utc)}</strong>
                    </div>
                  </div>
                )) : <div className="ops-empty-state">Audit kaydi bulunmuyor.</div>}
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={actionState !== null}
        title={actionState?.kind === 'action' ? (actionState.actionType === 'SUSPEND' ? 'Askiya al' : actionState.actionType === 'DISABLE_TEMP' ? 'Gecici devre disi' : 'Incelemeye al') : actionState?.kind === 'override' ? 'Risk override' : 'Not ekle'}
        onClose={() => setActionState(null)}
        maxWidthClass="max-w-2xl"
      >
        <div className="ops-action-form">
          {actionState?.kind !== 'note' ? (
            <>
              <label className="ops-field"><span>Sebep</span><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Islem gerekcesi" /></label>
              {actionState?.kind === 'override' ? <label className="ops-field"><span>Risk skoru</span><input type="number" min={0} max={100} value={overrideScore} onChange={(event) => setOverrideScore(event.target.value)} /></label> : null}
              <label className="ops-field"><span>Sure</span><select value={duration} onChange={(event) => setDuration(event.target.value as '1' | '3' | '7' | 'indefinite')}><option value="1">1 gun</option><option value="3">3 gun</option><option value="7">7 gun</option><option value="indefinite">Suresiz</option></select></label>
            </>
          ) : null}
          <label className="ops-field"><span>{actionState?.kind === 'note' ? 'Not' : 'Islem notu'}</span><textarea value={note} onChange={(event) => setNote(event.target.value)} rows={5} /></label>
          <div className="ops-action-footer">
            <button type="button" className="ops-button ops-button-ghost" onClick={() => setActionState(null)}>Vazgec</button>
            <button
              type="button"
              className="ops-button ops-button-primary"
              disabled={actionMutation.isPending || (!note.trim()) || (actionState?.kind !== 'note' && !reason.trim())}
              onClick={() => void actionMutation.mutateAsync()}
            >
              {actionMutation.isPending ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
