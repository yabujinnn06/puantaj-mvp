import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import {
  downloadEmployeeMonthlyExport,
  deleteManualDayOverride,
  getDepartmentShifts,
  getEmployees,
  getManualDayOverrides,
  getMonthlyEmployee,
  upsertManualDayOverride,
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
import { StatusBadge } from '../components/StatusBadge'
import { useToast } from '../hooks/useToast'
import type { ManualDayOverride, MonthlyEmployeeDay } from '../types/api'
import { getFlagMeta, knownComplianceFlags } from '../utils/flagDictionary'

interface MonthlyFilters {
  employeeId: string
  year: string
  month: string
}

type ManualDayStatus = 'NORMAL' | 'IZINLI' | 'RESMI_TATIL' | 'CALISMADI'
type RuleSourceOverride = 'AUTO' | 'SHIFT' | 'WEEKLY' | 'WORK_RULE'

const statusLabels: Record<ManualDayStatus, string> = {
  NORMAL: 'Normal',
  IZINLI: 'Izinli',
  RESMI_TATIL: 'Resmi Tatil',
  CALISMADI: 'Calismadi',
}

const ruleSourceLabels: Record<'SHIFT' | 'WEEKLY' | 'WORK_RULE', string> = {
  SHIFT: 'Vardiya',
  WEEKLY: 'Haftalik Kural',
  WORK_RULE: 'Temel Kural',
}

const ruleSourceOverrideLabels: Record<RuleSourceOverride, string> = {
  AUTO: 'Otomatik (Oncelik: Vardiya > Haftalik > Temel)',
  SHIFT: 'Vardiya',
  WEEKLY: 'Haftalik Kural',
  WORK_RULE: 'Temel Kural',
}

const ATTENDANCE_TIMEZONE = 'Europe/Istanbul'

function getDaySuspicionReasons(day: MonthlyEmployeeDay): string[] {
  const reasons: string[] = []
  if (day.status === 'INCOMPLETE') {
    reasons.push('EKSIK_GUN')
  }
  for (const flag of day.flags) {
    reasons.push(flag)
  }
  return reasons
}

function isoToHHMM(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: ATTENDANCE_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function formatLocalDateTime(value: string | null): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: ATTENDANCE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

function decodeManualOverrideStatus(override: ManualDayOverride | undefined): {
  status: ManualDayStatus
  reason: string
} {
  if (!override) {
    return { status: 'NORMAL', reason: '' }
  }
  const rawNote = (override.note ?? '').trim()
  const prefixMatch = rawNote.match(/^\[MANUAL_STATUS:(NORMAL|IZINLI|RESMI_TATIL|CALISMADI)\]\s*/i)
  if (prefixMatch) {
    const status = prefixMatch[1].toUpperCase() as ManualDayStatus
    return {
      status,
      reason: rawNote.replace(prefixMatch[0], '').trim(),
    }
  }
  if (override.is_absent) {
    return { status: 'CALISMADI', reason: rawNote }
  }
  return { status: 'NORMAL', reason: rawNote }
}

function encodeManualOverrideNote(status: ManualDayStatus, reason: string): string | null {
  const cleanReason = reason.trim()
  if (status === 'NORMAL') {
    return cleanReason || null
  }
  const base = `[MANUAL_STATUS:${status}]`
  return cleanReason ? `${base} ${cleanReason}` : base
}

export function EmployeeMonthlyReportPage() {
  const queryClient = useQueryClient()
  const { pushToast } = useToast()
  const now = new Date()

  const defaultFilters: MonthlyFilters = {
    employeeId: '',
    year: String(now.getFullYear()),
    month: String(now.getMonth() + 1),
  }

  const [draftFilters, setDraftFilters] = useState<MonthlyFilters>(defaultFilters)
  const [appliedFilters, setAppliedFilters] = useState<MonthlyFilters>(defaultFilters)
  const [showSuspiciousOnly, setShowSuspiciousOnly] = useState(false)
  const [selectedConflictFlag, setSelectedConflictFlag] = useState<string | null>(null)
  const [isDownloading, setIsDownloading] = useState(false)

  const [isManualModalOpen, setManualModalOpen] = useState(false)
  const [editingDay, setEditingDay] = useState<string>('')
  const [editInTime, setEditInTime] = useState('')
  const [editOutTime, setEditOutTime] = useState('')
  const [editReason, setEditReason] = useState('')
  const [editStatus, setEditStatus] = useState<ManualDayStatus>('NORMAL')
  const [editRuleSource, setEditRuleSource] = useState<RuleSourceOverride>('AUTO')
  const [editRuleShiftId, setEditRuleShiftId] = useState('')
  const [editOverrideId, setEditOverrideId] = useState<number | null>(null)
  const [manualFormWarning, setManualFormWarning] = useState<string | null>(null)

  const employeesQuery = useQuery({
    queryKey: ['employees', 'all'],
    queryFn: () => getEmployees({ status: 'all' }),
  })

  const parsedEmployeeId = Number(appliedFilters.employeeId)
  const parsedYear = Number(appliedFilters.year)
  const parsedMonth = Number(appliedFilters.month)

  const reportEnabled =
    Number.isFinite(parsedEmployeeId) &&
    parsedEmployeeId > 0 &&
    Number.isFinite(parsedYear) &&
    parsedYear > 0 &&
    Number.isFinite(parsedMonth) &&
    parsedMonth >= 1 &&
    parsedMonth <= 12

  const reportQuery = useQuery({
    queryKey: ['employee-monthly', parsedEmployeeId, parsedYear, parsedMonth],
    queryFn: () =>
      getMonthlyEmployee({
        employee_id: parsedEmployeeId,
        year: parsedYear,
        month: parsedMonth,
      }),
    enabled: reportEnabled,
  })

  const overridesQuery = useQuery({
    queryKey: ['manual-overrides', parsedEmployeeId, parsedYear, parsedMonth],
    queryFn: () => getManualDayOverrides(parsedEmployeeId, parsedYear, parsedMonth),
    enabled: reportEnabled,
  })

  const upsertOverrideMutation = useMutation({
    mutationFn: ({
      employeeId,
      dayDate,
      inTime,
      outTime,
      status,
      ruleSource,
      ruleShiftId,
      reason,
    }: {
      employeeId: number
      dayDate: string
      inTime: string
      outTime: string
      status: ManualDayStatus
      ruleSource: RuleSourceOverride
      ruleShiftId: string
      reason: string
    }) => {
      const isAbsent = status !== 'NORMAL'
      return upsertManualDayOverride(employeeId, {
        day_date: dayDate,
        in_time: isAbsent ? null : inTime || null,
        out_time: isAbsent ? null : outTime || null,
        is_absent: isAbsent,
        rule_source_override: ruleSource,
        rule_shift_id_override: ruleSource === 'SHIFT' ? (ruleShiftId ? Number(ruleShiftId) : null) : null,
        note: encodeManualOverrideNote(status, reason),
      })
    },
    onSuccess: () => {
      pushToast({
        variant: 'success',
        title: 'Manuel duzeltme kaydedildi',
        description: 'Gunluk puantaj kaydi guncellendi.',
      })
      setManualModalOpen(false)
      setManualFormWarning(null)
      setEditRuleShiftId('')
      void queryClient.invalidateQueries({ queryKey: ['employee-monthly'] })
      void queryClient.invalidateQueries({ queryKey: ['manual-overrides'] })
    },
    onError: (error) => {
      pushToast({
        variant: 'error',
        title: 'Duzeltme kaydedilemedi',
        description: parseApiError(error, 'Islem basarisiz.').message,
      })
    },
  })

  const deleteOverrideMutation = useMutation({
    mutationFn: deleteManualDayOverride,
    onSuccess: () => {
      pushToast({
        variant: 'success',
        title: 'Manuel duzeltme kaldirildi',
        description: 'Secili gun icin manuel override silindi.',
      })
      setManualModalOpen(false)
      setManualFormWarning(null)
      void queryClient.invalidateQueries({ queryKey: ['employee-monthly'] })
      void queryClient.invalidateQueries({ queryKey: ['manual-overrides'] })
    },
    onError: (error) => {
      pushToast({
        variant: 'error',
        title: 'Silme islemi basarisiz',
        description: parseApiError(error, 'Islem basarisiz.').message,
      })
    },
  })

  const selectedEmployee = useMemo(
    () => employeesQuery.data?.find((item) => item.id === parsedEmployeeId),
    [employeesQuery.data, parsedEmployeeId],
  )
  const employeeName = selectedEmployee?.full_name

  const shiftsQuery = useQuery({
    queryKey: ['monthly-manual-shifts', selectedEmployee?.department_id],
    queryFn: () =>
      getDepartmentShifts(
        selectedEmployee?.department_id
          ? { department_id: selectedEmployee.department_id, active_only: false }
          : undefined,
      ),
    enabled: Boolean(selectedEmployee?.department_id),
  })

  const overridesByDate = useMemo(() => {
    const map = new Map<string, ManualDayOverride>()
    for (const item of overridesQuery.data ?? []) {
      map.set(item.day_date, item)
    }
    return map
  }, [overridesQuery.data])

  const days = reportQuery.data?.days ?? []
  const totalMissingMinutes = useMemo(
    () => days.reduce((sum, day) => sum + (day.missing_minutes ?? 0), 0),
    [days],
  )
  const shownDays = useMemo(() => {
    return days.filter((day) => {
      if (showSuspiciousOnly && getDaySuspicionReasons(day).length === 0) {
        return false
      }
      if (selectedConflictFlag && !day.flags.includes(selectedConflictFlag)) {
        return false
      }
      return true
    })
  }, [days, selectedConflictFlag, showSuspiciousOnly])

  const suspiciousDayCount = useMemo(
    () => days.filter((day) => getDaySuspicionReasons(day).length > 0).length,
    [days],
  )

  const conflictSummary = useMemo(() => {
    const targetFlags = ['SHIFT_WEEKLY_RULE_OVERRIDE', 'NEEDS_SHIFT_REVIEW', 'MISSING_IN', 'MISSING_OUT', 'UNDERWORKED']
    const counts = new Map<string, number>()
    for (const flag of targetFlags) {
      counts.set(flag, 0)
    }

    for (const day of days) {
      for (const flag of targetFlags) {
        if (day.flags.includes(flag)) {
          counts.set(flag, (counts.get(flag) ?? 0) + 1)
        }
      }
    }

    return targetFlags.map((flag) => ({
      code: flag,
      count: counts.get(flag) ?? 0,
    }))
  }, [days])

  const activeFilterLabels = useMemo(() => {
    const labels: string[] = []
    if (appliedFilters.employeeId) labels.push(`Calisan: ${appliedFilters.employeeId}`)
    labels.push(`Yil: ${appliedFilters.year}`)
    labels.push(`Ay: ${appliedFilters.month}`)
    if (showSuspiciousOnly) labels.push('Sadece supheli gunler')
    if (selectedConflictFlag) labels.push(`Cakisma: ${getFlagMeta(selectedConflictFlag).label}`)
    return labels
  }, [appliedFilters, selectedConflictFlag, showSuspiciousOnly])

  const applyFilters = () => setAppliedFilters({ ...draftFilters })
  const clearFilters = () => {
    setDraftFilters(defaultFilters)
    setAppliedFilters(defaultFilters)
    setShowSuspiciousOnly(false)
    setSelectedConflictFlag(null)
  }

  const handleDownloadExcel = async () => {
    if (!reportEnabled) {
      pushToast({
        variant: 'error',
        title: 'Filtre hatasi',
        description: 'Excel indirmek icin calisan, yil ve ay secin.',
      })
      return
    }

    try {
      setIsDownloading(true)
      const blob = await downloadEmployeeMonthlyExport({
        employee_id: parsedEmployeeId,
        year: parsedYear,
        month: parsedMonth,
      })
      const url = window.URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `puantaj-employee-${parsedEmployeeId}-${parsedYear}-${String(parsedMonth).padStart(2, '0')}.xlsx`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.URL.revokeObjectURL(url)
    } catch (error) {
      pushToast({
        variant: 'error',
        title: 'Excel indirilemedi',
        description: parseApiError(error, 'Dosya olusturulamadi.').message,
      })
    } finally {
      setIsDownloading(false)
    }
  }

  const openManualModalForDay = (day: MonthlyEmployeeDay) => {
    const override = overridesByDate.get(day.date)
    const decoded = decodeManualOverrideStatus(override)
    setEditingDay(day.date)
    setEditOverrideId(override?.id ?? null)
    setEditStatus(decoded.status)
    setEditReason(decoded.reason)
    setEditInTime(override ? isoToHHMM(override.in_ts) : '')
    setEditOutTime(override ? isoToHHMM(override.out_ts) : '')
    setEditRuleSource(override?.rule_source_override ?? 'AUTO')
    setEditRuleShiftId(
      override?.rule_shift_id_override
        ? String(override.rule_shift_id_override)
        : day.shift_id
          ? String(day.shift_id)
          : '',
    )
    setManualFormWarning(null)
    setManualModalOpen(true)
  }

  const openManualModalFromToolbar = () => {
    if (!reportEnabled || days.length === 0) {
      pushToast({
        variant: 'error',
        title: 'Rapor verisi yok',
        description: 'Once calisan, yil ve ay secip raporu yukleyin.',
      })
      return
    }
    openManualModalForDay(days[0])
  }

  const validateManualForm = (): boolean => {
    setManualFormWarning(null)

    if (!editingDay) {
      setManualFormWarning('Duzeltme icin tarih secmelisiniz.')
      return false
    }

    if (editStatus === 'NORMAL') {
      if (!editInTime && !editOutTime) {
        setManualFormWarning('Normal gun icin en az bir saat bilgisi girin.')
        return false
      }
      if (editInTime && editOutTime && editOutTime < editInTime) {
        setManualFormWarning('Cikis saati giris saatinden kucuk olamaz.')
        return false
      }
    }
    if (editRuleSource === 'SHIFT' && !editRuleShiftId) {
      setManualFormWarning('Vardiya kurali icin bir vardiya secmelisiniz.')
      return false
    }
    return true
  }

  const onSaveManual = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!reportEnabled) return
    if (!validateManualForm()) return

    upsertOverrideMutation.mutate({
      employeeId: parsedEmployeeId,
      dayDate: editingDay,
      inTime: editInTime,
      outTime: editOutTime,
      status: editStatus,
      ruleSource: editRuleSource,
      ruleShiftId: editRuleShiftId,
      reason: editReason,
    })
  }

  if (employeesQuery.isLoading) {
    return <LoadingBlock />
  }

  if (employeesQuery.isError) {
    return <ErrorBlock message="Calisan listesi alinamadi." />
  }

  const employees = employeesQuery.data ?? []

  return (
    <div className="space-y-4">
      <PageHeader
        title="Aylik Calisan Puantaj Raporu"
        description="Gunluk giris/cikis ve fazla mesai bilgilerini inceleyin, HR icin manuel duzeltme yapin."
        action={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={openManualModalFromToolbar}
              className="btn-secondary rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Manuel Duzeltme
            </button>
            <button
              type="button"
              onClick={() => void handleDownloadExcel()}
              disabled={isDownloading}
              className="btn-secondary rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              {isDownloading ? (
                <>
                  <span className="inline-spinner inline-spinner-dark" aria-hidden="true" />
                  Hazirlaniyor...
                </>
              ) : (
                'Excel Indir'
              )}
            </button>
            <Link
              to="/reports/excel-export"
              className="btn-secondary rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Gelismis Export
            </Link>
          </div>
        }
      />

      <Panel>
        <h4 className="text-base font-semibold text-slate-900">Filtreler</h4>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <EmployeeAutocompleteField
            label="Calisan"
            employees={employees}
            value={draftFilters.employeeId}
            onChange={(employeeId) =>
              setDraftFilters((prev) => ({ ...prev, employeeId }))
            }
            emptyLabel="Seciniz"
            helperText="Calisan adini veya ID bilgisini yazabilirsiniz."
            className="md:col-span-2"
          />

          <label className="text-sm text-slate-700">
            Yil
            <input
              type="number"
              value={draftFilters.year}
              onChange={(event) =>
                setDraftFilters((prev) => ({ ...prev, year: event.target.value }))
              }
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="text-sm text-slate-700">
            Ay
            <input
              type="number"
              value={draftFilters.month}
              onChange={(event) =>
                setDraftFilters((prev) => ({ ...prev, month: event.target.value }))
              }
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
        </div>

        <div className="mt-3">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={showSuspiciousOnly}
              onChange={(event) => setShowSuspiciousOnly(event.target.checked)}
            />
            Sadece supheli gunleri goster
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={applyFilters}
            className="btn-primary rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Uygula
          </button>
          <button
            type="button"
            onClick={clearFilters}
            className="btn-secondary rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Temizle
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {activeFilterLabels.map((label) => (
            <span
              key={label}
              className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700"
            >
              {label}
            </span>
          ))}
        </div>
      </Panel>

      {!reportEnabled ? <ErrorBlock message="Rapor icin calisan, yil ve ay secmelisiniz." /> : null}
      {reportQuery.isLoading ? <LoadingBlock /> : null}
      {reportQuery.isError ? (
        <ErrorBlock message={parseApiError(reportQuery.error, 'Aylik rapor alinamadi.').message} />
      ) : null}

      {reportQuery.data ? (
        <>
          <Panel>
            <h4 className="text-base font-semibold text-slate-900">Toplamlar</h4>
            <p className="mt-2 text-sm text-slate-600">
              Calisan: {employeeName ?? reportQuery.data.employee_id} | Donem:{' '}
              {reportQuery.data.year}-{reportQuery.data.month}
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-5">
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs text-slate-500">Toplam Calisma</p>
                <p className="text-lg font-semibold">
                  <MinuteDisplay minutes={reportQuery.data.totals.worked_minutes} />
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs text-slate-500">Fazla Mesai</p>
                <p className="text-lg font-semibold">
                  <MinuteDisplay minutes={reportQuery.data.totals.overtime_minutes} />
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs text-slate-500">Eksik Gun</p>
                <p className="text-lg font-semibold">{reportQuery.data.totals.incomplete_days}</p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs text-slate-500">Supheli Gun</p>
                <p className="text-lg font-semibold">{suspiciousDayCount}</p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs text-slate-500">Toplam Eksik Sure</p>
                <p className="text-lg font-semibold">
                  <MinuteDisplay minutes={totalMissingMinutes} />
                </p>
              </div>
            </div>
          </Panel>

          <Panel>
            <h4 className="text-base font-semibold text-slate-900">Compliance (TR Is Kanunu)</h4>
            <div className="mt-3 grid gap-3 md:grid-cols-4">
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs text-slate-500">Net Calisma</p>
                <p className="text-lg font-semibold">
                  <MinuteDisplay minutes={reportQuery.data.worked_minutes_net} />
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs text-slate-500">Yillik Fazla Mesai Kullanim</p>
                <p className="text-lg font-semibold">
                  <MinuteDisplay minutes={reportQuery.data.annual_overtime_used_minutes} />
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs text-slate-500">Yillik Kalan Fazla Mesai</p>
                <p className="text-lg font-semibold">
                  <MinuteDisplay minutes={reportQuery.data.annual_overtime_remaining_minutes} />
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs text-slate-500">Yillik Limit Durumu</p>
                <p
                  className={`text-sm font-semibold ${
                    reportQuery.data.annual_overtime_cap_exceeded ? 'text-rose-700' : 'text-emerald-700'
                  }`}
                >
                  {reportQuery.data.annual_overtime_cap_exceeded ? 'Limit Asildi' : 'Limit Icinde'}
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-700">Flag aciklamalari</p>
              <ul className="mt-2 space-y-1 text-xs text-slate-600">
                {knownComplianceFlags().map((flag) => (
                  <li key={flag}>
                    <span className="font-semibold" title={getFlagMeta(flag).description}>
                      {getFlagMeta(flag).label}
                    </span>{' '}
                    ({flag}): {getFlagMeta(flag).description}
                  </li>
                ))}
              </ul>
            </div>
          </Panel>

          <Panel>
            <h4 className="text-base font-semibold text-slate-900">Cakisma Analizi</h4>
            <p className="mt-1 text-xs text-slate-500">
              Vardiya, haftalik kural ve event siralamasi arasinda tutarsiz gorunen gunlerin ozeti.
            </p>
            {selectedConflictFlag ? (
              <button
                type="button"
                onClick={() => setSelectedConflictFlag(null)}
                className="mt-2 rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                Cakisma filtresini temizle
              </button>
            ) : null}
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {conflictSummary.map((item) => (
                <button
                  key={item.code}
                  type="button"
                  onClick={() => {
                    setSelectedConflictFlag((prev) => (prev === item.code ? null : item.code))
                    setShowSuspiciousOnly(true)
                  }}
                  className={`rounded-lg border px-3 py-2 text-left transition ${
                    selectedConflictFlag === item.code
                      ? 'border-brand-500 bg-brand-50'
                      : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                  }`}
                >
                  <p className="text-xs text-slate-500" title={getFlagMeta(item.code).description}>
                    {getFlagMeta(item.code).label}
                  </p>
                  <p className="text-lg font-semibold text-slate-900">{item.count}</p>
                </button>
              ))}
            </div>
          </Panel>

          {shownDays.length === 0 ? (
            <Panel>
              <p className="text-sm text-slate-600">Secilen filtreye uygun gunluk kayit bulunamadi.</p>
            </Panel>
          ) : (
            <Panel>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs uppercase text-slate-500">
                    <tr>
                      <th className="py-2">Tarih</th>
                      <th className="py-2">Durum</th>
                      <th className="py-2">Giris</th>
                      <th className="py-2">Cikis</th>
                      <th className="py-2">Calisma</th>
                      <th className="py-2">Fazla Mesai</th>
                      <th className="py-2">Eksik Sure</th>
                      <th className="py-2">Kural Kaynagi</th>
                      <th className="py-2">Vardiya</th>
                      <th className="py-2">Izin</th>
                      <th className="py-2">Supheli Neden</th>
                      <th className="py-2">Aksiyon</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownDays.map((day) => {
                      const reasons = getDaySuspicionReasons(day)
                      const suspicious = reasons.length > 0
                      const override = overridesByDate.get(day.date)
                      const decodedOverride = decodeManualOverrideStatus(override)
                      const hasManual = day.flags.includes('MANUAL_OVERRIDE') || day.flags.includes('MANUAL_EVENT') || Boolean(override)
                      const showManualStatusBadge = decodedOverride.status !== 'NORMAL'

                      return (
                        <tr key={day.date} className={`border-t border-slate-100 ${suspicious ? 'bg-amber-50/40' : ''}`}>
                          <td className="py-2">{day.date}</td>
                          <td className="py-2">
                            <StatusBadge value={day.status} />
                            {hasManual ? (
                              <span className="ml-2 inline-flex rounded-full bg-indigo-100 px-2 py-1 text-[11px] font-semibold text-indigo-700">
                                MANUEL
                              </span>
                            ) : null}
                            {showManualStatusBadge ? (
                              <span className="ml-2 inline-flex rounded-full bg-cyan-100 px-2 py-1 text-[11px] font-semibold text-cyan-700">
                                {statusLabels[decodedOverride.status]}
                              </span>
                            ) : null}
                            <span className="ml-2">
                              <SuspiciousBadge suspicious={suspicious} />
                            </span>
                          </td>
                          <td className="py-2" title={day.in ?? undefined}>
                            {formatLocalDateTime(day.in)}
                          </td>
                          <td className="py-2" title={day.out ?? undefined}>
                            {formatLocalDateTime(day.out)}
                          </td>
                          <td className="py-2">
                            <MinuteDisplay minutes={day.worked_minutes} />
                          </td>
                          <td className="py-2">
                            <MinuteDisplay minutes={day.overtime_minutes} />
                          </td>
                          <td className="py-2">
                            <MinuteDisplay minutes={day.missing_minutes ?? 0} />
                          </td>
                          <td className="py-2">
                            <span
                              className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700"
                              title={`Oncelik: Vardiya > Haftalik > Temel | Plan: ${day.applied_planned_minutes} dk | Mola: ${day.applied_break_minutes} dk`}
                            >
                              {ruleSourceLabels[day.rule_source]}
                            </span>
                          </td>
                          <td className="py-2">{day.shift_name ?? '-'}</td>
                          <td className="py-2">{day.leave_type ?? '-'}</td>
                          <td className="py-2">
                            <SuspiciousReasonList reasons={reasons} />
                          </td>
                          <td className="py-2">
                            <button
                              type="button"
                              onClick={() => openManualModalForDay(day)}
                              className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              Manuel Duzelt
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </>
      ) : null}

      <Modal
        open={isManualModalOpen}
        title={editingDay ? `${editingDay} - Manuel Duzeltme` : 'Manuel Duzeltme'}
        onClose={() => setManualModalOpen(false)}
      >
        <form onSubmit={onSaveManual} className="space-y-3">
          <label className="text-sm text-slate-700">
            Tarih
            <input
              type="date"
              value={editingDay}
              onChange={(event) => setEditingDay(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="text-sm text-slate-700">
            Gun Durumu
            <select
              value={editStatus}
              onChange={(event) => setEditStatus(event.target.value as ManualDayStatus)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="NORMAL">Normal</option>
              <option value="IZINLI">Izinli</option>
              <option value="RESMI_TATIL">Resmi Tatil</option>
              <option value="CALISMADI">Calismadi</option>
            </select>
          </label>

          <label className="text-sm text-slate-700">
            Kural Kaynagi
            <select
              value={editRuleSource}
              onChange={(event) => {
                const nextSource = event.target.value as RuleSourceOverride
                setEditRuleSource(nextSource)
                if (nextSource !== 'SHIFT') {
                  setEditRuleShiftId('')
                }
              }}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="AUTO">{ruleSourceOverrideLabels.AUTO}</option>
              <option value="SHIFT">{ruleSourceOverrideLabels.SHIFT}</option>
              <option value="WEEKLY">{ruleSourceOverrideLabels.WEEKLY}</option>
              <option value="WORK_RULE">{ruleSourceOverrideLabels.WORK_RULE}</option>
            </select>
          </label>

          {editRuleSource === 'SHIFT' ? (
            <label className="text-sm text-slate-700">
              Kural Vardiyasi
              <select
                value={editRuleShiftId}
                onChange={(event) => setEditRuleShiftId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                <option value="">Vardiya seciniz</option>
                {(shiftsQuery.data ?? []).map((shift) => (
                  <option key={shift.id} value={shift.id}>
                    {shift.name} ({shift.start_time_local} - {shift.end_time_local})
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm text-slate-700">
              Giris Saati
              <input
                type="time"
                value={editInTime}
                onChange={(event) => setEditInTime(event.target.value)}
                disabled={editStatus !== 'NORMAL'}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="text-sm text-slate-700">
              Cikis Saati
              <input
                type="time"
                value={editOutTime}
                onChange={(event) => setEditOutTime(event.target.value)}
                disabled={editStatus !== 'NORMAL'}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
          </div>

          {editStatus === 'NORMAL' ? (
            <p className="text-xs text-slate-500">
              Uyari: Cikis saati giris saatinden kucuk olamaz.
            </p>
          ) : (
            <p className="text-xs text-slate-500">
              Bu secim gunu calisilmadi olarak isaretler; giris/cikis saatleri devre disi kalir.
            </p>
          )}

          <label className="text-sm text-slate-700">
            Gerekce / Not (opsiyonel)
            <input
              type="text"
              value={editReason}
              onChange={(event) => setEditReason(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              placeholder="Orn: Saglik raporu / Sistem arizasi"
            />
          </label>

          {manualFormWarning ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
              {manualFormWarning}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={upsertOverrideMutation.isPending}
              className="btn-primary rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {upsertOverrideMutation.isPending ? (
                <>
                  <span className="inline-spinner" aria-hidden="true" />
                  Kaydediliyor...
                </>
              ) : (
                'Kaydet'
              )}
            </button>
            {editOverrideId ? (
              <button
                type="button"
                onClick={() => deleteOverrideMutation.mutate(editOverrideId)}
                disabled={deleteOverrideMutation.isPending}
                className="btn-danger rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
              >
                {deleteOverrideMutation.isPending ? (
                  <>
                    <span className="inline-spinner" aria-hidden="true" />
                    Siliniyor...
                  </>
                ) : (
                  'Manuel Kaydi Sil'
                )}
              </button>
            ) : null}
          </div>
        </form>
      </Modal>
    </div>
  )
}
