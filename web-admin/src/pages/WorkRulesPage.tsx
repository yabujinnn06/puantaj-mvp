import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import {
  cancelSchedulePlan,
  createWorkRule,
  deleteDepartmentShift,
  getDepartmentShifts,
  getDepartments,
  getDepartmentWeeklyRules,
  getEmployees,
  getSchedulePlans,
  getWorkRules,
  upsertDepartmentShift,
  upsertDepartmentWeeklyRule,
  upsertSchedulePlan,
} from '../api/admin'
import { parseApiError } from '../api/error'
import { ErrorBlock } from '../components/ErrorBlock'
import { LoadingBlock } from '../components/LoadingBlock'
import { MinuteDisplay } from '../components/MinuteDisplay'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'
import { useToast } from '../hooks/useToast'
import type { DepartmentShift, SchedulePlan, SchedulePlanTargetType } from '../types/api'
import { formatMinutesForHr } from '../utils/minutes'

const workRuleSchema = z.object({
  department_id: z.coerce.number().int().positive(),
  daily_minutes_planned: z.coerce.number().int().nonnegative(),
  break_minutes: z.coerce.number().int().nonnegative(),
  grace_minutes: z.coerce.number().int().nonnegative(),
})

const weeklyRuleSchema = z.object({
  department_id: z.coerce.number().int().positive(),
  weekday: z.coerce.number().int().min(0).max(6),
  is_workday: z.boolean(),
  planned_minutes: z.coerce.number().int().nonnegative(),
  break_minutes: z.coerce.number().int().nonnegative(),
})

const shiftSchema = z.object({
  department_id: z.coerce.number().int().positive(),
  name: z.string().min(1).max(100),
  start_time_local: z.string().regex(/^\d{2}:\d{2}$/),
  end_time_local: z.string().regex(/^\d{2}:\d{2}$/),
  break_minutes: z.coerce.number().int().nonnegative(),
  is_active: z.boolean(),
})

const WEEKDAYS = [
  { value: 0, label: 'Pazartesi' },
  { value: 1, label: 'Sali' },
  { value: 2, label: 'Carsamba' },
  { value: 3, label: 'Persembe' },
  { value: 4, label: 'Cuma' },
  { value: 5, label: 'Cumartesi' },
  { value: 6, label: 'Pazar' },
]

const PLAN_TARGET_OPTIONS: Array<{ value: SchedulePlanTargetType; label: string }> = [
  { value: 'DEPARTMENT', label: 'Tum departman' },
  { value: 'DEPARTMENT_EXCEPT_EMPLOYEE', label: 'Departman (calisan haric)' },
  { value: 'ONLY_EMPLOYEE', label: 'Sadece secili calisan' },
]

const PLAN_TARGET_LABELS: Record<SchedulePlanTargetType, string> = {
  DEPARTMENT: 'Departman geneli',
  DEPARTMENT_EXCEPT_EMPLOYEE: 'Departman (haric)',
  ONLY_EMPLOYEE: 'Sadece calisan',
}

function parseOptionalMinutes(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Math.trunc(parsed)
}

function planToPayload(plan: SchedulePlan, isActive: boolean) {
  const normalizedTargets =
    plan.target_employee_ids && plan.target_employee_ids.length > 0
      ? plan.target_employee_ids
      : plan.target_employee_id
        ? [plan.target_employee_id]
        : []
  return {
    id: plan.id,
    department_id: plan.department_id,
    target_type: plan.target_type,
    target_employee_id: normalizedTargets.length > 0 ? normalizedTargets[0] : null,
    target_employee_ids: normalizedTargets,
    shift_id: plan.shift_id,
    daily_minutes_planned: plan.daily_minutes_planned,
    break_minutes: plan.break_minutes,
    grace_minutes: plan.grace_minutes,
    start_date: plan.start_date,
    end_date: plan.end_date,
    is_locked: plan.is_locked,
    is_active: isActive,
    note: plan.note,
  }
}

