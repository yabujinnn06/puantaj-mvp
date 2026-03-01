import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'

import {
  cancelNotificationJob,
  createAdminDeviceInvite,
  downloadDailyReportArchive,
  getAdminDailyReportHealth,
  getAdminNotificationEmailTargets,
  getAdminNotificationSubscriptions,
  getAdminPushConfig,
  getAdminPushSelfCheck,
  getAttendanceEvents,
  getAdminUsers,
  getDailyReportArchives,
  getEmployees,
  healAdminDevice,
  getNotificationDeliveryLogs,
  getNotificationJobs,
  getNotificationSubscriptions,
  notifyDailyReportArchive,
  sendAdminPushSelfTest,
  sendAdminNotificationEmailTest,
  sendManualNotification,
  updateNotificationJobNote,
  updateAdminNotificationEmailTargets,
} from '../api/admin'
import { parseApiError } from '../api/error'
import { ErrorBlock } from '../components/ErrorBlock'
import { LoadingBlock } from '../components/LoadingBlock'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'
import { TableSearchInput } from '../components/TableSearchInput'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import type {
  AdminDailyReportJobHealth,
  AdminDeviceInviteCreateResponse,
  AttendanceEvent,
  NotificationDeliveryLog,
  NotificationJob,
  NotificationJobStatus,
} from '../types/api'
import { urlBase64ToUint8Array } from '../utils/push'

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

function deliveryStatusClass(status: 'PENDING' | 'SENT' | 'FAILED'): string {
  if (status === 'SENT') return 'bg-emerald-100 text-emerald-700'
  if (status === 'FAILED') return 'bg-rose-100 text-rose-700'
  return 'bg-amber-100 text-amber-700'
}

function audienceLabel(value: string | null | undefined): string {
  if (value === 'admin') return 'ADMIN'
  if (value === 'employee') return 'CALISAN'
  return '-'
}

function riskBadgeClass(value: string | null | undefined): string {
  if (value === 'Kritik') return 'bg-rose-100 text-rose-700'
  if (value === 'Uyari') return 'bg-amber-100 text-amber-700'
  return 'bg-sky-100 text-sky-700'
}

function timelineEventLabel(event: AttendanceEvent): string {
  const rawShiftName = typeof event.flags?.SHIFT_NAME === 'string' ? event.flags.SHIFT_NAME : null
  const source = event.source === 'MANUAL' || event.created_by_admin ? 'Manuel' : 'Cihaz'
  const typeLabel = event.type === 'IN' ? 'Giris' : 'Cikis'
  return rawShiftName ? `${typeLabel} • ${source} • ${rawShiftName}` : `${typeLabel} • ${source}`
}

function dailyReportAlarmLabel(value: string): string {
  if (value === 'DAILY_REPORT_JOB_MISSING') return 'Job olusmamis'
  if (value === 'DAILY_REPORT_ARCHIVE_MISSING') return 'Arsiv olusmamis'
  if (value === 'DAILY_REPORT_JOB_STUCK') return 'Job takilmis'
  if (value === 'DAILY_REPORT_JOB_FAILED') return 'Job hatali'
  if (value === 'DAILY_REPORT_DELIVERY_EMPTY') return 'Teslimat bos'
  if (value === 'DAILY_REPORT_TARGET_ZERO') return 'Hedef 0'
  if (value === 'DAILY_REPORT_ARCHIVE_MISMATCH') return 'Arsiv eslesmiyor'
  if (value === 'DAILY_REPORT_HEALTH_QUERY_FAILED') return 'Health sorgusu hatali'
  return value
}

function dailyReportStatusClass(health: AdminDailyReportJobHealth | undefined): string {
  if (!health) return 'border-slate-200 bg-slate-50 text-slate-700'
  if ((health.alarms ?? []).length > 0) return 'border-rose-200 bg-rose-50 text-rose-800'
  if (!health.job_exists || !health.archive_exists) return 'border-amber-200 bg-amber-50 text-amber-800'
  if (health.status === 'SENT' && health.delivery_succeeded) return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (health.status === 'FAILED') return 'border-rose-200 bg-rose-50 text-rose-800'
  return 'border-sky-200 bg-sky-50 text-sky-800'
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

const LIST_PAGE_SIZE = 35
const PUSH_VAPID_KEY_STORAGE = 'pf_admin_push_vapid_public_key'

async function ensureAdminPushSubscription(vapidPublicKey: string): Promise<PushSubscription> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Bu tarayici push bildirimlerini desteklemiyor.')
  }

  const permission =
    Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error('Bildirim izni verilmedi.')
  }

  const swUrl = `${import.meta.env.BASE_URL}admin-sw.js`
  const registration = await navigator.serviceWorker.register(swUrl, {
    scope: import.meta.env.BASE_URL,
  })

  let subscription = await registration.pushManager.getSubscription()
  const savedVapidKey = window.localStorage.getItem(PUSH_VAPID_KEY_STORAGE)
  if (subscription && savedVapidKey && savedVapidKey !== vapidPublicKey) {
    try {
      await subscription.unsubscribe()
    } catch {
      // best effort
    }
    subscription = null
  }

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as unknown as BufferSource,
    })
  }

  return subscription
}

