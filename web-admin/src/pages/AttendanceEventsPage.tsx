import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  createManualAttendanceEvent,
  getAttendanceEvents,
  getAuditLogs,
  getDepartments,
  getDepartmentShifts,
  getEmployees,
  getMonthlyEmployee,
  softDeleteAttendanceEvent,
  updateManualAttendanceEvent,
  type AttendanceEventParams,
} from '../api/admin'
import { parseApiError } from '../api/error'
import { EmployeeAutocompleteField } from '../components/EmployeeAutocompleteField'
import { ErrorBlock } from '../components/ErrorBlock'
import { LoadingBlock } from '../components/LoadingBlock'
import { MinuteDisplay } from '../components/MinuteDisplay'
import { Modal } from '../components/Modal'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'
import { SuspiciousBadge } from '../components/SuspiciousBadge'
import { SuspiciousReasonList } from '../components/SuspiciousReasonList'
import { useToast } from '../hooks/useToast'
import type { AttendanceEvent, AttendanceType, LocationStatus } from '../types/api'
import { buildMonthlyAttendanceInsight, getAttendanceDayType } from '../utils/attendanceInsights'
import { getFlagMeta } from '../utils/flagDictionary'

const LOCATION_OPTIONS: { value: 'ALL' | LocationStatus; label: string }[] = [
  { value: 'ALL', label: 'Tüm konum durumları' },
  { value: 'VERIFIED_HOME', label: 'Evde onaylı' },
  { value: 'UNVERIFIED_LOCATION', label: 'Ev dışı' },
  { value: 'NO_LOCATION', label: 'Konum yok' },
]

const EVENT_TYPE_OPTIONS: { value: 'ALL' | AttendanceType; label: string }[] = [
  { value: 'ALL', label: 'Tüm tipler' },
  { value: 'IN', label: 'IN (Giriş)' },
  { value: 'OUT', label: 'OUT (Çıkış)' },
]

interface EventFilters {
  employeeId: string
  departmentId: string
  dateFrom: string
  dateTo: string
  eventType: 'ALL' | AttendanceType
  locationStatus: 'ALL' | LocationStatus
  duplicatesOnly: boolean
  suspiciousOnly: boolean
  includeDeleted: boolean
  limit: string
}

const DEFAULT_FILTERS: EventFilters = {
  employeeId: '',
  departmentId: '',
  dateFrom: '',
  dateTo: '',
  eventType: 'ALL',
  locationStatus: 'ALL',
  duplicatesOnly: false,
  suspiciousOnly: false,
  includeDeleted: false,
  limit: '200',
}

function flagIsTrue(flags: Record<string, unknown>, key: string): boolean {
  return flags[key] === true
}

function parseShiftId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed
    }
  }
  return null
}

function formatTs(ts: string): string {
  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date(ts))
}

function toDatetimeLocalValue(ts: string): string {
  const date = new Date(ts)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function locationStatusLabel(status: LocationStatus): string {
  if (status === 'VERIFIED_HOME') return 'Evde onaylı'
  if (status === 'UNVERIFIED_LOCATION') return 'Ev dışı'
  return 'Konum yok'
}

function suspiciousReasons(event: AttendanceEvent): string[] {
  const reasons: string[] = []
  const homeLocationMissing = event.flags['reason'] === 'home_location_not_set'
  if (flagIsTrue(event.flags, 'DUPLICATE_EVENT')) reasons.push('DUPLICATE_EVENT')
  if (flagIsTrue(event.flags, 'MANUAL_CHECKOUT')) reasons.push('MANUAL_CHECKOUT')
  if (flagIsTrue(event.flags, 'NEEDS_SHIFT_REVIEW')) reasons.push('NEEDS_SHIFT_REVIEW')
  if (event.location_status === 'NO_LOCATION') reasons.push('LOCATION_NO_LOCATION')
  if (event.location_status === 'UNVERIFIED_LOCATION' && !homeLocationMissing) reasons.push('LOCATION_UNVERIFIED')
  if (event.source === 'MANUAL' || event.created_by_admin || flagIsTrue(event.flags, 'ADMIN_MANUAL')) {
    reasons.push('ADMIN_MANUAL_EVENT')
  }
  return reasons
}

function numericValue(raw: string): number | null {
  const parsed = Number(raw)
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed
  }
  return null
}

