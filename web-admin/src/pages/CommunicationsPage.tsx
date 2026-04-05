import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'

import {
  createAdminConversationMessage,
  getAdminConversationThread,
  getAdminConversations,
  updateAdminConversationStatus,
} from '../api/admin'
import { parseApiError } from '../api/error'
import { ErrorBlock } from '../components/ErrorBlock'
import { LoadingBlock } from '../components/LoadingBlock'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'
import { useToast } from '../hooks/useToast'
import type { EmployeeConversationCategory, EmployeeConversationStatus } from '../types/api'

const categoryLabels: Record<EmployeeConversationCategory, string> = {
  ATTENDANCE: 'Puantaj',
  SHIFT: 'Vardiya',
  DEVICE: 'Cihaz',
  DOCUMENT: 'Belge',
  OTHER: 'Genel',
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

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return '-'
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }
  return parsed.toLocaleString('tr-TR')
}

function statusLabel(status: EmployeeConversationStatus): string {
  return status === 'CLOSED' ? 'Kapalı' : 'Açık'
}

function statusClassName(status: EmployeeConversationStatus): string {
  return status === 'CLOSED'
    ? 'border-slate-200 bg-slate-100 text-slate-700'
    : 'border-emerald-200 bg-emerald-50 text-emerald-700'
}