export function WorkRulesPage() {
  const queryClient = useQueryClient()
  const { pushToast } = useToast()

  const [departmentId, setDepartmentId] = useState('')
  const [dailyMinutesPlanned, setDailyMinutesPlanned] = useState('540')
  const [breakMinutes, setBreakMinutes] = useState('60')
  const [graceMinutes, setGraceMinutes] = useState('5')

  const [weeklyDepartmentId, setWeeklyDepartmentId] = useState('')
  const [weeklyWeekday, setWeeklyWeekday] = useState('0')
  const [weeklyIsWorkday, setWeeklyIsWorkday] = useState(true)
  const [weeklyPlannedMinutes, setWeeklyPlannedMinutes] = useState('540')
  const [weeklyBreakMinutes, setWeeklyBreakMinutes] = useState('60')

  const [shiftDepartmentId, setShiftDepartmentId] = useState('')
  const [shiftName, setShiftName] = useState('')
  const [shiftStart, setShiftStart] = useState('10:00')
  const [shiftEnd, setShiftEnd] = useState('18:00')
  const [shiftBreakMinutes, setShiftBreakMinutes] = useState('60')
  const [shiftIsActive, setShiftIsActive] = useState(true)
  const [shiftEditingId, setShiftEditingId] = useState<number | null>(null)

  const [planId, setPlanId] = useState<number | null>(null)
  const [planDepartmentId, setPlanDepartmentId] = useState('')
  const [planTargetType, setPlanTargetType] = useState<SchedulePlanTargetType>('DEPARTMENT')
  const [planTargetEmployeeIds, setPlanTargetEmployeeIds] = useState<number[]>([])
  const [planTargetSearch, setPlanTargetSearch] = useState('')
  const [planShiftId, setPlanShiftId] = useState('')
  const [planDailyMinutes, setPlanDailyMinutes] = useState('')
  const [planBreakMinutes, setPlanBreakMinutes] = useState('')
  const [planGraceMinutes, setPlanGraceMinutes] = useState('')
  const [planStartDate, setPlanStartDate] = useState(new Date().toISOString().slice(0, 10))
  const [planEndDate, setPlanEndDate] = useState(new Date().toISOString().slice(0, 10))
  const [planIsLocked, setPlanIsLocked] = useState(false)
  const [planIsActive, setPlanIsActive] = useState(true)
  const [planNote, setPlanNote] = useState('')
  const [showInactivePlans, setShowInactivePlans] = useState(true)

  const [formError, setFormError] = useState<string | null>(null)

  const departmentsQuery = useQuery({ queryKey: ['departments'], queryFn: getDepartments })
  const employeesQuery = useQuery({ queryKey: ['employees', 'all'], queryFn: () => getEmployees({ status: 'all' }) })
  const workRulesQuery = useQuery({ queryKey: ['work-rules'], queryFn: getWorkRules })
  const weeklyRulesQuery = useQuery({ queryKey: ['department-weekly-rules'], queryFn: () => getDepartmentWeeklyRules() })
  const shiftsQuery = useQuery({ queryKey: ['department-shifts'], queryFn: () => getDepartmentShifts() })
  const schedulePlansQuery = useQuery({ queryKey: ['schedule-plans', 'all'], queryFn: () => getSchedulePlans({ active_only: false }) })

  const createWorkRuleMutation = useMutation({
    mutationFn: createWorkRule,
    onSuccess: () => {
      setFormError(null)
      pushToast({ variant: 'success', title: 'Mesai kurali kaydedildi', description: 'Departman mesai kurali kaydedildi.' })
      void queryClient.invalidateQueries({ queryKey: ['work-rules'] })
    },
    onError: (error) => {
      const parsed = parseApiError(error, 'Mesai kurali kaydedilemedi.')
      setFormError(parsed.message)
      pushToast({ variant: 'error', title: 'Mesai kurali kaydedilemedi', description: parsed.message })
    },
  })

  const upsertWeeklyRuleMutation = useMutation({
    mutationFn: upsertDepartmentWeeklyRule,
    onSuccess: () => {
      setFormError(null)
      pushToast({ variant: 'success', title: 'Haftalik plan kaydedildi', description: 'Secilen gun icin departman plani guncellendi.' })
      void queryClient.invalidateQueries({ queryKey: ['department-weekly-rules'] })
    },
    onError: (error) => {
      const parsed = parseApiError(error, 'Haftalik plan kaydedilemedi.')
      setFormError(parsed.message)
      pushToast({ variant: 'error', title: 'Haftalik plan kaydedilemedi', description: parsed.message })
    },
  })

  const upsertShiftMutation = useMutation({
    mutationFn: upsertDepartmentShift,
    onSuccess: () => {
      setFormError(null)
      setShiftEditingId(null)
      setShiftName('')
      setShiftStart('10:00')
      setShiftEnd('18:00')
      setShiftBreakMinutes('60')
      setShiftIsActive(true)
      pushToast({ variant: 'success', title: 'Vardiya kaydedildi', description: 'Departman vardiyasi guncellendi.' })
      void queryClient.invalidateQueries({ queryKey: ['department-shifts'] })
    },
    onError: (error) => {
      const parsed = parseApiError(error, 'Vardiya kaydedilemedi.')
      setFormError(parsed.message)
      pushToast({ variant: 'error', title: 'Vardiya kaydedilemedi', description: parsed.message })
    },
  })

  const deactivateShiftMutation = useMutation({
    mutationFn: deleteDepartmentShift,
    onSuccess: () => {
      setFormError(null)
      if (shiftEditingId !== null) {
        setShiftEditingId(null)
        setShiftName('')
        setShiftStart('10:00')
        setShiftEnd('18:00')
        setShiftBreakMinutes('60')
        setShiftIsActive(true)
      }
      pushToast({ variant: 'success', title: 'Vardiya pasife alindi', description: 'Vardiya kaydi pasif duruma getirildi.' })
      void queryClient.invalidateQueries({ queryKey: ['department-shifts'] })
    },
    onError: (error) => {
      const parsed = parseApiError(error, 'Vardiya pasife alinamadi.')
      setFormError(parsed.message)
      pushToast({ variant: 'error', title: 'Vardiya pasife alinamadi', description: parsed.message })
    },
  })

  const setShiftActiveMutation = useMutation({
    mutationFn: ({ shift, nextActive }: { shift: DepartmentShift; nextActive: boolean }) =>
      upsertDepartmentShift({
        id: shift.id,
        department_id: shift.department_id,
        name: shift.name,
        start_time_local: shift.start_time_local,
        end_time_local: shift.end_time_local,
        break_minutes: shift.break_minutes,
        is_active: nextActive,
      }),
    onSuccess: (_result, variables) => {
      setFormError(null)
      pushToast({
        variant: 'success',
        title: variables.nextActive ? 'Vardiya aktif edildi' : 'Vardiya pasife alindi',
        description: variables.nextActive
          ? 'Vardiya tekrar kullanilabilir duruma getirildi.'
          : 'Vardiya kaydi pasif duruma getirildi.',
      })
      void queryClient.invalidateQueries({ queryKey: ['department-shifts'] })
    },
    onError: (error) => {
      const parsed = parseApiError(error, 'Vardiya durumu guncellenemedi.')
      setFormError(parsed.message)
      pushToast({ variant: 'error', title: 'Vardiya durumu guncellenemedi', description: parsed.message })
    },
  })

  const upsertSchedulePlanMutation = useMutation({
    mutationFn: upsertSchedulePlan,
    onSuccess: () => {
      setFormError(null)
      pushToast({ variant: 'success', title: 'Planlama kaydedildi', description: 'Departman/calisan plani kaydedildi.' })
      void queryClient.invalidateQueries({ queryKey: ['schedule-plans'] })
      setPlanId(null)
      setPlanTargetEmployeeIds([])
      setPlanShiftId('')
      setPlanDailyMinutes('')
      setPlanBreakMinutes('')
      setPlanGraceMinutes('')
      setPlanIsLocked(false)
      setPlanIsActive(true)
      setPlanNote('')
    },
    onError: (error) => {
      const parsed = parseApiError(error, 'Planlama kaydedilemedi.')
      setFormError(parsed.message)
      pushToast({ variant: 'error', title: 'Planlama kaydedilemedi', description: parsed.message })
    },
  })

  const cancelSchedulePlanMutation = useMutation({
    mutationFn: cancelSchedulePlan,
    onSuccess: () => {
      setFormError(null)
      pushToast({ variant: 'success', title: 'Planlama iptal edildi', description: 'Plan pasife alindi.' })
      void queryClient.invalidateQueries({ queryKey: ['schedule-plans'] })
    },
    onError: (error) => {
      const parsed = parseApiError(error, 'Planlama iptal edilemedi.')
      setFormError(parsed.message)
      pushToast({ variant: 'error', title: 'Planlama iptal edilemedi', description: parsed.message })
    },
  })

  const activateSchedulePlanMutation = useMutation({
    mutationFn: (plan: SchedulePlan) => upsertSchedulePlan(planToPayload(plan, true)),
    onSuccess: () => {
      setFormError(null)
      pushToast({ variant: 'success', title: 'Planlama aktif edildi', description: 'Plan tekrar aktif olarak kaydedildi.' })
      void queryClient.invalidateQueries({ queryKey: ['schedule-plans'] })
    },
    onError: (error) => {
      const parsed = parseApiError(error, 'Plan aktif edilemedi.')
      setFormError(parsed.message)
      pushToast({ variant: 'error', title: 'Plan aktif edilemedi', description: parsed.message })
    },
  })

  const livePreview = useMemo(() => {
    const daily = Number(dailyMinutesPlanned)
    const breakValue = Number(breakMinutes)
    const grace = Number(graceMinutes)
    return {
      daily: formatMinutesForHr(daily),
      breakValue: formatMinutesForHr(breakValue),
      grace: formatMinutesForHr(grace),
    }
  }, [dailyMinutesPlanned, breakMinutes, graceMinutes])

  if (
    departmentsQuery.isLoading ||
    employeesQuery.isLoading ||
    workRulesQuery.isLoading ||
    weeklyRulesQuery.isLoading ||
    shiftsQuery.isLoading ||
    schedulePlansQuery.isLoading
  ) {
    return <LoadingBlock />
  }

  if (
    departmentsQuery.isError ||
    employeesQuery.isError ||
    workRulesQuery.isError ||
    weeklyRulesQuery.isError ||
    shiftsQuery.isError ||
    schedulePlansQuery.isError
  ) {
    return <ErrorBlock message="Mesai kurali verileri alinamadi." />
  }

  const departments = departmentsQuery.data ?? []
  const employees = employeesQuery.data ?? []
  const workRules = workRulesQuery.data ?? []
  const weeklyRules = weeklyRulesQuery.data ?? []
  const shifts = shiftsQuery.data ?? []
  const schedulePlans = schedulePlansQuery.data ?? []

  const departmentNameById = new Map(departments.map((department) => [department.id, department.name]))
  const employeeNameById = new Map(employees.map((employee) => [employee.id, employee.full_name]))
  const shiftNameById = new Map(shifts.map((shift) => [shift.id, shift.name]))

  const filteredPlans = schedulePlans.filter((plan) => showInactivePlans || plan.is_active)
  const selectedPlanDepartmentId = Number(planDepartmentId)
  const planDepartmentShifts = Number.isFinite(selectedPlanDepartmentId)
    ? shifts.filter((shift) => shift.department_id === selectedPlanDepartmentId)
    : []
  const planDepartmentEmployees = Number.isFinite(selectedPlanDepartmentId)
    ? employees.filter((employee) => employee.department_id === selectedPlanDepartmentId)
    : []
  const filteredPlanDepartmentEmployees = planTargetSearch.trim()
    ? planDepartmentEmployees.filter((employee) => {
        const normalized = planTargetSearch.trim().toLowerCase()
        return (
          employee.full_name.toLowerCase().includes(normalized) ||
          String(employee.id).includes(normalized.replace('#', ''))
        )
      })
    : planDepartmentEmployees

  const resetSchedulePlanForm = () => {
    setPlanId(null)
    setPlanTargetType('DEPARTMENT')
    setPlanTargetEmployeeIds([])
    setPlanTargetSearch('')
    setPlanShiftId('')
    setPlanDailyMinutes('')
    setPlanBreakMinutes('')
    setPlanGraceMinutes('')
    setPlanStartDate(new Date().toISOString().slice(0, 10))
    setPlanEndDate(new Date().toISOString().slice(0, 10))
    setPlanIsLocked(false)
    setPlanIsActive(true)
    setPlanNote('')
  }

  const startEditSchedulePlan = (plan: SchedulePlan) => {
    const normalizedTargets =
      plan.target_employee_ids && plan.target_employee_ids.length > 0
        ? plan.target_employee_ids
        : plan.target_employee_id
          ? [plan.target_employee_id]
          : []
    setPlanId(plan.id)
    setPlanDepartmentId(String(plan.department_id))
    setPlanTargetType(plan.target_type)
    setPlanTargetEmployeeIds(normalizedTargets)
    setPlanTargetSearch('')
    setPlanShiftId(plan.shift_id ? String(plan.shift_id) : '')
    setPlanDailyMinutes(plan.daily_minutes_planned !== null ? String(plan.daily_minutes_planned) : '')
    setPlanBreakMinutes(plan.break_minutes !== null ? String(plan.break_minutes) : '')
    setPlanGraceMinutes(plan.grace_minutes !== null ? String(plan.grace_minutes) : '')
    setPlanStartDate(plan.start_date)
    setPlanEndDate(plan.end_date)
    setPlanIsLocked(plan.is_locked)
    setPlanIsActive(plan.is_active)
    setPlanNote(plan.note ?? '')
  }

  const onSubmitWorkRule = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)

    const parsed = workRuleSchema.safeParse({
      department_id: departmentId,
      daily_minutes_planned: dailyMinutesPlanned,
      break_minutes: breakMinutes,
      grace_minutes: graceMinutes,
    })

    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'Mesai kurali formunu kontrol edin.'
      setFormError(message)
      pushToast({ variant: 'error', title: 'Form hatasi', description: message })
      return
    }

    createWorkRuleMutation.mutate(parsed.data)
  }

  const onSubmitWeeklyRule = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)

    const parsed = weeklyRuleSchema.safeParse({
      department_id: weeklyDepartmentId,
      weekday: weeklyWeekday,
      is_workday: weeklyIsWorkday,
      planned_minutes: weeklyPlannedMinutes,
      break_minutes: weeklyBreakMinutes,
    })
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'Haftalik plan formunu kontrol edin.'
      setFormError(message)
      pushToast({ variant: 'error', title: 'Form hatasi', description: message })
      return
    }
    upsertWeeklyRuleMutation.mutate(parsed.data)
  }

  const onSubmitShift = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)

    const parsed = shiftSchema.safeParse({
      department_id: shiftDepartmentId,
      name: shiftName.trim(),
      start_time_local: shiftStart,
      end_time_local: shiftEnd,
      break_minutes: shiftBreakMinutes,
      is_active: shiftIsActive,
    })
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'Vardiya formunu kontrol edin.'
      setFormError(message)
      pushToast({ variant: 'error', title: 'Form hatasi', description: message })
      return
    }
    upsertShiftMutation.mutate({
      id: shiftEditingId ?? undefined,
      ...parsed.data,
    })
  }

  const onEditShift = (shift: DepartmentShift) => {
    setShiftEditingId(shift.id)
    setShiftDepartmentId(String(shift.department_id))
    setShiftName(shift.name)
    setShiftStart(shift.start_time_local)
    setShiftEnd(shift.end_time_local)
    setShiftBreakMinutes(String(shift.break_minutes))
    setShiftIsActive(shift.is_active)
    setFormError(null)
  }

  const resetShiftForm = () => {
    setShiftEditingId(null)
    setShiftName('')
    setShiftStart('10:00')
    setShiftEnd('18:00')
    setShiftBreakMinutes('60')
    setShiftIsActive(true)
    setFormError(null)
  }

  const onSchedulePlanSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)

    const parsedDepartmentId = Number(planDepartmentId)
    if (!Number.isFinite(parsedDepartmentId) || parsedDepartmentId <= 0) {
      setFormError('Planlama icin departman secmelisiniz.')
      return
    }
    if (!planStartDate || !planEndDate) {
      setFormError('Baslangic ve bitis tarihi zorunludur.')
      return
    }
    if (planStartDate > planEndDate) {
      setFormError('Baslangic tarihi bitis tarihinden buyuk olamaz.')
      return
    }

    const parsedTargetEmployeeIds = planTargetType === 'DEPARTMENT' ? [] : [...planTargetEmployeeIds]
    if (planTargetType !== 'DEPARTMENT' && parsedTargetEmployeeIds.length === 0) {
      setFormError('Secilen hedef tipi icin en az bir calisan secmelisiniz.')
      return
    }

    const parsedShiftId = planShiftId ? Number(planShiftId) : null
    const daily = parseOptionalMinutes(planDailyMinutes)
    const planBreak = parseOptionalMinutes(planBreakMinutes)
    const grace = parseOptionalMinutes(planGraceMinutes)

    if (!parsedShiftId && daily === null && planBreak === null && grace === null) {
      setFormError('En az bir plan degeri girmelisiniz (vardiya veya dakika alanlari).')
      return
    }

    upsertSchedulePlanMutation.mutate({
      id: planId ?? undefined,
      department_id: parsedDepartmentId,
      target_type: planTargetType,
      target_employee_id: parsedTargetEmployeeIds.length > 0 ? parsedTargetEmployeeIds[0] : null,
      target_employee_ids: parsedTargetEmployeeIds,
      shift_id: parsedShiftId,
      daily_minutes_planned: daily,
      break_minutes: planBreak,
      grace_minutes: grace,
      start_date: planStartDate,
      end_date: planEndDate,
      is_locked: planIsLocked,
      is_active: planIsActive,
      note: planNote.trim() || null,
    })
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Mesai Kurallari"
        description="Departman bazinda gunluk plan, haftalik gun davranisi ve coklu vardiya tanimlarini yonetin."
      />

      <Panel>
        <h4 className="text-base font-semibold text-slate-900">Temel Departman Kurali</h4>
        <form onSubmit={onSubmitWorkRule} className="mt-3 grid gap-3 md:grid-cols-4">
          <label className="text-sm text-slate-700">
            Departman
            <select
              value={departmentId}
              onChange={(event) => setDepartmentId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="">Seciniz</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm text-slate-700">
            Planlanan Gunluk Dakika
            <input
              value={dailyMinutesPlanned}
              onChange={(event) => setDailyMinutesPlanned(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="text-sm text-slate-700">
            Mola Dakikasi
            <input
              value={breakMinutes}
              onChange={(event) => setBreakMinutes(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="text-sm text-slate-700">
            Gecikme Toleransi (Dakika)
            <input
              value={graceMinutes}
              onChange={(event) => setGraceMinutes(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <div className="md:col-span-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Onizleme: Planlanan {livePreview.daily} | Mola {livePreview.breakValue} | Tolerans {livePreview.grace}
          </div>

          <div className="md:col-span-4">
            <button
              type="submit"
              disabled={createWorkRuleMutation.isPending}
              className="btn-primary rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {createWorkRuleMutation.isPending ? 'Kaydediliyor...' : 'Kurali Kaydet'}
            </button>
          </div>
        </form>
      </Panel>

      <Panel>
        <h4 className="text-base font-semibold text-slate-900">Haftalik Gun Plani</h4>
        <p className="mt-1 text-xs text-slate-500">
          Ornek: Cumartesi 5 saat, Pazar calisma yok gibi farkli gun davranislarini buradan tanimlayin.
        </p>
        <form onSubmit={onSubmitWeeklyRule} className="mt-3 grid gap-3 md:grid-cols-5">
          <label className="text-sm text-slate-700">
            Departman
            <select
              value={weeklyDepartmentId}
              onChange={(event) => setWeeklyDepartmentId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="">Seciniz</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm text-slate-700">
            Gun
            <select
              value={weeklyWeekday}
              onChange={(event) => setWeeklyWeekday(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              {WEEKDAYS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm text-slate-700">
            Planlanan Dakika
            <input
              value={weeklyPlannedMinutes}
              onChange={(event) => setWeeklyPlannedMinutes(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="text-sm text-slate-700">
            Mola Dakikasi
            <input
              value={weeklyBreakMinutes}
              onChange={(event) => setWeeklyBreakMinutes(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="inline-flex items-center gap-2 pt-8 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={weeklyIsWorkday}
              onChange={(event) => setWeeklyIsWorkday(event.target.checked)}
            />
            Calisma Gunu
          </label>

          <div className="md:col-span-5">
            <button
              type="submit"
              disabled={upsertWeeklyRuleMutation.isPending}
              className="btn-primary rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {upsertWeeklyRuleMutation.isPending ? 'Kaydediliyor...' : 'Gunu Kaydet'}
            </button>
          </div>
        </form>

        <div className="mt-4 list-scroll-area">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2">Departman</th>
                <th className="py-2">Gun</th>
                <th className="py-2">Durum</th>
                <th className="py-2">Planlanan Sure</th>
                <th className="py-2">Mola</th>
              </tr>
            </thead>
            <tbody>
              {weeklyRules.map((item) => (
                <tr key={item.id} className="border-t border-slate-100">
                  <td className="py-2">{departmentNameById.get(item.department_id) ?? item.department_id}</td>
                  <td className="py-2">{WEEKDAYS.find((w) => w.value === item.weekday)?.label ?? item.weekday}</td>
                  <td className="py-2">{item.is_workday ? 'Calisma' : 'Off'}</td>
                  <td className="py-2">
                    <MinuteDisplay minutes={item.planned_minutes} />
                  </td>
                  <td className="py-2">
                    <MinuteDisplay minutes={item.break_minutes} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel>
        <h4 className="text-base font-semibold text-slate-900">Departman Vardiyalari</h4>
        <p className="mt-1 text-xs text-slate-500">
          Ornek: Stant icin 10:00-18:00 ve 14:00-22:00 vardiyalarini ayri ayri tanimlayabilirsiniz.
        </p>
        {shiftEditingId ? (
          <p className="mt-2 text-xs font-medium text-brand-700">Duzenleme modu: #{shiftEditingId}</p>
        ) : null}
        <form onSubmit={onSubmitShift} className="mt-3 grid gap-3 md:grid-cols-6">
          <label className="text-sm text-slate-700">
            Departman
            <select
              value={shiftDepartmentId}
              onChange={(event) => setShiftDepartmentId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="">Seciniz</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm text-slate-700">
            Vardiya Adi
            <input
              value={shiftName}
              onChange={(event) => setShiftName(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              placeholder="Orn: Sabah 10-18"
            />
          </label>

          <label className="text-sm text-slate-700">
            Baslangic
            <input
              type="time"
              value={shiftStart}
              onChange={(event) => setShiftStart(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="text-sm text-slate-700">
            Bitis
            <input
              type="time"
              value={shiftEnd}
              onChange={(event) => setShiftEnd(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="text-sm text-slate-700">
            Mola Dakikasi
            <input
              value={shiftBreakMinutes}
              onChange={(event) => setShiftBreakMinutes(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="inline-flex items-center gap-2 pt-8 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={shiftIsActive}
              onChange={(event) => setShiftIsActive(event.target.checked)}
            />
            Aktif
          </label>

          <div className="md:col-span-6">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={upsertShiftMutation.isPending}
                className="btn-primary rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {upsertShiftMutation.isPending
                  ? 'Kaydediliyor...'
                  : shiftEditingId
                    ? 'Vardiya Guncelle'
                    : 'Vardiya Kaydet'}
              </button>
              {shiftEditingId ? (
                <button
                  type="button"
                  onClick={resetShiftForm}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Vazgec
                </button>
              ) : null}
            </div>
          </div>
        </form>

        <div className="mt-4 list-scroll-area">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2">Departman</th>
                <th className="py-2">Vardiya</th>
                <th className="py-2">Saat</th>
                <th className="py-2">Mola</th>
                <th className="py-2">Durum</th>
                <th className="py-2 text-right">Aksiyon</th>
              </tr>
            </thead>
            <tbody>
              {shifts.map((item) => (
                <tr key={item.id} className="border-t border-slate-100">
                  <td className="py-2">{departmentNameById.get(item.department_id) ?? item.department_id}</td>
                  <td className="py-2">{item.name}</td>
                  <td className="py-2">{item.start_time_local} - {item.end_time_local}</td>
                  <td className="py-2">
                    <MinuteDisplay minutes={item.break_minutes} />
                  </td>
                  <td className="py-2">{item.is_active ? 'Aktif' : 'Pasif'}</td>
                  <td className="py-2 text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => onEditShift(item)}
                        className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        Duzenle
                      </button>
                      {item.is_active ? (
                        <button
                          type="button"
                          disabled={deactivateShiftMutation.isPending || setShiftActiveMutation.isPending}
                          onClick={() => {
                            if (!window.confirm('Bu vardiya pasife alinsin mi?')) return
                            deactivateShiftMutation.mutate(item.id)
                          }}
                          className="rounded-lg border border-rose-300 px-3 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                        >
                          Pasife Al
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={setShiftActiveMutation.isPending || deactivateShiftMutation.isPending}
                          onClick={() => setShiftActiveMutation.mutate({ shift: item, nextActive: true })}
                          className="rounded-lg border border-emerald-300 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
                        >
                          Aktif Et
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-base font-semibold text-slate-900">Ileri Planlama (Departman/Calisan)</h4>
            <p className="mt-1 text-xs text-slate-500">
              Gelecek tarihli vardiya ve sure kurali tanimlayin. Planlar duzenlenebilir, iptal edilebilir, tekrar aktif edilebilir.
            </p>
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={showInactivePlans} onChange={(event) => setShowInactivePlans(event.target.checked)} />
            Pasif planlari goster
          </label>
        </div>

        <form onSubmit={onSchedulePlanSubmit} className="mt-4 grid gap-3 md:grid-cols-4">
          <label className="text-sm text-slate-700">
            Departman
            <select
              value={planDepartmentId}
              onChange={(event) => {
                setPlanDepartmentId(event.target.value)
                setPlanTargetEmployeeIds([])
                setPlanShiftId('')
              }}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="">Seciniz</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm text-slate-700">
            Hedef Tipi
            <select
              value={planTargetType}
              onChange={(event) => {
                const nextTarget = event.target.value as SchedulePlanTargetType
                setPlanTargetType(nextTarget)
                if (nextTarget === 'DEPARTMENT') setPlanTargetEmployeeIds([])
              }}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              {PLAN_TARGET_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm text-slate-700">
            Calisanlar (gerekliyse)
            <input
              type="text"
              value={planTargetSearch}
              onChange={(event) => setPlanTargetSearch(event.target.value)}
              disabled={planTargetType === 'DEPARTMENT'}
              placeholder="Calisan adi veya ID ile ara..."
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-100"
            />
            <select
              multiple
              value={planTargetEmployeeIds.map(String)}
              onChange={(event) => {
                const selected = Array.from(event.target.selectedOptions).map((option) => Number(option.value))
                setPlanTargetEmployeeIds(selected.filter((item) => Number.isFinite(item) && item > 0))
              }}
              disabled={planTargetType === 'DEPARTMENT'}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-100"
            >
              {filteredPlanDepartmentEmployees.map((employee) => (
                <option key={employee.id} value={employee.id}>#{employee.id} - {employee.full_name}</option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-slate-500">
              Ctrl/Cmd ile birden fazla calisan secilebilir. Binlerce kayitta once arama yapin.
            </span>
          </label>

          <label className="text-sm text-slate-700">
            Vardiya (opsiyonel)
            <select value={planShiftId} onChange={(event) => setPlanShiftId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
              <option value="">Seciniz</option>
              {planDepartmentShifts.map((shift) => (
                <option key={shift.id} value={shift.id}>{shift.name} ({shift.start_time_local} - {shift.end_time_local})</option>
              ))}
            </select>
          </label>

          <label className="text-sm text-slate-700">Gunluk Dakika (ops.)
            <input value={planDailyMinutes} onChange={(event) => setPlanDailyMinutes(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>

          <label className="text-sm text-slate-700">Mola Dakika (ops.)
            <input value={planBreakMinutes} onChange={(event) => setPlanBreakMinutes(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>

          <label className="text-sm text-slate-700">Tolerans Dakika (ops.)
            <input value={planGraceMinutes} onChange={(event) => setPlanGraceMinutes(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>

          <label className="text-sm text-slate-700">Baslangic Tarihi
            <input type="date" value={planStartDate} onChange={(event) => setPlanStartDate(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>

          <label className="text-sm text-slate-700">Bitis Tarihi
            <input type="date" value={planEndDate} onChange={(event) => setPlanEndDate(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>

          <label className="inline-flex items-center gap-2 pt-8 text-sm text-slate-700">
            <input type="checkbox" checked={planIsLocked} onChange={(event) => setPlanIsLocked(event.target.checked)} />
            Vardiya kilitli
          </label>

          <label className="inline-flex items-center gap-2 pt-8 text-sm text-slate-700">
            <input type="checkbox" checked={planIsActive} onChange={(event) => setPlanIsActive(event.target.checked)} />
            Aktif
          </label>

          <label className="text-sm text-slate-700 md:col-span-2">
            Not
            <input value={planNote} onChange={(event) => setPlanNote(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>

          <div className="md:col-span-4 flex flex-wrap gap-2">
            <button type="submit" disabled={upsertSchedulePlanMutation.isPending} className="btn-primary rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
              {upsertSchedulePlanMutation.isPending ? 'Kaydediliyor...' : planId ? 'Plani Guncelle' : 'Plan Olustur'}
            </button>
            <button type="button" onClick={resetSchedulePlanForm} className="btn-secondary rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Formu Temizle
            </button>
          </div>
        </form>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2">Departman</th>
                <th className="py-2">Hedef</th>
                <th className="py-2">Vardiya</th>
                <th className="py-2">Plan/Mola</th>
                <th className="py-2">Tarih Araligi</th>
                <th className="py-2">Kilit</th>
                <th className="py-2">Durum</th>
                <th className="py-2">Aksiyon</th>
              </tr>
            </thead>
            <tbody>
              {filteredPlans.map((plan) => {
                const scopedEmployeeIds =
                  plan.target_employee_ids && plan.target_employee_ids.length > 0
                    ? plan.target_employee_ids
                    : plan.target_employee_id
                      ? [plan.target_employee_id]
                      : []
                const targetEmployeeNames = scopedEmployeeIds.map(
                  (id) => employeeNameById.get(id) ?? `#${id}`,
                )

                return (
                  <tr key={plan.id} className="border-t border-slate-100">
                    <td className="py-2">{departmentNameById.get(plan.department_id) ?? plan.department_id}</td>
                    <td className="py-2">
                      <div className="flex flex-col">
                        <span>{PLAN_TARGET_LABELS[plan.target_type]}</span>
                        {targetEmployeeNames.length > 0 ? (
                          <span className="text-xs text-slate-500">{targetEmployeeNames.join(', ')}</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="py-2">{plan.shift_id ? shiftNameById.get(plan.shift_id) ?? `#${plan.shift_id}` : '-'}</td>
                    <td className="py-2 text-xs text-slate-700">
                      <div>Plan: {plan.daily_minutes_planned !== null ? `${plan.daily_minutes_planned} dk` : '-'}</div>
                      <div>Mola: {plan.break_minutes !== null ? `${plan.break_minutes} dk` : '-'}</div>
                      <div>Tolerans: {plan.grace_minutes !== null ? `${plan.grace_minutes} dk` : '-'}</div>
                    </td>
                    <td className="py-2">{plan.start_date} - {plan.end_date}</td>
                    <td className="py-2">{plan.is_locked ? 'Kilitli' : 'Serbest'}</td>
                    <td className="py-2">{plan.is_active ? 'Aktif' : 'Pasif'}</td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => startEditSchedulePlan(plan)} className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">Duzenle</button>
                        {plan.is_active ? (
                          <button type="button" onClick={() => cancelSchedulePlanMutation.mutate(plan.id)} disabled={cancelSchedulePlanMutation.isPending} className="rounded-lg border border-rose-300 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60">Iptal Et</button>
                        ) : (
                          <button type="button" onClick={() => activateSchedulePlanMutation.mutate(plan)} disabled={activateSchedulePlanMutation.isPending} className="rounded-lg border border-emerald-300 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-60">Aktif Et</button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel>
        <h4 className="text-base font-semibold text-slate-900">Mevcut Temel Kurallar</h4>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2">Departman</th>
                <th className="py-2">Planlanan Gunluk Sure</th>
                <th className="py-2">Mola Suresi</th>
                <th className="py-2">Tolerans</th>
              </tr>
            </thead>
            <tbody>
              {workRules.map((rule) => (
                <tr key={rule.id} className="border-t border-slate-100">
                  <td className="py-2">{departmentNameById.get(rule.department_id) ?? rule.department_id}</td>
                  <td className="py-2"><MinuteDisplay minutes={rule.daily_minutes_planned} /></td>
                  <td className="py-2"><MinuteDisplay minutes={rule.break_minutes} /></td>
                  <td className="py-2"><MinuteDisplay minutes={rule.grace_minutes} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {formError ? <p className="form-validation">{formError}</p> : null}
    </div>
  )
}
