import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import {
  getDepartments,
  getEmployees,
  getLocationMonitorEmployeeTimeline,
  getRegions,
} from '../api/admin'
import { EmployeeAutocompleteField } from '../components/EmployeeAutocompleteField'
import { ErrorBlock } from '../components/ErrorBlock'
import { LoadingBlock } from '../components/LoadingBlock'
import { MinuteDisplay } from '../components/MinuteDisplay'
import { LocationMonitor3DView } from '../components/location-monitor/LocationMonitor3DView'
import { LocationMonitorMap } from '../components/location-monitor/LocationMonitorMap'
import { dateValue } from '../components/management-console/types'
import type { LocationMonitorDayRecord, LocationMonitorMapPoint } from '../types/api'

const TIME_FORMAT = new Intl.DateTimeFormat('tr-TR', {
  hour: '2-digit',
  minute: '2-digit',
})

const DATE_TIME_FORMAT = new Intl.DateTimeFormat('tr-TR', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

const DAY_FORMAT = new Intl.DateTimeFormat('tr-TR', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
})

function formatDateTime(value: string | null): string {
  if (!value) {
    return '-'
  }
  return DATE_TIME_FORMAT.format(new Date(value))
}

function formatClock(value: string | null): string {
  if (!value) {
    return '-'
  }
  return TIME_FORMAT.format(new Date(value))
}

function formatDay(value: string): string {
  return DAY_FORMAT.format(new Date(`${value}T00:00:00`))
}

function dayStatusLabel(value: LocationMonitorDayRecord['status']): string {
  if (value === 'OK') return 'Tamamlandi'
  if (value === 'INCOMPLETE') return 'Eksik'
  if (value === 'LEAVE') return 'Izin'
  return 'Bos'
}

function pointSourceLabel(value: LocationMonitorMapPoint['source']): string {
  if (value === 'CHECKIN') return 'Mesai girisi'
  if (value === 'CHECKOUT') return 'Mesai cikisi'
  if (value === 'APP_OPEN') return 'Uygulama girisi'
  if (value === 'APP_CLOSE') return 'Uygulama cikisi'
  return 'Son konum'
}

function pointTone(value: LocationMonitorMapPoint['source']): string {
  if (value === 'CHECKIN') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (value === 'CHECKOUT') return 'border-rose-200 bg-rose-50 text-rose-700'
  if (value === 'APP_OPEN') return 'border-amber-200 bg-amber-50 text-amber-700'
  if (value === 'APP_CLOSE') return 'border-indigo-200 bg-indigo-50 text-indigo-700'
  return 'border-sky-200 bg-sky-50 text-sky-700'
}

function latestAvailablePoint(day: LocationMonitorDayRecord): LocationMonitorMapPoint | null {
  return (
    day.last_location_point ??
    day.last_app_close_point ??
    day.check_out_point ??
    day.first_app_open_point ??
    day.check_in_point
  )
}

