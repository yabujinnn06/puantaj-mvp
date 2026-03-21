import { useEffect, useMemo, useState } from 'react'

import type {
  DepartmentShift,
  DepartmentWeekdayShiftAssignment,
} from '../../types/api'

const WEEKDAYS = [
  { value: 0, label: 'Pazartesi' },
  { value: 1, label: 'Sali' },
  { value: 2, label: 'Carsamba' },
  { value: 3, label: 'Persembe' },
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

function normalizeShiftIds(shiftIds: string[]) {
  return shiftIds
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0)
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

  const saveWeekdayDraft = (weekday: number, nextShiftIds: string[]) => {
    setDrafts((prev) => ({
      ...prev,
      [weekday]: nextShiftIds,
    }))
    onSave(weekday, normalizeShiftIds(nextShiftIds))
  }

  if (!departmentId) {
    return <p className="mt-3 text-sm text-slate-500">{emptyMessage}</p>
  }

  return (
    <div className="mt-4 overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="text-xs uppercase text-slate-500">
          <tr>
            <th className="py-2">Gün</th>
            <th className="py-2">Eklenebilir vardiyalar</th>
            <th className="py-2">Bu güne atanan vardiyalar</th>
            <th className="py-2 text-right">İşlem</th>
          </tr>
        </thead>
        <tbody>
          {WEEKDAYS.map((weekday) => {
            const selectedShiftIds = drafts[weekday.value] ?? []
            const addableShifts = activeShifts.filter(
              (shift) => !selectedShiftIds.includes(String(shift.id)),
            )

            return (
              <tr key={weekday.value} className="border-t border-slate-100 align-top">
                <td className="py-2 font-medium text-slate-800">{weekday.label}</td>
                <td className="min-w-72 py-2">
                  {addableShifts.length > 0 ? (
                    <div className="grid gap-2">
                      {addableShifts.map((shift) => {
                        const shiftId = String(shift.id)
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
                            <button
                              type="button"
                              disabled={isSaving}
                              onClick={() =>
                                saveWeekdayDraft(weekday.value, [...selectedShiftIds, shiftId])
                              }
                              className="rounded-lg border border-brand-300 bg-white px-3 py-1 text-[11px] font-semibold text-brand-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Ekle
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <span className="text-xs text-slate-500">
                      Bu gün için eklenebilir başka aktif vardiya yok.
                    </span>
                  )}
                  <span className="mt-1 block text-xs text-slate-500">
                    Sol taraf sadece henüz bu güne eklenmemiş aktif vardiyaları gösterir.
                  </span>
                </td>
                <td className="min-w-72 py-2">
                  {selectedShiftIds.length > 0 ? (
                    <div className="grid gap-2">
                      {selectedShiftIds.map((shiftId, index) => (
                        <div
                          key={`${weekday.value}-${shiftId}-${index}`}
                          className="flex items-center justify-between gap-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs font-medium text-brand-700"
                        >
                          <span className="min-w-0 flex-1">
                            {shiftLabelById.get(Number(shiftId)) ?? `#${shiftId}`}
                          </span>
                          <button
                            type="button"
                            disabled={isSaving}
                            onClick={() =>
                              saveWeekdayDraft(
                                weekday.value,
                                selectedShiftIds.filter(
                                  (value, valueIndex) =>
                                    !(value === shiftId && valueIndex === index),
                                ),
                              )
                            }
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
                      onClick={() => saveWeekdayDraft(weekday.value, [])}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Günü temizle
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
