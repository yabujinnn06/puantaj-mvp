import { useMemo, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'

import { getAuditLogs, type AuditLogParams } from '../api/admin'
import { parseApiError } from '../api/error'
import { ErrorBlock } from '../components/ErrorBlock'
import { LoadingBlock } from '../components/LoadingBlock'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'
import type { AuditLog } from '../types/api'

interface LogFilters {
  action: string
  entityType: string
  entityId: string
  success: 'all' | 'success' | 'failed'
  limit: string
}

const DEFAULT_FILTERS: LogFilters = {
  action: '',
  entityType: '',
  entityId: '',
  success: 'all',
  limit: '300',
}

const ACTION_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Tüm aksiyonlar' },
  { value: 'ADMIN_LOGIN_SUCCESS', label: 'Admin giriş başarılı' },
  { value: 'ADMIN_LOGIN_FAIL', label: 'Admin giriş hatalı' },
  { value: 'ADMIN_LOGOUT', label: 'Admin çıkış' },
  { value: 'ATTENDANCE_EVENT_CREATED', label: 'Yoklama kaydı oluşturuldu' },
  { value: 'DEVICE_CLAIMED', label: 'Cihaz eşleştirildi' },
  { value: 'DEVICE_INVITE_CREATED', label: 'Cihaz daveti oluşturuldu' },
  { value: 'LEAVE_CREATED', label: 'İzin oluşturuldu' },
  { value: 'LEAVE_DELETED', label: 'İzin silindi' },
]

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date(value))
}

function successLabel(value: boolean): string {
  return value ? 'Başarılı' : 'Hata'
}

function detailsPreview(details: Record<string, unknown>): string {
  const entries = Object.entries(details)
  if (entries.length === 0) {
    return '-'
  }
  return entries
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(' | ')
}

function toQueryParams(filters: LogFilters): AuditLogParams {
  const parsedLimit = Number(filters.limit)
  const safeLimit =
    Number.isInteger(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 500)
      : 300
  return {
    action: filters.action || undefined,
    entity_type: filters.entityType || undefined,
    entity_id: filters.entityId || undefined,
    success:
      filters.success === 'all'
        ? undefined
        : filters.success === 'success',
    limit: safeLimit,
  }
}