export function LocationMonitorPage() {
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('')
  const [employeeQuery, setEmployeeQuery] = useState('')
  const [regionId, setRegionId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [includeInactive, setIncludeInactive] = useState(false)
  const [startDate, setStartDate] = useState(dateValue(-6))
  const [endDate, setEndDate] = useState(dateValue(0))
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [focusedPointId, setFocusedPointId] = useState<string | null>(null)
  const deferredEmployeeQuery = useDeferredValue(employeeQuery)

  const employeesQuery = useQuery({
    queryKey: ['employees', 'location-monitor'],
    queryFn: () => getEmployees({ status: 'all' }),
  })
  const regionsQuery = useQuery({
    queryKey: ['regions', 'location-monitor'],
    queryFn: () => getRegions(),
  })
  const departmentsQuery = useQuery({
    queryKey: ['departments', 'location-monitor'],
    queryFn: () => getDepartments(),
  })

  const filteredEmployees = useMemo(() => {
    const normalizedQuery = deferredEmployeeQuery.trim().toLocaleLowerCase('tr-TR')
    return (employeesQuery.data ?? [])
      .filter((employee) => {
        if (!includeInactive && !employee.is_active) {
          return false
        }
        if (regionId && String(employee.region_id ?? '') !== regionId) {
          return false
        }
        if (departmentId && String(employee.department_id ?? '') !== departmentId) {
          return false
        }
        if (!normalizedQuery) {
          return true
        }
        const haystack = `${employee.id} ${employee.full_name} ${employee.region_name ?? ''}`.toLocaleLowerCase('tr-TR')
        return haystack.includes(normalizedQuery)
      })
      .sort((left, right) => {
        if (left.is_active !== right.is_active) {
          return left.is_active ? -1 : 1
        }
        return left.full_name.localeCompare(right.full_name, 'tr')
      })
  }, [departmentId, deferredEmployeeQuery, employeesQuery.data, includeInactive, regionId])

  useEffect(() => {
    if (!filteredEmployees.length) {
      if (selectedEmployeeId) {
        setSelectedEmployeeId('')
      }
      return
    }
    const stillVisible = filteredEmployees.some((employee) => String(employee.id) === selectedEmployeeId)
    if (!stillVisible) {
      setSelectedEmployeeId(String(filteredEmployees[0].id))
    }
  }, [filteredEmployees, selectedEmployeeId])

  const timelineQuery = useQuery({
    queryKey: ['location-monitor-timeline', selectedEmployeeId, startDate, endDate],
    queryFn: () =>
      getLocationMonitorEmployeeTimeline(Number(selectedEmployeeId), {
        start_date: startDate,
        end_date: endDate,
      }),
    enabled: Boolean(selectedEmployeeId && startDate && endDate),
  })

  useEffect(() => {
    const days = timelineQuery.data?.days ?? []
    if (!days.length) {
      setSelectedDay(null)
      setFocusedPointId(null)
      return
    }
    const stillValid = selectedDay && days.some((day) => day.date === selectedDay)
    if (!stillValid) {
      setSelectedDay(days[0].date)
    }
    setFocusedPointId(null)
  }, [selectedDay, timelineQuery.data])

  const selectedEmployee = useMemo(
    () => filteredEmployees.find((employee) => String(employee.id) === selectedEmployeeId) ?? null,
    [filteredEmployees, selectedEmployeeId],
  )

  const selectedDayRecord = useMemo(
    () => timelineQuery.data?.days.find((day) => day.date === selectedDay) ?? null,
    [selectedDay, timelineQuery.data?.days],
  )

  const visiblePoints = useMemo(() => {
    const points = timelineQuery.data?.map_points ?? []
    const filtered = selectedDay ? points.filter((point) => point.day === selectedDay) : points
    return [...filtered].sort((left, right) => new Date(left.ts_utc).getTime() - new Date(right.ts_utc).getTime())
  }, [selectedDay, timelineQuery.data?.map_points])

  const highlightedPoint = useMemo(() => {
    if (!selectedDayRecord) {
      return timelineQuery.data?.summary.latest_location ?? null
    }
    return latestAvailablePoint(selectedDayRecord)
  }, [selectedDayRecord, timelineQuery.data?.summary.latest_location])

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white px-5 py-5 shadow-sm sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">Log Merkezi</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">Log</h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Ana panelden ayrilan bu ekran, uygulama girisi-cikisi, mesai baslangici-bitisi, son konum ve gunluk fazla
              mesai akisini tek yerde toplar.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/management-console"
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Ana panele don
            </Link>
            {selectedEmployee ? (
              <Link
                to={`/employees/${selectedEmployee.id}`}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
              >
                Personel dosyasini ac
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <aside className="space-y-4">
          <article className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Filtre Merkezi</p>
              <h3 className="mt-1 text-lg font-semibold text-slate-900">Ekip ve tarih kapsamı</h3>
            </div>
            <div className="space-y-4">
              <EmployeeAutocompleteField
                label="Calisan sec"
                employees={filteredEmployees}
                value={selectedEmployeeId}
                onChange={setSelectedEmployeeId}
                helperText="Secilen kisi icin gun gun konum izi ve mesai akisi gelir."
              />
              <label className="block text-sm text-slate-700">
                Calisan ara
                <input
                  value={employeeQuery}
                  onChange={(event) => setEmployeeQuery(event.target.value)}
                  placeholder="Ad, soyad veya #ID"
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <label className="block text-sm text-slate-700">
                  Bolge
                  <select
                    value={regionId}
                    onChange={(event) => setRegionId(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
                  >
                    <option value="">Tum bolgeler</option>
                    {(regionsQuery.data ?? []).map((region) => (
                      <option key={region.id} value={region.id}>
                        {region.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm text-slate-700">
                  Departman
                  <select
                    value={departmentId}
                    onChange={(event) => setDepartmentId(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
                  >
                    <option value="">Tum departmanlar</option>
                    {(departmentsQuery.data ?? []).map((department) => (
                      <option key={department.id} value={department.id}>
                        {department.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <label className="block text-sm text-slate-700">
                  Baslangic
                  <input
                    type="date"
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
                  />
                </label>
                <label className="block text-sm text-slate-700">
                  Bitis
                  <input
                    type="date"
                    value={endDate}
                    min={startDate || undefined}
                    onChange={(event) => setEndDate(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
                  />
                </label>
              </div>
              <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={includeInactive}
                  onChange={(event) => setIncludeInactive(event.target.checked)}
                  className="rounded border-slate-300"
                />
                Pasif calisanlari da goster
              </label>
            </div>
          </article>

          <article className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Calisan Listesi</p>
                <h3 className="mt-1 text-lg font-semibold text-slate-900">{filteredEmployees.length} kayit</h3>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                Canli secim
              </span>
            </div>
            <div className="max-h-[34rem] space-y-2 overflow-y-auto pr-1">
              {employeesQuery.isLoading ? (
                <LoadingBlock label="Calisan listesi yukleniyor..." />
              ) : filteredEmployees.length ? (
                filteredEmployees.map((employee) => (
                  <button
                    key={employee.id}
                    type="button"
                    onClick={() => setSelectedEmployeeId(String(employee.id))}
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                      String(employee.id) === selectedEmployeeId
                        ? 'border-sky-400 bg-sky-50 shadow-sm'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <strong className="block text-sm text-slate-900">{employee.full_name}</strong>
                        <p className="mt-1 text-xs text-slate-500">
                          #{employee.id} · {employee.region_name ?? 'Bolge yok'}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                          employee.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {employee.is_active ? 'Aktif' : 'Pasif'}
                      </span>
                    </div>
                  </button>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
                  Filtrelere uyan calisan bulunamadi.
                </div>
              )}
            </div>
          </article>
        </aside>

        <div className="space-y-6">
          {timelineQuery.isLoading ? <LoadingBlock label="Konum zamani akisi hazirlaniyor..." /> : null}
          {timelineQuery.isError ? <ErrorBlock message="Konum izleme verisi alinamadi." /> : null}

          {timelineQuery.data ? (
            <>
              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                      Secili Personel
                    </p>
                    <h3 className="mt-1 text-2xl font-semibold text-slate-900">
                      {timelineQuery.data.summary.employee.full_name}
                    </h3>
                    <p className="mt-1 text-sm text-slate-600">
                      #{timelineQuery.data.summary.employee.id} · {timelineQuery.data.summary.department_name ?? 'Departman yok'} ·{' '}
                      {timelineQuery.data.summary.region_name ?? 'Bolge yok'}
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-2xl bg-slate-950 px-4 py-3 text-white">
                      <span className="text-xs uppercase tracking-[0.18em] text-slate-300">Bugun</span>
                      <div className="mt-2 text-lg font-semibold">
                        <MinuteDisplay minutes={timelineQuery.data.summary.worked_today_minutes} />
                      </div>
                    </div>
                    <div className="rounded-2xl bg-slate-100 px-4 py-3 text-slate-900">
                      <span className="text-xs uppercase tracking-[0.18em] text-slate-500">Haftalik</span>
                      <div className="mt-2 text-lg font-semibold">
                        <MinuteDisplay minutes={timelineQuery.data.summary.weekly_total_minutes} />
                      </div>
                    </div>
                    <div className="rounded-2xl bg-sky-50 px-4 py-3 text-slate-900">
                      <span className="text-xs uppercase tracking-[0.18em] text-sky-700">Aralik fazla mesai</span>
                      <div className="mt-2 text-lg font-semibold">
                        <MinuteDisplay minutes={timelineQuery.data.totals.overtime_minutes} />
                      </div>
                    </div>
                    <div className="rounded-2xl bg-amber-50 px-4 py-3 text-slate-900">
                      <span className="text-xs uppercase tracking-[0.18em] text-amber-700">Fazla mesai gunu</span>
                      <div className="mt-2 text-lg font-semibold">{timelineQuery.data.totals.overtime_day_count}</div>
                    </div>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <article className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <span className="text-xs uppercase tracking-[0.18em] text-slate-500">Son mesai girisi</span>
                    <strong className="mt-2 block text-sm text-slate-900">
                      {formatDateTime(timelineQuery.data.summary.last_checkin_utc)}
                    </strong>
                  </article>
                  <article className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <span className="text-xs uppercase tracking-[0.18em] text-slate-500">Son mesai cikisi</span>
                    <strong className="mt-2 block text-sm text-slate-900">
                      {formatDateTime(timelineQuery.data.summary.last_checkout_utc)}
                    </strong>
                  </article>
                  <article className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <span className="text-xs uppercase tracking-[0.18em] text-slate-500">Son uygulama girisi</span>
                    <strong className="mt-2 block text-sm text-slate-900">
                      {formatDateTime(timelineQuery.data.summary.last_app_open_utc)}
                    </strong>
                  </article>
                  <article className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <span className="text-xs uppercase tracking-[0.18em] text-slate-500">Son uygulama cikisi</span>
                    <strong className="mt-2 block text-sm text-slate-900">
                      {formatDateTime(timelineQuery.data.summary.last_app_close_utc)}
                    </strong>
                  </article>
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Son bilinen konum</p>
                    <strong className="mt-2 block text-base text-slate-900">
                      {highlightedPoint ? highlightedPoint.label : 'Konum kaydi yok'}
                    </strong>
                    <p className="mt-1 text-sm text-slate-600">
                      {highlightedPoint
                        ? `${highlightedPoint.lat.toFixed(5)}, ${highlightedPoint.lon.toFixed(5)}`
                        : 'Secili aralikta koordinat gelmedi.'}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Operasyon izi</p>
                    <strong className="mt-2 block text-base text-slate-900">
                      {timelineQuery.data.summary.active_devices}/{timelineQuery.data.summary.total_devices} aktif cihaz
                    </strong>
                    <p className="mt-1 text-sm text-slate-600">
                      Son aktivite: {formatDateTime(timelineQuery.data.summary.last_activity_utc)} · IP:{' '}
                      {timelineQuery.data.summary.recent_ip ?? '-'}
                    </p>
                  </div>
                </div>
              </section>

              <section className="grid gap-6 2xl:grid-cols-2">
                <article className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Standart Harita</p>
                      <h3 className="mt-1 text-lg font-semibold text-slate-900">
                        {selectedDay ? `${formatDay(selectedDay)} izi` : 'Secili aralik izi'}
                      </h3>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                      {visiblePoints.length} nokta
                    </span>
                  </div>
                  <LocationMonitorMap points={visiblePoints} focusedPointId={focusedPointId} />
                </article>

                <article className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">3D Izleme</p>
                      <h3 className="mt-1 text-lg font-semibold text-slate-900">Zaman ve hareket derinligi</h3>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                      Cok katmanli gorunum
                    </span>
                  </div>
                  <LocationMonitor3DView points={visiblePoints} />
                </article>
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Gunluk Olay Akisi</p>
                    <h3 className="mt-1 text-lg font-semibold text-slate-900">
                      {selectedDay ? `${formatDay(selectedDay)} hareketleri` : 'Gun secerek detay acin'}
                    </h3>
                  </div>
                  {selectedDay ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedDay(null)
                        setFocusedPointId(null)
                      }}
                      className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      Tum araligi goster
                    </button>
                  ) : null}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {visiblePoints.length ? (
                    visiblePoints.map((point) => (
                      <button
                        key={point.id}
                        type="button"
                        onClick={() => setFocusedPointId(point.id)}
                        className={`rounded-2xl border px-3 py-2 text-left transition ${
                          focusedPointId === point.id
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : `${pointTone(point.source)} hover:shadow-sm`
                        }`}
                      >
                        <strong className="block text-xs uppercase tracking-[0.18em]">
                          {pointSourceLabel(point.source)}
                        </strong>
                        <span className="mt-1 block text-sm font-semibold">{formatClock(point.ts_utc)}</span>
                      </button>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
                      Secili gunde konum izi bulunmuyor.
                    </div>
                  )}
                </div>
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Gun Gun Kayitlar</p>
                    <h3 className="mt-1 text-lg font-semibold text-slate-900">
                      Mesai giris-cikis, uygulama izi ve fazla mesai
                    </h3>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs font-semibold text-slate-500">
                    <span className="rounded-full bg-slate-100 px-3 py-1">
                      Toplam sure: <MinuteDisplay minutes={timelineQuery.data.totals.worked_minutes} />
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-1">
                      Plan ustu: <MinuteDisplay minutes={timelineQuery.data.totals.plan_overtime_minutes} />
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-1">
                      Yasal fazla: <MinuteDisplay minutes={timelineQuery.data.totals.legal_overtime_minutes} />
                    </span>
                  </div>
                </div>

                <div className="mt-5 overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                      <tr>
                        <th className="px-3 py-3">Gun</th>
                        <th className="px-3 py-3">Durum</th>
                        <th className="px-3 py-3">Mesai girisi</th>
                        <th className="px-3 py-3">Mesai cikisi</th>
                        <th className="px-3 py-3">App giris</th>
                        <th className="px-3 py-3">App cikis</th>
                        <th className="px-3 py-3">Son konum</th>
                        <th className="px-3 py-3">Calisilan</th>
                        <th className="px-3 py-3">Fazla mesai</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {timelineQuery.data.days.map((day) => {
                        const lastPoint = latestAvailablePoint(day)
                        const isSelected = day.date === selectedDay
                        return (
                          <tr
                            key={day.date}
                            className={`cursor-pointer transition hover:bg-slate-50 ${isSelected ? 'bg-sky-50/70' : 'bg-white'}`}
                            onClick={() => {
                              setSelectedDay(day.date)
                              setFocusedPointId(lastPoint?.id ?? null)
                            }}
                          >
                            <td className="px-3 py-3 align-top">
                              <strong className="block text-slate-900">{formatDay(day.date)}</strong>
                              <span className="text-xs text-slate-500">{day.date}</span>
                            </td>
                            <td className="px-3 py-3 align-top">
                              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                                {dayStatusLabel(day.status)}
                              </span>
                            </td>
                            <td className="px-3 py-3 align-top">{day.check_in ? formatClock(`${day.date}T${day.check_in}`) : '-'}</td>
                            <td className="px-3 py-3 align-top">{day.check_out ? formatClock(`${day.date}T${day.check_out}`) : '-'}</td>
                            <td className="px-3 py-3 align-top">{formatDateTime(day.first_app_open_utc)}</td>
                            <td className="px-3 py-3 align-top">{formatDateTime(day.last_app_close_utc)}</td>
                            <td className="px-3 py-3 align-top">
                              {lastPoint ? (
                                <div>
                                  <strong className="block text-slate-900">{pointSourceLabel(lastPoint.source)}</strong>
                                  <span className="text-xs text-slate-500">
                                    {lastPoint.lat.toFixed(4)}, {lastPoint.lon.toFixed(4)}
                                  </span>
                                </div>
                              ) : (
                                '-'
                              )}
                            </td>
                            <td className="px-3 py-3 align-top">
                              <MinuteDisplay minutes={day.worked_minutes} />
                            </td>
                            <td className="px-3 py-3 align-top">
                              <div className="flex flex-col">
                                <strong className="text-slate-900">
                                  <MinuteDisplay minutes={day.overtime_minutes} />
                                </strong>
                                <span className="text-xs text-slate-500">
                                  Yasal <MinuteDisplay minutes={day.legal_overtime_minutes} />
                                </span>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          ) : null}
        </div>
      </section>
    </div>
  )
}
