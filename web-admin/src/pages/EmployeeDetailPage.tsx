import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { z } from 'zod'

import {
  createDeviceInvite,
  getDepartmentShifts,
  getEmployeeDetail,
  getEmployeeLocation,
  getMonthlyEmployee,
  updateEmployeeActive,
  updateEmployeeShift,
  upsertEmployeeLocation,
} from '../api/admin'
import { parseApiError } from '../api/error'
import { CopyField } from '../components/CopyField'
import { EmployeeLiveLocationMap, type EmployeeLiveLocationMapMarker } from '../components/EmployeeLiveLocationMap'
import { ErrorBlock } from '../components/ErrorBlock'
import { LoadingBlock } from '../components/LoadingBlock'
import { MinuteDisplay } from '../components/MinuteDisplay'
import { Modal } from '../components/Modal'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'
import { StatusBadge } from '../components/StatusBadge'
import { useToast } from '../hooks/useToast'
import type { MonthlyEmployeeDay } from '../types/api'

const locationSchema = z.object({
  home_lat: z.coerce.number().min(-90),
  home_lon: z.coerce.number().min(-180),
  radius_m: z.coerce.number().int().positive().max(2000),
})

const inviteSchema = z.object({
  expires_in_minutes: z.coerce.number().int().positive().max(1440),
})

function formatDateTime(value?: string | null): string {
  if (!value) {
    return '-'
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }
  return parsed.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })
}

function formatDayStatus(status: MonthlyEmployeeDay['status']): string {
  if (status === 'OK') return 'Tamam'
  if (status === 'INCOMPLETE') return 'Eksik'
  if (status === 'LEAVE') return 'Izinli'
  return 'Tatilde'
}

function formatCoordinate(lat: number | null, lon: number | null): string {
  if (lat === null || lon === null) {
    return '-'
  }
  return `${lat.toFixed(6)}, ${lon.toFixed(6)}`
}

