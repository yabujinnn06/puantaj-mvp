import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useLocation } from 'react-router-dom'

import { getControlRoomOverview, getDepartments, getEmployees, getNotificationJobs, getRegions } from '../api/admin'
import { EmployeeAutocompleteField } from '../components/EmployeeAutocompleteField'
import { ErrorBlock } from '../components/ErrorBlock'
import { LoadingBlock } from '../components/LoadingBlock'
import { MinuteDisplay } from '../components/MinuteDisplay'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'
import { controlRoomQueryKeys } from '../components/control-room/queryKeys'
import { formatDateTime, todayStatusLabel } from '../components/control-room/utils'
import { UI_BRANDING } from '../config/ui'
import { useAuth } from '../hooks/useAuth'
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

type WelcomeAbsenceRow = {
  jobId: number
  employeeId: number | null
  employeeKey: string | null
  fullName: string
  departmentName: string
  shiftWindow: string
  shiftDate: string
  status: 'PENDING' | 'SENDING' | 'SENT' | 'CANCELED' | 'FAILED'
  consecutiveAbsenceDays: number
}

const WELCOME_PAGE_SIZES = [12, 24, 48]
const WELCOME_ABSENCE_LIMIT = 200
const WELCOME_ABSENCE_QUERY_LIMIT = WELCOME_ABSENCE_LIMIT * 2
const TYPE_ABSENCE = 'devamsizlik'
const ABSENCE_BOARD_ID = 'absence-board'

const WELCOME_INPUT_DAY_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Istanbul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const WELCOME_DAY_LABEL_FORMAT = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul',
  weekday: 'long',
  day: '2-digit',
  month: 'long',
  year: 'numeric',
})

function getTodayIsoDay(): string {
  return WELCOME_INPUT_DAY_FORMAT.format(new Date())
}

function normalizeIsoDay(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!normalized) return null
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(normalized)
  return match?.[1] ?? null
}

function formatIsoDayLabel(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return value

  const [, year, month, day] = match
  const reference = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12, 0, 0))
  return WELCOME_DAY_LABEL_FORMAT.format(reference)
}

function readPayloadText(payload: Record<string, unknown>, key: string): string {
  const value = payload[key]
  return typeof value === 'string' ? value.trim() : ''
}

function shiftIsoDay(value: string, offsetDays: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return value

  const [, year, month, day] = match
  const reference = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12, 0, 0))
  reference.setUTCDate(reference.getUTCDate() + offsetDays)
  return reference.toISOString().slice(0, 10)
}

function resolveAbsenceEmployeeId(payload: Record<string, unknown>, fallbackEmployeeId: number | null): number | null {
  const payloadEmployeeId = payload.employee_id
  if (typeof payloadEmployeeId === 'number' && payloadEmployeeId > 0) {
    return payloadEmployeeId
  }
  if (typeof payloadEmployeeId === 'string' && /^\d+$/.test(payloadEmployeeId.trim())) {
    return Number(payloadEmployeeId.trim())
  }
  return fallbackEmployeeId
}

function resolveAbsenceEmployeeKey(employeeId: number | null): string | null {
  return employeeId != null ? `employee:${employeeId}` : null
}

function absenceStatusTone(status: WelcomeAbsenceRow['status']): string {
  if (status === 'SENT') return 'is-verified'
  if (status === 'FAILED') return 'is-alert'
  if (status === 'PENDING' || status === 'SENDING') return 'is-waiting'
  return 'is-muted'
}

