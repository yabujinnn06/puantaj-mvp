import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'

import {
  cancelNotificationJob,
  createAdminDeviceInvite,
  downloadDailyReportArchive,
  getAdminNotificationSubscriptions,
  getAdminPushConfig,
  getAdminUsers,
  getDailyReportArchives,
  getEmployees,
  getNotificationJobs,
  getNotificationSubscriptions,
  notifyDailyReportArchive,
  sendManualNotification,
} from '../api/admin'
import { parseApiError } from '../api/error'
import { ErrorBlock } from '../components/ErrorBlock'
import { LoadingBlock } from '../components/LoadingBlock'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'
import { TableSearchInput } from '../components/TableSearchInput'
import { useToast } from '../hooks/useToast'
import type { AdminDeviceInviteCreateResponse, NotificationJobStatus } from '../types/api'

function dt(value: string): string {
  return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value))
}

function statusClass(status: NotificationJobStatus): string {
  if (status === 'SENT') return 'bg-emerald-100 text-emerald-700'
  if (status === 'FAILED') return 'bg-rose-100 text-rose-700'
  if (status === 'CANCELED') return 'bg-slate-200 text-slate-700'
  if (status === 'SENDING') return 'bg-amber-100 text-amber-700'
  return 'bg-sky-100 text-sky-700'
}

function downloadBlob(blob: Blob, name: string): void {
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.URL.revokeObjectURL(url)
}

