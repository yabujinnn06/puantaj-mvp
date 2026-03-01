import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  deleteDepartmentShift,
  getDepartments,
  getDepartmentShifts,
  getDepartmentWeekdayShiftAssignments,
  getEmployees,
  replaceDepartmentWeekdayShiftAssignments,
  updateEmployeeDepartment,
  upsertDepartmentShift,
} from '../api/admin'
import { parseApiError } from '../api/error'
import { EmployeeAutocompleteField } from '../components/EmployeeAutocompleteField'
import { ErrorBlock } from '../components/ErrorBlock'
import { LoadingBlock } from '../components/LoadingBlock'
import { MinuteDisplay } from '../components/MinuteDisplay'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'
import { WeekdayShiftAssignmentEditor } from '../components/schedule/WeekdayShiftAssignmentEditor'
import { useToast } from '../hooks/useToast'
import type { DepartmentShift } from '../types/api'

export function QuickSetupPage() {
  const queryClient = useQueryClient()
  const { pushToast } = useToast()

  const [selectedDepartmentId, setSelectedDepartmentId] = useState('')
  const [assignmentEmployeeId, setAssignmentEmployeeId] = useState('')
  const [assignmentDepartmentId, setAssignmentDepartmentId] = useState('')

  const [shiftName, setShiftName] = useState('')
  const [shiftStartTime, setShiftStartTime] = useState('09:00')
  const [shiftEndTime, setShiftEndTime] = useState('17:30')
  const [shiftBreakMinutes, setShiftBreakMinutes] = useState('60')
  const [shiftIsActive, setShiftIsActive] = useState(true)
  const [shiftEditingId, setShiftEditingId] = useState<number | null>(null)

  const departmentsQuery = useQuery({ queryKey: ['departments'], queryFn: getDepartments })
  const employeesQuery = useQuery({
    queryKey: ['employees', 'all-for-quick-setup'],
    queryFn: () => getEmployees({ include_inactive: true, status: 'all' }),
  })
  const weekdayShiftAssignmentsQuery = useQuery({
    queryKey: ['department-weekday-shifts'],
    queryFn: () => getDepartmentWeekdayShiftAssignments({ active_only: true }),
  })
  const shiftsQuery = useQuery({
    queryKey: ['department-shifts'],
    queryFn: () => getDepartmentShifts({ active_only: false }),
  })

  const selectedDepartmentNum = selectedDepartmentId ? Number(selectedDepartmentId) : null

  const updateEmployeeDepartmentMutation = useMutation({
    mutationFn: ({ employeeId, departmentId }: { employeeId: number; departmentId: number | null }) =>
      updateEmployeeDepartment(employeeId, { department_id: departmentId }),
    onSuccess: (employee) => {
      pushToast({
        variant: 'success',
        title: 'Departman ataması güncellendi',
        description: `${employee.full_name} için departman kaydı güncellendi.`,
      })
      void queryClient.invalidateQueries({ queryKey: ['employees'] })
      void queryClient.invalidateQueries({ queryKey: ['employee-device-overview'] })
    },
    onError: (error) => {
      pushToast({
        variant: 'error',
        title: 'Departman güncellenemedi',
        description: parseApiError(error, 'İşlem başarısız.').message,
      })
    },
  })

  const replaceWeekdayShiftAssignmentsMutation = useMutation({
    mutationFn: replaceDepartmentWeekdayShiftAssignments,
    onSuccess: () => {
      pushToast({
        variant: 'success',
        title: 'Günlük vardiya planı kaydedildi',
        description: 'Seçilen gün için vardiya ataması güncellendi.',
      })
      void queryClient.invalidateQueries({ queryKey: ['department-weekday-shifts'] })
    },
    onError: (error) => {
      pushToast({
        variant: 'error',
        title: 'Günlük vardiya planı kaydedilemedi',
        description: parseApiError(error, 'İşlem başarısız.').message,
      })
    },
  })

  const upsertShiftMutation = useMutation({
    mutationFn: upsertDepartmentShift,
    onSuccess: () => {
      pushToast({
        variant: 'success',
        title: 'Vardiya kaydedildi',
        description: 'Departman vardiyası eklendi/güncellendi.',
      })
      setShiftName('')
      setShiftStartTime('09:00')
      setShiftEndTime('17:30')
      setShiftBreakMinutes('60')
      setShiftIsActive(true)
      setShiftEditingId(null)
      void queryClient.invalidateQueries({ queryKey: ['department-shifts'] })
    },
    onError: (error) => {
      pushToast({
        variant: 'error',
        title: 'Vardiya kaydedilemedi',
        description: parseApiError(error, 'İşlem başarısız.').message,
      })
    },
  })

  const deactivateShiftMutation = useMutation({
    mutationFn: deleteDepartmentShift,
    onSuccess: () => {
      pushToast({
        variant: 'success',
        title: 'Vardiya pasife alındı',
        description: 'Vardiya kaydı pasif duruma getirildi.',
      })
      if (shiftEditingId !== null) {
        setShiftEditingId(null)
        setShiftName('')
        setShiftStartTime('09:00')
        setShiftEndTime('17:30')
        setShiftBreakMinutes('60')
        setShiftIsActive(true)
      }
      void queryClient.invalidateQueries({ queryKey: ['department-shifts'] })
    },
    onError: (error) => {
      pushToast({
        variant: 'error',
        title: 'Vardiya pasife alınamadı',
        description: parseApiError(error, 'İşlem başarısız.').message,
      })
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
      pushToast({
        variant: 'success',
        title: variables.nextActive ? 'Vardiya aktif edildi' : 'Vardiya pasife alındı',
        description: variables.nextActive
          ? 'Vardiya tekrar kullanıma açıldı.'
          : 'Vardiya pasif duruma getirildi.',
      })
      void queryClient.invalidateQueries({ queryKey: ['department-shifts'] })
    },
    onError: (error) => {
      pushToast({
        variant: 'error',
        title: 'Vardiya durumu güncellenemedi',
        description: parseApiError(error, 'İşlem başarısız.').message,
      })
    },
  })

  if (
    departmentsQuery.isLoading ||
    employeesQuery.isLoading ||
    weekdayShiftAssignmentsQuery.isLoading ||
    shiftsQuery.isLoading
  ) {
    return <LoadingBlock />
  }

  if (
    departmentsQuery.isError ||
    employeesQuery.isError ||
    weekdayShiftAssignmentsQuery.isError ||
    shiftsQuery.isError
  ) {
    return <ErrorBlock message="Hızlı ayarlar verileri alınamadı." />
  }

  const departments = departmentsQuery.data ?? []
  const employees = employeesQuery.data ?? []
  const weekdayShiftAssignments = weekdayShiftAssignmentsQuery.data ?? []
  const shifts = shiftsQuery.data ?? []

  const departmentNameById = useMemo(
    () => new Map(departments.map((department) => [department.id, department.name])),
    [departments],
  )

  const filteredShifts = useMemo(() => {
    if (!selectedDepartmentNum) return []
    return shifts.filter((item) => item.department_id === selectedDepartmentNum)
  }, [selectedDepartmentNum, shifts])

  const filteredWeekdayAssignments = useMemo(() => {
    if (!selectedDepartmentNum) return []
    return weekdayShiftAssignments.filter((item) => item.department_id === selectedDepartmentNum)
  }, [selectedDepartmentNum, weekdayShiftAssignments])

  const selectedAssignmentEmployee = useMemo(
    () => employees.find((item) => String(item.id) === assignmentEmployeeId),
    [employees, assignmentEmployeeId],
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="Hızlı Ayarlar"
        description="Sadece gerekli kurulum adımları: çalışan-departman ataması, günlük vardiya planı ve vardiyalar."
      />

      <Panel>
        <h4 className="text-base font-semibold text-slate-900">1) Çalışan - Departman Ataması</h4>
        <p className="mt-1 text-xs text-slate-500">
          Çalışan adını veya ID bilgisini yazarak personeli bulun, departmanını hızlıca güncelleyin.
        </p>

        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <EmployeeAutocompleteField
            label="Çalışan"
            employees={employees}
            value={assignmentEmployeeId}
            onChange={(value) => {
              setAssignmentEmployeeId(value)
              const employee = employees.find((item) => String(item.id) === value)
              setAssignmentDepartmentId(employee?.department_id ? String(employee.department_id) : '')
            }}
            helperText="Ad-soyad veya personel ID ile arayın."
            className="md:col-span-2"
          />

          <label className="text-sm text-slate-700">
            Yeni departman
            <select
              value={assignmentDepartmentId}
              onChange={(event) => setAssignmentDepartmentId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="">Atanmamış</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          <div>
            <p>
              Seçili çalışan:{' '}
              {selectedAssignmentEmployee
                ? `#${selectedAssignmentEmployee.id} - ${selectedAssignmentEmployee.full_name}`
                : '-'}
            </p>
            <p className="text-xs text-slate-500">
              Mevcut departman:{' '}
              {selectedAssignmentEmployee?.department_id
                ? departmentNameById.get(selectedAssignmentEmployee.department_id) ?? '-'
                : 'Atanmamış'}
            </p>
          </div>
          <button
            type="button"
            disabled={!selectedAssignmentEmployee || updateEmployeeDepartmentMutation.isPending}
            onClick={() => {
              if (!selectedAssignmentEmployee) return
              updateEmployeeDepartmentMutation.mutate({
                employeeId: selectedAssignmentEmployee.id,
                departmentId: assignmentDepartmentId ? Number(assignmentDepartmentId) : null,
              })
            }}
            className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Departmanı Kaydet
          </button>
        </div>
      </Panel>

      <Panel>
        <h4 className="text-base font-semibold text-slate-900">2) Günlük Vardiya Planı</h4>
        <p className="mt-1 text-xs text-slate-500">
          Bir güne birden fazla vardiya atanabilir. Sistem önce bu listedeki vardiyalar arasından seçim yapar.
        </p>

        <div className="mt-3 grid gap-3 md:grid-cols-[minmax(260px,340px)_1fr]">
          <label className="text-sm text-slate-700">
            Departman
            <select
              value={selectedDepartmentId}
              onChange={(event) => setSelectedDepartmentId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="">Seçiniz</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
            Eğer gün için vardiya atamazsanız sistem eski fallback kurallarına döner. Net davranış için her çalışma
            gününe en az bir vardiya tanımlayın.
          </div>
        </div>

        <WeekdayShiftAssignmentEditor
          departmentId={selectedDepartmentNum}
          shifts={filteredShifts}
          assignments={filteredWeekdayAssignments}
          isSaving={replaceWeekdayShiftAssignmentsMutation.isPending}
          onSave={(weekday, shiftIds) => {
            if (!selectedDepartmentNum) return
            replaceWeekdayShiftAssignmentsMutation.mutate({
              department_id: selectedDepartmentNum,
              weekday,
              shift_ids: shiftIds,
            })
          }}
          emptyMessage="Günlük vardiya planı düzenlemek için departman seçin."
        />
      </Panel>

      <Panel>
        <h4 className="text-base font-semibold text-slate-900">3) Departman Vardiyaları</h4>
        <p className="mt-1 text-xs text-slate-500">
          Bir departman için birden fazla vardiya tanımlayabilirsiniz (ör. 09:30-18:30 ve 13:00-22:00).
        </p>

        {selectedDepartmentNum ? (
          <>
            <form
              className="mt-3 grid gap-3 md:grid-cols-5"
              onSubmit={(event) => {
                event.preventDefault()
                if (!shiftName.trim()) {
                  pushToast({
                    variant: 'error',
                    title: 'Vardiya adı zorunlu',
                    description: 'Lütfen vardiya adı girin.',
                  })
                  return
                }

                const parsedBreakMinutes = Number(shiftBreakMinutes)
                if (!Number.isFinite(parsedBreakMinutes) || parsedBreakMinutes < 0) {
                  pushToast({
                    variant: 'error',
                    title: 'Geçersiz mola dakikası',
                    description: 'Mola dakikasını sayı olarak girin.',
                  })
                  return
                }

                upsertShiftMutation.mutate({
                  id: shiftEditingId ?? undefined,
                  department_id: selectedDepartmentNum,
                  name: shiftName.trim(),
                  start_time_local: shiftStartTime,
                  end_time_local: shiftEndTime,
                  break_minutes: Math.trunc(parsedBreakMinutes),
                  is_active: shiftIsActive,
                })
              }}
            >
              {shiftEditingId ? (
                <div className="md:col-span-5 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs font-medium text-brand-700">
                  Düzenleme modu: #{shiftEditingId}
                </div>
              ) : null}
              <label className="text-sm text-slate-700">
                Vardiya adı
                <input
                  value={shiftName}
                  onChange={(event) => setShiftName(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  placeholder="Örn: Sabah 09:30-18:30"
                />
              </label>

              <label className="text-sm text-slate-700">
                Başlangıç
                <input
                  type="time"
                  value={shiftStartTime}
                  onChange={(event) => setShiftStartTime(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>

              <label className="text-sm text-slate-700">
                Bitiş
                <input
                  type="time"
                  value={shiftEndTime}
                  onChange={(event) => setShiftEndTime(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>

              <label className="text-sm text-slate-700">
                Mola dakika
                <input
                  value={shiftBreakMinutes}
                  onChange={(event) => setShiftBreakMinutes(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>

              <div className="flex items-end gap-3 pb-1">
                <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={shiftIsActive}
                    onChange={(event) => setShiftIsActive(event.target.checked)}
                  />
                  Aktif
                </label>
                <button
                  type="submit"
                  disabled={upsertShiftMutation.isPending}
                  className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {upsertShiftMutation.isPending
                    ? 'Kaydediliyor...'
                    : shiftEditingId
                      ? 'Vardiya Güncelle'
                      : 'Vardiya Kaydet'}
                </button>
                {shiftEditingId ? (
                  <button
                    type="button"
                    onClick={() => {
                      setShiftEditingId(null)
                      setShiftName('')
                      setShiftStartTime('09:00')
                      setShiftEndTime('17:30')
                      setShiftBreakMinutes('60')
                      setShiftIsActive(true)
                    }}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Vazgeç
                  </button>
                ) : null}
              </div>
            </form>

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2">Vardiya</th>
                    <th className="py-2">Saat Aralığı</th>
                    <th className="py-2">Mola</th>
                    <th className="py-2">Durum</th>
                    <th className="py-2 text-right">Aksiyon</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredShifts.map((shift) => (
                    <tr key={shift.id} className="border-t border-slate-100">
                      <td className="py-2">{shift.name}</td>
                      <td className="py-2">
                        {shift.start_time_local} - {shift.end_time_local}
                      </td>
                      <td className="py-2">
                        <MinuteDisplay minutes={shift.break_minutes} />
                      </td>
                      <td className="py-2">{shift.is_active ? 'Aktif' : 'Pasif'}</td>
                      <td className="py-2 text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setShiftEditingId(shift.id)
                              setShiftName(shift.name)
                              setShiftStartTime(shift.start_time_local)
                              setShiftEndTime(shift.end_time_local)
                              setShiftBreakMinutes(String(shift.break_minutes))
                              setShiftIsActive(shift.is_active)
                            }}
                            className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            Düzenle
                          </button>
                          {shift.is_active ? (
                            <button
                              type="button"
                              disabled={deactivateShiftMutation.isPending || setShiftActiveMutation.isPending}
                              onClick={() => {
                                if (!window.confirm('Bu vardiya pasife alınsın mı?')) return
                                deactivateShiftMutation.mutate(shift.id)
                              }}
                              className="rounded-lg border border-rose-300 px-3 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                            >
                              Pasife Al
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={setShiftActiveMutation.isPending || deactivateShiftMutation.isPending}
                              onClick={() => setShiftActiveMutation.mutate({ shift, nextActive: true })}
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

            {filteredShifts.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">Seçilen departman için vardiya bulunmuyor.</p>
            ) : null}
          </>
        ) : (
          <p className="mt-3 text-sm text-slate-500">Vardiya düzenlemek için departman seçin.</p>
        )}
      </Panel>
    </div>
  )
}