export function SystemLogsPage() {
  const [draftFilters, setDraftFilters] = useState<LogFilters>(DEFAULT_FILTERS)
  const [appliedFilters, setAppliedFilters] = useState<LogFilters>(DEFAULT_FILTERS)
  const [textSearch, setTextSearch] = useState('')

  const queryParams = useMemo(
    () => toQueryParams(appliedFilters),
    [appliedFilters],
  )

  const logsQuery = useQuery({
    queryKey: ['audit-logs', queryParams],
    queryFn: () => getAuditLogs(queryParams),
  })

  const logs = logsQuery.data ?? []
  const visibleLogs = useMemo(() => {
    if (!textSearch.trim()) {
      return logs
    }
    const needle = textSearch.trim().toLowerCase()
    return logs.filter((item) => {
      const haystack = [
        item.action,
        item.actor_type,
        item.actor_id,
        item.entity_type ?? '',
        item.entity_id ?? '',
        item.ip ?? '',
        item.user_agent ?? '',
        JSON.stringify(item.details),
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(needle)
    })
  }, [logs, textSearch])

  const summary = useMemo(() => {
    const failed = logs.filter((item) => !item.success).length
    const loginEvents = logs.filter((item) =>
      item.action.startsWith('ADMIN_LOGIN'),
    ).length
    const attendanceEvents = logs.filter(
      (item) => item.action === 'ATTENDANCE_EVENT_CREATED',
    ).length
    return {
      total: logs.length,
      failed,
      loginEvents,
      attendanceEvents,
    }
  }, [logs])

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAppliedFilters({ ...draftFilters })
  }

  const clearFilters = () => {
    setDraftFilters(DEFAULT_FILTERS)
    setAppliedFilters(DEFAULT_FILTERS)
    setTextSearch('')
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sistem Logları"
        description="Program hareketleri, hata kayıtları, giriş/çıkış ve yoklama işlemlerini takip edin."
      />

      <Panel>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs text-slate-500">Toplam log</p>
            <p className="text-sm font-semibold text-slate-900">{summary.total}</p>
          </div>
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
            <p className="text-xs text-rose-700">Hata logu</p>
            <p className="text-sm font-semibold text-rose-800">{summary.failed}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs text-slate-500">Login olayları</p>
            <p className="text-sm font-semibold text-slate-900">{summary.loginEvents}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs text-slate-500">Yoklama eventleri</p>
            <p className="text-sm font-semibold text-slate-900">{summary.attendanceEvents}</p>
          </div>
        </div>
      </Panel>

      <Panel>
        <h4 className="text-base font-semibold text-slate-900">Filtreler</h4>
        <form className="mt-3 space-y-3" onSubmit={applyFilters}>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
            <label className="text-sm text-slate-700">
              Aksiyon
              <select
                value={draftFilters.action}
                onChange={(event) =>
                  setDraftFilters((prev) => ({
                    ...prev,
                    action: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                {ACTION_OPTIONS.map((option) => (
                  <option key={option.label} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm text-slate-700">
              Varlık türü
              <input
                type="text"
                value={draftFilters.entityType}
                onChange={(event) =>
                  setDraftFilters((prev) => ({
                    ...prev,
                    entityType: event.target.value,
                  }))
                }
                placeholder="attendance_event / leave"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>

            <label className="text-sm text-slate-700">
              Varlık ID
              <input
                type="text"
                value={draftFilters.entityId}
                onChange={(event) =>
                  setDraftFilters((prev) => ({
                    ...prev,
                    entityId: event.target.value,
                  }))
                }
                placeholder="Örn: 42"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>

            <label className="text-sm text-slate-700">
              Durum
              <select
                value={draftFilters.success}
                onChange={(event) =>
                  setDraftFilters((prev) => ({
                    ...prev,
                    success: event.target.value as LogFilters['success'],
                  }))
                }
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                <option value="all">Tümü</option>
                <option value="success">Başarılı</option>
                <option value="failed">Hata</option>
              </select>
            </label>

            <label className="text-sm text-slate-700">
              Limit
              <input
                type="number"
                min={1}
                max={500}
                value={draftFilters.limit}
                onChange={(event) =>
                  setDraftFilters((prev) => ({
                    ...prev,
                    limit: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
            <label className="text-sm text-slate-700">
              Metin ara
              <input
                type="text"
                value={textSearch}
                onChange={(event) => setTextSearch(event.target.value)}
                placeholder="Aksiyon, kullanıcı, IP, detay..."
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
            <button
              type="submit"
              className="btn-primary self-end rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
            >
              Uygula
            </button>
            <button
              type="button"
              onClick={clearFilters}
              className="btn-secondary self-end rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Temizle
            </button>
          </div>
        </form>
      </Panel>

      <Panel>
        {logsQuery.isLoading ? <LoadingBlock label="Log kayıtları yükleniyor..." /> : null}
        {logsQuery.isError ? (
          <ErrorBlock
            message={parseApiError(logsQuery.error, 'Log kayıtları alınamadı.').message}
          />
        ) : null}

        {!logsQuery.isLoading && !logsQuery.isError ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2">Zaman</th>
                  <th className="py-2">Aksiyon</th>
                  <th className="py-2">Durum</th>
                  <th className="py-2">Aktör</th>
                  <th className="py-2">Varlık</th>
                  <th className="py-2">IP</th>
                  <th className="py-2">Detay</th>
                </tr>
              </thead>
              <tbody>
                {visibleLogs.map((item) => (
                  <LogRow key={item.id} item={item} />
                ))}
              </tbody>
            </table>
            {visibleLogs.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">
                Filtreye uygun log kaydı bulunamadı.
              </p>
            ) : null}
          </div>
        ) : null}
      </Panel>
    </div>
  )
}

function LogRow({ item }: { item: AuditLog }) {
  return (
    <tr className="border-t border-slate-100 align-top">
      <td className="py-2 whitespace-nowrap">{formatDateTime(item.ts_utc)}</td>
      <td className="py-2 font-medium text-slate-900">{item.action}</td>
      <td className="py-2">
        <span
          className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${
            item.success
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-rose-100 text-rose-700'
          }`}
        >
          {successLabel(item.success)}
        </span>
      </td>
      <td className="py-2">
        {item.actor_type}:{item.actor_id}
      </td>
      <td className="py-2">
        {item.entity_type ?? '-'}
        {item.entity_id ? ` #${item.entity_id}` : ''}
      </td>
      <td className="py-2">{item.ip ?? '-'}</td>
      <td className="py-2 max-w-xl">
        <p className="text-xs text-slate-600">{detailsPreview(item.details)}</p>
        {Object.keys(item.details).length > 0 ? (
          <details className="mt-1 text-xs">
            <summary className="cursor-pointer text-brand-700 hover:text-brand-900">
              Tam detayı göster
            </summary>
            <pre className="mt-1 overflow-x-auto rounded bg-slate-900 p-2 text-[11px] text-slate-100">
              {JSON.stringify(item.details, null, 2)}
            </pre>
          </details>
        ) : null}
      </td>
    </tr>
  )
}
