import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'

import { getAuditLogs, getEmployeeDetail, type AuditLogParams } from '../api/admin'
import { parseApiError } from '../api/error'
import { ErrorBlock } from '../components/ErrorBlock'
import { LoadingBlock } from '../components/LoadingBlock'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'
import { usePageVisibility } from '../hooks/usePageVisibility'
import type { AuditLog, LocationStatus } from '../types/api'

interface LogFilters {
  module: string
  eventType: string
  action: string
  employeeId: string
  deviceId: string
  entityType: string
  entityId: string
  success: 'all' | 'success' | 'failed'
}

type ConsoleMessageLevel = 'info' | 'success' | 'warning' | 'error'

interface ConsoleMessage {
  id: number
  level: ConsoleMessageLevel
  text: string
}

const DEFAULT_FILTERS: LogFilters = {
  module: '',
  eventType: '',
  action: '',
  employeeId: '',
  deviceId: '',
  entityType: '',
  entityId: '',
  success: 'all',
}

const LOGS_PAGE_SIZE = 35

const ACTION_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Tüm aksiyonlar' },
  { value: 'ADMIN_LOGIN_SUCCESS', label: 'Admin giriş başarılı' },
  { value: 'ADMIN_LOGIN_FAIL', label: 'Admin giriş başarısız' },
  { value: 'ADMIN_REFRESH', label: 'Admin token yeniledi' },
  { value: 'ADMIN_LOGOUT', label: 'Admin çıkış yapti' },
  { value: 'ATTENDANCE_EVENT_CREATED', label: 'Yoklama kaydı oluşturuldu' },
  { value: 'DEVICE_INVITE_CREATED', label: 'Cihaz daveti oluşturuldu' },
  { value: 'DEVICE_CLAIMED', label: 'Cihaz eslestirildi' },
  { value: 'LEAVE_CREATED', label: 'İzin oluşturuldu' },
  { value: 'LEAVE_DELETED', label: 'İzin silindi' },
  { value: 'EMPLOYEE_APP_LOCATION_PING', label: 'Employee app giriş pingi' },
]

const MODULE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Tüm moduller' },
  { value: 'CORE', label: 'CORE' },
  { value: 'APP', label: 'APP' },
]

const EVENT_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Tüm event tipleri' },
  { value: 'app_login', label: 'app_login' },
]

const ACTION_LABELS: Record<string, string> = {
  ADMIN_LOGIN_SUCCESS: 'Admin giriş başarılı',
  ADMIN_LOGIN_FAIL: 'Admin giriş başarısız',
  ADMIN_REFRESH: 'Admin token yeniledi',
  ADMIN_LOGOUT: 'Admin çıkış yapti',
  ATTENDANCE_EVENT_CREATED: 'Yoklama kaydı oluşturuldu',
  DEVICE_INVITE_CREATED: 'Cihaz daveti oluşturuldu',
  DEVICE_CLAIMED: 'Cihaz eslestirildi',
  LEAVE_CREATED: 'İzin oluşturuldu',
  LEAVE_DELETED: 'İzin silindi',
  EMPLOYEE_APP_LOCATION_PING: 'Employee app giriş pingi',
}

function formatDateTime(value?: string | null): string {
  if (!value) {
    return '-'
  }
  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date(value))
}

function formatTerminalTimestamp(value: string): string {
  return new Intl.DateTimeFormat('tr-TR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
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

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action
}

function formatLocationSignalStatus(status?: LocationStatus | null): string {
  if (status === 'VERIFIED_HOME') return 'Doğrulama güçlü'
  if (status === 'UNVERIFIED_LOCATION') return 'Kontrol gerektiriyor'
  if (status === 'NO_LOCATION') return 'Sinyal alınmadı'
  return 'Bekleniyor'
}

function formatAttendanceEventLabel(eventType?: 'IN' | 'OUT' | null): string {
  if (eventType === 'IN') return 'Giriş'
  if (eventType === 'OUT') return 'Çıkış'
  return '-'
}

function locationSignalTone(status?: LocationStatus | null): string {
  if (status === 'VERIFIED_HOME') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-900'
  }
  if (status === 'UNVERIFIED_LOCATION') {
    return 'border-amber-200 bg-amber-50 text-amber-900'
  }
  if (status === 'NO_LOCATION') {
    return 'border-slate-200 bg-slate-50 text-slate-800'
  }
  return 'border-slate-200 bg-white text-slate-800'
}

const istanbulDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Istanbul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function toIstanbulDay(value?: string | null): string | null {
  if (!value) {
    return null
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }
  return istanbulDayFormatter.format(parsed)
}

function toQueryParams(filters: LogFilters, page: number): AuditLogParams {
  const safePage = Number.isInteger(page) && page > 0 ? page : 1
  return {
    module: filters.module || undefined,
    event_type: filters.eventType || undefined,
    action: filters.action || undefined,
    employee_id: filters.employeeId ? Number(filters.employeeId) : undefined,
    device_id: filters.deviceId ? Number(filters.deviceId) : undefined,
    entity_type: filters.entityType || undefined,
    entity_id: filters.entityId || undefined,
    success: filters.success === 'all' ? undefined : filters.success === 'success',
    offset: (safePage - 1) * LOGS_PAGE_SIZE,
    limit: LOGS_PAGE_SIZE,
  }
}

function toTerminalLine(item: AuditLog): string {
  const actor = `${item.actor_type}:${item.actor_id}`
  const entity = item.entity_type ? `${item.entity_type}${item.entity_id ? `#${item.entity_id}` : ''}` : '-'
  const ip = item.ip ?? '-'
  return `[${formatTerminalTimestamp(item.ts_utc)}] ${item.module}/${item.event_type ?? item.action} actor=${actor} entity=${entity} ip=${ip}`
}

function consoleMessageClass(level: ConsoleMessageLevel): string {
  if (level === 'success') return 'text-emerald-300'
  if (level === 'warning') return 'text-amber-300'
  if (level === 'error') return 'text-rose-300'
  return 'text-cyan-300'
}