export function NotificationsPage() {
  const queryClient = useQueryClient()
  const { pushToast } = useToast()
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()

  const [title, setTitle] = useState('Puantaj Bildirimi')
  const [message, setMessage] = useState('')
  const [password, setPassword] = useState('')
  const [target, setTarget] = useState<'employees' | 'admins' | 'both'>('employees')
  const [expiresIn, setExpiresIn] = useState(15)
  const [jobsStatus, setJobsStatus] = useState<'' | NotificationJobStatus>('')
  const [jobNotificationType, setJobNotificationType] = useState('')
  const [jobRiskLevel, setJobRiskLevel] = useState<'' | 'Bilgi' | 'Uyari' | 'Kritik'>('')
  const [jobAudience, setJobAudience] = useState<'' | 'employee' | 'admin'>('')
  const [jobEmployeeId, setJobEmployeeId] = useState('')
  const [jobStartDate, setJobStartDate] = useState('')
  const [jobEndDate, setJobEndDate] = useState('')
  const [jobsPage, setJobsPage] = useState(1)
  const [deliveryPage, setDeliveryPage] = useState(1)
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
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null)
  const [selectedDeliveryLogId, setSelectedDeliveryLogId] = useState<number | null>(null)
  const [jobNoteDraft, setJobNoteDraft] = useState('')
  const [emailTargetsText, setEmailTargetsText] = useState('')
  const [emailTestRecipient, setEmailTestRecipient] = useState('')
  const [emailTestSubject, setEmailTestSubject] = useState('Puantaj test email bildirimi')
  const [emailTestMessage, setEmailTestMessage] = useState('Bu mesaj admin bildirim email testidir.')

  const employeesQuery = useQuery({ queryKey: ['employees', 'notify'], queryFn: () => getEmployees({ status: 'active' }) })
  const adminsQuery = useQuery({ queryKey: ['admin-users', 'notify'], queryFn: getAdminUsers })
  const pushConfigQuery = useQuery({ queryKey: ['admin-push-config'], queryFn: getAdminPushConfig })
  const dailyReportHealthQuery = useQuery({
    queryKey: ['admin-daily-report-health'],
    queryFn: getAdminDailyReportHealth,
    refetchInterval: 30000,
    retry: false,
  })
  const emailTargetsQuery = useQuery({
    queryKey: ['admin-notification-email-targets'],
    queryFn: getAdminNotificationEmailTargets,
    retry: false,
  })
  const adminSelfCheckQuery = useQuery({
    queryKey: ['admin-push-self-check'],
    queryFn: getAdminPushSelfCheck,
    refetchInterval: 15000,
    retry: false,
  })
  const jobsQuery = useQuery({
    queryKey: [
      'notification-jobs',
      jobsStatus,
      jobNotificationType,
      jobRiskLevel,
      jobAudience,
      jobEmployeeId,
      jobStartDate,
      jobEndDate,
      jobsPage,
    ],
    queryFn: () =>
      getNotificationJobs({
        status: jobsStatus || undefined,
        notification_type: jobNotificationType.trim() || undefined,
        risk_level: jobRiskLevel || undefined,
        audience: jobAudience || undefined,
        employee_id: Number(jobEmployeeId) > 0 ? Number(jobEmployeeId) : undefined,
        start_date: jobStartDate || undefined,
        end_date: jobEndDate || undefined,
        offset: (jobsPage - 1) * LIST_PAGE_SIZE,
        limit: LIST_PAGE_SIZE,
      }),
    refetchInterval: 10000,
  })
  const deliveryLogsQuery = useQuery({
    queryKey: ['notification-delivery-logs', deliveryPage],
    queryFn: () =>
      getNotificationDeliveryLogs({
        offset: (deliveryPage - 1) * LIST_PAGE_SIZE,
        limit: LIST_PAGE_SIZE,
      }),
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

  const selectedJob = useMemo<NotificationJob | null>(
    () => (jobsQuery.data?.items ?? []).find((row) => row.id === selectedJobId) ?? null,
    [jobsQuery.data, selectedJobId],
  )
  const selectedJobTimelineQuery = useQuery({
    queryKey: ['notification-job-timeline', selectedJob?.id, selectedJob?.employee_id, selectedJob?.local_day],
    queryFn: () =>
      getAttendanceEvents({
        employee_id: selectedJob?.employee_id ?? undefined,
        start_date: selectedJob?.local_day ?? undefined,
        end_date: selectedJob?.local_day ?? undefined,
        limit: 50,
      }),
    enabled:
      selectedJob !== null
      && typeof selectedJob.employee_id === 'number'
      && selectedJob.employee_id > 0
      && typeof selectedJob.local_day === 'string'
      && selectedJob.local_day.length > 0,
    refetchInterval: 15000,
  })
  const archivesQuery = useQuery({
    queryKey: ['daily-archives', archiveStartDate, archiveEndDate, archiveEmployeeQuery, archivePage],
    queryFn: () =>
      getDailyReportArchives({
        offset: (archivePage - 1) * LIST_PAGE_SIZE,
        limit: LIST_PAGE_SIZE,
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
    const rows = deliveryLogsQuery.data?.items ?? []
    if (!q) return rows
    return rows.filter((row) => {
      const parts = [
        row.recipient_name ?? '',
        row.recipient_address ?? '',
        String(row.recipient_id ?? ''),
        String(row.device_id ?? ''),
        row.ip ?? '',
        row.status,
        row.channel,
        row.notification_type ?? '',
        row.audience ?? '',
        row.event_id,
        row.title ?? '',
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
    () => filteredDeliveryLogs.find((row) => row.id === selectedDeliveryLogId) ?? null,
    [filteredDeliveryLogs, selectedDeliveryLogId],
  )

  const jobsRows = jobsQuery.data?.items ?? []
  const jobsTotal = jobsQuery.data?.total ?? 0
  const jobsTotalPages = Math.max(1, Math.ceil(jobsTotal / LIST_PAGE_SIZE))
  const jobsRangeStart = jobsTotal === 0 ? 0 : (jobsPage - 1) * LIST_PAGE_SIZE + 1
  const jobsRangeEnd = jobsRows.length === 0 ? 0 : jobsRangeStart + jobsRows.length - 1

  const deliveryTotal = deliveryLogsQuery.data?.total ?? 0
  const deliveryTotalPages = Math.max(1, Math.ceil(deliveryTotal / LIST_PAGE_SIZE))
  const deliveryRangeStart = deliveryTotal === 0 ? 0 : (deliveryPage - 1) * LIST_PAGE_SIZE + 1
  const deliveryRangeEnd = filteredDeliveryLogs.length === 0 ? 0 : deliveryRangeStart + filteredDeliveryLogs.length - 1

  const archiveRows = archivesQuery.data?.items ?? []
  const archiveTotal = archivesQuery.data?.total ?? 0
  const archiveTotalPages = Math.max(1, Math.ceil(archiveTotal / LIST_PAGE_SIZE))
  const archiveRangeStart = archiveTotal === 0 ? 0 : (archivePage - 1) * LIST_PAGE_SIZE + 1
  const archiveRangeEnd = archiveRows.length === 0 ? 0 : archiveRangeStart + archiveRows.length - 1
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
  const selfCheckData = adminSelfCheckQuery.data
  const selfCheckOk = selfCheckData?.self_check_ok !== false
  const effectiveSelfCheckData = selfCheckOk ? selfCheckData : undefined
  const currentAdminClaimCount = effectiveSelfCheckData?.active_claims_for_actor ?? fallbackCurrentAdminClaimBreakdown.total
  const currentAdminClaimCountById =
    effectiveSelfCheckData?.active_claims_for_actor_by_id ?? fallbackCurrentAdminClaimBreakdown.byId
  const currentAdminClaimCountByUsername =
    effectiveSelfCheckData?.active_claims_for_actor_by_username ?? fallbackCurrentAdminClaimBreakdown.byUsername
  const currentAdminHasActiveClaim = currentAdminClaimCount > 0
  const dailyReportHealth = dailyReportHealthQuery.data
  const dailyReportAlarmCount = dailyReportHealth?.alarms?.length ?? 0
  const dailyReportStatusText = dailyReportHealth?.status ?? (dailyReportHealth?.job_exists ? 'BILINMIYOR' : 'YOK')
  const dailyReportIsHealthy =
    dailyReportAlarmCount === 0
    && !!dailyReportHealth?.job_exists
    && !!dailyReportHealth?.archive_exists
    && dailyReportHealth?.status === 'SENT'
    && !!dailyReportHealth?.delivery_succeeded
  const configuredEmailTargets = emailTargetsQuery.data?.active_recipients ?? []
  const configuredEmailTargetCount = emailTargetsQuery.data?.active_count ?? 0

  useEffect(() => {
    if (!emailTargetsQuery.data) return
    setEmailTargetsText((prev) => (prev.trim().length > 0 ? prev : configuredEmailTargets.join('\n')))
  }, [emailTargetsQuery.data, configuredEmailTargets])

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

  const healMutation = useMutation({
    mutationFn: async () => {
      const pushConfig = await getAdminPushConfig()
      if (!pushConfig.enabled || !pushConfig.vapid_public_key) {
        throw new Error('Push bildirim servisi yapilandirilmamis.')
      }
      const subscription = await ensureAdminPushSubscription(pushConfig.vapid_public_key)
      const result = await healAdminDevice({
        subscription: subscription.toJSON() as Record<string, unknown>,
        send_test: true,
      })
      window.localStorage.setItem(PUSH_VAPID_KEY_STORAGE, pushConfig.vapid_public_key)
      return result
    },
    onSuccess: (result) => {
      pushToast({
        variant: result.test_push_ok ? 'success' : 'error',
        title: result.test_push_ok ? 'Heal tamamlandi' : 'Heal tamamlandi ama test hatali',
        description: result.test_push_ok
          ? `Abonelik yenilendi (#${result.subscription_id}) ve test bildirimi gonderildi.`
          : `Abonelik yenilendi (#${result.subscription_id}) ancak test bildirimi hatali.`,
      })
      void queryClient.invalidateQueries({ queryKey: ['admin-push-self-check'] })
      void queryClient.invalidateQueries({ queryKey: ['notify-subs-admin'] })
      void queryClient.invalidateQueries({ queryKey: ['notification-delivery-logs'] })
    },
    onError: (error) => {
      if (error instanceof Error && !('response' in error)) {
        pushToast({ variant: 'error', title: 'Heal hatasi', description: error.message })
        return
      }
      const parsed = parseApiError(error, 'Cihaz heal islemi basarisiz oldu.')
      pushToast({ variant: 'error', title: 'Heal hatasi', description: parsed.message })
    },
  })

  const saveEmailTargetsMutation = useMutation({
    mutationFn: async () => {
      const emails = Array.from(
        new Set(
          emailTargetsText
            .split(/[\n,;]+/g)
            .map((item) => item.trim().toLowerCase())
            .filter((item) => item.length > 0),
        ),
      )
      return updateAdminNotificationEmailTargets({ emails })
    },
    onSuccess: (result) => {
      setEmailTargetsText((result.active_recipients ?? []).join('\n'))
      pushToast({
        variant: 'success',
        title: 'Mail alicilari guncellendi',
        description: `Aktif alici: ${result.active_count}`,
      })
      void queryClient.invalidateQueries({ queryKey: ['admin-notification-email-targets'] })
    },
    onError: (error) => {
      const parsed = parseApiError(error, 'Mail alicilari kaydedilemedi.')
      pushToast({ variant: 'error', title: 'Kayit hatasi', description: parsed.message })
    },
  })

  const testEmailMutation = useMutation({
    mutationFn: async () => {
      const target = emailTestRecipient.trim()
      return sendAdminNotificationEmailTest({
        recipients: target ? [target] : undefined,
        subject: emailTestSubject.trim() || undefined,
        message: emailTestMessage.trim() || undefined,
      })
    },
    onSuccess: (result) => {
      if (!result.ok) {
        pushToast({
          variant: 'error',
          title: 'Test mail gonderilemedi',
          description: `${result.error ?? result.mode} | Alici: ${result.recipients.join(', ') || '-'}`,
        })
        return
      }
      pushToast({
        variant: 'success',
        title: 'Test mail gonderildi',
        description: `Alici: ${result.recipients.join(', ')} | Sent: ${result.sent}`,
      })
    },
    onError: (error) => {
      const parsed = parseApiError(error, 'Test mail gonderilemedi.')
      pushToast({ variant: 'error', title: 'Test mail hatasi', description: parsed.message })
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

  const updateJobNoteMutation = useMutation({
    mutationFn: ({ jobId, note }: { jobId: number; note: string | null }) => updateNotificationJobNote(jobId, note),
    onSuccess: () => {
      pushToast({ variant: 'success', title: 'Bildirim notu kaydedildi', description: 'Admin aciklamasi guncellendi.' })
      void queryClient.invalidateQueries({ queryKey: ['notification-jobs'] })
    },
    onError: (error) => {
      const parsed = parseApiError(error, 'Bildirim notu kaydedilemedi.')
      pushToast({ variant: 'error', title: 'Not kayit hatasi', description: parsed.message })
    },
  })

  const downloadMutation = useMutation({
    mutationFn: downloadDailyReportArchive,
    onSuccess: (blob, id) => {
      const item = (archivesQuery.data?.items ?? []).find((x) => x.id === id)
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
      void queryClient.invalidateQueries({ queryKey: ['admin-daily-report-health'] })
    },
    onError: (error) => {
      const parsed = parseApiError(error, 'Arsiv bildirimi gonderilemedi.')
      if (parsed.code === 'ADMIN_PUSH_SUBSCRIPTION_REQUIRED') {
        pushToast({
          variant: 'error',
          title: 'Admin hedefi 0',
          description: 'Aktif admin push aboneligi yok. Once admin cihazini claim edip tekrar deneyin.',
        })
      } else {
        pushToast({ variant: 'error', title: 'Arsiv bildirimi basarisiz', description: parsed.message })
      }
      void queryClient.invalidateQueries({ queryKey: ['admin-daily-report-health'] })
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
    const archiveRow = (archivesQuery.data?.items ?? []).find((x) => x.id === archiveId)
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
    const rawJobId = searchParams.get('job_id')
    if (!rawJobId) return
    const jobId = Number(rawJobId)
    if (!Number.isInteger(jobId) || jobId <= 0) return
    setSelectedJobId(jobId)
  }, [searchParams])

  useEffect(() => {
    setJobsPage(1)
  }, [jobsStatus, jobNotificationType, jobRiskLevel, jobAudience, jobEmployeeId, jobStartDate, jobEndDate])

  useEffect(() => {
    if (!jobsQuery.data) return
    setJobsPage((prev) => {
      if (prev < 1) return 1
      if (prev > jobsTotalPages) return jobsTotalPages
      return prev
    })
  }, [jobsQuery.data, jobsTotalPages])

  useEffect(() => {
    const rows = jobsQuery.data?.items ?? []
    if (rows.length === 0) {
      setSelectedJobId(null)
      return
    }
    if (selectedJobId === null || !rows.some((row) => row.id === selectedJobId)) {
      setSelectedJobId(rows[0].id)
    }
  }, [jobsQuery.data, selectedJobId])

  useEffect(() => {
    setJobNoteDraft(selectedJob?.admin_note ?? '')
  }, [selectedJob?.id, selectedJob?.admin_note])

  useEffect(() => {
    setDeliveryPage(1)
  }, [deliverySearch])

  useEffect(() => {
    if (!deliveryLogsQuery.data) return
    setDeliveryPage((prev) => {
      if (prev < 1) return 1
      if (prev > deliveryTotalPages) return deliveryTotalPages
      return prev
    })
  }, [deliveryLogsQuery.data, deliveryTotalPages])

  useEffect(() => {
    setArchivePage(1)
  }, [archiveStartDate, archiveEndDate, archiveEmployeeQuery])

  useEffect(() => {
    if (filteredDeliveryLogs.length === 0) {
      setSelectedDeliveryLogId(null)
      return
    }
    if (selectedDeliveryLogId === null || !filteredDeliveryLogs.some((row) => row.id === selectedDeliveryLogId)) {
      setSelectedDeliveryLogId(filteredDeliveryLogs[0].id)
    }
  }, [filteredDeliveryLogs, selectedDeliveryLogId])

  useEffect(() => {
    if (!archivesQuery.data) return
    setArchivePage((prev) => {
      if (prev < 1) return 1
      if (prev > archiveTotalPages) return archiveTotalPages
      return prev
    })
  }, [archivesQuery.data, archiveTotalPages])

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
              max={1440}
              value={expiresIn}
              onChange={(e) => setExpiresIn(Number(e.target.value || 15))}
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
        <p className="mt-2 text-xs text-slate-500">
          Link otomatik kopyalanir. Guvenlik icin kisa sure onerilir (ornegin 10-30 dk). Ekran: /admin-panel/device-claim?token=...
        </p>
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
        <div className="mt-3 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
          <select value={jobsStatus} onChange={(e) => setJobsStatus(e.target.value as '' | NotificationJobStatus)} className="rounded border border-slate-300 px-3 py-2 text-sm">
            <option value="">Durum: Tumu</option>
            <option value="PENDING">PENDING</option>
            <option value="SENDING">SENDING</option>
            <option value="SENT">SENT</option>
            <option value="FAILED">FAILED</option>
            <option value="CANCELED">CANCELED</option>
          </select>
          <input
            value={jobNotificationType}
            onChange={(e) => setJobNotificationType(e.target.value)}
            className="rounded border border-slate-300 px-3 py-2 text-sm"
            placeholder="Tur or. erken_cikis"
          />
          <select value={jobRiskLevel} onChange={(e) => setJobRiskLevel(e.target.value as '' | 'Bilgi' | 'Uyari' | 'Kritik')} className="rounded border border-slate-300 px-3 py-2 text-sm">
            <option value="">Risk: Tumu</option>
            <option value="Bilgi">Bilgi</option>
            <option value="Uyari">Uyari</option>
            <option value="Kritik">Kritik</option>
          </select>
          <select value={jobAudience} onChange={(e) => setJobAudience(e.target.value as '' | 'employee' | 'admin')} className="rounded border border-slate-300 px-3 py-2 text-sm">
            <option value="">Hedef: Tumu</option>
            <option value="employee">Calisan</option>
            <option value="admin">Admin</option>
          </select>
          <input
            value={jobEmployeeId}
            onChange={(e) => setJobEmployeeId(e.target.value)}
            className="rounded border border-slate-300 px-3 py-2 text-sm"
            placeholder="Personel ID"
          />
          <button type="button" onClick={() => void jobsQuery.refetch()} className="rounded border border-slate-300 px-3 py-2 text-sm">Listeyi yenile</button>
          <input type="date" value={jobStartDate} onChange={(e) => setJobStartDate(e.target.value)} className="rounded border border-slate-300 px-3 py-2 text-sm" />
          <input type="date" value={jobEndDate} onChange={(e) => setJobEndDate(e.target.value)} className="rounded border border-slate-300 px-3 py-2 text-sm" />
        </div>
        {jobsQuery.isLoading ? <LoadingBlock label="Yukleniyor..." /> : null}
        {jobsQuery.isError ? <ErrorBlock message="Job listesi alinamadi." /> : null}
        {!jobsQuery.isLoading && !jobsQuery.isError ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <span>
              Gosterilen satir: {jobsRangeStart}-{jobsRangeEnd} / {jobsTotal}
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
        <div className="mt-3 grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="max-h-[620px] overflow-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-left text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="text-xs uppercase text-slate-500">
                  <th className="px-2 py-2">Sira</th>
                  <th className="px-2 py-2">Tur</th>
                  <th className="px-2 py-2">Risk</th>
                  <th className="px-2 py-2">Hedef</th>
                  <th className="px-2 py-2">Personel</th>
                  <th className="px-2 py-2">Baslik</th>
                  <th className="px-2 py-2">Durum</th>
                  <th className="px-2 py-2">Olay</th>
                </tr>
              </thead>
              <tbody>
                {jobsRows.map((job, index) => {
                  const isSelected = job.id === selectedJobId
                  return (
                    <tr
                      key={job.id}
                      className={`border-t border-slate-100 ${isSelected ? 'bg-sky-50' : 'hover:bg-slate-50'} cursor-pointer`}
                      onClick={() => setSelectedJobId(job.id)}
                    >
                      <td className="px-2 py-2 text-slate-500">{jobsRangeStart + index}</td>
                      <td className="px-2 py-2 font-medium text-slate-700">{job.notification_type ?? job.job_type}</td>
                      <td className="px-2 py-2">
                        <span className={`rounded px-2 py-1 text-xs ${riskBadgeClass(job.risk_level)}`}>{job.risk_level ?? '-'}</span>
                      </td>
                      <td className="px-2 py-2">{audienceLabel(job.audience)}</td>
                      <td className="px-2 py-2">#{job.employee_id ?? '-'}</td>
                      <td className="px-2 py-2 max-w-56 truncate" title={job.title ?? ''}>{job.title ?? '-'}</td>
                      <td className="px-2 py-2">
                        <span className={`rounded px-2 py-1 text-xs ${statusClass(job.status)}`}>{job.status}</span>
                      </td>
                      <td className="px-2 py-2">{job.event_ts_utc ? dt(job.event_ts_utc) : dt(job.scheduled_at_utc)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <aside className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <h5 className="text-sm font-semibold text-slate-900">Secili bildirim detayi</h5>
            {selectedJob === null ? (
              <p className="mt-3 text-sm text-slate-600">Listeden bir bildirim secin.</p>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">
                  <p><span className="font-semibold">Baslik:</span> {selectedJob.title ?? '-'}</p>
                  <p><span className="font-semibold">Aciklama:</span> {selectedJob.description ?? '-'}</p>
                  <p><span className="font-semibold">Olay Zamani:</span> {selectedJob.event_ts_utc ? dt(selectedJob.event_ts_utc) : '-'}</p>
                  <p><span className="font-semibold">Vardiya Bilgisi:</span> {selectedJob.shift_summary ?? '-'}</p>
                  <p><span className="font-semibold">Gerceklesen Saat:</span> {selectedJob.actual_time_summary ?? '-'}</p>
                  <p><span className="font-semibold">Risk Seviyesi:</span> {selectedJob.risk_level ?? '-'}</p>
                  <p><span className="font-semibold">Islem Onerisi:</span> {selectedJob.suggested_action ?? '-'}</p>
                  <p><span className="font-semibold">Event ID:</span> {selectedJob.event_id ?? '-'}</p>
                  <p><span className="font-semibold">Personel:</span> #{selectedJob.employee_id ?? '-'} </p>
                  <p><span className="font-semibold">Hedef:</span> {audienceLabel(selectedJob.audience)}</p>
                  {selectedJob.status === 'PENDING' || selectedJob.status === 'SENDING' ? (
                    <button
                      type="button"
                      className="mt-2 rounded border border-rose-300 px-3 py-2 text-xs text-rose-700"
                      onClick={() => cancelMutation.mutate(selectedJob.id)}
                    >
                      Bildirimi iptal et
                    </button>
                  ) : null}
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-2">
                    <h6 className="text-sm font-semibold text-slate-900">Gun timeline'i</h6>
                    {selectedJob.employee_id && selectedJob.local_day ? (
                      <Link
                        to={`/attendance-events?employee_id=${selectedJob.employee_id}&start_date=${selectedJob.local_day}&end_date=${selectedJob.local_day}`}
                        className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700"
                      >
                        Manuel duzeltme ekranini ac
                      </Link>
                    ) : null}
                  </div>
                  {selectedJobTimelineQuery.isLoading ? <LoadingBlock label="Timeline yukleniyor..." /> : null}
                  {selectedJobTimelineQuery.isError ? <ErrorBlock message="Timeline alinamadi." /> : null}
                  {!selectedJobTimelineQuery.isLoading && !selectedJobTimelineQuery.isError ? (
                    <div className="mt-2 space-y-2">
                      {(selectedJobTimelineQuery.data ?? []).length === 0 ? (
                        <p className="text-sm text-slate-500">Bu gun icin timeline kaydi bulunamadi.</p>
                      ) : (
                        (selectedJobTimelineQuery.data ?? []).map((event) => (
                          <div key={event.id} className="rounded border border-slate-200 bg-slate-50 p-2 text-sm text-slate-700">
                            <div className="flex items-center justify-between gap-2">
                              <strong>{timelineEventLabel(event)}</strong>
                              <span>{dt(event.ts_utc)}</span>
                            </div>
                            {event.note ? <p className="mt-1 text-xs text-slate-600">Not: {event.note}</p> : null}
                          </div>
                        ))
                      )}
                    </div>
                  ) : null}
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <h6 className="text-sm font-semibold text-slate-900">Admin aciklamasi</h6>
                  <textarea
                    value={jobNoteDraft}
                    onChange={(e) => setJobNoteDraft(e.target.value)}
                    rows={4}
                    className="mt-2 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                    placeholder="Bildirimle ilgili operasyon notu ekleyin"
                  />
                  <button
                    type="button"
                    onClick={() => updateJobNoteMutation.mutate({ jobId: selectedJob.id, note: jobNoteDraft.trim() || null })}
                    disabled={updateJobNoteMutation.isPending}
                    className="mt-2 rounded border border-brand-300 px-3 py-2 text-sm text-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {updateJobNoteMutation.isPending ? 'Kaydediliyor...' : 'Aciklamayi kaydet'}
                  </button>
                </div>
              </div>
            )}
          </aside>
        </div>
        {!jobsQuery.isLoading && !jobsQuery.isError && jobsTotal === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Filtreye uygun bildirim isi bulunamadi.</p>
        ) : null}
      </Panel>

      <Panel>
        <h4 className="text-base font-semibold text-slate-900">Abonelik Ozeti</h4>
        <div className="grid gap-2 md:grid-cols-4">
          <div className="rounded border border-slate-200 p-3 text-sm">Calisan abonelik: {(employeeSubsQuery.data ?? []).length}</div>
          <div className="rounded border border-slate-200 p-3 text-sm">Admin abonelik: {(adminSubsQuery.data ?? []).length}</div>
          <div className="rounded border border-slate-200 p-3 text-sm">Arsiv dosyasi: {archiveTotal}</div>
          <div className="rounded border border-slate-200 p-3 text-sm">Teslimat log satiri: {deliveryTotal}</div>
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
              (effectiveSelfCheckData?.push_enabled ?? pushConfigQuery.data?.enabled)
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-rose-200 bg-rose-50 text-rose-800'
            }`}
          >
            Push config:{' '}
            <strong>{(effectiveSelfCheckData?.push_enabled ?? pushConfigQuery.data?.enabled) ? 'Aktif' : 'Pasif'}</strong>
          </div>
        </div>
        <div className="mt-2 grid gap-2 md:grid-cols-4">
          <div className="rounded border border-slate-200 p-3 text-sm">
            Toplam aktif admin claim: <strong>{effectiveSelfCheckData?.active_total_subscriptions ?? activeAdminSubscriptionCount}</strong>
          </div>
          <div className="rounded border border-slate-200 p-3 text-sm">
            Son claim gorulme:{' '}
            <strong>{effectiveSelfCheckData?.latest_claim_seen_at ? dt(effectiveSelfCheckData.latest_claim_seen_at) : '-'}</strong>
          </div>
          <div className="rounded border border-slate-200 p-3 text-sm">
            Claim saglik:{' '}
            <strong>
              saglikli {effectiveSelfCheckData?.active_claims_healthy ?? 0}
              {' / '}
              hatali {effectiveSelfCheckData?.active_claims_with_error ?? 0}
              {' / '}
              stale {effectiveSelfCheckData?.active_claims_stale ?? 0}
            </strong>
          </div>
          <div className="flex items-end">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => selfTestMutation.mutate()}
                disabled={selfTestMutation.isPending || healMutation.isPending}
                className="rounded border border-brand-300 px-3 py-2 text-sm text-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {selfTestMutation.isPending ? 'Self-test gonderiliyor...' : 'Kendime test bildirimi gonder'}
              </button>
              <button
                type="button"
                onClick={() => healMutation.mutate()}
                disabled={healMutation.isPending || selfTestMutation.isPending}
                className="rounded border border-emerald-300 px-3 py-2 text-sm text-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {healMutation.isPending ? 'Heal calisiyor...' : 'Bu cihazi heal et'}
              </button>
            </div>
          </div>
        </div>
        <div className="mt-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          Son self-test:{' '}
          <strong>
            {effectiveSelfCheckData?.last_self_test_at ? dt(effectiveSelfCheckData.last_self_test_at) : '-'}
          </strong>
          {' | '}
          Durum:{' '}
          <strong>
            {effectiveSelfCheckData?.last_self_test_success === null
              ? '-'
              : effectiveSelfCheckData?.last_self_test_success
                ? 'BASARILI'
                : 'HATALI'}
          </strong>
          {' | '}
          Hedef:{' '}
          <strong>{effectiveSelfCheckData?.last_self_test_total_targets ?? '-'}</strong>
          {' | '}
          Gonderilen:{' '}
          <strong>{effectiveSelfCheckData?.last_self_test_sent ?? '-'}</strong>
          {' | '}
          Hata:{' '}
          <strong>{effectiveSelfCheckData?.last_self_test_failed ?? '-'}</strong>
        </div>
        {adminSelfCheckQuery.isError ? (
          <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Self-check verisi alinamadi. Fallback olarak abonelik listesi kullaniliyor.
          </p>
        ) : null}
        {adminSelfCheckQuery.data?.self_check_ok === false ? (
          <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Self-check degradasyona dustu: {adminSelfCheckQuery.data.self_check_error || 'bilinmeyen hata'}. Fallback olarak abonelik listesi kullaniliyor.
          </p>
        ) : null}
        {!currentAdminHasActiveClaim ? (
          <p className="mt-2 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            Bu admin hesabinda aktif cihaz claim gorunmuyor. Bildirim almak icin telefonda claim linkini acip izin adimini tamamla.
          </p>
        ) : null}
        {effectiveSelfCheckData?.latest_claim_error ? (
          <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Son claim hatasi: {effectiveSelfCheckData.latest_claim_error}
          </p>
        ) : null}
      </Panel>

      <Panel>
        <h4 className="text-base font-semibold text-slate-900">Mail Bildirim Ayarlari</h4>
        <p className="mt-1 text-xs text-slate-500">
          Gece gunluk Excel arsiv job&apos;unda mail gonderimi best-effort calisir; push teslimati onceliklidir.
        </p>

        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <div className="rounded border border-slate-200 p-3 text-sm">
            Aktif mail alicisi: <strong>{configuredEmailTargetCount}</strong>
          </div>
          <div className="rounded border border-slate-200 p-3 text-sm">
            Son health email: <strong>{dailyReportHealth?.email_sent ?? 0}</strong>
          </div>
          <button
            type="button"
            onClick={() => void emailTargetsQuery.refetch()}
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          >
            Mail listesini yenile
          </button>
        </div>

        {emailTargetsQuery.isError ? (
          <p className="mt-2 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            Mail hedefleri yuklenemedi.
          </p>
        ) : null}
        {configuredEmailTargetCount <= 0 ? (
          <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Aktif mail alicisi yok. Mail kanali devre disi kalir, push bildirimi calismaya devam eder.
          </p>
        ) : null}

        <label className="mt-3 block text-xs text-slate-600">
          Alici listesi (satir satir veya virgul ile)
          <textarea
            value={emailTargetsText}
            onChange={(event) => setEmailTargetsText(event.target.value)}
            rows={5}
            placeholder="ornek@domain.com&#10;destek@domain.com"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => saveEmailTargetsMutation.mutate()}
            disabled={saveEmailTargetsMutation.isPending}
            className="rounded border border-brand-300 bg-brand-50 px-3 py-2 text-sm text-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saveEmailTargetsMutation.isPending ? 'Kaydediliyor...' : 'Mail alicilarini kaydet'}
          </button>
          <button
            type="button"
            onClick={() => setEmailTargetsText(configuredEmailTargets.join('\n'))}
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          >
            Listeyi geri al
          </button>
        </div>

        <div className="mt-4 rounded border border-slate-200 bg-slate-50 p-3">
          <h5 className="text-sm font-semibold text-slate-900">Test mail gonder</h5>
          <p className="mt-1 text-xs text-slate-600">
            Alici bos birakilirsa kayitli tum aktif adreslere test mail gonderilir.
          </p>
          <div className="mt-2 grid gap-2 md:grid-cols-3">
            <label className="text-xs text-slate-600">
              Test alici (opsiyonel)
              <input
                value={emailTestRecipient}
                onChange={(event) => setEmailTestRecipient(event.target.value)}
                placeholder="tekbir@adres.com"
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-xs text-slate-600 md:col-span-2">
              Konu
              <input
                value={emailTestSubject}
                onChange={(event) => setEmailTestSubject(event.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
          </div>
          <label className="mt-2 block text-xs text-slate-600">
            Mesaj
            <textarea
              value={emailTestMessage}
              onChange={(event) => setEmailTestMessage(event.target.value)}
              rows={3}
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={() => testEmailMutation.mutate()}
            disabled={testEmailMutation.isPending}
            className="mt-2 rounded border border-slate-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            {testEmailMutation.isPending ? 'Test gonderiliyor...' : 'Test mail gonder'}
          </button>
        </div>
      </Panel>

      <Panel>
        <h4 className="text-base font-semibold text-slate-900">Bildirim Teslimat Logu</h4>
        <p className="mt-1 text-xs text-slate-500">
          Kime gitti / gitmedi, isim-ID, cihaz, IP ve hata bilgisini izleyin.
        </p>

        <div className="mt-3 grid gap-2 md:grid-cols-4">
          <div className="rounded border border-slate-200 p-3 text-sm">
            Toplam satir: {deliveryTotal}
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

        {!deliveryLogsQuery.isLoading && !deliveryLogsQuery.isError ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <span>
              Gosterilen satir: {deliveryRangeStart}-{deliveryRangeEnd} / {deliveryTotal}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDeliveryPage((prev) => Math.max(1, prev - 1))}
                disabled={deliveryPage <= 1}
                className="rounded border border-slate-300 px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
              >
                Onceki
              </button>
              <span>
                Sayfa {deliveryPage} / {deliveryTotalPages}
              </span>
              <button
                type="button"
                onClick={() => setDeliveryPage((prev) => Math.min(deliveryTotalPages, prev + 1))}
                disabled={deliveryPage >= deliveryTotalPages}
                className="rounded border border-slate-300 px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
              >
                Sonraki
              </button>
            </div>
          </div>
        ) : null}

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
                <span className="text-[11px] text-slate-400">{deliveryRangeStart}-{deliveryRangeEnd} / {deliveryTotal}</span>
              </div>

              <div className="max-h-[520px] overflow-auto">
                <table className="min-w-full table-fixed text-left text-xs">
                  <thead className="sticky top-0 bg-slate-900/95 text-[11px] uppercase text-slate-400">
                    <tr>
                      <th className="w-36 px-2 py-2">Zaman</th>
                      <th className="w-24 px-2 py-2">Durum</th>
                      <th className="w-24 px-2 py-2">Kanal</th>
                      <th className="w-24 px-2 py-2">Kitle</th>
                      <th className="w-56 px-2 py-2">Kisi</th>
                      <th className="w-40 px-2 py-2">Tur</th>
                      <th className="w-48 px-2 py-2">Baslik</th>
                      <th className="w-64 px-2 py-2">Hata</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDeliveryLogs.map((row, index) => {
                      const isSelected = row.id === selectedDeliveryLogId
                      return (
                        <tr
                          key={`${row.id}-${row.recipient_type}-${row.recipient_id ?? 0}-${row.device_id ?? 0}-${index}`}
                          onClick={() => setSelectedDeliveryLogId(row.id)}
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
                          <td className="px-2 py-2 text-slate-300 uppercase">{row.channel}</td>
                          <td className="px-2 py-2 text-slate-300">{audienceLabel(row.audience)}</td>
                          <td className="px-2 py-2 text-slate-300 truncate" title={`#${row.recipient_id ?? '-'} - ${row.recipient_name ?? '-'}`}>
                            #{row.recipient_id ?? '-'} - {row.recipient_name ?? '-'}
                          </td>
                          <td className="px-2 py-2 text-slate-300 truncate" title={row.notification_type ?? '-'}>
                            {row.notification_type ?? '-'}
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
                      <span className="font-semibold">Kitle:</span> {audienceLabel(selectedDeliveryLog.audience)}
                    </p>
                    <p>
                      <span className="font-semibold">Kisi:</span> #{selectedDeliveryLog.recipient_id ?? '-'} -{' '}
                      {selectedDeliveryLog.recipient_name ?? '-'}
                    </p>
                    <p>
                      <span className="font-semibold">E-posta:</span> {selectedDeliveryLog.recipient_address ?? '-'}
                    </p>
                    <p>
                      <span className="font-semibold">Tur:</span> {selectedDeliveryLog.notification_type ?? '-'}
                    </p>
                    <p>
                      <span className="font-semibold">Kanal:</span> {selectedDeliveryLog.channel.toUpperCase()}
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
                      <span className="font-semibold">Event ID:</span> {selectedDeliveryLog.event_id}
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
        <div className="mt-2 grid gap-2 md:grid-cols-4">
          <div className={`rounded border p-3 text-sm ${dailyReportStatusClass(dailyReportHealth)}`}>
            Gece job durumu: <strong>{dailyReportStatusText}</strong>
            <div className="mt-1 text-xs">
              Alarm: <strong>{dailyReportAlarmCount}</strong>
            </div>
          </div>
          <div className="rounded border border-slate-200 p-3 text-sm">
            Rapor tarihi: <strong>{dailyReportHealth?.report_date ?? '-'}</strong>
            <div className="mt-1 text-xs text-slate-600">
              Son kontrol: {dailyReportHealth?.evaluated_at_utc ? dt(dailyReportHealth.evaluated_at_utc) : '-'}
            </div>
          </div>
          <div className="rounded border border-slate-200 p-3 text-sm">
            Teslimat: <strong>{dailyReportHealth?.push_sent ?? 0}</strong> / {dailyReportHealth?.push_total_targets ?? 0}
            <div className="mt-1 text-xs text-slate-600">
              Push hata: {dailyReportHealth?.push_failed ?? 0} | Email: {dailyReportHealth?.email_sent ?? 0}
            </div>
          </div>
          <div className="rounded border border-slate-200 p-3 text-sm">
            Arsiv: <strong>{dailyReportHealth?.archive_exists ? `#${dailyReportHealth.archive_id}` : 'YOK'}</strong>
            <div className="mt-1 text-xs text-slate-600">
              Calisan: {dailyReportHealth?.archive_employee_count ?? 0} | Boyut: {((dailyReportHealth?.archive_file_size_bytes ?? 0) / 1024).toFixed(1)} KB
            </div>
          </div>
        </div>
        {dailyReportHealthQuery.isError ? (
          <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Gece 00:00 job health verisi alinamadi.
          </p>
        ) : null}
        {!dailyReportHealthQuery.isError && dailyReportHealth ? (
          <div className="mt-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            {dailyReportAlarmCount > 0 ? (
              <div className="flex flex-wrap gap-1">
                {dailyReportHealth.alarms.map((alarm) => (
                  <span key={alarm} className="rounded border border-rose-300 bg-rose-100 px-2 py-0.5 text-rose-800">
                    {dailyReportAlarmLabel(alarm)}
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-emerald-700">Alarm yok. Gece arsiv job durumu saglikli.</span>
            )}
          </div>
        ) : null}
        {dailyReportHealth?.target_zero ? (
          <p className="mt-2 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            Gece job hedefi 0 gorunuyor. Push claim veya mail alici listesi bos olabilir.
          </p>
        ) : null}
        {dailyReportHealth?.last_error ? (
          <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Son job hatasi: {dailyReportHealth.last_error}
          </p>
        ) : null}
        {dailyReportHealth && dailyReportIsHealthy ? (
          <p className="mt-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            Gece 00:00 job olustu, teslimat yapildi ve alarm bulunmuyor.
          </p>
        ) : null}
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
              Gosterilen satir: {archiveRangeStart}-{archiveRangeEnd} / {archiveTotal}
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
              {archiveRows.map((item, index) => (
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
        {!archivesQuery.isLoading && !archivesQuery.isError && archiveTotal === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Filtreye uygun arsiv kaydi bulunamadi.</p>
        ) : null}
      </Panel>
    </div>
  )
}
