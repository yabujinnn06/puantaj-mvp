import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import { createDeviceInvite, getAttendanceEvents, getDepartments, getDevices, getEmployees, getLeaves } from '../api/admin'
import { getApiErrorMessage } from '../api/error'
import { ErrorBlock } from '../components/ErrorBlock'
import { LoadingBlock } from '../components/LoadingBlock'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'

const inviteSchema = z.object({
  employee_id: z.coerce.number().int().positive(),
  expires_in_minutes: z.coerce.number().int().positive().max(1440),
})

export function DashboardPage() {
  const queryClient = useQueryClient()

  const [employeeId, setEmployeeId] = useState('')
  const [expiresInMinutes, setExpiresInMinutes] = useState('60')
  const [inviteResult, setInviteResult] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const departmentsQuery = useQuery({ queryKey: ['departments'], queryFn: getDepartments })
  const employeesQuery = useQuery({ queryKey: ['employees'], queryFn: () => getEmployees() })
  const devicesQuery = useQuery({ queryKey: ['devices'], queryFn: getDevices })
  const leavesQuery = useQuery({ queryKey: ['leaves', 'dashboard'], queryFn: () => getLeaves({}) })
  const eventsQuery = useQuery({
    queryKey: ['attendance-events', 'dashboard'],
    queryFn: () => getAttendanceEvents({ limit: 8 }),
  })

  const inviteMutation = useMutation({
    mutationFn: createDeviceInvite,
    onSuccess: (data) => {
      setInviteResult(data.invite_url)
      setActionError(null)
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
    },
    onError: (error) => {
      setActionError(getApiErrorMessage(error, 'Device invite oluşturulamadı.'))
    },
  })

  const createInvite = () => {
    setInviteResult(null)
    setActionError(null)

    const parsed = inviteSchema.safeParse({
      employee_id: employeeId,
      expires_in_minutes: expiresInMinutes,
    })

    if (!parsed.success) {
      setActionError(parsed.error.issues[0]?.message ?? 'Invite formunu kontrol et.')
      return
    }

    inviteMutation.mutate(parsed.data)
  }

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
    return <ErrorBlock message="Dashboard verileri alınamadı." />
  }

  const departments = departmentsQuery.data ?? []
  const employees = employeesQuery.data ?? []
  const devices = devicesQuery.data ?? []
  const leaves = leavesQuery.data ?? []
  const events = eventsQuery.data ?? []

  const totalDepartments = departments.length
  const totalEmployees = employees.length
  const totalDevices = devices.length
  const totalLeaves = leaves.length

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description="Sistem özetini ve hızlı işlemleri bu ekrandan yönetebilirsin." />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Panel>
          <p className="text-sm text-slate-500">Departments</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{totalDepartments}</p>
        </Panel>
        <Panel>
          <p className="text-sm text-slate-500">Employees</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{totalEmployees}</p>
        </Panel>
        <Panel>
          <p className="text-sm text-slate-500">Devices</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{totalDevices}</p>
        </Panel>
        <Panel>
          <p className="text-sm text-slate-500">Leaves</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{totalLeaves}</p>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <h4 className="text-base font-semibold text-slate-900">Quick Device Invite</h4>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-slate-700">
              Employee ID
              <input
                value={employeeId}
                onChange={(event) => setEmployeeId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                placeholder="1"
              />
            </label>
            <label className="text-sm text-slate-700">
              Expires (minutes)
              <input
                value={expiresInMinutes}
                onChange={(event) => setExpiresInMinutes(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                placeholder="60"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={createInvite}
            disabled={inviteMutation.isPending}
            className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {inviteMutation.isPending ? 'Oluşturuluyor...' : 'Create Invite'}
          </button>

          {inviteResult ? (
            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
              Invite URL: {inviteResult}
            </div>
          ) : null}
          {actionError ? <div className="form-validation">{actionError}</div> : null}
        </Panel>

        <Panel>
          <h4 className="text-base font-semibold text-slate-900">Recent Attendance Events</h4>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2">ID</th>
                  <th className="py-2">Employee</th>
                  <th className="py-2">Type</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id} className="border-t border-slate-100">
                    <td className="py-2">{event.id}</td>
                    <td className="py-2">{event.employee_id}</td>
                    <td className="py-2">{event.type}</td>
                    <td className="py-2">{event.location_status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  )
}