export function SystemLogsPage() {
  const isPageVisible = usePageVisibility()
  const [draftFilters, setDraftFilters] = useState<LogFilters>(DEFAULT_FILTERS)
  const [appliedFilters, setAppliedFilters] = useState<LogFilters>(DEFAULT_FILTERS)
  const [logsPage, setLogsPage] = useState(1)
  const [textSearch, setTextSearch] = useState('')
  const [followLogs, setFollowLogs] = useState(true)
  const [isEmployeeContextOpen, setIsEmployeeContextOpen] = useState(false)
  const [commandInput, setCommandInput] = useState('')
  const [selectedLogId, setSelectedLogId] = useState<number | null>(null)
  const [consoleMessages, setConsoleMessages] = useState<ConsoleMessage[]>([
    { id: 1, level: 'info', text: 'Log terminali hazır. Yardim için "help" yazin.' },
  ])

  const messageCounterRef = useRef(2)
  const terminalScrollRef = useRef<HTMLDivElement | null>(null)

  const queryParams = useMemo(() => toQueryParams(appliedFilters, logsPage), [appliedFilters, logsPage])
  const filteredEmployeeId = useMemo(() => {
    const parsed = Number(appliedFilters.employeeId)
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return null
    }
    return parsed
  }, [appliedFilters.employeeId])
  const todayIstanbul = useMemo(() => istanbulDayFormatter.format(new Date()), [])

  const logsQuery = useQuery({
    queryKey: ['audit-logs', queryParams],
    queryFn: () => getAuditLogs(queryParams),
    refetchInterval: followLogs && isPageVisible ? 12_000 : false,
    refetchIntervalInBackground: false,
  })
  const employeeContextQuery = useQuery({
    queryKey: ['audit-logs', 'employee-context', filteredEmployeeId],
    queryFn: () => getEmployeeDetail(filteredEmployeeId as number),
    enabled: filteredEmployeeId !== null && isEmployeeContextOpen,
    staleTime: 60_000,
  })

  const logs = logsQuery.data?.items ?? []
  const logsTotal = logsQuery.data?.total ?? 0
  const logsTotalPages = Math.max(1, Math.ceil(logsTotal / LOGS_PAGE_SIZE))
  const logsRangeStart = logsTotal === 0 ? 0 : (logsPage - 1) * LOGS_PAGE_SIZE + 1
  const logsRangeEnd = logs.length === 0 ? 0 : logsRangeStart + logs.length - 1
  const employeeLocationRows = useMemo(
    () => employeeContextQuery.data?.recent_locations ?? [],
    [employeeContextQuery.data?.recent_locations],
  )
  const employeeTodayLocationRows = useMemo(
    () => employeeLocationRows.filter((row) => toIstanbulDay(row.ts_utc) === todayIstanbul),
    [employeeLocationRows, todayIstanbul],
  )
  const visibleEmployeeLocationRows = useMemo(
    () => (employeeTodayLocationRows.length > 0 ? employeeTodayLocationRows : employeeLocationRows).slice(0, 6),
    [employeeLocationRows, employeeTodayLocationRows],
  )
  const visibleEmployeeIpSummaries = useMemo(
    () => (employeeContextQuery.data?.ip_summary ?? []).slice(0, 3),
    [employeeContextQuery.data?.ip_summary],
  )
  const visibleEmployeePortalRows = useMemo(
    () => (employeeContextQuery.data?.recent_activity ?? []).slice(0, 6),
    [employeeContextQuery.data?.recent_activity],
  )
  const employeeFieldStatus =
    visibleEmployeeLocationRows[0]?.location_status ?? employeeContextQuery.data?.latest_location?.location_status ?? null

  const visibleLogs = useMemo(() => {
    if (!textSearch.trim()) {
      return logs
    }

    const needle = textSearch.trim().toLowerCase()
    return logs.filter((item) => {
      const haystack = [
        item.module,
        item.event_type ?? '',
        item.action,
        String(item.employee_id ?? ''),
        String(item.device_id ?? ''),
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

  const selectedLog = useMemo(() => {
    if (selectedLogId !== null) {
      const found = visibleLogs.find((item) => item.id === selectedLogId)
      if (found) {
        return found
      }
    }
    return visibleLogs[0] ?? null
  }, [selectedLogId, visibleLogs])

  const summary = useMemo(() => {
    const failed = logs.filter((item) => !item.success).length
    const loginEvents = logs.filter((item) => item.action.startsWith('ADMIN_LOGIN')).length
    const attendanceEvents = logs.filter((item) => item.action === 'ATTENDANCE_EVENT_CREATED').length
    return {
      total: logsTotal,
      failed,
      loginEvents,
      attendanceEvents,
    }
  }, [logs, logsTotal])

  useEffect(() => {
    if (!selectedLog && selectedLogId !== null) {
      setSelectedLogId(null)
    }
  }, [selectedLog, selectedLogId])

  useEffect(() => {
    if (!logsQuery.data) return
    setLogsPage((prev) => {
      if (prev < 1) return 1
      if (prev > logsTotalPages) return logsTotalPages
      return prev
    })
  }, [logsQuery.data, logsTotalPages])

  useEffect(() => {
    if (!followLogs || terminalScrollRef.current === null) {
      return
    }
    terminalScrollRef.current.scrollTop = terminalScrollRef.current.scrollHeight
  }, [followLogs, visibleLogs, consoleMessages])

  useEffect(() => {
    if (filteredEmployeeId !== null) {
      return
    }
    setIsEmployeeContextOpen(false)
  }, [filteredEmployeeId])

  const pushConsoleMessage = (level: ConsoleMessageLevel, text: string) => {
    setConsoleMessages((prev) => {
      const next = [...prev, { id: messageCounterRef.current, level, text }]
      messageCounterRef.current += 1
      return next.slice(-120)
    })
  }

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAppliedFilters({ ...draftFilters })
    setLogsPage(1)
    pushConsoleMessage('success', 'Filtreler uygulandi.')
  }

  const clearFilters = () => {
    setDraftFilters(DEFAULT_FILTERS)
    setAppliedFilters(DEFAULT_FILTERS)
    setLogsPage(1)
    setTextSearch('')
    pushConsoleMessage('info', 'Filtreler temizlendi.')
  }

  const executeCommand = (rawCommand: string) => {
    const command = rawCommand.trim()
    if (!command) {
      return
    }

    pushConsoleMessage('info', `$ ${command}`)
    const [nameRaw, ...args] = command.split(/\s+/)
    const name = nameRaw.toLowerCase()
    const value = command.slice(nameRaw.length).trim()

    if (name === 'help' || name === 'yardim') {
      pushConsoleMessage('info', 'Komutlar: help, clear, apply, reset, refresh, follow on|off, status all|success|failed, action <AKSIYON>, search <METIN>, page <N>. Modul/event filtreleri formdan uygulanir.')
      return
    }

    if (name === 'clear' || name === 'temizle') {
      setConsoleMessages([])
      messageCounterRef.current = 1
      pushConsoleMessage('success', 'Terminal cikti gecmisi temizlendi.')
      return
    }

    if (name === 'apply' || name === 'uygula') {
      setAppliedFilters({ ...draftFilters })
      setLogsPage(1)
      pushConsoleMessage('success', 'Taslak filtreler uygulandi.')
      return
    }

    if (name === 'reset' || name === 'sıfırla') {
      setDraftFilters(DEFAULT_FILTERS)
      setAppliedFilters(DEFAULT_FILTERS)
      setLogsPage(1)
      setTextSearch('')
      pushConsoleMessage('warning', 'Filtreler sıfırlandı.')
      return
    }

    if (name === 'refresh' || name === 'yenile') {
      void logsQuery.refetch()
      pushConsoleMessage('success', 'Log verisi yeniden cekiliyor.')
      return
    }

    if (name === 'follow' || name === 'takip') {
      const mode = args[0]?.toLowerCase()
      if (mode === 'on' || mode === 'ac') {
        setFollowLogs(true)
        pushConsoleMessage('success', 'Canlı takip acildi.')
        return
      }
      if (mode === 'off' || mode === 'kapat') {
        setFollowLogs(false)
        pushConsoleMessage('warning', 'Canlı takip kapatildi.')
        return
      }
      pushConsoleMessage('error', 'Kullanim: follow on|off')
      return
    }

    if (name === 'status' || name === 'durum') {
      const mode = args[0]?.toLowerCase()
      let next: LogFilters['success'] | null = null
      if (mode === 'all' || mode === 'tüm') next = 'all'
      if (mode === 'success' || mode === 'ok' || mode === 'başarılı') next = 'success'
      if (mode === 'failed' || mode === 'error' || mode === 'hata') next = 'failed'
      if (next === null) {
        pushConsoleMessage('error', 'Kullanim: status all|success|failed')
        return
      }
      setDraftFilters((prev) => ({ ...prev, success: next as LogFilters['success'] }))
      setAppliedFilters((prev) => ({ ...prev, success: next as LogFilters['success'] }))
      setLogsPage(1)
      pushConsoleMessage('success', `Durum filtresi güncellendi: ${next}`)
      return
    }

    if (name === 'action' || name === 'aksiyon') {
      if (!value) {
        pushConsoleMessage('error', 'Kullanim: action <AKSIYON_KODU>')
        return
      }
      setDraftFilters((prev) => ({ ...prev, action: value }))
      setAppliedFilters((prev) => ({ ...prev, action: value }))
      setLogsPage(1)
      pushConsoleMessage('success', `Aksiyon filtresi güncellendi: ${value}`)
      return
    }

    if (name === 'search' || name === 'ara') {
      setTextSearch(value)
      pushConsoleMessage('success', value ? `Metin aramasi uygulandi: "${value}"` : 'Metin aramasi temizlendi.')
      return
    }

    if (name === 'page' || name === 'sayfa') {
      const parsed = Number(args[0])
      if (!Number.isFinite(parsed) || parsed <= 0) {
        pushConsoleMessage('error', 'Kullanim: page <1-n>')
        return
      }
      const safe = Math.max(Math.trunc(parsed), 1)
      setLogsPage(safe)
      pushConsoleMessage('success', `Sayfa güncellendi: ${safe}`)
      return
    }

    pushConsoleMessage('error', `Bilinmeyen komut: ${name}. Yardim için "help" yazin.`)
  }

  const handleCommandSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    executeCommand(commandInput)
    setCommandInput('')
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sistem Logları"
        description="Program hareketleri, hata kayıtları, giriş/çıkış ve yoklama işlemlerini terminal görünümünde izleyin."
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
            <p className="text-xs text-slate-500">Login olaylari</p>
            <p className="text-sm font-semibold text-slate-900">{summary.loginEvents}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs text-slate-500">Yoklama olaylari</p>
            <p className="text-sm font-semibold text-slate-900">{summary.attendanceEvents}</p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const next = !followLogs
                setFollowLogs(next)
                pushConsoleMessage('info', next ? 'Canlı takip acildi.' : 'Canlı takip kapatildi.')
              }}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                followLogs ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-700'
              }`}
            >
              {followLogs ? 'Canlı takip: Acik' : 'Canlı takip: Kapalı'}
            </button>
            <button
              type="button"
              onClick={() => {
                void logsQuery.refetch()
                pushConsoleMessage('success', 'Log listesi manuel yenilendi.')
              }}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Yenile
            </button>
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Filtreleri temizle
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-600">
            <span>
              Gösterilen satir: {logsRangeStart}-{logsRangeEnd} / {logsTotal}
            </span>
            <button
              type="button"
              onClick={() => setLogsPage((prev) => Math.max(1, prev - 1))}
              disabled={logsPage <= 1}
              className="rounded border border-slate-300 px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Onceki
            </button>
            <span>
              Sayfa {logsPage} / {logsTotalPages}
            </span>
            <button
              type="button"
              onClick={() => setLogsPage((prev) => Math.min(logsTotalPages, prev + 1))}
              disabled={logsPage >= logsTotalPages}
              className="rounded border border-slate-300 px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Sonraki
            </button>
          </div>
        </div>
      </Panel>

      <Panel>
        <h4 className="text-base font-semibold text-slate-900">Filtreler</h4>
        <form className="mt-3 space-y-3" onSubmit={applyFilters}>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm text-slate-700">
              Modul
              <select
                value={draftFilters.module}
                onChange={(event) => setDraftFilters((prev) => ({ ...prev, module: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                {MODULE_OPTIONS.map((option) => (
                  <option key={option.label} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm text-slate-700">
              Event tipi
              <select
                value={draftFilters.eventType}
                onChange={(event) => setDraftFilters((prev) => ({ ...prev, eventType: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                {EVENT_OPTIONS.map((option) => (
                  <option key={option.label} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm text-slate-700">
              Aksiyon
              <select
                value={draftFilters.action}
                onChange={(event) => setDraftFilters((prev) => ({ ...prev, action: event.target.value }))}
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
              Employee ID
              <input
                type="number"
                min={1}
                value={draftFilters.employeeId}
                onChange={(event) => setDraftFilters((prev) => ({ ...prev, employeeId: event.target.value }))}
                placeholder="Orn: 42"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm text-slate-700">
              Device ID
              <input
                type="number"
                min={1}
                value={draftFilters.deviceId}
                onChange={(event) => setDraftFilters((prev) => ({ ...prev, deviceId: event.target.value }))}
                placeholder="Orn: 17"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>

            <label className="text-sm text-slate-700">
              Varlik turu
              <input
                type="text"
                value={draftFilters.entityType}
                onChange={(event) => setDraftFilters((prev) => ({ ...prev, entityType: event.target.value }))}
                placeholder="attendance_event / leave"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>

            <label className="text-sm text-slate-700">
              Varlik ID
              <input
                type="text"
                value={draftFilters.entityId}
                onChange={(event) => setDraftFilters((prev) => ({ ...prev, entityId: event.target.value }))}
                placeholder="Orn: 42"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>

            <label className="text-sm text-slate-700">
              Durum
              <select
                value={draftFilters.success}
                onChange={(event) =>
                  setDraftFilters((prev) => ({ ...prev, success: event.target.value as LogFilters['success'] }))
                }
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                <option value="all">Tümü</option>
                <option value="success">Başarılı</option>
                <option value="failed">Hata</option>
              </select>
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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="text-base font-semibold text-slate-900">Çalışan izleri</h4>
            <p className="mt-1 text-xs text-slate-500">
              Employee ID filtresi uygulandığında saha izi, bağlantı özeti ve portal hareketleri burada kapalı bir bölmede açılır.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {filteredEmployeeId !== null ? (
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                Employee #{filteredEmployeeId}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => setIsEmployeeContextOpen((prev) => !prev)}
              disabled={filteredEmployeeId === null}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isEmployeeContextOpen ? 'Bölmeyi gizle' : 'Bölmeyi aç'}
            </button>
          </div>
        </div>

        {filteredEmployeeId === null ? (
          <p className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
            Önce log filtrelerinden bir `Employee ID` seçin. Bu gizli bölüm sadece seçili çalışan için açılır.
          </p>
        ) : !isEmployeeContextOpen ? (
          <p className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
            Gizli çalışan bölmesi hazır. Taşınan saha ve portal özetini görmek için “Bölmeyi aç” butonunu kullanın.
          </p>
        ) : employeeContextQuery.isLoading ? (
          <div className="mt-4">
            <LoadingBlock label="Çalışan izleri yükleniyor..." />
          </div>
        ) : employeeContextQuery.isError ? (
          <div className="mt-4">
            <ErrorBlock message={parseApiError(employeeContextQuery.error, 'Çalışan izleri alınamadı.').message} />
          </div>
        ) : employeeContextQuery.data ? (
          <div className="mt-4 grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
            <section className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Saha izi / bağlantı özeti
                  </p>
                  <h5 className="mt-2 text-lg font-semibold text-slate-900">
                    {employeeContextQuery.data.employee.full_name}
                  </h5>
                </div>
                <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${locationSignalTone(employeeFieldStatus)}`}>
                  {formatLocationSignalStatus(employeeFieldStatus)}
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-white bg-white p-3">
                  <p className="text-xs text-slate-500">Son portal ziyareti</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">
                    {formatDateTime(employeeContextQuery.data.last_portal_seen_utc)}
                  </p>
                </div>
                <div className="rounded-xl border border-white bg-white p-3">
                  <p className="text-xs text-slate-500">Bugünkü saha izi</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">{employeeTodayLocationRows.length} kayıt</p>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-[0.96fr_1.04fr]">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h6 className="text-sm font-semibold text-slate-900">Saha izi</h6>
                    <span className="text-xs text-slate-500">
                      {employeeTodayLocationRows.length > 0 ? 'Bugün öncelikli' : 'Son kayıtlar'}
                    </span>
                  </div>
                  {visibleEmployeeLocationRows.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-5 text-sm text-slate-500">
                      Saha izi bulunmuyor.
                    </p>
                  ) : (
                    visibleEmployeeLocationRows.map((row, index) => (
                      <div
                        key={`${row.ts_utc}-${row.device_id}-${index}`}
                        className="rounded-xl border border-slate-200 bg-white px-4 py-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-slate-900">{formatDateTime(row.ts_utc)}</p>
                          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${locationSignalTone(row.location_status)}`}>
                            {formatLocationSignalStatus(row.location_status)}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-slate-600">
                          {formatAttendanceEventLabel(row.event_type)} akışı, cihaz #{row.device_id}
                        </p>
                      </div>
                    ))
                  )}
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h6 className="text-sm font-semibold text-slate-900">Bağlantı özeti</h6>
                    <span className="text-xs text-slate-500">{visibleEmployeeIpSummaries.length} özet</span>
                  </div>
                  {visibleEmployeeIpSummaries.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-5 text-sm text-slate-500">
                      Bağlantı özeti henüz oluşmadı.
                    </p>
                  ) : (
                    visibleEmployeeIpSummaries.map((item) => (
                      <div
                        key={`${item.ip}-${item.last_seen_at_utc ?? 'summary'}`}
                        className="rounded-xl border border-slate-200 bg-white px-4 py-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-mono text-xs text-slate-700">{item.ip}</p>
                          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${locationSignalTone(item.last_location_status)}`}>
                            {formatLocationSignalStatus(item.last_location_status)}
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-slate-500">Son portal işlemi: {item.last_action ?? '-'}</p>
                        <p className="text-xs text-slate-500">Son iz: {formatDateTime(item.last_seen_at_utc)}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Portal hareketleri
                  </p>
                  <h5 className="mt-2 text-lg font-semibold text-slate-900">Son kullanıcı adımları</h5>
                </div>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                  Son ziyaret: {formatDateTime(employeeContextQuery.data.last_portal_seen_utc)}
                </span>
              </div>

              <div className="mt-4 space-y-3">
                {visibleEmployeePortalRows.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                    Portal tarafında henüz hareket izi oluşmadı.
                  </p>
                ) : (
                  visibleEmployeePortalRows.map((item, index) => (
                    <div key={`${item.ts_utc}-${index}`} className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-900">{item.action}</p>
                        <span className="text-xs text-slate-500">{formatDateTime(item.ts_utc)}</span>
                      </div>
                      <p className="mt-2 text-xs text-slate-500">IP: {item.ip ?? '-'}</p>
                      <p className="mt-1 truncate text-xs text-slate-500" title={item.user_agent ?? '-'}>
                        {item.user_agent ?? 'User agent bilgisi yok'}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        ) : null}
      </Panel>

      <Panel>
        {logsQuery.isLoading ? <LoadingBlock label="Log kayıtları yükleniyor..." /> : null}
        {logsQuery.isError ? (
          <ErrorBlock message={parseApiError(logsQuery.error, 'Log kayıtları alınamadı.').message} />
        ) : null}

        {!logsQuery.isLoading && !logsQuery.isError ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <section className="overflow-hidden rounded-xl border border-slate-900 bg-[#09131d] text-slate-200 shadow-inner">
              <div className="flex items-center justify-between border-b border-slate-700 bg-slate-900/70 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                  <span className="ml-2 text-xs font-semibold text-slate-300">audit-terminal</span>
                </div>
                <span className="text-[11px] text-slate-400">
                  {followLogs ? 'FOLLOW MODE' : 'MANUAL MODE'} • {logsRangeStart}-{logsRangeEnd} / {logsTotal}
                </span>
              </div>

              <form onSubmit={handleCommandSubmit} className="border-b border-slate-700 bg-slate-900/50 p-2">
                <label className="flex items-center gap-2 text-xs font-mono text-emerald-300">
                  <span>admin@audit:~$</span>
                  <input
                    value={commandInput}
                    onChange={(event) => setCommandInput(event.target.value)}
                    placeholder='help, follow on, status failed, action ATTENDANCE_EVENT_CREATED, search duplicate, page 2...'
                    className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-cyan-400"
                  />
                </label>
              </form>

              <div ref={terminalScrollRef} className="h-[520px] overflow-y-auto px-3 py-2 font-mono text-xs">
                {consoleMessages.map((item) => (
                  <p key={item.id} className={`leading-6 ${consoleMessageClass(item.level)}`}>
                    {item.text}
                  </p>
                ))}

                {visibleLogs.map((item) => {
                  const isSelected = selectedLog?.id === item.id
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedLogId(item.id)}
                      className={`mt-1 block w-full rounded px-2 py-1 text-left leading-6 ${
                        isSelected ? 'bg-cyan-900/40 ring-1 ring-cyan-500/40' : 'hover:bg-slate-800/60'
                      }`}
                    >
                      <span className={item.success ? 'text-emerald-300' : 'text-rose-300'}>
                        {item.success ? '[OK]' : '[ERR]'}
                      </span>{' '}
                      <span className="text-slate-200">{toTerminalLine(item)}</span>
                    </button>
                  )
                })}

                {visibleLogs.length === 0 ? (
                  <p className="mt-2 text-amber-300">Filtreye uygun log kaydı bulunamadı.</p>
                ) : null}
              </div>
            </section>

            <aside className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <h5 className="text-sm font-semibold text-slate-900">Seçili log detayı</h5>
              {selectedLog === null ? (
                <p className="mt-3 text-sm text-slate-600">Listeden bir kayıt seçin.</p>
              ) : (
                <div className="mt-3 space-y-3">
                  <div className="rounded-lg border border-slate-200 bg-white p-2">
                    <p className="text-xs text-slate-500">Aksiyon</p>
                    <p className="text-sm font-semibold text-slate-900">{actionLabel(selectedLog.action)}</p>
                    <p className="mt-1 text-xs text-slate-500">{selectedLog.action}</p>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-700">
                    <p>
                      <span className="font-semibold">Zaman:</span> {formatDateTime(selectedLog.ts_utc)}
                    </p>
                    <p>
                      <span className="font-semibold">Aktor:</span> {selectedLog.actor_type}:{selectedLog.actor_id}
                    </p>
                    <p>
                      <span className="font-semibold">Modul:</span> {selectedLog.module}
                    </p>
                    <p>
                      <span className="font-semibold">Event tipi:</span> {selectedLog.event_type ?? '-'}
                    </p>
                    <p>
                      <span className="font-semibold">Durum:</span> {successLabel(selectedLog.success)}
                    </p>
                    <p>
                      <span className="font-semibold">Employee:</span> {selectedLog.employee_id ?? '-'}
                    </p>
                    <p>
                      <span className="font-semibold">Device:</span> {selectedLog.device_id ?? '-'}
                    </p>
                    <p>
                      <span className="font-semibold">Varlik:</span>{' '}
                      {selectedLog.entity_type ?? '-'}
                      {selectedLog.entity_id ? ` #${selectedLog.entity_id}` : ''}
                    </p>
                    <p>
                      <span className="font-semibold">IP:</span> {selectedLog.ip ?? '-'}
                    </p>
                    <p className="break-all">
                      <span className="font-semibold">User Agent:</span> {selectedLog.user_agent ?? '-'}
                    </p>
                    <p>
                      <span className="font-semibold">Detay özeti:</span> {detailsPreview(selectedLog.details)}
                    </p>
                  </div>

                  <div>
                    <p className="mb-1 text-xs font-semibold text-slate-600">JSON detay</p>
                    <pre className="max-h-64 overflow-auto rounded-lg bg-slate-900 p-2 text-[11px] text-slate-100">
                      {JSON.stringify(selectedLog.details, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </aside>
          </div>
        ) : null}
      </Panel>
    </div>
  )
}
