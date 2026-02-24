import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import {
  createDeviceInvite,
  getAttendanceEvents,
  getDashboardEmployeeSnapshot,
  getDepartments,
  getDevices,
  getEmployees,
  getLeaves,
} from '../api/admin'
import { getApiErrorMessage } from '../api/error'
import { EmployeeAutocompleteField } from '../components/EmployeeAutocompleteField'
import { ErrorBlock } from '../components/ErrorBlock'
import { LoadingBlock } from '../components/LoadingBlock'
import { MinuteDisplay } from '../components/MinuteDisplay'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'

const inviteSchema = z.object({
  employee_id: z.coerce.number().int().positive(),
  expires_in_minutes: z.coerce.number().int().positive().max(1440),
})

function dt(value: string | null | undefined): string {
  if (!value) return '-'
  return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function monthLabel(year: number, month: number): string {
  const monthName = new Intl.DateTimeFormat('tr-TR', { month: 'long' }).format(new Date(Date.UTC(year, month - 1, 1)))
  return `${monthName} ${year}`
}

function todayStatusClass(status: 'NOT_STARTED' | 'IN_PROGRESS' | 'FINISHED'): string {
  if (status === 'FINISHED') return 'status-badge status-badge-ok'
  if (status === 'IN_PROGRESS') return 'status-badge status-badge-pending'
  return 'status-badge status-badge-neutral'
}

export function DashboardPage() {
  const queryClient = useQueryClient()

  const [employeeTargetId, setEmployeeTargetId] = useState('')
  const [expiresInMinutes, setExpiresInMinutes] = useState('30')
  const [inviteResult, setInviteResult] = useState<{ token: string; invite_url: string } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const departmentsQuery = useQuery({ queryKey: ['departments'], queryFn: getDepartments })
  const employeesQuery = useQuery({ queryKey: ['employees'], queryFn: () => getEmployees({ status: 'active' }) })
  const devicesQuery = useQuery({ queryKey: ['devices'], queryFn: getDevices })
  const leavesQuery = useQuery({ queryKey: ['leaves', 'dashboard'], queryFn: () => getLeaves({}) })
  const eventsQuery = useQuery({
    queryKey: ['attendance-events', 'dashboard'],
    queryFn: () => getAttendanceEvents({ limit: 8 }),
  })

  const snapshotQuery = useQuery({
    queryKey: ['dashboard-employee-snapshot', employeeTargetId],
    queryFn: () => getDashboardEmployeeSnapshot({ employee_id: Number(employeeTargetId) }),
    enabled: Boolean(employeeTargetId),
    staleTime: 20_000,
  })

  const inviteMutation = useMutation({
    mutationFn: createDeviceInvite,
    onSuccess: (data) => {
      setInviteResult({ token: data.token, invite_url: data.invite_url })
      setActionError(null)
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
    },
    onError: (error) => {
      setActionError(getApiErrorMessage(error, 'Claim token olusturulamadi.'))
    },
  })

  const createInvite = () => {
    setInviteResult(null)
    setActionError(null)

    const parsed = inviteSchema.safeParse({
      employee_id: employeeTargetId,
      expires_in_minutes: expiresInMinutes,
    })

    if (!parsed.success) {
      setActionError(parsed.error.issues[0]?.message ?? 'Form alanlarini kontrol et.')
      return
    }

    inviteMutation.mutate(parsed.data)
  }

  const departments = departmentsQuery.data ?? []
  const employees = employeesQuery.data ?? []
  const devices = devicesQuery.data ?? []
  const leaves = leavesQuery.data ?? []
  const events = eventsQuery.data ?? []

  const selectedEmployee = useMemo(
    () => employees.find((item) => String(item.id) === employeeTargetId) ?? null,
    [employees, employeeTargetId],
  )

  if (
    departmentsQuery.isLoading ||
    employeesQuery.isLoading ||
    devicesQuery.isLoading ||
    leavesQuery.isLoading ||
    eventsQuery.isLoading
  ) {
    return <LoadingBlock />
  }

  if (
    departmentsQuery.isError ||
    employeesQuery.isError ||
    devicesQuery.isError ||
    leavesQuery.isError ||
    eventsQuery.isError
  ) {
    return <ErrorBlock message="Dashboard verileri alinamadi." />
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Genel Bakis"
        description="Calisan odakli claim token operasyonu ve anlik puantaj gorunumu."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Panel>
          <p className="text-sm text-slate-500">Departman</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{departments.length}</p>
        </Panel>
        <Panel>
          <p className="text-sm text-slate-500">Calisan</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{employees.length}</p>
        </Panel>
        <Panel>
          <p className="text-sm text-slate-500">Cihaz</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{devices.length}</p>
        </Panel>
        <Panel>
          <p className="text-sm text-slate-500">Izin Kaydi</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{leaves.length}</p>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.05fr_1.3fr]">
        <Panel>
          <h4 className="text-base font-semibold text-slate-900">Claim Token Uretimi</h4>
          <p className="mt-1 text-xs text-slate-500">Calisan adi veya ID secip employee claim URL olustur.</p>

          <div className="mt-4 space-y-3">
            <EmployeeAutocompleteField
              label="Calisan"
              employees={employees}
              value={employeeTargetId}
              onChange={setEmployeeTargetId}
              placeholder="Calisan adi veya #ID"
              helperText="Tek bir calisan secildiginde dashboard ozet kartlari otomatik dolar."
            />

            <label className="text-sm text-slate-700">
              Token suresi (dakika)
              <input
                value={expiresInMinutes}
                onChange={(event) => setExpiresInMinutes(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                placeholder="30"
              />
            </label>
          </div>

          {selectedEmployee ? (
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              <p>Secili: #{selectedEmployee.id} - {selectedEmployee.full_name}</p>
              <p>Departman: {selectedEmployee.department_id ?? '-'}</p>
            </div>
          ) : null}

          <button
            type="button"
            onClick={createInvite}
            disabled={inviteMutation.isPending || !employeeTargetId}
            className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {inviteMutation.isPending ? 'Olusturuluyor...' : 'Claim Token Olustur'}
          </button>

          {inviteResult ? (
            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
              <p className="font-semibold">Token: {inviteResult.token}</p>
              <p className="mt-1 break-all">URL: {inviteResult.invite_url}</p>
            </div>
          ) : null}
          {actionError ? <div className="form-validation">{actionError}</div> : null}
        </Panel>

        <Panel>
          <h4 className="text-base font-semibold text-slate-900">Calisan Canli Ozet</h4>

          {!employeeTargetId ? (
            <p className="mt-3 text-sm text-slate-500">Bir calisan secildiginde bu ay/gecen ay mesai, cihaz ve konum bilgisi gorunur.</p>
          ) : null}
          {employeeTargetId && snapshotQuery.isLoading ? <LoadingBlock label="Calisan ozeti yukleniyor..." /> : null}
          {employeeTargetId && snapshotQuery.isError ? <ErrorBlock message="Calisan ozeti alinamadi." /> : null}

          {snapshotQuery.data ? (
            <div className="mt-3 space-y-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className={todayStatusClass(snapshotQuery.data.today_status)}>{snapshotQuery.data.today_status}</span>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700">
                  Aktif cihaz: {snapshotQuery.data.active_devices}/{snapshotQuery.data.total_devices}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700">
                  Son guncelleme: {dt(snapshotQuery.data.generated_at_utc)}
                </span>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">{monthLabel(snapshotQuery.data.current_month.year, snapshotQuery.data.current_month.month)}</p>
                  <p className="mt-2 text-xs text-slate-600">Toplam net sure: <MinuteDisplay minutes={snapshotQuery.data.current_month.worked_minutes} /></p>
                  <p className="mt-1 text-xs text-slate-600">Plan ustu sure: <MinuteDisplay minutes={snapshotQuery.data.current_month.plan_overtime_minutes} /></p>
                  <p className="mt-1 text-xs text-slate-600">Yasal fazla sure: <MinuteDisplay minutes={snapshotQuery.data.current_month.extra_work_minutes} /></p>
                  <p className="mt-1 text-xs text-slate-600">Yasal fazla mesai: <MinuteDisplay minutes={snapshotQuery.data.current_month.overtime_minutes} /></p>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">{monthLabel(snapshotQuery.data.previous_month.year, snapshotQuery.data.previous_month.month)}</p>
                  <p className="mt-2 text-xs text-slate-600">Toplam net sure: <MinuteDisplay minutes={snapshotQuery.data.previous_month.worked_minutes} /></p>
                  <p className="mt-1 text-xs text-slate-600">Plan ustu sure: <MinuteDisplay minutes={snapshotQuery.data.previous_month.plan_overtime_minutes} /></p>
                  <p className="mt-1 text-xs text-slate-600">Yasal fazla sure: <MinuteDisplay minutes={snapshotQuery.data.previous_month.extra_work_minutes} /></p>
                  <p className="mt-1 text-xs text-slate-600">Yasal fazla mesai: <MinuteDisplay minutes={snapshotQuery.data.previous_month.overtime_minutes} /></p>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Son Puantaj Olayi</p>
                  {snapshotQuery.data.last_event ? (
                    <>
                      <p className="mt-2 text-xs text-slate-700">Tip: {snapshotQuery.data.last_event.event_type}</p>
                      <p className="mt-1 text-xs text-slate-700">Zaman: {dt(snapshotQuery.data.last_event.ts_utc)}</p>
                      <p className="mt-1 text-xs text-slate-700">Konum: {snapshotQuery.data.last_event.location_status}</p>
                    </>
                  ) : (
                    <p className="mt-2 text-xs text-slate-500">Kayit bulunamadi.</p>
                  )}
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Son Konum</p>
                  {snapshotQuery.data.latest_location ? (
                    <>
                      <p className="mt-2 text-xs text-slate-700">Lat/Lon: {snapshotQuery.data.latest_location.lat.toFixed(6)}, {snapshotQuery.data.latest_location.lon.toFixed(6)}</p>
                      <p className="mt-1 text-xs text-slate-700">Zaman: {dt(snapshotQuery.data.latest_location.ts_utc)}</p>
                    </>
                  ) : (
                    <p className="mt-2 text-xs text-slate-500">Konum verisi yok.</p>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Cihazlar</p>
                {snapshotQuery.data.devices.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-500">Cihaz kaydi bulunamadi.</p>
                ) : (
                  <div className="mt-2 space-y-1 text-xs text-slate-700">
                    {snapshotQuery.data.devices.slice(0, 8).map((device) => (
                      <div key={device.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-100 px-2 py-1">
                        <span>#{device.id} - {device.device_fingerprint}</span>
                        <span className={device.is_active ? 'status-badge status-badge-ok' : 'status-badge status-badge-danger'}>
                          {device.is_active ? 'AKTIF' : 'PASIF'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </Panel>
      </div>

      <Panel>
        <h4 className="text-base font-semibold text-slate-900">Son Attendance Eventleri</h4>
        <div className="mt-4 list-scroll-area">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2">ID</th>
                <th className="py-2">Calisan</th>
                <th className="py-2">Tip</th>
                <th className="py-2">Durum</th>
                <th className="py-2">Zaman</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-t border-slate-100">
                  <td className="py-2">{event.id}</td>
                  <td className="py-2">{event.employee_id}</td>
                  <td className="py-2">{event.type}</td>
                  <td className="py-2">{event.location_status}</td>
                  <td className="py-2">{dt(event.ts_utc)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}
