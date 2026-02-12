import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  cancelNotificationJob,
  getEmployees,
  getNotificationJobs,
  getNotificationSubscriptions,
  sendManualNotification,
} from '../api/admin'
import { parseApiError } from '../api/error'
import { ErrorBlock } from '../components/ErrorBlock'
import { LoadingBlock } from '../components/LoadingBlock'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'
import { TableSearchInput } from '../components/TableSearchInput'
import { useToast } from '../hooks/useToast'
import type { NotificationJobStatus } from '../types/api'

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date(value))
}

function statusClass(status: NotificationJobStatus): string {
  if (status === 'SENT') return 'bg-emerald-100 text-emerald-700'
  if (status === 'FAILED') return 'bg-rose-100 text-rose-700'
  if (status === 'CANCELED') return 'bg-slate-200 text-slate-700'
  if (status === 'SENDING') return 'bg-amber-100 text-amber-700'
  return 'bg-sky-100 text-sky-700'
}

export function NotificationsPage() {
  const queryClient = useQueryClient()
  const { pushToast } = useToast()

  const [title, setTitle] = useState('Puantaj Bildirimi')
  const [message, setMessage] = useState('')
  const [password, setPassword] = useState('')
  const [targetMode, setTargetMode] = useState<'all' | 'selected'>('all')
  const [employeeSearch, setEmployeeSearch] = useState('')
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<number[]>([])
  const [jobsStatusFilter, setJobsStatusFilter] = useState<'' | NotificationJobStatus>('')
  const [jobsLimit, setJobsLimit] = useState(100)
  const [subscriptionsEmployeeFilter, setSubscriptionsEmployeeFilter] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [formRequestId, setFormRequestId] = useState<string | null>(null)

  const employeesQuery = useQuery({
    queryKey: ['employees', 'notifications-active'],
    queryFn: () => getEmployees({ status: 'active' }),
  })

  const jobsQuery = useQuery({
    queryKey: ['notification-jobs', jobsStatusFilter, jobsLimit],
    queryFn: () =>
      getNotificationJobs({
        status: jobsStatusFilter || undefined,
        limit: jobsLimit,
      }),
    refetchInterval: 10000,
    refetchIntervalInBackground: true,
  })

  const subscriptionsQuery = useQuery({
    queryKey: ['notification-subscriptions', subscriptionsEmployeeFilter],
    queryFn: () =>
      getNotificationSubscriptions({
        employee_id: subscriptionsEmployeeFilter ? Number(subscriptionsEmployeeFilter) : undefined,
      }),
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
  })

  const sendMutation = useMutation({
    mutationFn: sendManualNotification,
    onSuccess: (response) => {
      setFormError(null)
      setFormRequestId(null)
      setMessage('')
      setPassword('')
      pushToast({
        variant: 'success',
        title: 'Bildirim gönderildi',
        description: `Hedef: ${response.total_targets} | Başarılı: ${response.sent} | Hata: ${response.failed}`,
      })
      void queryClient.invalidateQueries({ queryKey: ['notification-jobs'] })
      void queryClient.invalidateQueries({ queryKey: ['notification-subscriptions'] })
    },
    onError: (error) => {
      const parsed = parseApiError(error, 'Bildirim gönderilemedi.')
      setFormError(parsed.message)
      setFormRequestId(parsed.requestId ?? null)
      pushToast({
        variant: 'error',
        title: 'Bildirim gönderilemedi',
        description: parsed.message,
      })
    },
  })

  const cancelMutation = useMutation({
    mutationFn: cancelNotificationJob,
    onSuccess: () => {
      pushToast({
        variant: 'success',
        title: 'İş iptal edildi',
        description: 'Bildirim işi iptal durumuna alındı.',
      })
      void queryClient.invalidateQueries({ queryKey: ['notification-jobs'] })
    },
    onError: (error) => {
      const parsed = parseApiError(error, 'Bildirim işi iptal edilemedi.')
      pushToast({
        variant: 'error',
        title: 'İptal başarısız',
        description: parsed.message,
      })
    },
  })

  const employees = employeesQuery.data ?? []
  const jobs = jobsQuery.data ?? []
  const subscriptions = subscriptionsQuery.data ?? []

  const filteredEmployees = useMemo(() => {
    const needle = employeeSearch.trim().toLowerCase()
    if (!needle) {
      return employees
    }
    return employees.filter((item) => {
      const text = `${item.full_name} ${item.id}`.toLowerCase()
      return text.includes(needle)
    })
  }, [employees, employeeSearch])

  const selectedEmployeeCount = selectedEmployeeIds.length

  const toggleEmployee = (employeeId: number) => {
    setSelectedEmployeeIds((prev) =>
      prev.includes(employeeId) ? prev.filter((id) => id !== employeeId) : [...prev, employeeId],
    )
  }

  const onSubmitManualSend = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(null)
    setFormRequestId(null)

    const trimmedTitle = title.trim()
    const trimmedMessage = message.trim()
    const trimmedPassword = password.trim()

    if (!trimmedTitle) {
      setFormError('Başlık zorunludur.')
      return
    }
    if (!trimmedMessage) {
      setFormError('Mesaj zorunludur.')
      return
    }
    if (!trimmedPassword) {
      setFormError('Gönderim için admin şifresi zorunludur.')
      return
    }
    if (targetMode === 'selected' && selectedEmployeeIds.length === 0) {
      setFormError('En az bir çalışan seçmelisiniz.')
      return
    }

    sendMutation.mutate({
      title: trimmedTitle,
      message: trimmedMessage,
      password: trimmedPassword,
      employee_ids: targetMode === 'selected' ? selectedEmployeeIds : undefined,
    })
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Bildirimler"
        description="Çalışan cihaz aboneliklerini izleyin, sistem işlerini takip edin ve manuel bildirim gönderin."
      />

      <Panel>
        <h4 className="text-base font-semibold text-slate-900">Manuel Bildirim Gönder</h4>
        <p className="mt-1 text-sm text-slate-600">
          Bu işlem anlık push bildirimi gönderir. Güvenlik için mevcut admin şifresi istenir.
        </p>
        <form className="mt-4 space-y-3" onSubmit={onSubmitManualSend}>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm text-slate-700">
              Başlık
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                maxLength={120}
                placeholder="Puantaj Bildirimi"
              />
            </label>
            <label className="text-sm text-slate-700">
              Admin Şifresi
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                autoComplete="current-password"
                placeholder="Şifre doğrulama"
              />
            </label>
          </div>

          <label className="text-sm text-slate-700">
            Mesaj
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              rows={4}
              maxLength={2000}
              placeholder="Lütfen mesai çıkışınızı tamamlayın."
            />
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm text-slate-700">
              Hedef
              <select
                value={targetMode}
                onChange={(event) => setTargetMode(event.target.value as 'all' | 'selected')}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                <option value="all">Tüm aktif abonelikler</option>
                <option value="selected">Seçili çalışanlar</option>
              </select>
            </label>
            <div className="text-sm text-slate-700">
              Seçili çalışan sayısı
              <div className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-semibold text-slate-900">
                {targetMode === 'all' ? 'Tümü' : selectedEmployeeCount}
              </div>
            </div>
          </div>

          {targetMode === 'selected' ? (
            <div className="rounded-lg border border-slate-200 p-3">
              <TableSearchInput
                value={employeeSearch}
                onChange={setEmployeeSearch}
                placeholder="Çalışan adı veya ID ile ara..."
              />
              <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
                {employeesQuery.isLoading ? <LoadingBlock label="Çalışanlar yükleniyor..." /> : null}
                {employeesQuery.isError ? (
                  <ErrorBlock message="Çalışan listesi alınamadı." />
                ) : null}
                {!employeesQuery.isLoading && !employeesQuery.isError && filteredEmployees.length === 0 ? (
                  <p className="text-sm text-slate-500">Eşleşen çalışan bulunamadı.</p>
                ) : null}
                {!employeesQuery.isLoading &&
                  !employeesQuery.isError &&
                  filteredEmployees.map((employee) => (
                    <label
                      key={employee.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    >
                      <span className="font-medium text-slate-900">
                        #{employee.id} - {employee.full_name}
                      </span>
                      <input
                        type="checkbox"
                        checked={selectedEmployeeIds.includes(employee.id)}
                        onChange={() => toggleEmployee(employee.id)}
                      />
                    </label>
                  ))}
              </div>
            </div>
          ) : null}

          {formError ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              <p>{formError}</p>
              {formRequestId ? <p className="mt-1 text-xs">request_id: {formRequestId}</p> : null}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={sendMutation.isPending}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {sendMutation.isPending ? 'Gönderiliyor...' : 'Bildirimi Gönder'}
            </button>
            <button
              type="button"
              onClick={() => {
                setMessage('')
                setFormError(null)
                setFormRequestId(null)
              }}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Mesajı Temizle
            </button>
          </div>
        </form>
      </Panel>

      <Panel>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-slate-700">
            Job durumu
            <select
              value={jobsStatusFilter}
              onChange={(event) => setJobsStatusFilter(event.target.value as '' | NotificationJobStatus)}
              className="mt-1 w-44 rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="">Tümü</option>
              <option value="PENDING">PENDING</option>
              <option value="SENDING">SENDING</option>
              <option value="SENT">SENT</option>
              <option value="FAILED">FAILED</option>
              <option value="CANCELED">CANCELED</option>
            </select>
          </label>
          <label className="text-sm text-slate-700">
            Limit
            <input
              type="number"
              min={1}
              max={500}
              value={jobsLimit}
              onChange={(event) => setJobsLimit(Math.min(500, Math.max(1, Number(event.target.value || 1))))}
              className="mt-1 w-28 rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <button
            type="button"
            onClick={() => void jobsQuery.refetch()}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Job listesini yenile
          </button>
        </div>

        {jobsQuery.isLoading ? <LoadingBlock label="Bildirim işleri yükleniyor..." /> : null}
        {jobsQuery.isError ? <ErrorBlock message="Bildirim işleri alınamadı." /> : null}

        {!jobsQuery.isLoading && !jobsQuery.isError ? (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2">ID</th>
                  <th className="py-2">Tür</th>
                  <th className="py-2">Çalışan</th>
                  <th className="py-2">Durum</th>
                  <th className="py-2">Planlanan</th>
                  <th className="py-2">Deneme</th>
                  <th className="py-2">Hata</th>
                  <th className="py-2">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} className="border-t border-slate-100">
                    <td className="py-2 font-medium text-slate-900">{job.id}</td>
                    <td className="py-2 text-slate-700">{job.job_type}</td>
                    <td className="py-2 text-slate-700">{job.employee_id ?? '-'}</td>
                    <td className="py-2">
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusClass(job.status)}`}>
                        {job.status}
                      </span>
                    </td>
                    <td className="py-2 text-slate-700">{formatDateTime(job.scheduled_at_utc)}</td>
                    <td className="py-2 text-slate-700">{job.attempts}</td>
                    <td className="py-2 text-slate-700">{job.last_error ?? '-'}</td>
                    <td className="py-2">
                      {job.status === 'PENDING' || job.status === 'SENDING' ? (
                        <button
                          type="button"
                          onClick={() => cancelMutation.mutate(job.id)}
                          className="rounded-lg border border-rose-300 px-3 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                          disabled={cancelMutation.isPending}
                        >
                          İptal Et
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {jobs.length === 0 ? <p className="py-3 text-sm text-slate-500">Bildirim işi bulunamadı.</p> : null}
          </div>
        ) : null}
      </Panel>

      <Panel>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-slate-700">
            Abonelik çalışan filtresi
            <input
              type="number"
              min={1}
              value={subscriptionsEmployeeFilter}
              onChange={(event) => setSubscriptionsEmployeeFilter(event.target.value)}
              className="mt-1 w-44 rounded-lg border border-slate-300 px-3 py-2"
              placeholder="Employee ID"
            />
          </label>
          <button
            type="button"
            onClick={() => void subscriptionsQuery.refetch()}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Abonelikleri yenile
          </button>
        </div>

        {subscriptionsQuery.isLoading ? <LoadingBlock label="Push abonelikleri yükleniyor..." /> : null}
        {subscriptionsQuery.isError ? <ErrorBlock message="Push abonelik listesi alınamadı." /> : null}

        {!subscriptionsQuery.isLoading && !subscriptionsQuery.isError ? (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2">ID</th>
                  <th className="py-2">Çalışan</th>
                  <th className="py-2">Cihaz</th>
                  <th className="py-2">Durum</th>
                  <th className="py-2">Son Görülme</th>
                  <th className="py-2">Endpoint</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="py-2 font-medium text-slate-900">{row.id}</td>
                    <td className="py-2 text-slate-700">{row.employee_id}</td>
                    <td className="py-2 text-slate-700">{row.device_id}</td>
                    <td className="py-2">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-semibold ${
                          row.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-700'
                        }`}
                      >
                        {row.is_active ? 'AKTİF' : 'PASİF'}
                      </span>
                    </td>
                    <td className="py-2 text-slate-700">{formatDateTime(row.last_seen_at)}</td>
                    <td className="py-2 text-slate-700">
                      <span className="inline-block max-w-[460px] truncate align-bottom">{row.endpoint}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {subscriptions.length === 0 ? (
              <p className="py-3 text-sm text-slate-500">Aktif push aboneliği bulunamadı.</p>
            ) : null}
          </div>
        ) : null}
      </Panel>
    </div>
  )
}
