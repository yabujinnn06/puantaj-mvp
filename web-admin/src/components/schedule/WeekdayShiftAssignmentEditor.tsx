import { useEffect, useMemo, useState } from 'react'

import type {
  DepartmentShift,
  DepartmentWeekdayShiftAssignment,
} from '../../types/api'

const WEEKDAYS = [
  { value: 0, label: 'Pazartesi' },
  { value: 1, label: 'Salı' },
  { value: 2, label: 'Çarşamba' },
  { value: 3, label: 'Perşembe' },
  { value: 4, label: 'Cuma' },
  { value: 5, label: 'Cumartesi' },
  { value: 6, label: 'Pazar' },
]

type Props = {
  departmentId: number | null
  shifts: DepartmentShift[]
  assignments: DepartmentWeekdayShiftAssignment[]
  isSaving: boolean
  onSave: (weekday: number, shiftIds: number[]) => void
  emptyMessage: string
}

export function WeekdayShiftAssignmentEditor({
  departmentId,
  shifts,
  assignments,
  isSaving,
  onSave,
  emptyMessage,
}: Props) {
  const [drafts, setDrafts] = useState<Record<number, string[]>>({})

  const updateWeekdayDraft = (weekday: number, nextShiftIds: string[]) => {
    setDrafts((prev) => ({
      ...prev,
      [weekday]: nextShiftIds,
    }))
  }

  const normalizeShiftIds = (shiftIds: string[]) =>
    shiftIds
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0)

  const saveWeekdayDraft = (weekday: number, nextShiftIds: string[]) => {
    onSave(weekday, normalizeShiftIds(nextShiftIds))
  }

  const addAssignedShift = (weekday: number, selectedShiftIds: string[], shiftId: string) => {
    if (selectedShiftIds.includes(shiftId)) {
      return
    }
    const nextShiftIds = [...selectedShiftIds, shiftId]
    updateWeekdayDraft(weekday, nextShiftIds)
    saveWeekdayDraft(weekday, nextShiftIds)
  }

  const removeAssignedShift = (
    weekday: number,
    selectedShiftIds: string[],
    shiftId: string,
    index: number,
  ) => {
    const nextShiftIds = selectedShiftIds.filter(
      (value, valueIndex) => !(value === shiftId && valueIndex === index),
    )
    updateWeekdayDraft(weekday, nextShiftIds)
    saveWeekdayDraft(weekday, nextShiftIds)
  }

  const activeShifts = useMemo(
    () =>
      shifts
        .filter((shift) => shift.is_active)
        .sort((left, right) => {
          if (left.start_time_local === right.start_time_local) {
            return left.name.localeCompare(right.name, 'tr')
          }
          return left.start_time_local.localeCompare(right.start_time_local)
        }),
    [shifts],
  )

  const shiftLabelById = useMemo(
    () =>
      new Map(
        activeShifts.map((shift) => [
          shift.id,
          `${shift.name} (${shift.start_time_local} - ${shift.end_time_local})`,
        ]),
      ),
    [activeShifts],
  )

  useEffect(() => {
    if (!departmentId) {
      setDrafts({})
      return
    }

    const nextDrafts: Record<number, string[]> = {}
    for (const weekday of WEEKDAYS) {
      nextDrafts[weekday.value] = assignments
        .filter((assignment) => assignment.weekday === weekday.value)
        .sort((left, right) => left.sort_order - right.sort_order || left.id - right.id)
        .map((assignment) => String(assignment.shift_id))
    }
    setDrafts(nextDrafts)
  }, [assignments, departmentId])

  if (!departmentId) {
    return <p className="mt-3 text-sm text-slate-500">{emptyMessage}</p>
  }

  return (
    <div className="mt-4 overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="text-xs uppercase text-slate-500">
          <tr>
            <th className="py-2">Gün</th>
            <th className="py-2">Seçilebilir aktif vardiyalar</th>
            <th className="py-2">Bu güne atanan vardiyalar</th>
            <th className="py-2 text-right">İşlem</th>
          </tr>
        </thead>
        <tbody>
          {WEEKDAYS.map((weekday) => {
            const selectedShiftIds = drafts[weekday.value] ?? []
            const selectedLabels = selectedShiftIds
              .map((shiftId) => shiftLabelById.get(Number(shiftId)) ?? `#${shiftId}`)
              .filter(Boolean)

            return (
              <tr key={weekday.value} className="border-t border-slate-100 align-top">
                <td className="py-2 font-medium text-slate-800">{weekday.label}</td>
                <td className="py-2 min-w-72">
                  {activeShifts.length > 0 ? (
                    <div className="grid gap-2">
                      {activeShifts.map((shift) => {
                        const shiftId = String(shift.id)
                        const isAssigned = selectedShiftIds.includes(shiftId)
                        return (
                          <div
                            key={`${weekday.value}-pool-${shift.id}`}
                            className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2"
                          >
                            <div className="min-w-0 flex-1 text-slate-700">
                              <div className="truncate text-sm font-medium">{shift.name}</div>
                              <div className="text-xs text-slate-500">
                                {shift.start_time_local} - {shift.end_time_local}
                              </div>
                            </div>
                            {isAssigned ? (
                              <span className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-700">
                                Bu günde
                              </span>
                            ) : (
                              <button
                                type="button"
                                disabled={isSaving}
                                onClick={() => addAssignedShift(weekday.value, selectedShiftIds, shiftId)}
                                className="rounded-lg border border-brand-300 bg-white px-3 py-1 text-[11px] font-semibold text-brand-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Ekle
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <span className="text-xs text-slate-500">
                      Bu departman için aktif vardiya yok.
                    </span>
                  )}
                  <span className="mt-1 block text-xs text-slate-500">
                    Sol taraf departmandaki aktif vardiya havuzudur. Sağ taraf sadece bu günün atamalarını gösterir.
                  </span>
                </td>
                <td className="py-2 min-w-72">
                  {selectedLabels.length > 0 ? (
                    <div className="grid gap-2">
                      {selectedShiftIds.map((shiftId, index) => (
                        <div
                          key={`${weekday.value}-${shiftId}-${index}`}
                          className="flex items-center justify-between gap-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs font-medium text-brand-700"
                        >
                          <span className="min-w-0 flex-1">{shiftLabelById.get(Number(shiftId)) ?? `#${shiftId}`}</span>
                          <button
                            type="button"
                            disabled={isSaving}
                            onClick={() => removeAssignedShift(weekday.value, selectedShiftIds, shiftId, index)}
                            className="rounded-lg border border-rose-300 bg-white px-3 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Kaldir
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-slate-500">
                      Atama yok. Bu gün için sistem fallback kurallarına döner.
                    </span>
                  )}
                </td>
                <td className="py-2 text-right">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      disabled={isSaving || selectedShiftIds.length === 0}
                      onClick={() => {
                        updateWeekdayDraft(weekday.value, [])
                        saveWeekdayDraft(weekday.value, [])
                      }}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Gunu temizle
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
