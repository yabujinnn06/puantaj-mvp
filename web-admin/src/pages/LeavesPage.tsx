import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import { createLeave, decideLeave, deleteLeave, getEmployees, getLeaves } from '../api/admin'
import { parseApiError } from '../api/error'
import { EmployeeAutocompleteField } from '../components/EmployeeAutocompleteField'
import { ErrorBlock } from '../components/ErrorBlock'
import { LoadingBlock } from '../components/LoadingBlock'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'
import { StatusBadge } from '../components/StatusBadge'
import { useToast } from '../hooks/useToast'

const leaveSchema = z
  .object({
    employee_id: z.coerce.number().int().positive(),
    start_date: z.string().min(1),
    end_date: z.string().min(1),
    type: z.enum(['ANNUAL', 'SICK', 'UNPAID', 'EXCUSE', 'PUBLIC_HOLIDAY']),
    status: z.enum(['APPROVED', 'PENDING', 'REJECTED']).default('APPROVED'),
    note: z.string().trim().optional(),
  })
  .refine((data) => data.end_date >= data.start_date, {
    message: 'Bitis tarihi baslangic tarihinden kucuk olamaz.',
    path: ['end_date'],
  })

const leaveTypeLabels: Record<'ANNUAL' | 'SICK' | 'UNPAID' | 'EXCUSE' | 'PUBLIC_HOLIDAY', string> = {
  ANNUAL: 'YILLIK IZIN',
  SICK: 'RAPOR / HASTALIK',
  UNPAID: 'UCRETSIZ IZIN',
  EXCUSE: 'MAZERET IZNI',
  PUBLIC_HOLIDAY: 'RESMI TATIL',
}

