import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { z } from 'zod'

import {
  createAdminLeaveMessage,
  createLeave,
  decideLeave,
  deleteLeave,
  downloadAdminLeaveAttachment,
  getEmployees,
  getLeaves,
  getLeaveThread,
} from '../api/admin'
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
  ANNUAL: 'YILLIK İZİN',
  SICK: 'RAPOR / HASTALIK',
  UNPAID: 'ÜCRETSİZ İZİN',
  EXCUSE: 'MAZERET İZNİ',
  PUBLIC_HOLIDAY: 'RESMİ TATİL',
}

function parsePositiveInt(value: string | null): number | null {
  if (!value) {
    return null
  }
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null
  }
  return parsed
}

function formatThreadDate(value: string | null | undefined): string {
  if (!value) {
    return '-'
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }
  return parsed.toLocaleString('tr-TR')
}

function formatAttachmentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 KB'
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.URL.revokeObjectURL(url)
}

export function LeavesPage() {
  const queryClient = useQueryClient()
  const { pushToast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()

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
  const [threadReplyDraft, setThreadReplyDraft] = useState('')

  const focusedLeaveId = useMemo(() => parsePositiveInt(searchParams.get('leave_id')), [searchParams])

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

  const leaveThreadQuery = useQuery({
    queryKey: ['leave-thread', focusedLeaveId ?? 'none'],
    queryFn: () => getLeaveThread(focusedLeaveId as number),
    enabled: focusedLeaveId !== null,
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
        title: leave.status === 'APPROVED' ? 'İzin onaylandı' : 'İzin reddedildi',
        description: `İzin #${leave.id} güncellendi.`,
      })
      void queryClient.invalidateQueries({ queryKey: ['leaves'] })
      void queryClient.invalidateQueries({ queryKey: ['leave-thread', leave.id] })
    },
    onError: (error) => {
      const parsed = parseApiError(error, 'İzin talebi güncellenemedi.')
      pushToast({
        variant: 'error',
        title: 'İzin kararı kaydedilemedi',
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
      if (focusedLeaveId === leaveId) {
        const next = new URLSearchParams(searchParams)
        next.delete('leave_id')
        next.delete('thread')
        setSearchParams(next, { replace: true })
        setThreadReplyDraft('')
      }
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

  const threadMessageMutation = useMutation({
    mutationFn: ({ leaveId, message }: { leaveId: number; message: string }) =>
      createAdminLeaveMessage(leaveId, { message }),
    onSuccess: (thread) => {
      setThreadReplyDraft('')
      queryClient.setQueryData(['leave-thread', thread.leave.id], thread)
      void queryClient.invalidateQueries({ queryKey: ['leaves'] })
      pushToast({
        variant: 'success',
        title: 'Mesaj gönderildi',
        description: `Çalışana izin talebi #${thread.leave.id} için yanıt iletildi.`,
      })
    },
    onError: (error) => {
      const parsed = parseApiError(error, 'Yazışma mesajı gönderilemedi.')
      pushToast({
        variant: 'error',
        title: 'Mesaj gönderilemedi',
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
    return <ErrorBlock message="Çalışan listesi alınamadı." />
  }

  const employees = employeesQuery.data ?? []
  const leaveRows = leavesQuery.data ?? []
  const pendingLeaveRows = pendingRequestsQuery.data ?? []
  const employeeNameById = new Map(employees.map((employee) => [employee.id, employee.full_name]))
  const busyDecisionLeaveId = decisionMutation.isPending ? decisionMutation.variables?.leaveId ?? null : null
  const activeThread = leaveThreadQuery.data
  const activeThreadLeave = activeThread?.leave ?? null
  const activeThreadEmployeeName =
    activeThreadLeave !== null
      ? employeeNameById.get(activeThreadLeave.employee_id) ?? `Çalışan #${activeThreadLeave.employee_id}`
      : null
  const openLeaveThread = (leaveId: number) => {
    const next = new URLSearchParams(searchParams)
    next.set('leave_id', String(leaveId))
    next.set('thread', '1')
    setSearchParams(next, { replace: true })
  }
  const closeLeaveThread = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('leave_id')
    next.delete('thread')
    setSearchParams(next, { replace: true })
    setThreadReplyDraft('')
  }
  const submitThreadReply = () => {
    const message = threadReplyDraft.trim()
    if (!focusedLeaveId) {
      return
    }
    if (message.length < 2) {
      pushToast({
        variant: 'info',
        title: 'Mesaj kısa',
        description: 'Yanıt göndermek için en az 2 karakter yazın.',
      })
      return
    }
    threadMessageMutation.mutate({ leaveId: focusedLeaveId, message })
  }
  const handleAttachmentDownload = async (
    leaveId: number,
    attachmentId: number,
    fileName: string,
  ) => {
    try {
      const result = await downloadAdminLeaveAttachment(leaveId, attachmentId)
      triggerBlobDownload(result.blob, result.file_name || fileName || `izin-belgesi-${attachmentId}`)
    } catch (error) {
      const parsed = parseApiError(error, 'Belge indirilemedi.')
      pushToast({
        variant: 'error',
        title: 'Belge indirilemedi',
        description: parsed.message,
      })
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="İzin Kayıtları" description="Yıllık izin, rapor ve mazeret kayıtlarını yönetin." />

      <Panel className="border-slate-200/90 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.12),_transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.96))]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">İzin Yazışması</p>
            <h4 className="mt-2 text-base font-semibold text-slate-900">
              {focusedLeaveId ? `Talep #${focusedLeaveId} için chat ekranı` : 'Admin mesaj merkezi'}
            </h4>
            <p className="mt-1 text-sm text-slate-500">
              Çalışan soruları buraya düşer. Bildirimden geldiğinde ilgili izin talebi bu panelde doğrudan açılır.
            </p>
          </div>
          {focusedLeaveId ? (
            <button
              type="button"
              onClick={closeLeaveThread}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Yazışmayı Kapat
            </button>
          ) : (
            <span className="rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-xs font-semibold text-slate-600">
              Bildirim uyumlu
            </span>
          )}
        </div>

        {!focusedLeaveId ? (
          <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 p-5 text-sm text-slate-600">
            Bir izin kaydında <strong>Yazışmayı Aç</strong> butonuna basın ya da admin bildirimiyle bu sayfaya gelin.
          </div>
        ) : leaveThreadQuery.isLoading ? (
          <div className="mt-4">
            <LoadingBlock />
          </div>
        ) : leaveThreadQuery.isError ? (
          <div className="mt-4">
            <ErrorBlock message="İzin yazışması yüklenemedi." />
          </div>
        ) : activeThread && activeThreadLeave ? (
          <div className="mt-4 space-y-4">
            <div className="grid gap-3 lg:grid-cols-[0.95fr_1.05fr]">
              <section className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Talep Özeti</p>
                    <h5 className="mt-2 text-lg font-semibold text-slate-900">{activeThreadEmployeeName}</h5>
                    <p className="mt-1 text-sm text-slate-600">
                      {leaveTypeLabels[activeThreadLeave.type]} · {activeThreadLeave.start_date} - {activeThreadLeave.end_date}
                    </p>
                  </div>
                  <StatusBadge value={activeThreadLeave.status} />
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Kaynak</p>
                    <p className="mt-2 text-sm font-medium text-slate-800">
                      {activeThreadLeave.requested_by_employee ? 'Çalışan talebi' : 'Admin kaydı'}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Son Mesaj</p>
                    <p className="mt-2 text-sm font-medium text-slate-800">
                      {formatThreadDate(activeThreadLeave.last_message_at || activeThreadLeave.created_at)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Mesaj Sayısı</p>
                    <p className="mt-2 text-sm font-medium text-slate-800">{activeThread.messages.length}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Belge Sayısı</p>
                    <p className="mt-2 text-sm font-medium text-slate-800">{activeThread.attachments.length}</p>
                  </div>
                </div>

                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Çalışan Gerekçesi</p>
                  <p className="mt-2 text-sm leading-6 text-slate-700">{activeThreadLeave.note || 'Açıklama girilmedi.'}</p>
                </div>

                {activeThread.attachments.length > 0 ? (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Ekli Belgeler</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {activeThread.attachments.map((attachment) => (
                        <button
                          key={attachment.id}
                          type="button"
                          onClick={() =>
                            void handleAttachmentDownload(activeThreadLeave.id, attachment.id, attachment.file_name)
                          }
                          className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                        >
                          <span className="block font-semibold">{attachment.file_name}</span>
                          <span className="block text-xs text-slate-500">
                            {attachment.uploaded_by_label} · {formatAttachmentSize(attachment.file_size_bytes)}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </section>

              <section className="rounded-2xl border border-slate-200 bg-slate-950 p-4 text-white shadow-[0_18px_36px_rgba(15,23,42,0.24)]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-200/80">Canlı Chat</p>
                    <h5 className="mt-2 text-lg font-semibold">Çalışanla konuş</h5>
                    <p className="mt-1 text-sm text-slate-300">
                      Soruları burada yanıtlayın. Mesaj çalışan uygulamasına bildirim olarak gider.
                    </p>
                  </div>
                  <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-semibold text-slate-200">
                    Talep #{activeThreadLeave.id}
                  </span>
                </div>

                <ol className="mt-4 space-y-3">
                  {activeThread.messages.length > 0 ? (
                    activeThread.messages.map((message) => (
                      <li
                        key={message.id}
                        className={`flex ${message.sender_actor === 'ADMIN' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[88%] rounded-2xl px-4 py-3 shadow-sm ${
                            message.sender_actor === 'ADMIN'
                              ? 'bg-sky-500 text-white'
                              : 'border border-white/10 bg-white/8 text-slate-100'
                          }`}
                        >
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] uppercase tracking-[0.14em]">
                            <span className={message.sender_actor === 'ADMIN' ? 'text-white/80' : 'text-sky-200/80'}>
                              {message.sender_label}
                            </span>
                            <span className={message.sender_actor === 'ADMIN' ? 'text-white/70' : 'text-slate-300'}>
                              {formatThreadDate(message.created_at)}
                            </span>
                          </div>
                          <p className="whitespace-pre-wrap text-sm leading-6">{message.message}</p>
                        </div>
                      </li>
                    ))
                  ) : (
                    <li className="rounded-2xl border border-dashed border-white/15 bg-white/5 px-4 py-4 text-sm text-slate-300">
                      Henüz yazışma başlamamış. İlk yanıtı sen verebilirsin.
                    </li>
                  )}
                </ol>

                <div className="mt-4 rounded-2xl border border-white/10 bg-white/6 p-3">
                  <label className="text-sm text-slate-200">
                    Çalışana yanıt
                    <textarea
                      value={threadReplyDraft}
                      onChange={(event) => setThreadReplyDraft(event.target.value)}
                      rows={4}
                      placeholder="Belgeyi gördüm, süreci şu aşamada... gibi net bir yanıt yaz."
                      className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-3 py-3 text-sm text-white placeholder:text-slate-400"
                    />
                  </label>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-slate-400">Mesaj gönderildiğinde çalışanın cihazına admin bildirimi düşer.</p>
                    <button
                      type="button"
                      onClick={submitThreadReply}
                      disabled={threadMessageMutation.isPending}
                      className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {threadMessageMutation.isPending ? 'Gönderiliyor...' : 'Yanıt Gönder'}
                    </button>
                  </div>
                </div>
              </section>
            </div>
          </div>
        ) : null}
      </Panel>

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-base font-semibold text-slate-900">Bekleyen Çalışan Talepleri</h4>
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
                  <article
                    key={leave.id}
                    className={`rounded-2xl border bg-slate-50 p-4 ${
                      focusedLeaveId === leave.id
                        ? 'border-sky-300 ring-2 ring-sky-200/70'
                        : 'border-slate-200'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          #{leave.id} - {employeeNameById.get(leave.employee_id) ?? leave.employee_id}
                        </p>
                        <p className="mt-1 text-sm text-slate-600">
                          {leaveTypeLabels[leave.type]} | {leave.start_date} - {leave.end_date}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">Talep tarihi: {leave.created_at}</p>
                        {leave.latest_message_preview ? (
                          <p className="mt-2 text-xs text-slate-600">Son mesaj: {leave.latest_message_preview}</p>
                        ) : null}
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
                      <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                        {leave.message_count ?? 0} mesaj
                      </span>
                      <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                        {leave.attachment_count ?? 0} belge
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => openLeaveThread(leave.id)}
                        className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-700 hover:bg-sky-100"
                      >
                        Yazışmayı Aç
                      </button>
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
                  <th className="py-2">İzin ID</th>
                  <th className="py-2">Çalışan</th>
                  <th className="py-2">Kaynak</th>
                  <th className="py-2">İzin Tipi</th>
                  <th className="py-2">Tarih Aralığı</th>
                  <th className="py-2">Talep Notu</th>
                  <th className="py-2">Karar Notu</th>
                  <th className="py-2">Durum</th>
                  <th className="py-2">Mesaj / Belge</th>
                  <th className="py-2">Karar Zamanı</th>
                  <th className="py-2">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {leaveRows.map((leave) => (
                  <tr
                    key={leave.id}
                    className={`border-t border-slate-100 ${focusedLeaveId === leave.id ? 'bg-sky-50/70' : ''}`}
                  >
                    <td className="py-2">{leave.id}</td>
                    <td className="py-2">{employeeNameById.get(leave.employee_id) ?? leave.employee_id}</td>
                    <td className="py-2">{leave.requested_by_employee ? 'Çalışan talebi' : 'Admin kaydı'}</td>
                    <td className="py-2">{leaveTypeLabels[leave.type]}</td>
                    <td className="py-2">
                      {leave.start_date} - {leave.end_date}
                    </td>
                    <td className="py-2 text-slate-600">{leave.note || '-'}</td>
                    <td className="py-2 text-slate-600">{leave.decision_note || '-'}</td>
                    <td className="py-2">
                      <StatusBadge value={leave.status} />
                    </td>
                    <td className="py-2 text-xs text-slate-500">
                      {(leave.message_count ?? 0) > 0 || (leave.attachment_count ?? 0) > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600">
                            {leave.message_count ?? 0} mesaj
                          </span>
                          <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600">
                            {leave.attachment_count ?? 0} belge
                          </span>
                        </div>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="py-2 text-xs text-slate-500">{leave.decided_at || '-'}</td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => openLeaveThread(leave.id)}
                          className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700 hover:bg-sky-100"
                        >
                          Yazışma
                        </button>
                      <button
                        type="button"
                        onClick={() => deleteMutation.mutate(leave.id)}
                        className="btn-danger rounded-lg border border-rose-300 px-3 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50"
                      >
                        Sil
                      </button>
                      </div>
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