function absenceStatusLabel(status: WelcomeAbsenceRow['status']): string {
  if (status === 'SENT') return 'Gonderildi'
  if (status === 'FAILED') return 'Hata'
  if (status === 'SENDING') return 'Gonderiliyor'
  if (status === 'PENDING') return 'Bekliyor'
  return 'Iptal'
}

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
  tone = 'default',
}: {
  label: string
  value: ReactNode
  tone?: 'default' | 'live' | 'watch' | 'active'
}) {
  return (
    <article className={`welcome-summary-card is-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}

function WelcomeSignalCard({
  label,
  title,
}: {
  label: string
  title: ReactNode
}) {
  return (
    <article className="welcome-signal-card">
      <span>{label}</span>
      <strong>{title}</strong>
    </article>
  )
}

export function WelcomePage() {
  const location = useLocation()
  const { hasPermission } = useAuth()
  const absenceBoardRef = useRef<HTMLDivElement | null>(null)
  const [employeeId, setEmployeeId] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [regionId, setRegionId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [employmentFilter, setEmploymentFilter] = useState<EmploymentFilter>('all')
  const [pageSize, setPageSize] = useState(24)
  const [page, setPage] = useState(1)
  const [sortField, setSortField] = useState<WelcomeSortField>('overtime')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [isAbsenceBoardFocused, setIsAbsenceBoardFocused] = useState(false)
  const todayIsoDay = useMemo(() => getTodayIsoDay(), [])
  const canViewAbsenceBoard = hasPermission('notifications')

  const requestedAbsenceDate = useMemo(() => {
    const params = new URLSearchParams(location.search)
    return (
      normalizeIsoDay(params.get('absence_date')) ??
      normalizeIsoDay(params.get('shift_date')) ??
      normalizeIsoDay(params.get('start_date')) ??
      todayIsoDay
    )
  }, [location.search, todayIsoDay])

  const absenceFocusRequested = useMemo(() => {
    const params = new URLSearchParams(location.search)
    const focus = (params.get('focus') ?? '').trim().toLowerCase()
    const notificationType = (params.get('notification_type') ?? '').trim().toLowerCase()
    return focus === ABSENCE_BOARD_ID || notificationType === TYPE_ABSENCE || location.hash === `#${ABSENCE_BOARD_ID}`
  }, [location.hash, location.search])

  const [absenceDate, setAbsenceDate] = useState(requestedAbsenceDate)
  const previousAbsenceDate = useMemo(() => shiftIsoDay(absenceDate, -1), [absenceDate])

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

  const absenceJobsQuery = useQuery({
    enabled: canViewAbsenceBoard,
    queryKey: ['welcome', 'absence-board', previousAbsenceDate, absenceDate],
    queryFn: () =>
      getNotificationJobs({
        audience: 'admin',
        notification_type: TYPE_ABSENCE,
        start_date: previousAbsenceDate,
        end_date: absenceDate,
        limit: WELCOME_ABSENCE_QUERY_LIMIT,
        offset: 0,
      }),
    staleTime: 60_000,
  })

  useEffect(() => {
    setPage(1)
  }, [departmentId, employeeId, employmentFilter, pageSize, regionId, searchTerm, sortDirection, sortField])

  useEffect(() => {
    setAbsenceDate(requestedAbsenceDate)
  }, [requestedAbsenceDate])

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

  const absenceRows = useMemo<WelcomeAbsenceRow[]>(() => {
    const seenEmployeeDays = new Set<string>()
    const normalizedRows = (absenceJobsQuery.data?.items ?? []).flatMap((job) => {
      const payload = job.payload ?? {}
      const shiftDate =
        normalizeIsoDay(readPayloadText(payload, 'shift_date')) ?? normalizeIsoDay(job.local_day) ?? absenceDate

      const employeeId = resolveAbsenceEmployeeId(payload, job.employee_id)
      const dedupeKey = `${employeeId ?? `job:${job.id}`}:${shiftDate}`
      if (seenEmployeeDays.has(dedupeKey)) {
        return []
      }
      seenEmployeeDays.add(dedupeKey)

      return [
        {
          jobId: job.id,
          employeeId,
          employeeKey: resolveAbsenceEmployeeKey(employeeId),
          fullName: readPayloadText(payload, 'employee_full_name') || `Calisan #${employeeId ?? job.id}`,
          departmentName: readPayloadText(payload, 'department_name') || 'Departman belirtilmedi',
          shiftWindow: readPayloadText(payload, 'shift_window_local') || job.shift_summary || 'Vardiya bilgisi yok',
          shiftDate,
          status: job.status,
          consecutiveAbsenceDays: 1,
        },
      ]
    })
    const previousDayEmployeeKeys = new Set(
      normalizedRows
        .filter((row) => row.shiftDate === previousAbsenceDate && row.employeeKey)
        .map((row) => row.employeeKey as string),
    )

    return normalizedRows
      .filter((row) => row.shiftDate === absenceDate)
      .map((row) => ({
        ...row,
        consecutiveAbsenceDays: row.employeeKey && previousDayEmployeeKeys.has(row.employeeKey) ? 2 : 1,
      }))
      .sort((left, right) => {
        if (right.consecutiveAbsenceDays !== left.consecutiveAbsenceDays) {
          return right.consecutiveAbsenceDays - left.consecutiveAbsenceDays
        }
        const departmentCompare = left.departmentName.localeCompare(right.departmentName, 'tr')
        if (departmentCompare !== 0) return departmentCompare
        return left.fullName.localeCompare(right.fullName, 'tr')
      })
  }, [absenceDate, absenceJobsQuery.data?.items, previousAbsenceDate])

  const absenceDayLabel = useMemo(() => formatIsoDayLabel(absenceDate), [absenceDate])

  const absenceDepartmentCount = useMemo(
    () => new Set(absenceRows.map((row) => row.departmentName)).size,
    [absenceRows],
  )

  const absencePendingCount = useMemo(
    () => absenceRows.filter((row) => row.status === 'PENDING' || row.status === 'SENDING').length,
    [absenceRows],
  )

  const absenceDeliveredCount = useMemo(
    () => absenceRows.filter((row) => row.status === 'SENT').length,
    [absenceRows],
  )

  const absenceStreakCount = useMemo(
    () => absenceRows.filter((row) => row.consecutiveAbsenceDays >= 2).length,
    [absenceRows],
  )

  useEffect(() => {
    if (!absenceFocusRequested || !canViewAbsenceBoard) return
    if (!absenceBoardRef.current) return

    const frameId = window.requestAnimationFrame(() => {
      absenceBoardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setIsAbsenceBoardFocused(true)
    })
    const timeoutId = window.setTimeout(() => {
      setIsAbsenceBoardFocused(false)
    }, 2600)

    return () => {
      window.cancelAnimationFrame(frameId)
      window.clearTimeout(timeoutId)
    }
  }, [absenceFocusRequested, canViewAbsenceBoard, absenceDate, absenceRows.length])

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
              <WelcomeHeroMetric label="Kapsamdaki kadro" value={summary.total} tone="active" />
              <WelcomeHeroMetric
                label="Aylık fazla mesai"
                value={<MinuteDisplay minutes={summary.overtime} />}
                tone="watch"
              />
              <WelcomeHeroMetric
                label="Planlanan yük"
                value={<MinuteDisplay minutes={summary.planOvertime} />}
                tone="live"
              />
              <WelcomeHeroMetric label="Ek çalışma" value={<MinuteDisplay minutes={summary.extraWork} />} />
            </div>
          </div>

          <div className="welcome-hero__visual welcome-reveal is-delay-5">
            <div className="welcome-scene">
              <span className="welcome-scene__chip is-top">Hızlı tarama</span>
              <span className="welcome-scene__chip is-left">Kurumsal netlik</span>

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

              <div className="welcome-scene__signature">
                <div className="welcome-scene__signature-mark" aria-hidden="true">
                  <span className="welcome-scene__signature-core">Y</span>
                  <span className="welcome-scene__signature-trace" />
                  <span className="welcome-scene__signature-pulse is-a" />
                  <span className="welcome-scene__signature-pulse is-b" />
                </div>
                <div className="welcome-scene__signature-copy">
                  <p className="welcome-scene__signature-kicker">YABUJIN SIGNATURE</p>
                  <strong>{UI_BRANDING.signatureText}</strong>
                  <span>{UI_BRANDING.signatureTagline}</span>
                </div>
              </div>

              <div className="welcome-scene__panel">
                <div>
                  <span>Aktif vardiya</span>
                  <strong>{heroInsights.liveCount}</strong>
                </div>
                <div>
                  <span>Pasif / bekleyen</span>
                  <strong>{heroInsights.waitingCount}</strong>
                </div>
                <div>
                  <span>Aktif oran</span>
                  <strong>%{heroInsights.activeRate}</strong>
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

      {canViewAbsenceBoard ? (
        <div id={ABSENCE_BOARD_ID} ref={absenceBoardRef}>
          <Panel className={`welcome-absence-panel ${isAbsenceBoardFocused ? 'is-focus' : ''}`}>
            <div className="welcome-absence-panel__head welcome-reveal is-delay-6">
              <div>
                <p className="welcome-panel-kicker">GUNLUK DEVAMSIZLIK</p>
                <h3>{absenceDayLabel} devamsizlik tablosu</h3>
                <p>Secilen gunde devamsizlik yapan calisanlar burada gunluk tablo halinde listelenir.</p>
              </div>

              <div className="welcome-absence-panel__actions">
                <label className="welcome-inline-field">
                  <span>Tarih</span>
                  <input
                    type="date"
                    value={absenceDate}
                    onChange={(event) => setAbsenceDate(event.target.value || todayIsoDay)}
                    className="welcome-filter__control welcome-absence-panel__date"
                  />
                </label>

                <button
                  type="button"
                  onClick={() => setAbsenceDate(todayIsoDay)}
                  className="welcome-absence-action"
                >
                  Bugune don
                </button>

                <Link
                  to={`/notifications?notification_type=${TYPE_ABSENCE}&start_date=${absenceDate}&end_date=${absenceDate}`}
                  className="welcome-absence-action is-primary"
                >
                  Bildirim kayitlari
                </Link>
              </div>
            </div>

            {absenceJobsQuery.isPending ? (
              <div className="welcome-absence-loading">Devamsizlik kayitlari yukleniyor...</div>
            ) : absenceJobsQuery.isError ? (
              <ErrorBlock message="Gunluk devamsizlik panosu yuklenemedi." />
            ) : (
              <>
                <div className="welcome-absence-summary">
                  <span className="welcome-absence-summary-chip">{absenceRows.length} calisan</span>
                  <span className="welcome-absence-summary-chip">{absenceDepartmentCount} departman</span>
                  <span className="welcome-absence-summary-chip">
                    {absenceDeliveredCount} gonderildi / {absencePendingCount} bekliyor
                  </span>
                  <span className={`welcome-absence-summary-chip ${absenceStreakCount ? 'is-alert' : ''}`}>
                    {absenceStreakCount} kisi 2 gun ust uste
                  </span>
                </div>

                {absenceRows.length ? (
                  <div className="welcome-absence-table-shell">
                    <table className="welcome-absence-table">
                      <thead>
                        <tr>
                          <th>Calisan</th>
                          <th>Departman</th>
                          <th>Vardiya</th>
                          <th>Bildirim</th>
                          <th>Seri</th>
                        </tr>
                      </thead>
                      <tbody>
                        {absenceRows.map((row) => (
                          <tr
                            key={`${row.jobId}-${row.employeeId ?? 'na'}`}
                            className={`welcome-absence-row ${row.consecutiveAbsenceDays >= 2 ? 'is-streak' : ''}`}
                          >
                            <td>
                              <div className="welcome-absence-employee">
                                <strong>{row.fullName}</strong>
                                <span>#{row.employeeId ?? row.jobId}</span>
                              </div>
                            </td>
                            <td>{row.departmentName}</td>
                            <td>{row.shiftWindow}</td>
                            <td>
                              <span className={`welcome-status ${absenceStatusTone(row.status)}`}>
                                {absenceStatusLabel(row.status)}
                              </span>
                            </td>
                            <td>
                              <span
                                className={`welcome-absence-streak ${
                                  row.consecutiveAbsenceDays >= 2 ? 'is-alert' : 'is-idle'
                                }`}
                              >
                                {row.consecutiveAbsenceDays >= 2 ? '2 gun ust uste' : 'Gunluk'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="welcome-empty welcome-absence-empty">
                    {absenceDayLabel} icin admin devamsizlik kaydi bulunmuyor.
                  </div>
                )}
              </>
            )}
          </Panel>
        </div>
      ) : null}

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