export function CommunicationsPage() {
  const queryClient = useQueryClient()
  const { pushToast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const [statusFilter, setStatusFilter] = useState<'' | EmployeeConversationStatus>('OPEN')
  const [searchText, setSearchText] = useState('')
  const [replyDraft, setReplyDraft] = useState('')

  const focusedConversationId = useMemo(() => parsePositiveInt(searchParams.get('conversation_id')), [searchParams])

  const conversationsQuery = useQuery({
    queryKey: ['admin-conversations', statusFilter || 'all'],
    queryFn: () => getAdminConversations({ status: statusFilter || undefined }),
  })

  const threadQuery = useQuery({
    queryKey: ['admin-conversation-thread', focusedConversationId ?? 'none'],
    queryFn: () => getAdminConversationThread(focusedConversationId as number),
    enabled: focusedConversationId !== null,
  })

  const messageMutation = useMutation({
    mutationFn: ({ conversationId, message }: { conversationId: number; message: string }) =>
      createAdminConversationMessage(conversationId, { message }),
    onSuccess: (thread) => {
      setReplyDraft('')
      queryClient.setQueryData(['admin-conversation-thread', thread.conversation.id], thread)
      void queryClient.invalidateQueries({ queryKey: ['admin-conversations'] })
      pushToast({
        variant: 'success',
        title: 'Yanıt gönderildi',
        description: `Kurumsal iletişim #${thread.conversation.id} için çalışan bilgilendirildi.`,
      })
    },
    onError: (error) => {
      const parsed = parseApiError(error, 'Yanıt gönderilemedi.')
      pushToast({
        variant: 'error',
        title: 'Yanıt gönderilemedi',
        description: parsed.message,
      })
    },
  })

  const statusMutation = useMutation({
    mutationFn: ({ conversationId, status }: { conversationId: number; status: EmployeeConversationStatus }) =>
      updateAdminConversationStatus(conversationId, { status }),
    onSuccess: (conversation) => {
      void queryClient.invalidateQueries({ queryKey: ['admin-conversations'] })
      void queryClient.invalidateQueries({ queryKey: ['admin-conversation-thread', conversation.id] })
      pushToast({
        variant: 'success',
        title: conversation.status === 'CLOSED' ? 'Yazışma kapatıldı' : 'Yazışma yeniden açıldı',
        description: `${conversation.subject} başlıklı kayıt güncellendi.`,
      })
    },
    onError: (error) => {
      const parsed = parseApiError(error, 'Yazışma durumu güncellenemedi.')
      pushToast({
        variant: 'error',
        title: 'Durum güncellenemedi',
        description: parsed.message,
      })
    },
  })

  const allConversations = conversationsQuery.data ?? []
  const filteredConversations = useMemo(() => {
    const query = searchText.trim().toLocaleLowerCase('tr-TR')
    if (!query) {
      return allConversations
    }
    return allConversations.filter((conversation) => {
      const haystack = `${conversation.employee_name} ${conversation.subject} ${conversation.latest_message_preview ?? ''}`
        .toLocaleLowerCase('tr-TR')
      return haystack.includes(query)
    })
  }, [allConversations, searchText])

  const openConversation = (conversationId: number) => {
    const next = new URLSearchParams(searchParams)
    next.set('conversation_id', String(conversationId))
    next.set('thread', '1')
    setSearchParams(next, { replace: true })
  }

  const closeThread = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('conversation_id')
    next.delete('thread')
    setSearchParams(next, { replace: true })
    setReplyDraft('')
  }

  const submitReply = () => {
    const message = replyDraft.trim()
    if (!focusedConversationId) {
      return
    }
    if (message.length < 3) {
      pushToast({
        variant: 'info',
        title: 'Mesaj kısa',
        description: 'Yanıt göndermek için en az 3 karakter yazın.',
      })
      return
    }
    messageMutation.mutate({ conversationId: focusedConversationId, message })
  }

  const activeThread = threadQuery.data
  const activeConversation = activeThread?.conversation ?? null

  return (
    <div className="space-y-4">
      <PageHeader
        title="Kurumsal İletişim"
        description="Çalışanlardan gelen resmi mesajları yönetin, yanıtlayın ve gerektiğinde kapatın."
      />

      <Panel className="border-slate-200/90 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.12),_transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.96))]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">Yazışma Merkezi</p>
            <h3 className="mt-2 text-base font-semibold text-slate-900">
              {focusedConversationId ? `İletişim #${focusedConversationId}` : 'Kurumsal çalışan mesajları'}
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Admin bildirimi tıklandığında ilgili konuşma burada doğrudan açılır.
            </p>
          </div>
          {focusedConversationId ? (
            <button
              type="button"
              onClick={closeThread}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Thread'i Kapat
            </button>
          ) : (
            <span className="rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-xs font-semibold text-slate-600">
              Bildirim uyumlu
            </span>
          )}
        </div>

        {!focusedConversationId ? (
          <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 p-5 text-sm text-slate-600">
            Listeden bir iletişim kaydı açın ya da admin bildiriminden bu sayfaya gelin.
          </div>
        ) : threadQuery.isLoading ? (
          <div className="mt-4">
            <LoadingBlock />
          </div>
        ) : threadQuery.isError ? (
          <div className="mt-4">
            <ErrorBlock message="İletişim thread'i yüklenemedi." />
          </div>
        ) : activeConversation ? (
          <div className="mt-4 grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
            <section className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Talep Özeti</p>
                  <h4 className="mt-2 text-lg font-semibold text-slate-900">{activeConversation.subject}</h4>
                  <p className="mt-1 text-sm text-slate-600">
                    {activeConversation.employee_name} · {categoryLabels[activeConversation.category]}
                  </p>
                </div>
                <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClassName(activeConversation.status)}`}>
                  {statusLabel(activeConversation.status)}
                </span>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">İlk kayıt</p>
                  <p className="mt-2 text-sm font-medium text-slate-800">{formatDateTime(activeConversation.created_at)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Son mesaj</p>
                  <p className="mt-2 text-sm font-medium text-slate-800">{formatDateTime(activeConversation.last_message_at)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Mesaj sayısı</p>
                  <p className="mt-2 text-sm font-medium text-slate-800">{activeConversation.message_count}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Kapanış</p>
                  <p className="mt-2 text-sm font-medium text-slate-800">{formatDateTime(activeConversation.closed_at)}</p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    statusMutation.mutate({
                      conversationId: activeConversation.id,
                      status: activeConversation.status === 'OPEN' ? 'CLOSED' : 'OPEN',
                    })
                  }
                  disabled={statusMutation.isPending}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  {activeConversation.status === 'OPEN' ? 'Kaydı Kapat' : 'Yeniden Aç'}
                </button>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-slate-950 p-4 text-white shadow-[0_18px_36px_rgba(15,23,42,0.24)]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-200/80">Kurumsal Chat</p>
                  <h4 className="mt-2 text-lg font-semibold">Resmi yazışma akışı</h4>
                  <p className="mt-1 text-sm text-slate-300">
                    Çalışana net ve kurumsal yanıt verin. Mesaj doğrudan employee uygulamasına bildirim olarak gider.
                  </p>
                </div>
              </div>

              <ol className="mt-4 space-y-3">
                {activeThread?.messages.map((message) => (
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
                          {formatDateTime(message.created_at)}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-6">{message.message}</p>
                    </div>
                  </li>
                ))}
              </ol>

              {activeConversation.status === 'OPEN' ? (
                <div className="mt-4 rounded-2xl border border-white/10 bg-white/6 p-3">
                  <label className="text-sm text-slate-200">
                    Çalışana yanıt
                    <textarea
                      value={replyDraft}
                      onChange={(event) => setReplyDraft(event.target.value)}
                      rows={4}
                      placeholder="Örnek: Talebiniz incelenmiştir, güncel durumu bugün içinde paylaşacağız."
                      className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/80 px-3 py-3 text-sm text-white placeholder:text-slate-400"
                    />
                  </label>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-slate-400">Yanıt resmi, net ve iş odaklı olmalıdır.</p>
                    <button
                      type="button"
                      onClick={submitReply}
                      disabled={messageMutation.isPending}
                      className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {messageMutation.isPending ? 'Gönderiliyor...' : 'Yanıt Gönder'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-dashed border-white/15 bg-white/5 px-4 py-4 text-sm text-slate-300">
                  Bu iletişim kaydı kapalı. Yeniden yanıt vermek için önce kaydı açın.
                </div>
              )}
            </section>
          </div>
        ) : null}
      </Panel>

      <Panel>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">İletişim Listesi</h3>
            <p className="mt-1 text-sm text-slate-500">Çalışanların kurumsal mesaj kayıtlarını konu ve durum bazında takip edin.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <label className="text-sm text-slate-700">
              Durum
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as '' | EmployeeConversationStatus)}
                className="mt-1 rounded-lg border border-slate-300 px-3 py-2"
              >
                <option value="">Tümü</option>
                <option value="OPEN">Açık</option>
                <option value="CLOSED">Kapalı</option>
              </select>
            </label>
            <label className="text-sm text-slate-700">
              Ara
              <input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Çalışan veya başlık ara"
                className="mt-1 rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
          </div>
        </div>

        {conversationsQuery.isLoading ? <div className="mt-4"><LoadingBlock /></div> : null}
        {conversationsQuery.isError ? <div className="mt-4"><ErrorBlock message="İletişim listesi alınamadı." /></div> : null}

        {!conversationsQuery.isLoading && !conversationsQuery.isError ? (
          filteredConversations.length > 0 ? (
            <div className="mt-4 grid gap-3">
              {filteredConversations.map((conversation) => (
                <article
                  key={conversation.id}
                  className={`rounded-2xl border p-4 ${
                    focusedConversationId === conversation.id
                      ? 'border-sky-300 bg-sky-50/60 ring-2 ring-sky-200/70'
                      : 'border-slate-200 bg-slate-50'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        #{conversation.id} · {conversation.employee_name}
                      </p>
                      <p className="mt-1 text-sm text-slate-700">{conversation.subject}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {categoryLabels[conversation.category]} · Son mesaj: {formatDateTime(conversation.last_message_at)}
                      </p>
                    </div>
                    <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClassName(conversation.status)}`}>
                      {statusLabel(conversation.status)}
                    </span>
                  </div>

                  {conversation.latest_message_preview ? (
                    <p className="mt-3 text-sm text-slate-600">{conversation.latest_message_preview}</p>
                  ) : null}

                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                      {conversation.message_count} mesaj
                    </span>
                    <button
                      type="button"
                      onClick={() => openConversation(conversation.id)}
                      className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700 hover:bg-sky-100"
                    >
                      Yazışmayı Aç
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">Gösterilecek kurumsal iletişim kaydı yok.</p>
          )
        ) : null}
      </Panel>
    </div>
  )
}
