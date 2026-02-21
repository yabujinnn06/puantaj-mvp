import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'

import {
  cancelNotificationJob,
  createAdminDeviceInvite,
  downloadDailyReportArchive,
  getAdminNotificationSubscriptions,
  getAdminPushConfig,
  getAdminPushSelfCheck,
  getAdminUsers,
  getDailyReportArchives,
  getEmployees,
  getNotificationDeliveryLogs,
  getNotificationJobs,
  getNotificationSubscriptions,
  notifyDailyReportArchive,
  sendAdminPushSelfTest,
  sendManualNotification,
} from '../api/admin'
import { parseApiError } from '../api/error'
import { ErrorBlock } from '../components/ErrorBlock'
import { LoadingBlock } from '../components/LoadingBlock'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'
import { TableSearchInput } from '../components/TableSearchInput'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import type { AdminDeviceInviteCreateResponse, NotificationDeliveryLog, NotificationJobStatus } from '../types/api'

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

function deliveryStatusClass(status: 'SENT' | 'FAILED'): string {
  if (status === 'SENT') return 'bg-emerald-100 text-emerald-700'
  return 'bg-rose-100 text-rose-700'
}

function deliveryTargetLabel(value: string): string {
  if (value === 'admins') return 'ADMIN'
  if (value === 'employees') return 'CALISAN'
  if (value === 'both') return 'HER IKISI'
  return value.toUpperCase()
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

const JOBS_PAGE_SIZE = 25
const ARCHIVE_PAGE_SIZE = 50

export function NotificationsPage() {
  const queryClient = useQueryClient()
  const { pushToast } = useToast()
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()

  const [title, setTitle] = useState('Puantaj Bildirimi')
  const [message, setMessage] = useState('')
  const [password, setPassword] = useState('')
  const [target, setTarget] = useState<'employees' | 'admins' | 'both'>('employees')
  const [expiresIn, setExpiresIn] = useState(60)
  const [jobsStatus, setJobsStatus] = useState<'' | NotificationJobStatus>('')
  const [jobsPage, setJobsPage] = useState(1)
  const [searchEmployee, setSearchEmployee] = useState('')
  const [searchAdmin, setSearchAdmin] = useState('')
  const [selectedEmployees, setSelectedEmployees] = useState<number[]>([])
  const [selectedAdmins, setSelectedAdmins] = useState<number[]>([])
  const [createdInvite, setCreatedInvite] = useState<AdminDeviceInviteCreateResponse | null>(null)
  const [archiveAutoHandled, setArchiveAutoHandled] = useState(false)
  const [archiveStartDate, setArchiveStartDate] = useState('')
  const [archiveEndDate, setArchiveEndDate] = useState('')
  const [archiveEmployeeQuery, setArchiveEmployeeQuery] = useState('')
  const [archivePage, setArchivePage] = useState(1)
  const [deliverySearch, setDeliverySearch] = useState('')
  const [selectedDeliveryAuditId, setSelectedDeliveryAuditId] = useState<number | null>(null)

  const employeesQuery = useQuery({ queryKey: ['employees', 'notify'], queryFn: () => getEmployees({ status: 'active' }) })
  const adminsQuery = useQuery({ queryKey: ['admin-users', 'notify'], queryFn: getAdminUsers })
  const pushConfigQuery = useQuery({ queryKey: ['admin-push-config'], queryFn: getAdminPushConfig })
  const adminSelfCheckQuery = useQuery({
    queryKey: ['admin-push-self-check'],
    queryFn: getAdminPushSelfCheck,
    refetchInterval: 15000,
  })
  const jobsQuery = useQuery({
    queryKey: ['notification-jobs', jobsStatus],
    queryFn: () => getNotificationJobs({ status: jobsStatus || undefined, limit: 100 }),
    refetchInterval: 10000,
  })
  const deliveryLogsQuery = useQuery({
    queryKey: ['notification-delivery-logs'],
    queryFn: () => getNotificationDeliveryLogs({ limit: 400 }),
    refetchInterval: 15000,
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
  const archivesQuery = useQuery({
    queryKey: ['daily-archives', archiveStartDate, archiveEndDate, archiveEmployeeQuery],
    queryFn: () =>
      getDailyReportArchives({
        limit: 180,
        start_date: archiveStartDate || undefined,
        end_date: archiveEndDate || undefined,
        employee_query: archiveEmployeeQuery.trim() || undefined,
      }),
  })

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

  const filteredDeliveryLogs = useMemo(() => {
    const q = deliverySearch.trim().toLowerCase()
    const rows = deliveryLogsQuery.data ?? []
    if (!q) return rows
    return rows.filter((row) => {
      const parts = [
        row.recipient_name ?? '',
        String(row.recipient_id ?? ''),
        String(row.device_id ?? ''),
        row.ip ?? '',
        row.status,
        row.target,
        row.title ?? '',
        row.sender_admin,
      ]
      return parts.join(' ').toLowerCase().includes(q)
    })
  }, [deliveryLogsQuery.data, deliverySearch])

  const deliverySentCount = useMemo(
    () => filteredDeliveryLogs.filter((row) => row.status === 'SENT').length,
    [filteredDeliveryLogs],
  )
  const deliveryFailedCount = useMemo(
    () => filteredDeliveryLogs.filter((row) => row.status === 'FAILED').length,
    [filteredDeliveryLogs],
  )
  const selectedDeliveryLog = useMemo<NotificationDeliveryLog | null>(
    () => filteredDeliveryLogs.find((row) => row.audit_id === selectedDeliveryAuditId) ?? null,
    [filteredDeliveryLogs, selectedDeliveryAuditId],
  )
  const jobsRows = jobsQuery.data ?? []
  const jobsTotalPages = useMemo(
    () => Math.max(1, Math.ceil(jobsRows.length / JOBS_PAGE_SIZE)),
    [jobsRows.length],
  )
  const pagedJobs = useMemo(() => {
    const startIndex = (jobsPage - 1) * JOBS_PAGE_SIZE
    return jobsRows.slice(startIndex, startIndex + JOBS_PAGE_SIZE)
  }, [jobsPage, jobsRows])
  const jobsRangeStart = jobsRows.length === 0 ? 0 : (jobsPage - 1) * JOBS_PAGE_SIZE + 1
  const jobsRangeEnd = Math.min(jobsPage * JOBS_PAGE_SIZE, jobsRows.length)
  const archiveRows = archivesQuery.data ?? []
  const archiveTotalPages = useMemo(
    () => Math.max(1, Math.ceil(archiveRows.length / ARCHIVE_PAGE_SIZE)),
    [archiveRows.length],
  )
  const pagedArchives = useMemo(() => {
    const startIndex = (archivePage - 1) * ARCHIVE_PAGE_SIZE
    return archiveRows.slice(startIndex, startIndex + ARCHIVE_PAGE_SIZE)
  }, [archivePage, archiveRows])
  const archiveRangeStart = archiveRows.length === 0 ? 0 : (archivePage - 1) * ARCHIVE_PAGE_SIZE + 1
  const archiveRangeEnd = Math.min(archivePage * ARCHIVE_PAGE_SIZE, archiveRows.length)
  const activeAdminSubscriptionCount = (adminSubsQuery.data ?? []).length
  const canNotifyAdmins = activeAdminSubscriptionCount > 0
  const currentAdminUsername = (user?.username ?? '').trim().toLowerCase()
  const currentAdminUserId = typeof user?.admin_user_id === 'number' && user.admin_user_id > 0 ? user.admin_user_id : null
  const fallbackCurrentAdminClaimBreakdown = useMemo(() => {
    const rows = adminSubsQuery.data ?? []
    let byId = 0
    let byUsername = 0
    let total = 0
    for (const item of rows) {
      const matchesById = currentAdminUserId !== null && item.admin_user_id === currentAdminUserId
      const matchesByUsername =
        currentAdminUsername.length > 0 && (item.admin_username || '').trim().toLowerCase() === currentAdminUsername
      if (matchesById) byId += 1
      if (matchesByUsername) byUsername += 1
      if (matchesById || matchesByUsername) total += 1
    }
    return { total, byId, byUsername }
  }, [adminSubsQuery.data, currentAdminUserId, currentAdminUsername])
  const currentAdminClaimCount = adminSelfCheckQuery.data?.active_claims_for_actor ?? fallbackCurrentAdminClaimBreakdown.total
  const currentAdminClaimCountById =
    adminSelfCheckQuery.data?.active_claims_for_actor_by_id ?? fallbackCurrentAdminClaimBreakdown.byId
  const currentAdminClaimCountByUsername =
    adminSelfCheckQuery.data?.active_claims_for_actor_by_username ?? fallbackCurrentAdminClaimBreakdown.byUsername
  const currentAdminHasActiveClaim = currentAdminClaimCount > 0

  const inviteMutation = useMutation({
    mutationFn: createAdminDeviceInvite,
    onSuccess: (res) => {
      setCreatedInvite(res)
      pushToast({ variant: 'success', title: 'Davet hazir', description: 'Link admin cihaza gonderildi.' })
      void navigator.clipboard.writeText(res.invite_url)
    },
    onError: (e) =>
      pushToast({ variant: 'error', title: 'Davet hatasi', description: parseApiError(e, 'Davet olusturulamadi').message }),
  })

  const selfTestMutation = useMutation({
    mutationFn: sendAdminPushSelfTest,
    onSuccess: (result) => {
      if (result.total_targets <= 0 || result.sent <= 0) {
        pushToast({
          variant: 'error',
          title: 'Self-test basarisiz',
          description: `Hedef: ${result.total_targets} | Gonderilen: ${result.sent} | Hata: ${result.failed}`,
        })
      } else {
        pushToast({
          variant: 'success',
          title: 'Self-test bildirimi gonderildi',
          description: `Hedef: ${result.total_targets} | Gonderilen: ${result.sent}`,
        })
      }
      void queryClient.invalidateQueries({ queryKey: ['admin-push-self-check'] })
      void queryClient.invalidateQueries({ queryKey: ['notification-delivery-logs'] })
    },
    onError: (error) => {
      const parsed = parseApiError(error, 'Self-test bildirimi gonderilemedi.')
      pushToast({ variant: 'error', title: 'Self-test hatasi', description: parsed.message })
    },
  })

  const sendMutation = useMutation({
    mutationFn: sendManualNotification,
    onSuccess: (res, payload) => {
      const adminTargetRequested = payload.target === 'admins' || payload.target === 'both'
      if (res.total_targets <= 0) {
        pushToast({
          variant: 'error',
          title: 'Bildirim gonderilemedi',
          description: 'Hedef 0. Aktif abonelik yok; once cihaz claim edin.',
        })
      } else if (res.sent <= 0) {
        pushToast({
          variant: 'error',
          title: 'Bildirim gonderilemedi',
          description: `Hedef: ${res.total_targets} / Gonderilen: ${res.sent} / Hata: ${res.failed}`,
        })
      } else {
        pushToast({
          variant: 'success',
          title: 'Bildirim gonderildi',
          description: `Hedef: ${res.total_targets} / Gonderilen: ${res.sent}`,
        })
        if (adminTargetRequested && !currentAdminHasActiveClaim) {
          pushToast({
            variant: 'error',
            title: 'Bu hesapta claim eksik',
            description: 'Admin hedefli gonderim yapildi ancak bu hesapta aktif claim olmadigi icin sana dusmeyebilir.',
          })
        }
      }
      if (adminTargetRequested && res.admin_target_missing) {
        pushToast({
          variant: 'error',
          title: 'Admin hedefi 0',
          description: 'Calisan bildirimi gitmis olabilir ama admin hedefinde aktif abonelik yok. Admin claim zorunlu.',
        })
      }
      void queryClient.invalidateQueries({ queryKey: ['notification-jobs'] })
      void queryClient.invalidateQueries({ queryKey: ['notification-delivery-logs'] })
      void queryClient.invalidateQueries({ queryKey: ['admin-push-self-check'] })
    },
    onError: (e) =>
      pushToast({
        variant: 'error',
        title: 'Gonderim hatasi',
        description: parseApiError(e, 'Bildirim gonderilemedi').message,
      }),
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
      if (result.total_targets <= 0 || result.sent <= 0) {
        pushToast({
          variant: 'error',
          title: 'Arsiv bildirimi gonderilemedi',
          description: `Hedef: ${result.total_targets} | Gonderilen: ${result.sent} | Hata: ${result.failed}. Aktif admin cihazi claim edilmeli.`,
        })
      } else {
        pushToast({
          variant: 'success',
          title: 'Arsiv bildirimi gonderildi',
          description: `Hedef: ${result.total_targets} | Gonderilen: ${result.sent} | Hata: ${result.failed}`,
        })
        if (!currentAdminHasActiveClaim) {
          pushToast({
            variant: 'error',
            title: 'Bu hesapta claim eksik',
            description: 'Bildirim gitti ama bu admin hesabinda aktif cihaz claim olmadigi icin sana dusmeyebilir.',
          })
        }
      }
      void queryClient.invalidateQueries({ queryKey: ['notification-jobs'] })
    },
    onError: (error) => {
      const parsed = parseApiError(error, 'Arsiv bildirimi gonderilemedi.')
      pushToast({ variant: 'error', title: 'Arsiv bildirimi basarisiz', description: parsed.message })
    },
  })

  useEffect(() => {
    if (archiveAutoHandled) return
    const rawArchiveId = searchParams.get('archive_id')
    if (!rawArchiveId) return
    const archiveId = Number(rawArchiveId)
    if (!Number.isInteger(archiveId) || archiveId <= 0) {
      setArchiveAutoHandled(true)
      return
    }
    const archiveRow = (archivesQuery.data ?? []).find((x) => x.id === archiveId)
    if (!archiveRow) return

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

  useEffect(() => {
    setJobsPage(1)
  }, [jobsStatus])

  useEffect(() => {
    setJobsPage((prev) => {
      if (prev < 1) return 1
      if (prev > jobsTotalPages) return jobsTotalPages
      return prev
    })
  }, [jobsTotalPages])

  useEffect(() => {
    setArchivePage(1)
  }, [archiveStartDate, archiveEndDate, archiveEmployeeQuery])

  useEffect(() => {
    if (filteredDeliveryLogs.length === 0) {
      setSelectedDeliveryAuditId(null)
      return
    }
    if (selectedDeliveryAuditId === null || !filteredDeliveryLogs.some((row) => row.audit_id === selectedDeliveryAuditId)) {
      setSelectedDeliveryAuditId(filteredDeliveryLogs[0].audit_id)
    }
  }, [filteredDeliveryLogs, selectedDeliveryAuditId])

  useEffect(() => {
    setArchivePage((prev) => {
      if (prev < 1) return 1
      if (prev > archiveTotalPages) return archiveTotalPages
      return prev
    })
  }, [archiveTotalPages])

  return (
    <div className="space-y-4">
      <PageHeader title="Bildirim Merkezi" description="Push, claim daveti, job yonetimi ve gunluk Excel arsivi." />

      <Panel>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-slate-700">
            Admin davet suresi (dk)
            <input
              type="number"
              min={1}
              max={43200}
              value={expiresIn}
              onChange={(e) => setExpiresIn(Number(e.target.value || 60))}
              className="mt-1 w-40 rounded border border-slate-300 px-3 py-2"
            />
          </label>
          <button
            type="button"
            onClick={() => inviteMutation.mutate({ expires_in_minutes: expiresIn })}
            className="rounded bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
          >
            Admin cihaz claim linki uret
          </button>
          <span className="text-xs text-slate-500">Push: {pushConfigQuery.data?.enabled ? 'Aktif' : 'Pasif'}</span>
        </div>
        <p className="mt-2 text-xs text-slate-500">Link otomatik kopyalanir. Ekran: /admin-panel/device-claim?token=...</p>
        {createdInvite ? (
          <div className="mt-2 rounded border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
            <p>Token: {createdInvite.token}</p>
            <p className="break-all">Link: {createdInvite.invite_url}</p>
            <p>Bitis: {dt(createdInvite.expires_at)}</p>
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
          <h4 className="text-base font-semibold text-slate-900">Manuel Push Gonder</h4>
          <div className="grid gap-3 md:grid-cols-3">
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="rounded border border-slate-300 px-3 py-2" placeholder="Baslik" />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="rounded border border-slate-300 px-3 py-2" placeholder="Admin sifresi" />
            <select value={target} onChange={(e) => setTarget(e.target.value as 'employees' | 'admins' | 'both')} className="rounded border border-slate-300 px-3 py-2">
              <option value="employees">Calisanlara</option>
              <option value="admins">Adminlere</option>
              <option value="both">Her ikisine</option>
            </select>
          </div>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} className="w-full rounded border border-slate-300 px-3 py-2" placeholder="Mesaj" />

          {target !== 'admins' ? (
            <div>
              <TableSearchInput value={searchEmployee} onChange={setSearchEmployee} placeholder="Calisan filtrele..." />
              <div className="mt-2 max-h-36 overflow-y-auto rounded border border-slate-200 p-2 text-sm">
                {filteredEmployees.map((item) => (
                  <label key={item.id} className="flex items-center justify-between py-1">
                    <span>#{item.id} - {item.full_name}</span>
                    <input
                      type="checkbox"
                      checked={selectedEmployees.includes(item.id)}
                      onChange={() =>
                        setSelectedEmployees((prev) =>
                          prev.includes(item.id) ? prev.filter((x) => x !== item.id) : [...prev, item.id],
                        )
                      }
                    />
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
                    <input
                      type="checkbox"
                      checked={selectedAdmins.includes(item.id)}
                      onChange={() =>
                        setSelectedAdmins((prev) =>
                          prev.includes(item.id) ? prev.filter((x) => x !== item.id) : [...prev, item.id],
                        )
                      }
                    />
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          <button type="submit" className="rounded bg-brand-600 px-4 py-2 text-sm font-semibold text-white">Bildirimi gonder</button>
        </form>
      </Panel>

      <Panel>
        <h4 className="text-base font-semibold text-slate-900">Bildirim Isleri</h4>
        <div className="mb-2 mt-2 flex gap-2">
          <select value={jobsStatus} onChange={(e) => setJobsStatus(e.target.value as '' | NotificationJobStatus)} className="rounded border border-slate-300 px-3 py-2 text-sm">
            <option value="">Tumu</option>
            <option value="PENDING">PENDING</option>
            <option value="SENDING">SENDING</option>
            <option value="SENT">SENT</option>
            <option value="FAILED">FAILED</option>
            <option value="CANCELED">CANCELED</option>
          </select>
          <button type="button" onClick={() => void jobsQuery.refetch()} className="rounded border border-slate-300 px-3 py-2 text-sm">Yenile</button>
        </div>
        {jobsQuery.isLoading ? <LoadingBlock label="Yukleniyor..." /> : null}
        {jobsQuery.isError ? <ErrorBlock message="Job listesi alinamadi." /> : null}
        {!jobsQuery.isLoading && !jobsQuery.isError ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <span>
              Gosterilen satir: {jobsRangeStart}-{jobsRangeEnd} / {jobsRows.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setJobsPage((prev) => Math.max(1, prev - 1))}
                disabled={jobsPage <= 1}
                className="rounded border border-slate-300 px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
              >
                Onceki
              </button>
              <span>
                Sayfa {jobsPage} / {jobsTotalPages}
              </span>
              <button
                type="button"
                onClick={() => setJobsPage((prev) => Math.min(jobsTotalPages, prev + 1))}
                disabled={jobsPage >= jobsTotalPages}
                className="rounded border border-slate-300 px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
              >
                Sonraki
              </button>
            </div>
          </div>
        ) : null}
        <div className="mt-2 max-h-[420px] overflow-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-left text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="text-xs uppercase text-slate-500">
                <th className="px-2 py-2">Sira</th>
                <th className="px-2 py-2">ID</th>
                <th className="px-2 py-2">Tur</th>
                <th className="px-2 py-2">Durum</th>
                <th className="px-2 py-2">Planlanan</th>
                <th className="px-2 py-2">Islem</th>
              </tr>
            </thead>
            <tbody>
              {pagedJobs.map((job, index) => (
                <tr key={job.id} className="border-t border-slate-100">
                  <td className="px-2 py-2 text-slate-500">{jobsRangeStart + index}</td>
                  <td className="px-2 py-2">{job.id}</td>
                  <td className="px-2 py-2">{job.job_type}</td>
                  <td className="px-2 py-2">
                    <span className={`rounded px-2 py-1 text-xs ${statusClass(job.status)}`}>{job.status}</span>
                  </td>
                  <td className="px-2 py-2">{dt(job.scheduled_at_utc)}</td>
                  <td className="px-2 py-2">
                    {job.status === 'PENDING' || job.status === 'SENDING' ? (
                      <button type="button" className="rounded border border-rose-300 px-2 py-1 text-xs text-rose-700" onClick={() => cancelMutation.mutate(job.id)}>
                        Iptal
                      </button>
                    ) : (
                      '-'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!jobsQuery.isLoading && !jobsQuery.isError && jobsRows.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Filtreye uygun bildirim isi bulunamadi.</p>
        ) : null}
      </Panel>

      <Panel>
        <h4 className="text-base font-semibold text-slate-900">Abonelik Ozeti</h4>
        <div className="grid gap-2 md:grid-cols-4">
          <div className="rounded border border-slate-200 p-3 text-sm">Calisan abonelik: {(employeeSubsQuery.data ?? []).length}</div>
          <div className="rounded border border-slate-200 p-3 text-sm">Admin abonelik: {(adminSubsQuery.data ?? []).length}</div>
          <div className="rounded border border-slate-200 p-3 text-sm">Arsiv dosyasi: {(archivesQuery.data ?? []).length}</div>
          <div className="rounded border border-slate-200 p-3 text-sm">Teslimat log satiri: {(deliveryLogsQuery.data ?? []).length}</div>
        </div>
        {!canNotifyAdmins ? (
          <p className="mt-2 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            Aktif admin push aboneligi yok. "Admin cihaz claim linki uret" adimini tamamlamadan bildirim gonderilemez.
          </p>
        ) : null}
      </Panel>

      <Panel>
        <h4 className="text-base font-semibold text-slate-900">Admin Push Self-Check</h4>
        <div className="mt-2 grid gap-2 md:grid-cols-4">
          <div className="rounded border border-slate-200 p-3 text-sm">
            Login admin: <strong>{user?.username ?? '-'}</strong>
          </div>
          <div className="rounded border border-slate-200 p-3 text-sm">
            Login admin ID: <strong>{user?.admin_user_id ?? '-'}</strong>
          </div>
          <div
            className={`rounded border p-3 text-sm ${
              currentAdminHasActiveClaim ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'
            }`}
          >
            Bu hesap claim: <strong>{currentAdminClaimCount}</strong> (id:{currentAdminClaimCountById} / user:{currentAdminClaimCountByUsername})
          </div>
          <div
            className={`rounded border p-3 text-sm ${
              (adminSelfCheckQuery.data?.push_enabled ?? pushConfigQuery.data?.enabled)
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-rose-200 bg-rose-50 text-rose-800'
            }`}
          >
            Push config:{' '}
            <strong>{(adminSelfCheckQuery.data?.push_enabled ?? pushConfigQuery.data?.enabled) ? 'Aktif' : 'Pasif'}</strong>
          </div>
        </div>
        <div className="mt-2 grid gap-2 md:grid-cols-3">
          <div className="rounded border border-slate-200 p-3 text-sm">
            Toplam aktif admin claim: <strong>{adminSelfCheckQuery.data?.active_total_subscriptions ?? activeAdminSubscriptionCount}</strong>
          </div>
          <div className="rounded border border-slate-200 p-3 text-sm">
            Son claim gorulme:{' '}
            <strong>{adminSelfCheckQuery.data?.latest_claim_seen_at ? dt(adminSelfCheckQuery.data.latest_claim_seen_at) : '-'}</strong>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => selfTestMutation.mutate()}
              disabled={selfTestMutation.isPending}
              className="rounded border border-brand-300 px-3 py-2 text-sm text-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {selfTestMutation.isPending ? 'Self-test gonderiliyor...' : 'Kendime test bildirimi gonder'}
            </button>
          </div>
        </div>
        {adminSelfCheckQuery.isError ? (
          <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Self-check verisi alinamadi. Fallback olarak abonelik listesi kullaniliyor.
          </p>
        ) : null}
        {!currentAdminHasActiveClaim ? (
          <p className="mt-2 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            Bu admin hesabinda aktif cihaz claim gorunmuyor. Bildirim almak icin telefonda claim linkini acip izin adimini tamamla.
          </p>
        ) : null}
        {adminSelfCheckQuery.data?.latest_claim_error ? (
          <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Son claim hatasi: {adminSelfCheckQuery.data.latest_claim_error}
          </p>
        ) : null}
      </Panel>

      <Panel>
        <h4 className="text-base font-semibold text-slate-900">Bildirim Teslimat Logu</h4>
        <p className="mt-1 text-xs text-slate-500">
          Kime gitti / gitmedi, isim-ID, cihaz, IP ve hata bilgisini izleyin.
        </p>

        <div className="mt-3 grid gap-2 md:grid-cols-4">
          <div className="rounded border border-slate-200 p-3 text-sm">
            Toplam satir: {filteredDeliveryLogs.length}
          </div>
          <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            Gonderildi: {deliverySentCount}
          </div>
          <div className="rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            Gonderilemedi: {deliveryFailedCount}
          </div>
          <button
            type="button"
            onClick={() => void deliveryLogsQuery.refetch()}
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          >
            Logu yenile
          </button>
        </div>

        <div className="mt-3">
          <TableSearchInput
            value={deliverySearch}
            onChange={setDeliverySearch}
            placeholder="Isim, ID, cihaz, IP, baslik, durum ara..."
          />
        </div>

        {deliveryLogsQuery.isLoading ? <LoadingBlock label="Teslimat logu yukleniyor..." /> : null}
        {deliveryLogsQuery.isError ? <ErrorBlock message="Teslimat logu alinamadi." /> : null}
        {!deliveryLogsQuery.isLoading && !deliveryLogsQuery.isError ? (
          <div className="mt-3 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <section className="overflow-hidden rounded-xl border border-slate-900 bg-[#09131d] text-slate-200 shadow-inner">
              <div className="flex items-center justify-between border-b border-slate-700 bg-slate-900/70 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                  <span className="ml-2 text-xs font-semibold text-slate-300">delivery-terminal</span>
                </div>
                <span className="text-[11px] text-slate-400">{filteredDeliveryLogs.length} kayit</span>
              </div>

              <div className="max-h-[520px] overflow-auto">
                <table className="min-w-full table-fixed text-left text-xs">
                  <thead className="sticky top-0 bg-slate-900/95 text-[11px] uppercase text-slate-400">
                    <tr>
                      <th className="w-36 px-2 py-2">Zaman</th>
                      <th className="w-24 px-2 py-2">Durum</th>
                      <th className="w-24 px-2 py-2">Hedef</th>
                      <th className="w-56 px-2 py-2">Kisi</th>
                      <th className="w-20 px-2 py-2">Cihaz</th>
                      <th className="w-36 px-2 py-2">IP</th>
                      <th className="w-48 px-2 py-2">Baslik</th>
                      <th className="w-64 px-2 py-2">Hata</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDeliveryLogs.map((row, index) => {
                      const isSelected = row.audit_id === selectedDeliveryAuditId
                      return (
                        <tr
                          key={`${row.audit_id}-${row.recipient_type}-${row.recipient_id ?? 0}-${row.device_id ?? 0}-${index}`}
                          onClick={() => setSelectedDeliveryAuditId(row.audit_id)}
                          className={`cursor-pointer border-t border-slate-800 ${
                            isSelected ? 'bg-cyan-900/35' : 'hover:bg-slate-800/55'
                          }`}
                        >
                          <td className="px-2 py-2 text-slate-300">{dt(row.sent_at_utc)}</td>
                          <td className="px-2 py-2">
                            <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${deliveryStatusClass(row.status)}`}>
                              {row.status}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-slate-300">{deliveryTargetLabel(row.target)}</td>
                          <td className="px-2 py-2 text-slate-300 truncate" title={`#${row.recipient_id ?? '-'} - ${row.recipient_name ?? '-'}`}>
                            #{row.recipient_id ?? '-'} - {row.recipient_name ?? '-'}
                          </td>
                          <td className="px-2 py-2 text-slate-300">{row.device_id ?? '-'}</td>
                          <td className="px-2 py-2 text-slate-300 truncate" title={row.ip ?? '-'}>
                            {row.ip ?? '-'}
                          </td>
                          <td className="px-2 py-2 text-slate-300 truncate" title={row.title ?? '-'}>
                            {row.title ?? '-'}
                          </td>
                          <td className="px-2 py-2 text-slate-300 truncate" title={row.error ?? '-'}>
                            {row.error ?? '-'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {filteredDeliveryLogs.length === 0 ? (
                  <p className="px-3 py-3 text-sm text-amber-300">Filtreye uygun teslimat kaydi bulunamadi.</p>
                ) : null}
              </div>
            </section>

            <aside className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <h5 className="text-sm font-semibold text-slate-900">Secili teslimat detayi</h5>
              {selectedDeliveryLog === null ? (
                <p className="mt-3 text-sm text-slate-600">Listeden bir kayit secin.</p>
              ) : (
                <div className="mt-3 space-y-3">
                  <div className="rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-700">
                    <p>
                      <span className="font-semibold">Zaman:</span> {dt(selectedDeliveryLog.sent_at_utc)}
                    </p>
                    <p>
                      <span className="font-semibold">Durum:</span> {selectedDeliveryLog.status}
                    </p>
                    <p>
                      <span className="font-semibold">Hedef tipi:</span>{' '}
                      {selectedDeliveryLog.recipient_type === 'employee' ? 'CALISAN' : 'ADMIN'}
                    </p>
                    <p>
                      <span className="font-semibold">Hedef:</span> {deliveryTargetLabel(selectedDeliveryLog.target)}
                    </p>
                    <p>
                      <span className="font-semibold">Kisi:</span> #{selectedDeliveryLog.recipient_id ?? '-'} -{' '}
                      {selectedDeliveryLog.recipient_name ?? '-'}
                    </p>
                    <p>
                      <span className="font-semibold">Cihaz:</span> {selectedDeliveryLog.device_id ?? '-'}
                    </p>
                    <p>
                      <span className="font-semibold">IP:</span> {selectedDeliveryLog.ip ?? '-'}
                    </p>
                    <p className="break-words">
                      <span className="font-semibold">Baslik:</span> {selectedDeliveryLog.title ?? '-'}
                    </p>
                    <p>
                      <span className="font-semibold">Gonderen:</span> {selectedDeliveryLog.sender_admin}
                    </p>
                    <p className="break-all">
                      <span className="font-semibold">Endpoint:</span> {selectedDeliveryLog.endpoint ?? '-'}
                    </p>
                    <p className="break-all">
                      <span className="font-semibold">Hata:</span> {selectedDeliveryLog.error ?? '-'}
                    </p>
                  </div>

                  <div>
                    <p className="mb-1 text-xs font-semibold text-slate-600">JSON detay</p>
                    <pre className="max-h-64 overflow-auto rounded-lg bg-slate-900 p-2 text-[11px] text-slate-100">
                      {JSON.stringify(selectedDeliveryLog, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </aside>
          </div>
        ) : null}
      </Panel>

      <Panel>
        <h4 className="text-base font-semibold text-slate-900">Gunluk Excel Arsivi</h4>
        <div className="mt-3 grid gap-2 md:grid-cols-4">
          <label className="text-xs text-slate-600">
            Baslangic
            <input
              type="date"
              value={archiveStartDate}
              onChange={(event) => setArchiveStartDate(event.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-slate-600">
            Bitis
            <input
              type="date"
              value={archiveEndDate}
              onChange={(event) => setArchiveEndDate(event.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-slate-600">
            Calisan icerigi
            <input
              value={archiveEmployeeQuery}
              onChange={(event) => setArchiveEmployeeQuery(event.target.value)}
              placeholder="ad veya ID"
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => void archivesQuery.refetch()}
              className="rounded border border-slate-300 px-3 py-2 text-sm"
            >
              Arsivi yenile
            </button>
          </div>
        </div>

        {archivesQuery.isLoading ? <LoadingBlock label="Arsiv yukleniyor..." /> : null}
        {archivesQuery.isError ? <ErrorBlock message="Arsiv listesi alinamadi." /> : null}
        {!archivesQuery.isLoading && !archivesQuery.isError ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <span>
              Gosterilen satir: {archiveRangeStart}-{archiveRangeEnd} / {archiveRows.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setArchivePage((prev) => Math.max(1, prev - 1))}
                disabled={archivePage <= 1}
                className="rounded border border-slate-300 px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
              >
                Onceki
              </button>
              <span>
                Sayfa {archivePage} / {archiveTotalPages}
              </span>
              <button
                type="button"
                onClick={() => setArchivePage((prev) => Math.min(archiveTotalPages, prev + 1))}
                disabled={archivePage >= archiveTotalPages}
                className="rounded border border-slate-300 px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
              >
                Sonraki
              </button>
            </div>
          </div>
        ) : null}

        <div className="mt-2 max-h-[520px] overflow-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-left text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="text-xs uppercase text-slate-500">
                <th className="px-2 py-2">Sira</th>
                <th className="px-2 py-2">ID</th>
                <th className="px-2 py-2">Tarih</th>
                <th className="px-2 py-2">Dosya</th>
                <th className="px-2 py-2">Calisan</th>
                <th className="px-2 py-2">Boyut</th>
                <th className="px-2 py-2">Islem</th>
              </tr>
            </thead>
            <tbody>
              {pagedArchives.map((item, index) => (
                <tr key={item.id} className="border-t border-slate-100">
                  <td className="px-2 py-2 text-slate-500">{archiveRangeStart + index}</td>
                  <td className="px-2 py-2">{item.id}</td>
                  <td className="px-2 py-2">{item.report_date}</td>
                  <td className="px-2 py-2">{item.file_name}</td>
                  <td className="px-2 py-2">{item.employee_count}</td>
                  <td className="px-2 py-2">{(item.file_size_bytes / 1024).toFixed(1)} KB</td>
                  <td className="px-2 py-2">
                    <div className="flex gap-1">
                      <button type="button" className="rounded border border-brand-300 px-2 py-1 text-xs text-brand-700" onClick={() => downloadMutation.mutate(item.id)}>
                        Excel indir
                      </button>
                      <button
                        type="button"
                        className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700"
                        title={!canNotifyAdmins ? 'Aktif admin push aboneligi yok' : undefined}
                        onClick={() => notifyArchiveMutation.mutate(item.id)}
                        disabled={notifyArchiveMutation.isPending || !canNotifyAdmins}
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
        {!archivesQuery.isLoading && !archivesQuery.isError && archiveRows.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Filtreye uygun arsiv kaydi bulunamadi.</p>
        ) : null}
      </Panel>
    </div>
  )
}