export function EmployeeDetailPage() {
  const params = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { pushToast } = useToast()
  const now = new Date()

  const employeeId = Number(params.id)
  const isAllowedFromEmployees =
    Number.isFinite(employeeId) &&
    sessionStorage.getItem('employee-detail-origin') === 'employees' &&
    sessionStorage.getItem('employee-detail-id') === String(employeeId)

  const [homeLat, setHomeLat] = useState('41.0')
  const [homeLon, setHomeLon] = useState('29.0')
  const [radiusM, setRadiusM] = useState('120')
  const [formError, setFormError] = useState<string | null>(null)
  const [selectedShiftId, setSelectedShiftId] = useState('')

  const [selectedYear, setSelectedYear] = useState(String(now.getFullYear()))
  const [selectedMonth, setSelectedMonth] = useState(String(now.getMonth() + 1))
  const [selectedMapDay, setSelectedMapDay] = useState<string | null>(null)

  const [isInviteModalOpen, setInviteModalOpen] = useState(false)
  const [expiresInMinutes, setExpiresInMinutes] = useState('60')
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteToken, setInviteToken] = useState<string | null>(null)
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)

  const detailQuery = useQuery({
    queryKey: ['employee-detail', employeeId],
    queryFn: () => getEmployeeDetail(employeeId),
    enabled: Number.isFinite(employeeId),
  })

  const locationQuery = useQuery({
    queryKey: ['employee-location', employeeId],
    queryFn: () => getEmployeeLocation(employeeId),
    enabled: Number.isFinite(employeeId),
    retry: false,
  })

  const employee = detailQuery.data?.employee

  const shiftsQuery = useQuery({
    queryKey: ['department-shifts', employee?.department_id],
    queryFn: () =>
      getDepartmentShifts(
        employee?.department_id ? { department_id: employee.department_id, active_only: false } : undefined,
      ),
    enabled: Boolean(employee?.department_id),
  })

  const parsedYear = Number(selectedYear)
  const parsedMonth = Number(selectedMonth)
  const selectedMonthValid = Number.isFinite(parsedYear) && Number.isFinite(parsedMonth) && parsedMonth >= 1 && parsedMonth <= 12

  const monthlyQuery = useQuery({
    queryKey: ['employee-monthly', employeeId, parsedYear, parsedMonth],
    queryFn: () => getMonthlyEmployee({ employee_id: employeeId, year: parsedYear, month: parsedMonth }),
    enabled: Number.isFinite(employeeId) && selectedMonthValid,
  })

  const currentMonthQuery = useQuery({
    queryKey: ['employee-monthly-current', employeeId, now.getFullYear(), now.getMonth() + 1],
    queryFn: () =>
      getMonthlyEmployee({
        employee_id: employeeId,
        year: now.getFullYear(),
        month: now.getMonth() + 1,
      }),
    enabled: Number.isFinite(employeeId),
  })

  const locationMutation = useMutation({
    mutationFn: (payload: { home_lat: number; home_lon: number; radius_m: number }) =>
      upsertEmployeeLocation(employeeId, payload),
    onSuccess: () => {
      setFormError(null)
      pushToast({
        variant: 'success',
        title: 'Ev konumu guncellendi',
        description: `Calisan #${employeeId} icin konum kaydedildi.`,
      })
      void queryClient.invalidateQueries({ queryKey: ['employee-location', employeeId] })
      void queryClient.invalidateQueries({ queryKey: ['employee-detail', employeeId] })
    },
    onError: (error) => {
      const message = parseApiError(error, 'Konum kaydedilemedi.').message
      setFormError(message)
      pushToast({
        variant: 'error',
        title: 'Konum kaydedilemedi',
        description: message,
      })
    },
  })

  const toggleActiveMutation = useMutation({
    mutationFn: (nextStatus: boolean) => updateEmployeeActive(employeeId, { is_active: nextStatus }),
    onSuccess: (updatedEmployee) => {
      pushToast({
        variant: 'success',
        title: updatedEmployee.is_active ? 'Calisan aktife alindi' : 'Calisan arsive alindi',
        description: `${updatedEmployee.full_name} icin durum guncellendi.`,
      })
      void queryClient.invalidateQueries({ queryKey: ['employees'] })
      void queryClient.invalidateQueries({ queryKey: ['employee-detail', employeeId] })
    },
    onError: (error) => {
      pushToast({
        variant: 'error',
        title: 'Durum guncellenemedi',
        description: parseApiError(error, 'Islem basarisiz.').message,
      })
    },
  })

  const updateShiftMutation = useMutation({
    mutationFn: (shiftId: number | null) => updateEmployeeShift(employeeId, { shift_id: shiftId }),
    onSuccess: (updatedEmployee) => {
      pushToast({
        variant: 'success',
        title: 'Vardiya atamasi guncellendi',
        description: `${updatedEmployee.full_name} icin vardiya kaydedildi.`,
      })
      void queryClient.invalidateQueries({ queryKey: ['employees'] })
      void queryClient.invalidateQueries({ queryKey: ['employee-detail', employeeId] })
      void queryClient.invalidateQueries({ queryKey: ['employee-monthly'] })
    },
    onError: (error) => {
      pushToast({
        variant: 'error',
        title: 'Vardiya atamasi basarisiz',
        description: parseApiError(error, 'Islem basarisiz.').message,
      })
    },
  })

  const inviteMutation = useMutation({
    mutationFn: createDeviceInvite,
    onSuccess: (result) => {
      setInviteError(null)
      setInviteToken(result.token)
      setInviteUrl(result.invite_url)
      pushToast({
        variant: 'success',
        title: 'Cihaz daveti olusturuldu',
        description: `Calisan #${employeeId} icin davet hazir.`,
      })
      void queryClient.invalidateQueries({ queryKey: ['employee-detail', employeeId] })
    },
    onError: (error) => {
      const message = parseApiError(error, 'Cihaz daveti olusturulamadi.').message
      setInviteError(message)
      pushToast({
        variant: 'error',
        title: 'Davet olusturulamadi',
        description: message,
      })
    },
  })

  useEffect(() => {
    if (locationQuery.data) {
      setHomeLat(String(locationQuery.data.home_lat))
      setHomeLon(String(locationQuery.data.home_lon))
      setRadiusM(String(locationQuery.data.radius_m))
    }
  }, [locationQuery.data])

  useEffect(() => {
    if (!employee) return
    setSelectedShiftId(employee.shift_id ? String(employee.shift_id) : '')
  }, [employee])

  useEffect(() => {
    if (!Number.isFinite(employeeId)) return
    if (isAllowedFromEmployees) return
    navigate('/employees', { replace: true })
  }, [employeeId, isAllowedFromEmployees, navigate])

  const copyText = async (text: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = text
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }
      pushToast({
        variant: 'success',
        title: 'Kopyalandi',
        description: 'Deger panoya kopyalandi.',
      })
    } catch {
      pushToast({
        variant: 'error',
        title: 'Kopyalanamadi',
        description: 'Tarayici kopyalama islemini engelledi.',
      })
    }
  }

  const onCreateInvite = () => {
    setInviteError(null)
    setInviteToken(null)
    setInviteUrl(null)
    setExpiresInMinutes('60')
    setInviteModalOpen(true)
  }

  const onInviteSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setInviteError(null)

    const parsed = inviteSchema.safeParse({
      expires_in_minutes: expiresInMinutes,
    })

    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'Sure alanini kontrol edin.'
      setInviteError(message)
      pushToast({
        variant: 'error',
        title: 'Form hatasi',
        description: message,
      })
      return
    }

    inviteMutation.mutate({
      employee_id: employeeId,
      expires_in_minutes: parsed.data.expires_in_minutes,
    })
  }

  const onLocationSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)

    const parsed = locationSchema.safeParse({
      home_lat: homeLat,
      home_lon: homeLon,
      radius_m: radiusM,
    })

    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'Konum alanlarini kontrol edin.'
      setFormError(message)
      pushToast({
        variant: 'error',
        title: 'Form hatasi',
        description: message,
      })
      return
    }

    locationMutation.mutate(parsed.data)
  }

  const monthlyRows = monthlyQuery.data?.days ?? []
  const ipSummaryRows = detailQuery.data?.ip_summary ?? []

  useEffect(() => {
    if (!selectedMapDay) {
      return
    }
    const stillExists = monthlyRows.some((item) => item.date === selectedMapDay)
    if (!stillExists) {
      setSelectedMapDay(null)
    }
  }, [monthlyRows, selectedMapDay])

  const selectedMapDayRow = useMemo(
    () => monthlyRows.find((item) => item.date === selectedMapDay) ?? null,
    [monthlyRows, selectedMapDay],
  )

  const mapMarkers = useMemo<EmployeeLiveLocationMapMarker[]>(() => {
    if (selectedMapDayRow) {
      const dayMarkers: EmployeeLiveLocationMapMarker[] = []
      if (selectedMapDayRow.in_lat !== null && selectedMapDayRow.in_lon !== null) {
        dayMarkers.push({
          id: `${selectedMapDayRow.date}-in`,
          lat: selectedMapDayRow.in_lat,
          lon: selectedMapDayRow.in_lon,
          label: `${selectedMapDayRow.date} - Mesai Baslangici`,
          kind: 'checkin',
        })
      }
      if (selectedMapDayRow.out_lat !== null && selectedMapDayRow.out_lon !== null) {
        dayMarkers.push({
          id: `${selectedMapDayRow.date}-out`,
          lat: selectedMapDayRow.out_lat,
          lon: selectedMapDayRow.out_lon,
          label: `${selectedMapDayRow.date} - Mesai Bitisi`,
          kind: 'checkout',
        })
      }
      if (dayMarkers.length) {
        return dayMarkers
      }
    }

    if (detailQuery.data?.latest_location) {
      return [
        {
          id: 'latest',
          lat: detailQuery.data.latest_location.lat,
          lon: detailQuery.data.latest_location.lon,
          label: 'Son bildirilen konum',
          kind: 'latest',
        },
      ]
    }
    return []
  }, [detailQuery.data?.latest_location, selectedMapDayRow])

  const focusDayOnMap = (day: MonthlyEmployeeDay, source: 'in' | 'out') => {
    const hasIn = day.in_lat !== null && day.in_lon !== null
    const hasOut = day.out_lat !== null && day.out_lon !== null
    const requestedExists = source === 'in' ? hasIn : hasOut
    if (!requestedExists) {
      pushToast({
        variant: 'info',
        title: 'Konum bulunamadi',
        description: `${day.date} icin secilen konum kaydi yok.`,
      })
      return
    }
    setSelectedMapDay(day.date)
  }

  const deviceCountText = useMemo(() => {
    const count = detailQuery.data?.devices.length ?? 0
    return `${count} cihaz`
  }, [detailQuery.data?.devices.length])

  if (!Number.isFinite(employeeId)) {
    return <ErrorBlock message="Gecersiz calisan id degeri." />
  }

  if (!isAllowedFromEmployees) {
    return <LoadingBlock />
  }

  if (detailQuery.isLoading) {
    return <LoadingBlock />
  }

  if (detailQuery.isError || !employee) {
    return <ErrorBlock message="Calisan kaydi bulunamadi." />
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Calisan Detayi #${employee.id}`}
        description={`${employee.full_name} icin puantaj, cihaz, aktivite ve konum bilgileri`}
        action={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                const nextStatus = !employee.is_active
                const confirmed = window.confirm(
                  nextStatus
                    ? `${employee.full_name} arsivden cikarilsin mi?`
                    : `${employee.full_name} arsivlensin mi?`,
                )
                if (!confirmed) return
                toggleActiveMutation.mutate(nextStatus)
              }}
              disabled={toggleActiveMutation.isPending}
              className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${
                employee.is_active ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'
              }`}
            >
              {employee.is_active ? 'Arsivle' : 'Arsivden Cikar'}
            </button>
            <button
              type="button"
              onClick={onCreateInvite}
              className="btn-primary rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
            >
              Cihaz Baglama Linki Olustur
            </button>
          </div>
        }
      />

      <Panel>
        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <p className="text-xs text-slate-500">Calisan</p>
            <p className="text-base font-semibold text-slate-900">{employee.full_name}</p>
            <p className="text-xs text-slate-500">ID: {employee.id}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Durum</p>
            <StatusBadge value={employee.is_active ? 'Aktif' : 'Pasif'} />
            <p className="mt-2 text-xs text-slate-500">Bolge: {employee.region_name ?? '-'}</p>
            <p className="text-xs text-slate-500">Departman ID: {employee.department_id ?? '-'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Son employee portal aktivitesi</p>
            <p className="text-sm font-medium text-slate-800">{formatDateTime(detailQuery.data?.last_portal_seen_utc)}</p>
            <p className="mt-2 text-xs text-slate-500">Cihaz sayisi: {deviceCountText}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Bu ay fazla mesai</p>
            <p className="text-lg font-semibold text-slate-900">
              <MinuteDisplay minutes={currentMonthQuery.data?.totals.overtime_minutes ?? 0} />
            </p>
            <p className="text-xs text-slate-500">
              {now.getFullYear()}-{String(now.getMonth() + 1).padStart(2, '0')}
            </p>
          </div>
        </div>
      </Panel>

      <Panel>
        <h4 className="text-base font-semibold text-slate-900">Vardiya Atamasi</h4>
        <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto] md:items-end">
          <label className="text-sm text-slate-700">
            Vardiya
            <select
              value={selectedShiftId}
              onChange={(event) => setSelectedShiftId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              disabled={!employee.department_id || shiftsQuery.isLoading}
            >
              <option value="">Atanmamis</option>
              {(shiftsQuery.data ?? []).map((shift) => (
                <option key={shift.id} value={shift.id}>
                  {shift.name} ({shift.start_time_local}-{shift.end_time_local})
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={updateShiftMutation.isPending || !employee.department_id}
            onClick={() => {
              const shiftId = selectedShiftId ? Number(selectedShiftId) : null
              updateShiftMutation.mutate(shiftId)
            }}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
          >
            {updateShiftMutation.isPending ? 'Kaydediliyor...' : 'Vardiya Ata'}
          </button>
        </div>
      </Panel>

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-base font-semibold text-slate-900">Aylik Puantaj</h4>
            <p className="text-xs text-slate-500">Aydan aya puantaj ve secili ay fazla mesai durumunu inceleyin.</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-slate-600">
              Yil
              <input
                type="number"
                value={selectedYear}
                onChange={(event) => setSelectedYear(event.target.value)}
                className="mt-1 w-28 rounded-lg border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs text-slate-600">
              Ay
              <input
                type="number"
                min={1}
                max={12}
                value={selectedMonth}
                onChange={(event) => setSelectedMonth(event.target.value)}
                className="mt-1 w-20 rounded-lg border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
          </div>
        </div>

        {!selectedMonthValid ? (
          <p className="mt-3 text-sm text-amber-700">Yil/ay degeri gecersiz.</p>
        ) : monthlyQuery.isLoading ? (
          <LoadingBlock />
        ) : monthlyQuery.isError ? (
          <ErrorBlock message={parseApiError(monthlyQuery.error, 'Aylik puantaj alinamadi.').message} />
        ) : (
          <div className="mt-4 space-y-3">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs text-slate-500">Secili ay net calisma</p>
                <p className="text-lg font-semibold text-slate-900">
                  <MinuteDisplay minutes={monthlyQuery.data?.totals.worked_minutes ?? 0} />
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs text-slate-500">Secili ay fazla mesai</p>
                <p className="text-lg font-semibold text-slate-900">
                  <MinuteDisplay minutes={monthlyQuery.data?.totals.overtime_minutes ?? 0} />
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs text-slate-500">Eksik gun</p>
                <p className="text-lg font-semibold text-slate-900">{monthlyQuery.data?.totals.incomplete_days ?? 0}</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2">Tarih</th>
                    <th className="py-2">Durum</th>
                    <th className="py-2">Giris</th>
                    <th className="py-2">Cikis</th>
                    <th className="py-2">Giris Konum (lat/lon)</th>
                    <th className="py-2">Cikis Konum (lat/lon)</th>
                    <th className="py-2">Net Sure</th>
                    <th className="py-2">Fazla Mesai</th>
                    <th className="py-2">Bayraklar</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyRows.map((day) => (
                    <tr key={day.date} className="border-t border-slate-100">
                      <td className="py-2">{day.date}</td>
                      <td className="py-2">{formatDayStatus(day.status)}</td>
                      <td className="py-2">{formatDateTime(day.in)}</td>
                      <td className="py-2">{formatDateTime(day.out)}</td>
                      <td className="py-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs">{formatCoordinate(day.in_lat, day.in_lon)}</span>
                          {day.in_lat !== null && day.in_lon !== null ? (
                            <button
                              type="button"
                              className="rounded-md border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                              onClick={() => focusDayOnMap(day, 'in')}
                              title="Mesai baslangic konumunu haritada goster"
                            >
                              Check
                            </button>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs">{formatCoordinate(day.out_lat, day.out_lon)}</span>
                          {day.out_lat !== null && day.out_lon !== null ? (
                            <button
                              type="button"
                              className="rounded-md border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                              onClick={() => focusDayOnMap(day, 'out')}
                              title="Mesai bitis konumunu haritada goster"
                            >
                              Check
                            </button>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-2">
                        <MinuteDisplay minutes={day.worked_minutes} />
                      </td>
                      <td className="py-2">
                        <MinuteDisplay minutes={day.overtime_minutes} />
                      </td>
                      <td className="py-2 text-xs text-slate-600">{day.flags.length ? day.flags.join(', ') : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Panel>

      <Panel>
        <h4 className="text-base font-semibold text-slate-900">Kayitli Cihazlar ve IP Bilgisi</h4>
        <p className="mt-1 text-xs text-slate-500">Cihazlar, son attendance zamani ve son gorulen IP bilgisi.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2">Cihaz ID</th>
                <th className="py-2">Parmak Izi</th>
                <th className="py-2">Durum</th>
                <th className="py-2">Olusma</th>
                <th className="py-2">Son Attendance</th>
                <th className="py-2">Son Gorulen IP</th>
                <th className="py-2">Son Islem Zamani</th>
              </tr>
            </thead>
            <tbody>
              {(detailQuery.data?.devices ?? []).map((device) => (
                <tr key={device.id} className="border-t border-slate-100">
                  <td className="py-2">{device.id}</td>
                  <td className="py-2 font-mono text-xs">{device.device_fingerprint}</td>
                  <td className="py-2">
                    <StatusBadge value={device.is_active ? 'Aktif' : 'Pasif'} />
                  </td>
                  <td className="py-2">{formatDateTime(device.created_at)}</td>
                  <td className="py-2">{formatDateTime(device.last_attendance_ts_utc)}</td>
                  <td className="py-2">{device.last_seen_ip ?? '-'}</td>
                  <td className="py-2">{formatDateTime(device.last_seen_at_utc)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <Panel>
          <h4 className="text-base font-semibold text-slate-900">Employee Portal Aktivite Akisi</h4>
          <div className="mt-3 max-h-[420px] overflow-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2">Zaman</th>
                  <th className="py-2">Islem</th>
                  <th className="py-2">IP</th>
                  <th className="py-2">User Agent</th>
                </tr>
              </thead>
              <tbody>
                {(detailQuery.data?.recent_activity ?? []).map((item, index) => (
                  <tr key={`${item.ts_utc}-${index}`} className="border-t border-slate-100">
                    <td className="py-2">{formatDateTime(item.ts_utc)}</td>
                    <td className="py-2">{item.action}</td>
                    <td className="py-2">{item.ip ?? '-'}</td>
                    <td className="py-2 max-w-[280px] truncate" title={item.user_agent ?? '-'}>
                      {item.user_agent ?? '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel>
          <h4 className="text-base font-semibold text-slate-900">Cihaz IP Ozeti</h4>
          <p className="mt-1 text-xs text-slate-500">IP, son gorulme zamani ve son bilinen konum bilgisi.</p>
          <div className="mt-3 max-h-[420px] overflow-auto rounded-lg border border-slate-200">
            {ipSummaryRows.length ? (
              <table className="min-w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2">IP</th>
                    <th className="py-2">Son gorulme</th>
                    <th className="py-2">Aksiyon</th>
                    <th className="py-2">Son konum (lat/lon)</th>
                    <th className="py-2">Konum zamani</th>
                  </tr>
                </thead>
                <tbody>
                  {ipSummaryRows.map((item) => (
                    <tr key={item.ip} className="border-t border-slate-100">
                      <td className="py-2 font-mono text-xs">{item.ip}</td>
                      <td className="py-2">{formatDateTime(item.last_seen_at_utc)}</td>
                      <td className="py-2">{item.last_action}</td>
                      <td className="py-2">
                        {item.last_lat !== null && item.last_lon !== null
                          ? `${item.last_lat.toFixed(6)}, ${item.last_lon.toFixed(6)}`
                          : '-'}
                      </td>
                      <td className="py-2">
                        {item.last_location_ts_utc ? formatDateTime(item.last_location_ts_utc) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="p-3 text-sm text-slate-500">IP kaydi bulunamadi.</div>
            )}
          </div>
        </Panel>
      </div>

      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h4 className="text-base font-semibold text-slate-900">Konum Haritasi</h4>
          {selectedMapDay ? (
            <button
              type="button"
              onClick={() => setSelectedMapDay(null)}
              className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Son bildirilen konuma don
            </button>
          ) : null}
        </div>
        {selectedMapDayRow ? (
          <p className="mt-2 text-sm text-slate-700">
            Harita secimi: <span className="font-semibold">{selectedMapDayRow.date}</span> gununun giris/cikis konumlari
          </p>
        ) : detailQuery.data?.latest_location ? (
          <p className="mt-2 text-sm text-slate-700">Harita secimi: son bildirilen konum</p>
        ) : (
          <p className="mt-2 text-sm text-slate-500">Calisan icin konum verisi henuz yok.</p>
        )}
        {mapMarkers.length ? (
          <div className="mt-3 space-y-3">
            <EmployeeLiveLocationMap markers={mapMarkers} />
            <div className="flex flex-wrap gap-3 text-xs text-slate-700">
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1">
                <span className="h-2 w-2 rounded-full bg-emerald-600" />
                Mesai baslangici
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3 py-1">
                <span className="h-2 w-2 rounded-full bg-rose-600" />
                Mesai bitisi
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1">
                <span className="h-2 w-2 rounded-full bg-sky-700" />
                Son bildirilen konum
              </span>
            </div>
          </div>
        ) : null}
      </Panel>

      <Panel>
        <h4 className="text-base font-semibold text-slate-900">Ev Konumu</h4>
        <p className="mt-1 text-xs text-slate-500">
          Check-in konum dogrulamasi icin enlem, boylam ve yaricap metre bilgisini girin.
        </p>
        {locationQuery.isError ? (
          <p className="mt-2 text-sm text-amber-700">Kayitli konum bulunamadi. Ilk kaydi olusturabilirsiniz.</p>
        ) : null}

        <form onSubmit={onLocationSubmit} className="mt-4 grid gap-3 md:grid-cols-3">
          <label className="text-sm text-slate-700">
            Ev Enlem (Lat)
            <input
              value={homeLat}
              onChange={(event) => setHomeLat(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="text-sm text-slate-700">
            Ev Boylam (Lon)
            <input
              value={homeLon}
              onChange={(event) => setHomeLon(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="text-sm text-slate-700">
            Yaricap (metre)
            <input
              value={radiusM}
              onChange={(event) => setRadiusM(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <div className="md:col-span-3">
            <button
              type="submit"
              disabled={locationMutation.isPending}
              className="btn-primary rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {locationMutation.isPending ? (
                <>
                  <span className="inline-spinner" aria-hidden="true" />
                  Kaydediliyor...
                </>
              ) : locationQuery.data ? (
                'Konumu Guncelle'
              ) : (
                'Konumu Kaydet'
              )}
            </button>
          </div>
        </form>

        {formError ? <p className="form-validation">{formError}</p> : null}
      </Panel>

      <Modal open={isInviteModalOpen} title="Cihaz Baglama Linki Olustur" onClose={() => setInviteModalOpen(false)}>
        <form onSubmit={onInviteSubmit} className="space-y-4">
          <label className="block text-sm text-slate-700">
            Gecerlilik Suresi (dakika)
            <input
              value={expiresInMinutes}
              onChange={(event) => setExpiresInMinutes(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <button
            type="submit"
            disabled={inviteMutation.isPending}
            className="btn-primary rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {inviteMutation.isPending ? (
              <>
                <span className="inline-spinner" aria-hidden="true" />
                Olusturuluyor...
              </>
            ) : (
              'Daveti Uret'
            )}
          </button>
        </form>

        <p className="mt-3 text-xs text-slate-500">
          Bu linki calisana iletin. Calisan linki acinca cihazini otomatik olarak hesabina baglayabilir.
        </p>

        {inviteError ? <p className="form-validation">{inviteError}</p> : null}

        {inviteToken && inviteUrl ? (
          <div className="mt-4 space-y-3">
            <CopyField label="Token" value={inviteToken} onCopy={copyText} />
            <CopyField label="Baglanti Linki (invite_url)" value={inviteUrl} onCopy={copyText} />
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