export function LeavesPage() {
  const queryClient = useQueryClient()
  const { pushToast } = useToast()

  const [employeeId, setEmployeeId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [leaveType, setLeaveType] = useState<'ANNUAL' | 'SICK' | 'UNPAID' | 'EXCUSE' | 'PUBLIC_HOLIDAY'>('ANNUAL')
  const [leaveStatus, setLeaveStatus] = useState<'APPROVED' | 'PENDING' | 'REJECTED'>('APPROVED')
  const [note, setNote] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const [filterEmployeeId, setFilterEmployeeId] = useState('')
  const [filterYear, setFilterYear] = useState(String(new Date().getFullYear()))
  const [filterMonth, setFilterMonth] = useState(String(new Date().getMonth() + 1))
  const [filterStatus, setFilterStatus] = useState<'all' | 'APPROVED' | 'PENDING' | 'REJECTED'>('all')
  const [decisionNotes, setDecisionNotes] = useState<Record<number, string>>({})

  const employeesQuery = useQuery({
    queryKey: ['employees'],
    queryFn: () => getEmployees({ include_inactive: true, status: 'all' }),
  })

  const leaveFilter = useMemo(() => {
    const parsedEmployee = Number(filterEmployeeId)
    const parsedYear = Number(filterYear)
    const parsedMonth = Number(filterMonth)

    return {
      employee_id: Number.isFinite(parsedEmployee) && parsedEmployee > 0 ? parsedEmployee : undefined,
      year: Number.isFinite(parsedYear) && parsedYear > 0 ? parsedYear : undefined,
      month: Number.isFinite(parsedMonth) && parsedMonth > 0 ? parsedMonth : undefined,
      status: filterStatus === 'all' ? undefined : filterStatus,
    }
  }, [filterEmployeeId, filterMonth, filterStatus, filterYear])

  const leavesQuery = useQuery({
    queryKey: ['leaves', leaveFilter.employee_id ?? 'all', leaveFilter.year ?? 'all', leaveFilter.month ?? 'all', leaveFilter.status ?? 'all'],
    queryFn: () => getLeaves(leaveFilter),
  })

  const pendingRequestsQuery = useQuery({
    queryKey: ['leaves', 'pending-employee-requests'],
    queryFn: () => getLeaves({ status: 'PENDING', requested_by_employee: true }),
  })

  const createMutation = useMutation({
    mutationFn: createLeave,
    onSuccess: (leave) => {
      setStartDate('')
      setEndDate('')
      setLeaveType('ANNUAL')
      setLeaveStatus('APPROVED')
      setNote('')
      setFormError(null)
      pushToast({
        variant: 'success',
        title: 'Izin kaydi olusturuldu',
        description: `Izin #${leave.id} kaydedildi.`,
      })
      void queryClient.invalidateQueries({ queryKey: ['leaves'] })
    },
    onError: (error) => {
      const parsed = parseApiError(error, 'Izin kaydi olusturulamadi.')
      setFormError(parsed.message)
      pushToast({
        variant: 'error',
        title: 'Izin olusturulamadi',
        description: parsed.message,
      })
    },
  })

  const decisionMutation = useMutation({
    mutationFn: ({ leaveId, status, decision_note }: { leaveId: number; status: 'APPROVED' | 'REJECTED'; decision_note?: string | null }) =>
      decideLeave(leaveId, { status, decision_note }),
    onSuccess: (leave) => {
      setDecisionNotes((current) => {
        const next = { ...current }
        delete next[leave.id]
        return next
      })
      pushToast({
        variant: 'success',
        title: leave.status === 'APPROVED' ? 'Izin onaylandi' : 'Izin reddedildi',
        description: `Izin #${leave.id} guncellendi.`,
      })
      void queryClient.invalidateQueries({ queryKey: ['leaves'] })
    },
    onError: (error) => {
      const parsed = parseApiError(error, 'Izin talebi guncellenemedi.')
      pushToast({
        variant: 'error',
        title: 'Izin karari kaydedilemedi',
        description: parsed.message,
      })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteLeave,
    onSuccess: (_, leaveId) => {
      pushToast({
        variant: 'success',
        title: 'Izin kaydi silindi',
        description: `Izin #${leaveId} silindi.`,
      })
      void queryClient.invalidateQueries({ queryKey: ['leaves'] })
    },
    onError: (error) => {
      const parsed = parseApiError(error, 'Izin silinemedi.')
      pushToast({
        variant: 'error',
        title: 'Izin silinemedi',
        description: parsed.message,
      })
    },
  })

  const onCreateLeave = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)

    const parsed = leaveSchema.safeParse({
      employee_id: employeeId,
      start_date: startDate,
      end_date: endDate,
      type: leaveType,
      status: leaveStatus,
      note,
    })

    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'Izin formunu kontrol edin.'
      setFormError(message)
      pushToast({
        variant: 'error',
        title: 'Form hatasi',
        description: message,
      })
      return
    }

    createMutation.mutate({
      ...parsed.data,
      note: parsed.data.note || null,
    })
  }

  const updateDecisionNote = (leaveId: number, value: string) => {
    setDecisionNotes((current) => ({
      ...current,
      [leaveId]: value,
    }))
  }

  const handleDecision = (leaveId: number, status: 'APPROVED' | 'REJECTED') => {
    const decisionNote = decisionNotes[leaveId]?.trim() ?? ''
    if (status === 'REJECTED' && decisionNote.length < 3) {
      pushToast({
        variant: 'info',
        title: 'Ret sebebi gerekli',
        description: 'Izin reddederken en az 3 karakter aciklama girin.',
      })
      return
    }
    decisionMutation.mutate({
      leaveId,
      status,
      decision_note: decisionNote || null,
    })
  }

  if (employeesQuery.isLoading) {
    return <LoadingBlock />
  }

  if (employeesQuery.isError) {
    return <ErrorBlock message="Calisan listesi alinamadi." />
  }

  const employees = employeesQuery.data ?? []
  const leaveRows = leavesQuery.data ?? []
  const pendingLeaveRows = pendingRequestsQuery.data ?? []
  const employeeNameById = new Map(employees.map((employee) => [employee.id, employee.full_name]))
  const busyDecisionLeaveId = decisionMutation.isPending ? decisionMutation.variables?.leaveId ?? null : null

  return (
    <div className="space-y-4">
      <PageHeader title="Izin Kayitlari" description="Yillik izin, rapor ve mazeret kayitlarini yonetin." />

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-base font-semibold text-slate-900">Bekleyen Calisan Talepleri</h4>
            <p className="mt-1 text-sm text-slate-500">
              Employee uygulamasindan gelen izin taleplerini burada onaylayin veya reddedin.
            </p>
          </div>
          <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
            {pendingLeaveRows.length} bekleyen talep
          </span>
        </div>

        {pendingRequestsQuery.isLoading ? <LoadingBlock /> : null}
        {pendingRequestsQuery.isError ? <ErrorBlock message="Bekleyen izin talepleri alinamadi." /> : null}

        {!pendingRequestsQuery.isLoading && !pendingRequestsQuery.isError ? (
          pendingLeaveRows.length > 0 ? (
            <div className="mt-4 grid gap-3">
              {pendingLeaveRows.map((leave) => {
                const decisionNote = decisionNotes[leave.id] ?? ''
                const isBusy = busyDecisionLeaveId === leave.id
                return (
                  <article key={leave.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          #{leave.id} - {employeeNameById.get(leave.employee_id) ?? leave.employee_id}
                        </p>
                        <p className="mt-1 text-sm text-slate-600">
                          {leaveTypeLabels[leave.type]} | {leave.start_date} - {leave.end_date}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">Talep tarihi: {leave.created_at}</p>
                      </div>
                      <StatusBadge value={leave.status} />
                    </div>

                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Calisan Gerekcesi</p>
                        <p className="mt-2 text-sm text-slate-700">{leave.note || 'Aciklama girilmedi.'}</p>
                      </div>
                      <label className="text-sm text-slate-700">
                        Karar Notu
                        <textarea
                          value={decisionNote}
                          onChange={(event) => updateDecisionNote(leave.id, event.target.value)}
                          rows={3}
                          placeholder="Reddederken aciklama girin. Onay verirken opsiyonel."
                          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                        />
                      </label>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={decisionMutation.isPending}
                        onClick={() => handleDecision(leave.id, 'APPROVED')}
                        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                      >
                        {isBusy ? 'Kaydediliyor...' : 'Onayla'}
                      </button>
                      <button
                        type="button"
                        disabled={decisionMutation.isPending}
                        onClick={() => handleDecision(leave.id, 'REJECTED')}
                        className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                      >
                        {isBusy ? 'Kaydediliyor...' : 'Reddet'}
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">Bekleyen calisan izin talebi yok.</p>
          )
        ) : null}
      </Panel>

      <Panel>
        <h4 className="text-base font-semibold text-slate-900">Yeni Izin Kaydi</h4>
        <form onSubmit={onCreateLeave} className="mt-4 grid gap-3 md:grid-cols-3">
          <EmployeeAutocompleteField
            label="Calisan"
            employees={employees}
            value={employeeId}
            onChange={setEmployeeId}
            emptyLabel="Seciniz"
            helperText="Ad-soyad veya ID ile arayin."
          />

          <label className="text-sm text-slate-700">
            Baslangic Tarihi
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="text-sm text-slate-700">
            Bitis Tarihi
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="text-sm text-slate-700">
            Izin Tipi
            <select
              value={leaveType}
              onChange={(event) =>
                setLeaveType(event.target.value as 'ANNUAL' | 'SICK' | 'UNPAID' | 'EXCUSE' | 'PUBLIC_HOLIDAY')
              }
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="ANNUAL">YILLIK IZIN</option>
              <option value="SICK">RAPOR / HASTALIK</option>
              <option value="UNPAID">UCRETSIZ IZIN</option>
              <option value="EXCUSE">MAZERET IZNI</option>
              <option value="PUBLIC_HOLIDAY">RESMI TATIL</option>
            </select>
          </label>

          <label className="text-sm text-slate-700">
            Onay Durumu
            <select
              value={leaveStatus}
              onChange={(event) => setLeaveStatus(event.target.value as 'APPROVED' | 'PENDING' | 'REJECTED')}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="APPROVED">ONAYLI</option>
              <option value="PENDING">BEKLEMEDE</option>
              <option value="REJECTED">REDDEDILDI</option>
            </select>
          </label>

          <label className="text-sm text-slate-700 md:col-span-3">
            Aciklama Notu
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              rows={3}
            />
          </label>

          <div className="md:col-span-3">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="btn-primary rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {createMutation.isPending ? 'Kaydediliyor...' : 'Izin Kaydini Olustur'}
            </button>
          </div>
        </form>
        {formError ? <div className="form-validation">{formError}</div> : null}
      </Panel>

      <Panel>
        <h4 className="text-base font-semibold text-slate-900">Izin Listesi Filtreleri</h4>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <EmployeeAutocompleteField
            label="Calisan"
            employees={employees}
            value={filterEmployeeId}
            onChange={setFilterEmployeeId}
            emptyLabel="Tumu"
            helperText="Calisana gore filtreleyin."
          />

          <label className="text-sm text-slate-700">
            Yil
            <input
              value={filterYear}
              onChange={(event) => setFilterYear(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="text-sm text-slate-700">
            Ay
            <input
              value={filterMonth}
              onChange={(event) => setFilterMonth(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="text-sm text-slate-700">
            Durum
            <select
              value={filterStatus}
              onChange={(event) => setFilterStatus(event.target.value as 'all' | 'APPROVED' | 'PENDING' | 'REJECTED')}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="all">TUMU</option>
              <option value="APPROVED">ONAYLI</option>
              <option value="PENDING">BEKLEMEDE</option>
              <option value="REJECTED">REDDEDILDI</option>
            </select>
          </label>
        </div>
      </Panel>

      {leavesQuery.isLoading ? <LoadingBlock /> : null}
      {leavesQuery.isError ? <ErrorBlock message="Izin listesi alinamadi." /> : null}

      {!leavesQuery.isLoading && !leavesQuery.isError ? (
        <Panel>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2">Izin ID</th>
                  <th className="py-2">Calisan</th>
                  <th className="py-2">Kaynak</th>
                  <th className="py-2">Izin Tipi</th>
                  <th className="py-2">Tarih Araligi</th>
                  <th className="py-2">Talep Notu</th>
                  <th className="py-2">Karar Notu</th>
                  <th className="py-2">Durum</th>
                  <th className="py-2">Karar Zamani</th>
                  <th className="py-2">Islem</th>
                </tr>
              </thead>
              <tbody>
                {leaveRows.map((leave) => (
                  <tr key={leave.id} className="border-t border-slate-100">
                    <td className="py-2">{leave.id}</td>
                    <td className="py-2">{employeeNameById.get(leave.employee_id) ?? leave.employee_id}</td>
                    <td className="py-2">{leave.requested_by_employee ? 'Calisan talebi' : 'Admin kaydi'}</td>
                    <td className="py-2">{leaveTypeLabels[leave.type]}</td>
                    <td className="py-2">
                      {leave.start_date} - {leave.end_date}
                    </td>
                    <td className="py-2 text-slate-600">{leave.note || '-'}</td>
                    <td className="py-2 text-slate-600">{leave.decision_note || '-'}</td>
                    <td className="py-2">
                      <StatusBadge value={leave.status} />
                    </td>
                    <td className="py-2 text-xs text-slate-500">{leave.decided_at || '-'}</td>
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => deleteMutation.mutate(leave.id)}
                        className="btn-danger rounded-lg border border-rose-300 px-3 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50"
                      >
                        Sil
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {leaveRows.length === 0 ? <p className="mt-3 text-sm text-slate-500">Izin kaydi bulunamadi.</p> : null}
        </Panel>
      ) : null}
    </div>
  )
}
