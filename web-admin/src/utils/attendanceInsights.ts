import type { MonthlyEmployeeDay } from '../types/api'

export type AttendanceDayType = 'WEEKDAY' | 'SUNDAY' | 'SPECIAL'

export interface AttendanceDayTypeInfo {
  key: AttendanceDayType
  label: string
}

export interface MonthlyAttendanceInsight {
  workedMinutes: number
  overtimeMinutes: number
  planOvertimeMinutes: number
  legalExtraWorkMinutes: number
  workedDayCount: number
  overtimeDayCount: number
  planOvertimeDayCount: number
  sundayWorkedDayCount: number
  weekdayWorkedDayCount: number
  specialWorkedDayCount: number
  sundayWorkedMinutes: number
  weekdayWorkedMinutes: number
  specialWorkedMinutes: number
}

function parseIsoDate(value: string): Date {
  const [yearRaw, monthRaw, dayRaw] = value.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const day = Number(dayRaw)
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return new Date('invalid')
  }
  return new Date(Date.UTC(year, month - 1, day))
}

function isSpecialDay(day: MonthlyEmployeeDay): boolean {
  return day.leave_type === 'PUBLIC_HOLIDAY' || day.flags.includes('PUBLIC_HOLIDAY')
}

function isWorkedDay(day: MonthlyEmployeeDay): boolean {
  if (day.worked_minutes > 0) {
    return true
  }
  return Boolean(day.in || day.out)
}

export function getAttendanceDayType(day: MonthlyEmployeeDay): AttendanceDayTypeInfo {
  if (isSpecialDay(day)) {
    return { key: 'SPECIAL', label: 'Özel Gün' }
  }

  const parsed = parseIsoDate(day.date)
  if (!Number.isNaN(parsed.getTime()) && parsed.getUTCDay() === 0) {
    return { key: 'SUNDAY', label: 'Pazar' }
  }

  return { key: 'WEEKDAY', label: 'Hafta İçi' }
}

export function buildMonthlyAttendanceInsight(days: MonthlyEmployeeDay[]): MonthlyAttendanceInsight {
  const insight: MonthlyAttendanceInsight = {
    workedMinutes: 0,
    overtimeMinutes: 0,
    planOvertimeMinutes: 0,
    legalExtraWorkMinutes: 0,
    workedDayCount: 0,
    overtimeDayCount: 0,
    planOvertimeDayCount: 0,
    sundayWorkedDayCount: 0,
    weekdayWorkedDayCount: 0,
    specialWorkedDayCount: 0,
    sundayWorkedMinutes: 0,
    weekdayWorkedMinutes: 0,
    specialWorkedMinutes: 0,
  }

  for (const day of days) {
    const planOvertime = day.plan_overtime_minutes ?? day.overtime_minutes
    const legalExtraWork = day.legal_extra_work_minutes ?? 0
    const legalOvertime = day.legal_overtime_minutes ?? day.overtime_minutes

    insight.workedMinutes += day.worked_minutes
    insight.planOvertimeMinutes += planOvertime
    insight.legalExtraWorkMinutes += legalExtraWork
    insight.overtimeMinutes += legalOvertime

    const worked = isWorkedDay(day)
    if (worked) {
      insight.workedDayCount += 1
      const dayType = getAttendanceDayType(day)
      if (dayType.key === 'SPECIAL') {
        insight.specialWorkedDayCount += 1
        insight.specialWorkedMinutes += day.worked_minutes
      } else if (dayType.key === 'SUNDAY') {
        insight.sundayWorkedDayCount += 1
        insight.sundayWorkedMinutes += day.worked_minutes
      } else {
        insight.weekdayWorkedDayCount += 1
        insight.weekdayWorkedMinutes += day.worked_minutes
      }
    }

    if (planOvertime > 0) {
      insight.planOvertimeDayCount += 1
    }

    if (legalOvertime > 0) {
      insight.overtimeDayCount += 1
    }
  }

  return insight
}