export function NotificationsPage() {
  const queryClient = useQueryClient()
  const { pushToast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()

  const [title, setTitle] = useState('Puantaj Bildirimi')
  const [message, setMessage] = useState('')
  const [password, setPassword] = useState('')
  const [target, setTarget] = useState<'employees' | 'admins' | 'both'>('employees')
  const [expiresIn, setExpiresIn] = useState(60)
  const [jobsStatus, setJobsStatus] = useState<'' | NotificationJobStatus>('')
  const [searchEmployee, setSearchEmployee] = useState('')
  const [searchAdmin, setSearchAdmin] = useState('')
  const [selectedEmployees, setSelectedEmployees] = useState<number[]>([])
  const [selectedAdmins, setSelectedAdmins] = useState<number[]>([])
  const [createdInvite, setCreatedInvite] = useState<AdminDeviceInviteCreateResponse | null>(null)
  const [archiveAutoHandled, setArchiveAutoHandled] = useState(false)

  const employeesQuery = useQuery({ queryKey: ['employees', 'notify'], queryFn: () => getEmployees({ status: 'active' }) })
  const adminsQuery = useQuery({ queryKey: ['admin-users', 'notify'], queryFn: getAdminUsers })
  const pushConfigQuery = useQuery({ queryKey: ['admin-push-config'], queryFn: getAdminPushConfig })
  const jobsQuery = useQuery({
    queryKey: ['notification-jobs', jobsStatus],
    queryFn: () => getNotificationJobs({ status: jobsStatus || undefined, limit: 100 }),
    refetchInterval: 10000,
  })
  const employeeSubsQuery = useQuery({
    queryKey: ['notify-subs-emp'],
    queryFn: () => getNotificationSubscriptions({}),
    refetchInterval: 15000,
  })
  const adminSubsQuery = useQuery({
    queryKey: ['notify-subs-admin'],
    queryFn: () => getAdminNotificationSubscriptions({}),
    refetchInterval: 15000,
  })
  const archivesQuery = useQuery({ queryKey: ['daily-archives'], queryFn: () => getDailyReportArchives({ limit: 90 }) })

  const filteredEmployees = useMemo(() => {
    const q = searchEmployee.trim().toLowerCase()
    if (!q) return employeesQuery.data ?? []
    return (employeesQuery.data ?? []).filter((x) => `${x.id} ${x.full_name}`.toLowerCase().includes(q))
  }, [employeesQuery.data, searchEmployee])

  const filteredAdmins = useMemo(() => {
    const q = searchAdmin.trim().toLowerCase()
    if (!q) return adminsQuery.data ?? []
    return (adminsQuery.data ?? []).filter((x) => `${x.id} ${x.username}`.toLowerCase().includes(q))
  }, [adminsQuery.data, searchAdmin])

  const inviteMutation = useMutation({
    mutationFn: createAdminDeviceInvite,
    onSuccess: (res) => {
      setCreatedInvite(res)
      pushToast({ variant: 'success', title: 'Davet hazır', description: 'Link admin cihazına gönderildi.' })
      void navigator.clipboard.writeText(res.invite_url)
    },
    onError: (e) => pushToast({ variant: 'error', title: 'Davet hatası', description: parseApiError(e, 'Davet oluşturulamadı').message }),
  })

  const sendMutation = useMutation({
    mutationFn: sendManualNotification,
    onSuccess: (res) => {
      pushToast({ variant: 'success', title: 'Bildirim gönderildi', description: `Hedef: ${res.total_targets} / Gönderilen: ${res.sent}` })
      void queryClient.invalidateQueries({ queryKey: ['notification-jobs'] })
    },
    onError: (e) => pushToast({ variant: 'error', title: 'Gönderim hatası', description: parseApiError(e, 'Bildirim gönderilemedi').message }),
  })

  const cancelMutation = useMutation({
    mutationFn: cancelNotificationJob,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notification-jobs'] }),
  })

  const downloadMutation = useMutation({
    mutationFn: downloadDailyReportArchive,
    onSuccess: (blob, id) => {
      const item = (archivesQuery.data ?? []).find((x) => x.id === id)
      downloadBlob(blob, item?.file_name ?? `arsiv-${id}.xlsx`)
    },
  })

  const notifyArchiveMutation = useMutation({
    mutationFn: (archiveId: number) => notifyDailyReportArchive(archiveId),
    onSuccess: (result) => {
      pushToast({
        variant: 'success',
        title: 'Admin bildirimleri gönderildi',
        description: `Hedef: ${result.total_targets} | Gönderilen: ${result.sent} | Hata: ${result.failed}`,
      })
      void queryClient.invalidateQueries({ queryKey: ['notification-jobs'] })
    },
    onError: (error) => {
      const parsed = parseApiError(error, 'Arşiv bildirimi gönderilemedi.')
      pushToast({
        variant: 'error',
        title: 'Arşiv bildirimi başarısız',
        description: parsed.message,
      })
    },
  })

  useEffect(() => {
    if (archiveAutoHandled) {
      return
    }
    const rawArchiveId = searchParams.get('archive_id')
    if (!rawArchiveId) {
      return
    }
    const archiveId = Number(rawArchiveId)
    if (!Number.isInteger(archiveId) || archiveId <= 0) {
      setArchiveAutoHandled(true)
      return
    }
    const archiveRow = (archivesQuery.data ?? []).find((x) => x.id === archiveId)
    if (!archiveRow) {
      return
    }

    setArchiveAutoHandled(true)
    downloadMutation.mutate(archiveId)
    const next = new URLSearchParams(searchParams)
    next.delete('archive_id')
    setSearchParams(next, { replace: true })
  }, [
    archiveAutoHandled,
    archivesQuery.data,
    downloadMutation,
    searchParams,
    setSearchParams,
  ])

  return (
    <div className="space-y-4">
      <PageHeader title="Bildirim Merkezi" description="Admin claim daveti, push abonelikleri ve günlük Excel arşiv yönetimi." />

      <Panel>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-slate-700">Admin davet süresi (dk)
            <input type="number" min={1} max={43200} value={expiresIn} onChange={(e) => setExpiresIn(Number(e.target.value || 60))} className="mt-1 w-40 rounded border border-slate-300 px-3 py-2" />
          </label>
          <button type="button" onClick={() => inviteMutation.mutate({ expires_in_minutes: expiresIn })} className="rounded bg-brand-600 px-4 py-2 text-sm font-semibold text-white">
            Admin cihaz claim linki üret
          </button>
          <span className="text-xs text-slate-500">Push: {pushConfigQuery.data?.enabled ? 'Aktif' : 'Pasif'}</span>
        </div>
        <p className="mt-2 text-xs text-slate-500">Link kopyalama otomatik yapılır. Claim ekranı: /admin-panel/device-claim?token=...</p>
        {createdInvite ? (
          <div className="mt-2 rounded border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
            <p>Token: {createdInvite.token}</p>
            <p className="break-all">Link: {createdInvite.invite_url}</p>
            <p>Bitiş: {dt(createdInvite.expires_at)}</p>
          </div>
        ) : null}
      </Panel>

      <Panel>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            sendMutation.mutate({
              title: title.trim(),
              message: message.trim(),
              password: password.trim(),
              target,
              employee_ids: target !== 'admins' && selectedEmployees.length > 0 ? selectedEmployees : undefined,
              admin_user_ids: target !== 'employees' && selectedAdmins.length > 0 ? selectedAdmins : undefined,
            })
          }}
        >
          <h4 className="text-base font-semibold text-slate-900">Manuel Push Gönder</h4>
          <div className="grid gap-3 md:grid-cols-3">
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="rounded border border-slate-300 px-3 py-2" placeholder="Başlık" />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="rounded border border-slate-300 px-3 py-2" placeholder="Admin şifresi" />
            <select value={target} onChange={(e) => setTarget(e.target.value as 'employees' | 'admins' | 'both')} className="rounded border border-slate-300 px-3 py-2">
              <option value="employees">Çalışanlara</option>
              <option value="admins">Adminlere</option>
              <option value="both">Her ikisine</option>
            </select>
          </div>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} className="w-full rounded border border-slate-300 px-3 py-2" placeholder="Mesaj" />

          {target !== 'admins' ? (
            <div>
              <TableSearchInput value={searchEmployee} onChange={setSearchEmployee} placeholder="Çalışan filtrele..." />
              <div className="mt-2 max-h-36 overflow-y-auto rounded border border-slate-200 p-2 text-sm">
                {filteredEmployees.map((item) => (
                  <label key={item.id} className="flex items-center justify-between py-1">
                    <span>#{item.id} - {item.full_name}</span>
                    <input type="checkbox" checked={selectedEmployees.includes(item.id)} onChange={() => setSelectedEmployees((prev) => prev.includes(item.id) ? prev.filter((x) => x !== item.id) : [...prev, item.id])} />
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {target !== 'employees' ? (
            <div>
              <TableSearchInput value={searchAdmin} onChange={setSearchAdmin} placeholder="Admin filtrele..." />
              <div className="mt-2 max-h-36 overflow-y-auto rounded border border-slate-200 p-2 text-sm">
                {filteredAdmins.map((item) => (
                  <label key={item.id} className="flex items-center justify-between py-1">
                    <span>#{item.id} - {item.username}</span>
                    <input type="checkbox" checked={selectedAdmins.includes(item.id)} onChange={() => setSelectedAdmins((prev) => prev.includes(item.id) ? prev.filter((x) => x !== item.id) : [...prev, item.id])} />
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          <button type="submit" className="rounded bg-brand-600 px-4 py-2 text-sm font-semibold text-white">Bildirimi gönder</button>
        </form>
      </Panel>

      <Panel>
        <h4 className="text-base font-semibold text-slate-900">Bildirim İşleri</h4>
        <div className="mb-2 mt-2 flex gap-2">
          <select value={jobsStatus} onChange={(e) => setJobsStatus(e.target.value as '' | NotificationJobStatus)} className="rounded border border-slate-300 px-3 py-2 text-sm">
            <option value="">Tümü</option><option value="PENDING">PENDING</option><option value="SENDING">SENDING</option><option value="SENT">SENT</option><option value="FAILED">FAILED</option><option value="CANCELED">CANCELED</option>
          </select>
          <button type="button" onClick={() => void jobsQuery.refetch()} className="rounded border border-slate-300 px-3 py-2 text-sm">Yenile</button>
        </div>
        {jobsQuery.isLoading ? <LoadingBlock label="Yükleniyor..." /> : null}
        {jobsQuery.isError ? <ErrorBlock message="Job listesi alınamadı." /> : null}
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead><tr className="text-xs uppercase text-slate-500"><th className="py-2">ID</th><th>Tür</th><th>Durum</th><th>Planlanan</th><th>İşlem</th></tr></thead>
            <tbody>
              {(jobsQuery.data ?? []).map((job) => (
                <tr key={job.id} className="border-t border-slate-100">
                  <td className="py-2">{job.id}</td><td>{job.job_type}</td>
                  <td><span className={`rounded px-2 py-1 text-xs ${job.status === 'SENT' ? 'bg-emerald-100 text-emerald-700' : statusClass(job.status)}`}>{job.status}</span></td>
                  <td>{dt(job.scheduled_at_utc)}</td>
                  <td>{job.status === 'PENDING' || job.status === 'SENDING' ? <button type="button" className="rounded border border-rose-300 px-2 py-1 text-xs text-rose-700" onClick={() => cancelMutation.mutate(job.id)}>İptal</button> : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel>
        <h4 className="text-base font-semibold text-slate-900">Abonelik Özeti</h4>
        <div className="grid gap-2 md:grid-cols-3">
          <div className="rounded border border-slate-200 p-3 text-sm">Çalışan abonelik: {(employeeSubsQuery.data ?? []).length}</div>
          <div className="rounded border border-slate-200 p-3 text-sm">Admin abonelik: {(adminSubsQuery.data ?? []).length}</div>
          <div className="rounded border border-slate-200 p-3 text-sm">Arşiv dosyası: {(archivesQuery.data ?? []).length}</div>
        </div>
      </Panel>

      <Panel>
        <h4 className="text-base font-semibold text-slate-900">Günlük Excel Arşivi</h4>
        {archivesQuery.isLoading ? <LoadingBlock label="Arşiv yükleniyor..." /> : null}
        {archivesQuery.isError ? <ErrorBlock message="Arşiv listesi alınamadı." /> : null}
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead><tr className="text-xs uppercase text-slate-500"><th className="py-2">ID</th><th>Tarih</th><th>Dosya</th><th>Boyut</th><th>İndir</th></tr></thead>
            <tbody>
              {(archivesQuery.data ?? []).map((item) => (
                <tr key={item.id} className="border-t border-slate-100">
                  <td className="py-2">{item.id}</td><td>{item.report_date}</td><td>{item.file_name}</td><td>{(item.file_size_bytes / 1024).toFixed(1)} KB</td>
                  <td>
                    <div className="flex gap-1">
                      <button type="button" className="rounded border border-brand-300 px-2 py-1 text-xs text-brand-700" onClick={() => downloadMutation.mutate(item.id)}>
                        Excel indir
                      </button>
                      <button
                        type="button"
                        className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700"
                        onClick={() => notifyArchiveMutation.mutate(item.id)}
                        disabled={notifyArchiveMutation.isPending}
                      >
                        Adminlere bildir
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}