function formatFlagList(flags: string[]): string {
  if (!flags.length) {
    return '-'
  }
  return flags.map((flag) => `${getFlagMeta(flag).label} (${flag})`).join(', ')
}

export function AttendanceEventsPage() {
  const queryClient = useQueryClient()
  const { pushToast } = useToast()

  const [draftFilters, setDraftFilters] = useState<EventFilters>(DEFAULT_FILTERS)
  const [appliedFilters, setAppliedFilters] = useState<EventFilters>(DEFAULT_FILTERS)

  const [manualEmployeeId, setManualEmployeeId] = useState('')
  const [manualType, setManualType] = useState<AttendanceType>('IN')
  const [manualDatetime, setManualDatetime] = useState('')
  const [manualNote, setManualNote] = useState('')
  const [manualShiftId, setManualShiftId] = useState('')
  const [manualAllowDuplicate, setManualAllowDuplicate] = useState(false)

  const [editingEvent, setEditingEvent] = useState<AttendanceEvent | null>(null)
  const [editType, setEditType] = useState<AttendanceType>('IN')
  const [editDatetime, setEditDatetime] = useState('')
  const [editNote, setEditNote] = useState('')
  const [editShiftId, setEditShiftId] = useState('')
  const [editAllowDuplicate, setEditAllowDuplicate] = useState(false)
  const [editForce, setEditForce] = useState(false)

  const [deletingEvent, setDeletingEvent] = useState<AttendanceEvent | null>(null)
  const [deleteForce, setDeleteForce] = useState(false)

  const employeesQuery = useQuery({
    queryKey: ['employees', 'all'],
    queryFn: () => getEmployees({ status: 'all', include_inactive: true }),
  })
  const departmentsQuery = useQuery({ queryKey: ['departments'], queryFn: getDepartments })
  const shiftsQuery = useQuery({
    queryKey: ['department-shifts', 'all'],
    queryFn: () => getDepartmentShifts({ active_only: false }),
  })

  const eventParams = useMemo<AttendanceEventParams>(() => {
    const employeeId = Number(appliedFilters.employeeId)
    const departmentId = Number(appliedFilters.departmentId)
    const limit = Number(appliedFilters.limit)
    return {
      employee_id: employeeId > 0 ? employeeId : undefined,
      department_id: departmentId > 0 ? departmentId : undefined,
      start_date: appliedFilters.dateFrom || undefined,
      end_date: appliedFilters.dateTo || undefined,
      type: appliedFilters.eventType === 'ALL' ? undefined : appliedFilters.eventType,
      location_status: appliedFilters.locationStatus === 'ALL' ? undefined : appliedFilters.locationStatus,
      duplicates_only: appliedFilters.duplicatesOnly || undefined,
      include_deleted: appliedFilters.includeDeleted || undefined,
      limit: limit > 0 ? limit : 200,
    }
  }, [appliedFilters])

  const eventsQuery = useQuery({
    queryKey: ['attendance-events', eventParams],
    queryFn: () => getAttendanceEvents(eventParams),
  })
  const auditLogsQuery = useQuery({
    queryKey: ['audit-logs', 'attendance-events'],
    queryFn: () => getAuditLogs({ entity_type: 'attendance_event', limit: 50 }),
  })

  const selectedSummaryEmployeeId = Number(appliedFilters.employeeId)
  const summaryMonthDate = useMemo(() => {
    const rawDate = appliedFilters.dateFrom || appliedFilters.dateTo
    if (!rawDate) {
      return new Date()
    }
    const parsed = new Date(`${rawDate}T00:00:00`)
    if (Number.isNaN(parsed.getTime())) {
      return new Date()
    }
    return parsed
  }, [appliedFilters.dateFrom, appliedFilters.dateTo])

  const monthlySummaryQuery = useQuery({
    queryKey: ['attendance-events-monthly-summary', selectedSummaryEmployeeId, summaryMonthDate.getFullYear(), summaryMonthDate.getMonth() + 1],
    queryFn: () =>
      getMonthlyEmployee({
        employee_id: selectedSummaryEmployeeId,
        year: summaryMonthDate.getFullYear(),
        month: summaryMonthDate.getMonth() + 1,
      }),
    enabled: Number.isInteger(selectedSummaryEmployeeId) && selectedSummaryEmployeeId > 0,
    staleTime: 15_000,
  })

  const createManualMutation = useMutation({
    mutationFn: createManualAttendanceEvent,
    onSuccess: () => {
      pushToast({
        variant: 'success',
        title: 'Manuel event kaydedildi',
        description: 'Kayıt başarıyla oluşturuldu.',
      })
      setManualNote('')
      setManualShiftId('')
      setManualAllowDuplicate(false)
      void queryClient.invalidateQueries({ queryKey: ['attendance-events'] })
      void queryClient.invalidateQueries({ queryKey: ['audit-logs'] })
    },
    onError: (error) => {
      pushToast({
        variant: 'error',
        title: 'Kayıt oluşturulamadı',
        description: parseApiError(error, 'İşlem başarısız.').message,
      })
    },
  })

  const updateManualMutation = useMutation({
    mutationFn: ({ eventId, payload }: { eventId: number; payload: Parameters<typeof updateManualAttendanceEvent>[1] }) =>
      updateManualAttendanceEvent(eventId, payload),
    onSuccess: () => {
      pushToast({
        variant: 'success',
        title: 'Event güncellendi',
        description: 'Değişiklikler kaydedildi.',
      })
      setEditingEvent(null)
      void queryClient.invalidateQueries({ queryKey: ['attendance-events'] })
      void queryClient.invalidateQueries({ queryKey: ['audit-logs'] })
    },
    onError: (error) => {
      pushToast({
        variant: 'error',
        title: 'Event güncellenemedi',
        description: parseApiError(error, 'İşlem başarısız.').message,
      })
    },
  })

  const deleteEventMutation = useMutation({
    mutationFn: ({ eventId, force }: { eventId: number; force: boolean }) => softDeleteAttendanceEvent(eventId, force),
    onSuccess: () => {
      pushToast({
        variant: 'success',
        title: 'Event soft silindi',
        description: 'Kayıt pasife alındı.',
      })
      setDeletingEvent(null)
      setDeleteForce(false)
      void queryClient.invalidateQueries({ queryKey: ['attendance-events'] })
      void queryClient.invalidateQueries({ queryKey: ['audit-logs'] })
    },
    onError: (error) => {
      pushToast({
        variant: 'error',
        title: 'Silme başarısız',
        description: parseApiError(error, 'İşlem başarısız.').message,
      })
    },
  })

  const employees = employeesQuery.data ?? []
  const departments = departmentsQuery.data ?? []
  const shifts = shiftsQuery.data ?? []
  const events = eventsQuery.data ?? []
  const monthlySummaryRows = useMemo(() => {
    const rows = monthlySummaryQuery.data?.days ?? []
    return rows.filter((day) => {
      if (appliedFilters.dateFrom && day.date < appliedFilters.dateFrom) {
        return false
      }
      if (appliedFilters.dateTo && day.date > appliedFilters.dateTo) {
        return false
      }
      return true
    })
  }, [monthlySummaryQuery.data?.days, appliedFilters.dateFrom, appliedFilters.dateTo])
  const monthlySummaryInsight = useMemo(
    () => buildMonthlyAttendanceInsight(monthlySummaryRows),
    [monthlySummaryRows],
  )

  const employeeById = useMemo(() => new Map(employees.map((item) => [item.id, item])), [employees])
  const employeeNameById = useMemo(() => new Map(employees.map((item) => [item.id, item.full_name])), [employees])
  const departmentById = useMemo(() => new Map(departments.map((item) => [item.id, item.name])), [departments])
  const shiftById = useMemo(() => new Map(shifts.map((item) => [item.id, item])), [shifts])

  const selectedManualEmployee = useMemo(
    () => employeeById.get(Number(manualEmployeeId)),
    [employeeById, manualEmployeeId],
  )

  const manualShiftOptions = useMemo(() => {
    if (!selectedManualEmployee?.department_id) return shifts
    return shifts.filter((item) => item.department_id === selectedManualEmployee.department_id)
  }, [selectedManualEmployee?.department_id, shifts])

  const editShiftOptions = useMemo(() => {
    if (!editingEvent) return shifts
    const eventEmployee = employeeById.get(editingEvent.employee_id)
    if (!eventEmployee?.department_id) return shifts
    return shifts.filter((item) => item.department_id === eventEmployee.department_id)
  }, [employeeById, editingEvent, shifts])

  const filteredEvents = useMemo(() => {
    if (!appliedFilters.suspiciousOnly) return events
    return events.filter((item) => suspiciousReasons(item).length > 0)
  }, [events, appliedFilters.suspiciousOnly])

  const applyFilters = () => setAppliedFilters({ ...draftFilters })
  const clearFilters = () => {
    setDraftFilters(DEFAULT_FILTERS)
    setAppliedFilters(DEFAULT_FILTERS)
  }

  const onCreateManualEvent = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const employeeId = numericValue(manualEmployeeId)
    if (!employeeId || !manualDatetime) {
      pushToast({
        variant: 'error',
        title: 'Eksik alan',
        description: 'Çalışan ve tarih/saat zorunludur.',
      })
      return
    }

    const shiftId = numericValue(manualShiftId)
    createManualMutation.mutate({
      employee_id: employeeId,
      type: manualType,
      ts_utc: new Date(manualDatetime).toISOString(),
      note: manualNote || undefined,
      shift_id: shiftId ?? undefined,
      allow_duplicate: manualAllowDuplicate,
    })
  }

  const openEditModal = (item: AttendanceEvent) => {
    setEditingEvent(item)
    setEditType(item.type)
    setEditDatetime(toDatetimeLocalValue(item.ts_utc))
    setEditNote(item.note ?? '')
    setEditAllowDuplicate(false)
    setEditForce(false)
    setEditShiftId(String(parseShiftId(item.flags.SHIFT_ID) ?? ''))
  }

  const onUpdateEvent = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editingEvent || !editDatetime) return

    const shiftId = numericValue(editShiftId)
    updateManualMutation.mutate({
      eventId: editingEvent.id,
      payload: {
        type: editType,
        ts_utc: new Date(editDatetime).toISOString(),
        note: editNote || null,
        shift_id: shiftId ?? undefined,
        allow_duplicate: editAllowDuplicate,
        force_edit: editForce,
      },
    })
  }

  if (employeesQuery.isLoading || departmentsQuery.isLoading || shiftsQuery.isLoading) return <LoadingBlock />
  if (employeesQuery.isError || departmentsQuery.isError || shiftsQuery.isError) {
    return <ErrorBlock message="Çalışan/departman/vardiya bilgileri alınamadı." />
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Yoklama Kayıtları"
        description="Manuel event ekleme, vardiya düzeltme, soft silme ve audit takibi."
      />

      <Panel>
        <h4 className="text-base font-semibold text-slate-900">Filtreler</h4>
        <div className="mt-3 grid gap-3 md:grid-cols-3 lg:grid-cols-4">
          <EmployeeAutocompleteField
            label="Çalışan"
            employees={employees}
            value={draftFilters.employeeId}
            onChange={(employeeId) => setDraftFilters((prev) => ({ ...prev, employeeId }))}
            emptyLabel="Tümü"
            helperText="Ad-soyad veya ID ile arayın."
          />
<label className="text-sm text-slate-700">
            Departman
            <select
              value={draftFilters.departmentId}
              onChange={(e) => setDraftFilters((prev) => ({ ...prev, departmentId: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="">Tümü</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  #{department.id} - {department.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm text-slate-700">
            Başlangıç
            <input
              type="date"
              value={draftFilters.dateFrom}
              onChange={(e) => setDraftFilters((prev) => ({ ...prev, dateFrom: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="text-sm text-slate-700">
            Bitiş
            <input
              type="date"
              value={draftFilters.dateTo}
              onChange={(e) => setDraftFilters((prev) => ({ ...prev, dateTo: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="text-sm text-slate-700">
            Event tipi
            <select
              value={draftFilters.eventType}
              onChange={(e) => setDraftFilters((prev) => ({ ...prev, eventType: e.target.value as 'ALL' | AttendanceType }))}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              {EVENT_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>

          <label className="text-sm text-slate-700">
            Konum
            <select
              value={draftFilters.locationStatus}
              onChange={(e) => setDraftFilters((prev) => ({ ...prev, locationStatus: e.target.value as 'ALL' | LocationStatus }))}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              {LOCATION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>

          <label className="text-sm text-slate-700">
            Limit
            <input
              type="number"
              value={draftFilters.limit}
              onChange={(e) => setDraftFilters((prev) => ({ ...prev, limit: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <div className="flex flex-col justify-end gap-2 text-sm text-slate-700">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={draftFilters.duplicatesOnly}
                onChange={(e) => setDraftFilters((prev) => ({ ...prev, duplicatesOnly: e.target.checked }))}
              />
              Sadece mükerrer
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={draftFilters.suspiciousOnly}
                onChange={(e) => setDraftFilters((prev) => ({ ...prev, suspiciousOnly: e.target.checked }))}
              />
              Sadece şüpheli
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={draftFilters.includeDeleted}
                onChange={(e) => setDraftFilters((prev) => ({ ...prev, includeDeleted: e.target.checked }))}
              />
              Silinenleri göster
            </label>
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <button type="button" onClick={applyFilters} className="btn-primary rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
            Uygula
          </button>
          <button type="button" onClick={clearFilters} className="btn-secondary rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Temizle
          </button>
        </div>
      </Panel>

      <Panel>
        <h4 className="text-base font-semibold text-slate-900">Manuel Event Ekle</h4>
        <form onSubmit={onCreateManualEvent} className="mt-3 grid gap-3 md:grid-cols-3">
          <EmployeeAutocompleteField
            label="Çalışan"
            employees={employees}
            value={manualEmployeeId}
            onChange={setManualEmployeeId}
            emptyLabel="Seçiniz"
            helperText="Manuel kayıt için çalışan seçin."
            className="md:col-span-2"
          />
<label className="text-sm text-slate-700">
            Event tipi
            <select
              value={manualType}
              onChange={(e) => setManualType(e.target.value as AttendanceType)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="IN">IN (Giriş)</option>
              <option value="OUT">OUT (Çıkış)</option>
            </select>
          </label>

          <label className="text-sm text-slate-700">
            Tarih/saat
            <input
              type="datetime-local"
              value={manualDatetime}
              onChange={(e) => setManualDatetime(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="text-sm text-slate-700">
            Vardiya (opsiyonel)
            <select
              value={manualShiftId}
              onChange={(e) => setManualShiftId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="">Otomatik/boş</option>
              {manualShiftOptions.map((shift) => (
                <option key={shift.id} value={shift.id}>
                  #{shift.id} - {shift.name} ({shift.start_time_local}-{shift.end_time_local})
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm text-slate-700 md:col-span-3">
            Not
            <input
              type="text"
              value={manualNote}
              onChange={(e) => setManualNote(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="inline-flex items-center gap-2 text-sm text-slate-700 md:col-span-3">
            <input
              type="checkbox"
              checked={manualAllowDuplicate}
              onChange={(e) => setManualAllowDuplicate(e.target.checked)}
            />
            Sıra çakışıyorsa duplicate olarak kaydet
          </label>

          <div className="md:col-span-3">
            <button
              type="submit"
              disabled={createManualMutation.isPending}
              className="btn-primary rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {createManualMutation.isPending ? 'Kaydediliyor...' : 'Manuel event kaydet'}
            </button>
          </div>
        </form>
      </Panel>

      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="text-base font-semibold text-slate-900">Puantaj Analiz Ozeti</h4>
            <p className="text-xs text-slate-500">
              Secili calisan icin saat bazli net calisma, fazla mesai ve gun tipi kirilimlari.
            </p>
          </div>
          <p className="text-xs text-slate-500">
            Ay: {summaryMonthDate.getFullYear()}-{String(summaryMonthDate.getMonth() + 1).padStart(2, '0')}
          </p>
        </div>

        {!selectedSummaryEmployeeId ? (
          <p className="mt-3 text-sm text-slate-600">Analiz gormek icin filtrelerden bir calisan secin.</p>
        ) : monthlySummaryQuery.isLoading ? (
          <LoadingBlock />
        ) : monthlySummaryQuery.isError ? (
          <ErrorBlock message={parseApiError(monthlySummaryQuery.error, 'Puantaj analiz ozeti alinamadi.').message} />
        ) : (
          <div className="mt-3 space-y-3">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">Net calisma</p>
                <p className="text-sm font-semibold text-slate-900">
                  <MinuteDisplay minutes={monthlySummaryInsight.workedMinutes} />
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">Plan ustu sure</p>
                <p className="text-sm font-semibold text-slate-900">
                  <MinuteDisplay minutes={monthlySummaryInsight.planOvertimeMinutes} />
                </p>
                <p className="text-xs text-slate-500">{monthlySummaryInsight.planOvertimeDayCount} gun</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">Yasal fazla mesai</p>
                <p className="text-sm font-semibold text-slate-900">
                  <MinuteDisplay minutes={monthlySummaryInsight.overtimeMinutes} />
                </p>
                <p className="text-xs text-slate-500">{monthlySummaryInsight.overtimeDayCount} gun</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">Calisilan gun</p>
                <p className="text-sm font-semibold text-slate-900">{monthlySummaryInsight.workedDayCount}</p>
                <p className="text-xs text-slate-500">Hafta ici: {monthlySummaryInsight.weekdayWorkedDayCount}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">Pazar / Ozel</p>
                <p className="text-sm font-semibold text-slate-900">
                  {monthlySummaryInsight.sundayWorkedDayCount} / {monthlySummaryInsight.specialWorkedDayCount} gun
                </p>
              </div>
            </div>

            <div className="max-h-[44vh] overflow-auto overscroll-contain">
              <table className="min-w-[1100px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2">Tarih</th>
                    <th className="py-2">Gun Tipi</th>
                    <th className="py-2">Durum</th>
                    <th className="py-2">Giris</th>
                    <th className="py-2">Cikis</th>
                    <th className="py-2">Calisma</th>
                    <th className="py-2">Plan Ustu</th>
                    <th className="py-2">Yasal Fazla Sure</th>
                    <th className="py-2">Yasal Fazla Mesai</th>
                    <th className="py-2">Bayraklar</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlySummaryRows.map((day) => (
                    <tr key={day.date} className="border-t border-slate-100">
                      <td className="py-2">{day.date}</td>
                      <td className="py-2">{getAttendanceDayType(day).label}</td>
                      <td className="py-2">{day.status}</td>
                      <td className="py-2">{day.in ? formatTs(day.in) : '-'}</td>
                      <td className="py-2">{day.out ? formatTs(day.out) : '-'}</td>
                      <td className="py-2"><MinuteDisplay minutes={day.worked_minutes} /></td>
                      <td className="py-2"><MinuteDisplay minutes={day.plan_overtime_minutes} /></td>
                      <td className="py-2"><MinuteDisplay minutes={day.legal_extra_work_minutes} /></td>
                      <td className="py-2"><MinuteDisplay minutes={day.legal_overtime_minutes} /></td>
                      <td className="py-2 text-xs text-slate-600">{formatFlagList(day.flags)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {monthlySummaryRows.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">Secili aralikta puantaj gun kaydi bulunamadi.</p>
              ) : null}
            </div>
          </div>
        )}
      </Panel>

      <Panel>
        <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs text-slate-500">Toplam kayıt</p>
            <p className="text-sm font-semibold text-slate-900">{filteredEvents.length}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs text-slate-500">Şüpheli kayıt</p>
            <p className="text-sm font-semibold text-slate-900">{filteredEvents.filter((i) => suspiciousReasons(i).length > 0).length}</p>
          </div>
        </div>

        {eventsQuery.isLoading ? <LoadingBlock /> : null}
        {eventsQuery.isError ? <ErrorBlock message={parseApiError(eventsQuery.error, 'Yoklama kayıtları alınamadı.').message} /> : null}

        {!eventsQuery.isLoading && !eventsQuery.isError ? (
          <div className="max-h-[66vh] overflow-auto overscroll-contain">
            <table className="min-w-[1320px] text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2">ID</th>
                  <th className="py-2">Çalışan</th>
                  <th className="py-2">Departman</th>
                  <th className="py-2">Tip</th>
                  <th className="py-2">Kaynak</th>
                  <th className="py-2">Zaman</th>
                  <th className="py-2">Konum</th>
                  <th className="py-2">Vardiya</th>
                  <th className="py-2">Not</th>
                  <th className="py-2">Bayraklar</th>
                  <th className="py-2">Durum</th>
                  <th className="py-2">Aksiyon</th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.map((item) => {
                  const reasons = suspiciousReasons(item)
                  const employee = employeeById.get(item.employee_id)
                  const departmentName = employee?.department_id != null ? departmentById.get(employee.department_id) : '-'
                  const isManual = item.source === 'MANUAL' || item.created_by_admin || flagIsTrue(item.flags, 'ADMIN_MANUAL')
                  const shiftId = parseShiftId(item.flags.SHIFT_ID)
                  const shiftName = typeof item.flags.SHIFT_NAME === 'string'
                    ? item.flags.SHIFT_NAME
                    : shiftId && shiftById.get(shiftId)
                      ? shiftById.get(shiftId)?.name
                      : null

                  return (
                    <tr key={item.id} className={`border-t border-slate-100 ${reasons.length > 0 ? 'bg-amber-50/40' : ''}`}>
                      <td className="py-2">{item.id}</td>
                      <td className="py-2">#{item.employee_id} - {employeeNameById.get(item.employee_id) ?? '-'}</td>
                      <td className="py-2">{departmentName ?? '-'}</td>
                      <td className="py-2">{item.type}</td>
                      <td className="py-2">
                        {isManual ? <span className="inline-flex rounded-full bg-indigo-100 px-2 py-1 text-[11px] font-semibold text-indigo-700">MANUEL</span> : 'CİHAZ'}
                        {item.deleted_at ? <span className="ml-1 inline-flex rounded-full bg-rose-100 px-2 py-1 text-[11px] font-semibold text-rose-700">SİLİNDİ</span> : null}
                      </td>
                      <td className="py-2">{formatTs(item.ts_utc)}</td>
                      <td className="py-2">{locationStatusLabel(item.location_status)}</td>
                      <td className="py-2">
                        {shiftName ? (
                          <span>{shiftName}{shiftId ? ` (#${shiftId})` : ''}</span>
                        ) : shiftId ? (
                          <span>#{shiftId}</span>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="py-2">{item.note || '-'}</td>
                      <td className="py-2">
                        <SuspiciousReasonList reasons={reasons} />
                      </td>
                      <td className="py-2"><SuspiciousBadge suspicious={reasons.length > 0} label="Şüpheli" /></td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => openEditModal(item)} className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">Düzenle</button>
                          <button type="button" onClick={() => setDeletingEvent(item)} className="rounded-lg border border-rose-300 px-3 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50">Soft sil</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {filteredEvents.length === 0 ? <p className="mt-3 text-sm text-slate-500">Filtreye uygun kayıt bulunamadı.</p> : null}
          </div>
        ) : null}
      </Panel>

      <Panel>
        <h4 className="text-base font-semibold text-slate-900">Audit Log</h4>
        {auditLogsQuery.isLoading ? <LoadingBlock /> : null}
        {auditLogsQuery.isError ? <ErrorBlock message={parseApiError(auditLogsQuery.error, 'Audit loglar alınamadı.').message} /> : null}
        {!auditLogsQuery.isLoading && !auditLogsQuery.isError ? (
          <div className="mt-3 max-h-[40vh] overflow-auto overscroll-contain">
            <table className="min-w-[980px] text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2">Zaman</th>
                  <th className="py-2">Aksiyon</th>
                  <th className="py-2">Kullanıcı</th>
                  <th className="py-2">Entity</th>
                  <th className="py-2">Durum</th>
                </tr>
              </thead>
              <tbody>
                {(auditLogsQuery.data ?? []).map((item) => (
                  <tr key={item.id} className="border-t border-slate-100">
                    <td className="py-2">{formatTs(item.ts_utc)}</td>
                    <td className="py-2">{item.action}</td>
                    <td className="py-2">{item.actor_type}:{item.actor_id}</td>
                    <td className="py-2">{item.entity_type ?? '-'} {item.entity_id ? `#${item.entity_id}` : ''}</td>
                    <td className="py-2">{item.success ? 'Başarılı' : 'Hatalı'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Panel>

      <Modal open={editingEvent !== null} title={editingEvent ? `Event #${editingEvent.id} düzenle` : 'Event düzenle'} onClose={() => setEditingEvent(null)}>
        <form onSubmit={onUpdateEvent} className="space-y-3">
          <label className="text-sm text-slate-700">
            Event tipi
            <select value={editType} onChange={(e) => setEditType(e.target.value as AttendanceType)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
              <option value="IN">IN (Giriş)</option>
              <option value="OUT">OUT (Çıkış)</option>
            </select>
          </label>
          <label className="text-sm text-slate-700">
            Tarih/saat
            <input type="datetime-local" value={editDatetime} onChange={(e) => setEditDatetime(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>
          <label className="text-sm text-slate-700">
            Vardiya (opsiyonel)
            <select
              value={editShiftId}
              onChange={(e) => setEditShiftId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="">Değiştirme</option>
              {editShiftOptions.map((shift) => (
                <option key={shift.id} value={shift.id}>
                  #{shift.id} - {shift.name} ({shift.start_time_local}-{shift.end_time_local})
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-700">
            Not
            <input type="text" value={editNote} onChange={(e) => setEditNote(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={editAllowDuplicate} onChange={(e) => setEditAllowDuplicate(e.target.checked)} /> Sıra çakışıyorsa duplicate olarak güncelle</label>
          <label className="inline-flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={editForce} onChange={(e) => setEditForce(e.target.checked)} /> Manuel olmayan kayıtlarda zorla düzenle</label>
          <button type="submit" disabled={updateManualMutation.isPending} className="btn-primary rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">{updateManualMutation.isPending ? 'Kaydediliyor...' : 'Kaydet'}</button>
        </form>
      </Modal>

      <Modal open={deletingEvent !== null} title={deletingEvent ? `Event #${deletingEvent.id} soft sil` : 'Event soft sil'} onClose={() => setDeletingEvent(null)}>
        <div className="space-y-3">
          <p className="text-sm text-slate-700">Kayıt hard delete edilmez, soft delete olarak işaretlenir.</p>
          <label className="inline-flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={deleteForce} onChange={(e) => setDeleteForce(e.target.checked)} /> Manuel olmayan kayıtlarda zorla sil</label>
          <button
            type="button"
            onClick={() => deletingEvent && deleteEventMutation.mutate({ eventId: deletingEvent.id, force: deleteForce })}
            disabled={deleteEventMutation.isPending}
            className="btn-danger rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
          >
            {deleteEventMutation.isPending ? 'Siliniyor...' : 'Soft sil'}
          </button>
        </div>
      </Modal>
    </div>
  )
}

