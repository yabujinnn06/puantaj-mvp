import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import { createLeave, deleteLeave, getEmployees, getLeaves } from '../api/admin'
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
    message: 'Bitiş tarihi başlangıç tarihinden küçük olamaz.',
    path: ['end_date'],
  })

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

  const employeesQuery = useQuery({ queryKey: ['employees'], queryFn: () => getEmployees({ include_inactive: true, status: 'all' }) })

  const leaveFilter = useMemo(() => {
    const parsedEmployee = Number(filterEmployeeId)
    const parsedYear = Number(filterYear)
    const parsedMonth = Number(filterMonth)

    return {
      employee_id: Number.isFinite(parsedEmployee) && parsedEmployee > 0 ? parsedEmployee : undefined,
      year: Number.isFinite(parsedYear) && parsedYear > 0 ? parsedYear : undefined,
      month: Number.isFinite(parsedMonth) && parsedMonth > 0 ? parsedMonth : undefined,
    }
  }, [filterEmployeeId, filterYear, filterMonth])

  const leavesQuery = useQuery({
    queryKey: ['leaves', leaveFilter.employee_id ?? 'all', leaveFilter.year ?? 'all', leaveFilter.month ?? 'all'],
    queryFn: () => getLeaves(leaveFilter),
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
        title: 'İzin kaydı oluşturuldu',
        description: `İzin #${leave.id} kaydedildi.`,
      })
      void queryClient.invalidateQueries({ queryKey: ['leaves'] })
    },
    onError: (error) => {
      const parsed = parseApiError(error, 'İzin kaydı oluşturulamadı.')
      setFormError(parsed.message)
      pushToast({
        variant: 'error',
        title: 'İzin oluşturulamadı',
        description: parsed.message,
      })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteLeave,
    onSuccess: (_, leaveId) => {
      pushToast({
        variant: 'success',
        title: 'İzin kaydı silindi',
        description: `İzin #${leaveId} silindi.`,
      })
      void queryClient.invalidateQueries({ queryKey: ['leaves'] })
    },
    onError: (error) => {
      const parsed = parseApiError(error, 'İzin silinemedi.')
      pushToast({
        variant: 'error',
        title: 'İzin silinemedi',
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
      const message = parsed.error.issues[0]?.message ?? 'İzin formunu kontrol edin.'
      setFormError(message)
      pushToast({
        variant: 'error',
        title: 'Form hatası',
        description: message,
      })
      return
    }

    createMutation.mutate({
      ...parsed.data,
      note: parsed.data.note || null,
    })
  }

  if (employeesQuery.isLoading) {
    return <LoadingBlock />
  }

  if (employeesQuery.isError) {
    return <ErrorBlock message="Çalışan listesi alınamadı." />
  }

  const employees = employeesQuery.data ?? []
  const leaveRows = leavesQuery.data ?? []
  const employeeNameById = new Map(employees.map((employee) => [employee.id, employee.full_name]))

  return (
    <div className="space-y-4">
      <PageHeader title="İzin Kayıtları" description="Yıllık izin, rapor ve mazeret kayıtlarını yönetin." />

      <Panel>
        <h4 className="text-base font-semibold text-slate-900">Yeni İzin Kaydı</h4>
        <form onSubmit={onCreateLeave} className="mt-4 grid gap-3 md:grid-cols-3">
          <EmployeeAutocompleteField
            label="Çalışan"
            employees={employees}
            value={employeeId}
            onChange={setEmployeeId}
            emptyLabel="Seçiniz"
            helperText="Ad-soyad veya ID ile arayın."
          />

          <label className="text-sm text-slate-700">
            Başlangıç Tarihi
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="text-sm text-slate-700">
            Bitiş Tarihi
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="text-sm text-slate-700">
            İzin Tipi
            <select
              value={leaveType}
              onChange={(event) =>
                setLeaveType(event.target.value as 'ANNUAL' | 'SICK' | 'UNPAID' | 'EXCUSE' | 'PUBLIC_HOLIDAY')
              }
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="ANNUAL">YILLIK İZİN</option>
              <option value="SICK">RAPOR / HASTALIK</option>
              <option value="UNPAID">ÜCRETSİZ İZİN</option>
              <option value="EXCUSE">MAZERET İZNİ</option>
              <option value="PUBLIC_HOLIDAY">RESMİ TATİL</option>
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
              <option value="REJECTED">REDDEDİLDİ</option>
            </select>
          </label>

          <label className="text-sm text-slate-700 md:col-span-3">
            Açıklama Notu
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
              {createMutation.isPending ? 'Kaydediliyor...' : 'İzin Kaydını Oluştur'}
            </button>
          </div>
        </form>
        {formError ? <div className="form-validation">{formError}</div> : null}
      </Panel>

      <Panel>
        <h4 className="text-base font-semibold text-slate-900">İzin Listesi Filtreleri</h4>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <EmployeeAutocompleteField
            label="Çalışan"
            employees={employees}
            value={filterEmployeeId}
            onChange={setFilterEmployeeId}
            emptyLabel="Tümü"
            helperText="Çalışana göre filtreleyin."
          />

          <label className="text-sm text-slate-700">
            Yıl
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
        </div>
      </Panel>

      {leavesQuery.isLoading ? <LoadingBlock /> : null}
      {leavesQuery.isError ? <ErrorBlock message="İzin listesi alınamadı." /> : null}

      {!leavesQuery.isLoading && !leavesQuery.isError ? (
        <Panel>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2">İzin ID</th>
                  <th className="py-2">Çalışan</th>
                  <th className="py-2">İzin Tipi</th>
                  <th className="py-2">Tarih Aralığı</th>
                  <th className="py-2">Durum</th>
                  <th className="py-2">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {leaveRows.map((leave) => (
                  <tr key={leave.id} className="border-t border-slate-100">
                    <td className="py-2">{leave.id}</td>
                    <td className="py-2">{employeeNameById.get(leave.employee_id) ?? leave.employee_id}</td>
                    <td className="py-2">{leave.type}</td>
                    <td className="py-2">
                      {leave.start_date} - {leave.end_date}
                    </td>
                    <td className="py-2">
                      <StatusBadge value={leave.status} />
                    </td>
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
          {leaveRows.length === 0 ? <p className="mt-3 text-sm text-slate-500">İzin kaydı bulunamadı.</p> : null}
        </Panel>
      ) : null}
    </div>
  )
}
