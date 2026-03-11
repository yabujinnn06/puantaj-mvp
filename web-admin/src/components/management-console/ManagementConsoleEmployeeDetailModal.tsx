import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { parseApiError } from '../../api/error'
import {
  createControlRoomEmployeeAction,
  createControlRoomNote,
  createControlRoomRiskOverride,
  getAttendanceEvents,
  getControlRoomEmployeeDetail,
  getMonthlyEmployee,
  getNotificationJobs,
} from '../../api/admin'
import { ErrorBlock } from '../ErrorBlock'
import { LoadingBlock } from '../LoadingBlock'
import { MinuteDisplay } from '../MinuteDisplay'
import { Modal } from '../Modal'
import { useToast } from '../../hooks/useToast'
import type { AttendanceEvent, MonthlyEmployeeDay, NotificationJob } from '../../types/api'
import type { ActionState } from './types'

const ISTANBUL_TIMEZONE = 'Europe/Istanbul'

const DAY_KEY = new Intl.DateTimeFormat('en-CA', {
  timeZone: ISTANBUL_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

type TimelineGroup = {
  dateKey: string
  label: string
  day: MonthlyEmployeeDay | null
  events: AttendanceEvent[]
  firstIn: AttendanceEvent | null
  lastOut: AttendanceEvent | null
}

type OperationalDay = {
  date: string
  label: string
  tone: 'is-normal' | 'is-watch' | 'is-critical'
  summary: string
  shiftName: string
  workedMinutes: number
  overtimeMinutes: number
  earlyArrivalMinutes: number
  missingMinutes: number
  flagCount: number
}

type DurationValue = '1' | '3' | '7' | 'indefinite'

type ActionPreset = {
  title: string
  summary: string
  reason: string
  note: string
  buttonClass: string
  duration: DurationValue
}

const ACTION_PRESETS: Record<'REVIEW' | 'DISABLE_TEMP' | 'SUSPEND' | 'RISK_OVERRIDE' | 'NOTE', ActionPreset> = {
  REVIEW: {
    title: 'Ä°ncelemeye al',
    summary: 'Ã‡alÄ±ÅŸanÄ±n operasyon dosyasÄ±nÄ± izlemeye alÄ±r ve audit akÄ±ÅŸÄ±na kaydeder.',
    reason: 'Operasyon dosyasÄ±nda izleme gerektiren sinyaller tespit edildi.',
    note: 'Personel kaydÄ± inceleme akÄ±ÅŸÄ±na alÄ±ndÄ±.',
    buttonClass: 'mc-button--primary',
    duration: '3',
  },
  DISABLE_TEMP: {
    title: 'GeÃ§ici mÃ¼dahale',
    summary: 'EriÅŸim ve sÃ¼reÃ§ etkisini geÃ§ici olarak sÄ±nÄ±rlar.',
    reason: 'Operasyonel uyumsuzluk nedeniyle geÃ§ici devre dÄ±ÅŸÄ± iÅŸlemi uygulanÄ±yor.',
    note: 'GeÃ§ici mÃ¼dahale kaydÄ± operasyon dosyasÄ±ndan baÅŸlatÄ±ldÄ±.',
    buttonClass: 'mc-button--secondary',
    duration: '1',
  },
  SUSPEND: {
    title: 'AskÄ±ya al',
    summary: 'Kritik durumda personel kaydÄ±nÄ± sÃ¼resiz veya sÄ±nÄ±rlÄ± sÃ¼reyle askÄ±ya alÄ±r.',
    reason: 'Kritik operasyon riski nedeniyle askÄ±ya alma iÅŸlemi uygulanÄ±yor.',
    note: 'AskÄ±ya alma iÅŸlemi operasyon dosyasÄ±ndan baÅŸlatÄ±ldÄ±.',
    buttonClass: 'mc-button--danger',
    duration: '7',
  },
  RISK_OVERRIDE: {
    title: 'Risk override',
    summary: 'Risk skorunu kontrollÃ¼ biÃ§imde manuel olarak gÃ¼nceller.',
    reason: 'Risk skoru manuel olarak yeniden deÄŸerlendirildi.',
    note: 'Risk override iÅŸlemi operasyon dosyasÄ±ndan kaydedildi.',
    buttonClass: 'mc-button--ghost',
    duration: '3',
  },
  NOTE: {
    title: 'Operasyon notu',
    summary: 'SÃ¼reÃ§ izine admin notu ekler.',
    reason: '',
    note: 'Operasyon dosyasÄ±na gÃ¶zlem notu eklendi.',
    buttonClass: 'mc-button--ghost',
    duration: '1',
  },
}

const riskStatusLabels: Record<string, string> = {
  RISK_CRITICAL: 'Risk skoru kritik eÅŸikte',
  RISK_HIGH: 'YÃ¼ksek risk seviyesi',
  RISK_MEDIUM: 'Orta risk seviyesi',
  RISK_LOW: 'DÃ¼ÅŸÃ¼k risk seviyesi',
}

const riskFactorLabels: Record<string, string> = {
  VIOLATION_DENSITY: 'Ä°hlal yoÄŸunluÄŸu',
  ABSENCE_MINUTES: 'DevamsÄ±zlÄ±k sÃ¼resi',
  EARLY_CHECKOUT: 'Erken Ã§Ä±kÄ±ÅŸ',
  LATE_CHECKIN: 'GeÃ§ giriÅŸ',
  LOCATION_DEVIATION: 'Lokasyon sapmasÄ±',
}

function defaultExpandedTimelineKeys(): string[] {
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  return [DAY_KEY.format(today), DAY_KEY.format(yesterday)]
}

function currentMonthBounds() {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ISTANBUL_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now)
  const year = Number(parts.find((item) => item.type === 'year')?.value ?? now.getUTCFullYear())
  const month = Number(parts.find((item) => item.type === 'month')?.value ?? now.getUTCMonth() + 1)
  const endDate = new Date(Date.UTC(year, month, 0))
  return {
    year,
    month,
    start: `${year}-${String(month).padStart(2, '0')}-01`,
    end: endDate.toISOString().slice(0, 10),
  }
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-'
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: ISTANBUL_TIMEZONE,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatTime(value: string | null | undefined): string {
  if (!value) return '-'
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: ISTANBUL_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '-'
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: ISTANBUL_TIMEZONE,
    dateStyle: 'medium',
  }).format(new Date(value))
}

function formatRelative(value: string | null | undefined): string {
  if (!value) return 'Veri yok'
  const diffMs = Date.now() - new Date(value).getTime()
  const minutes = Math.max(0, Math.round(diffMs / 60000))
  if (minutes < 1) return 'Åimdi'
  if (minutes < 60) return `${minutes} dk Ã¶nce`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} sa Ã¶nce`
  return `${Math.floor(hours / 24)} gÃ¼n Ã¶nce`
}

function localDayKey(value: string): string {
  return DAY_KEY.format(new Date(value))
}

function riskClass(value: 'NORMAL' | 'WATCH' | 'CRITICAL' | 'Bilgi' | 'Uyari' | 'Kritik' | null | undefined): string {
  if (value === 'CRITICAL' || value === 'Kritik') return 'is-critical'
  if (value === 'WATCH' || value === 'Uyari') return 'is-watch'
  return 'is-normal'
}

function riskStatusLabel(value: 'NORMAL' | 'WATCH' | 'CRITICAL'): string {
  if (value === 'CRITICAL') return 'Kritik'
  if (value === 'WATCH') return 'Ä°zlemeli'
  return 'Normal'
}

function riskStatusCodeLabel(value: string): string {
  return riskStatusLabels[value] ?? value
}

function riskFactorLabel(code: string, fallback: string): string {
  return riskFactorLabels[code] ?? fallback
}

function dailyStatusLabel(value: string | null | undefined): string {
  if (!value) return 'Durum yok'
  if (value === 'COMPLETE') return 'TamamlandÄ±'
  if (value === 'INCOMPLETE') return 'Eksik kayÄ±t'
  if (value === 'ABSENT') return 'DevamsÄ±z'
  if (value === 'OPEN_SHIFT') return 'AÃ§Ä±k vardiya'
  return value
}

function todayStatusLabel(value: 'NOT_STARTED' | 'IN_PROGRESS' | 'FINISHED'): string {
  if (value === 'IN_PROGRESS') return 'Aktif vardiya'
  if (value === 'FINISHED') return 'GÃ¼n tamamlandÄ±'
  return 'GiriÅŸ bekleniyor'
}

function locationStateLabel(value: 'LIVE' | 'STALE' | 'DORMANT' | 'NONE'): string {
  if (value === 'LIVE') return 'CanlÄ±'
  if (value === 'STALE') return 'YakÄ±n'
  if (value === 'DORMANT') return 'Eski'
  return 'Veri yok'
}

function eventTypeLabel(value: AttendanceEvent['type']): string {
  return value === 'IN' ? 'GiriÅŸ' : 'Ã‡Ä±kÄ±ÅŸ'
}

function eventSourceLabel(value: AttendanceEvent['source']): string {
  return value === 'MANUAL' ? 'Manuel' : 'Cihaz'
}

function eventDeviceLabel(event: AttendanceEvent): string {
  if (event.device_id != null) return `Cihaz #${event.device_id}`
  return eventSourceLabel(event.source)
}

function notificationStatusLabel(value: NotificationJob['status']): string {
  if (value === 'PENDING') return 'Bekliyor'
  if (value === 'SENDING') return 'GÃ¶nderiliyor'
  if (value === 'SENT') return 'GÃ¶nderildi'
  if (value === 'FAILED') return 'Hata'
  return 'Ä°ptal'
}

function notificationAudienceLabel(value: NotificationJob['audience']): string {
  if (value === 'admin') return 'YÃ¶netim'
  if (value === 'employee') return 'Ã‡alÄ±ÅŸan'
  return 'Karma'
}

function buildTimeline(events: AttendanceEvent[], monthDays: MonthlyEmployeeDay[]): TimelineGroup[] {
  const dayMap = new Map(monthDays.map((day) => [day.date, day]))
  const grouped = new Map<string, AttendanceEvent[]>()
  for (const event of events) {
    const key = localDayKey(event.ts_utc)
    grouped.set(key, [...(grouped.get(key) ?? []), event])
  }
  return [...grouped.entries()]
    .map(([dateKey, items]) => {
      const sorted = [...items].sort((a, b) => new Date(b.ts_utc).getTime() - new Date(a.ts_utc).getTime())
      return {
        dateKey,
        label: formatDate(dateKey),
        day: dayMap.get(dateKey) ?? null,
        events: sorted,
        firstIn: [...sorted].reverse().find((item) => item.type === 'IN') ?? null,
        lastOut: sorted.find((item) => item.type === 'OUT') ?? null,
      }
    })
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey))
    .slice(0, 7)
}

function buildOperationalDays(days: MonthlyEmployeeDay[]): OperationalDay[] {
  return days
    .filter((day) => day.status === 'INCOMPLETE' || day.missing_minutes > 0 || day.overtime_minutes > 0 || day.early_arrival_minutes > 0 || day.flags.length > 0)
    .map((day) => {
      const tone: OperationalDay['tone'] =
        day.status === 'INCOMPLETE' || day.missing_minutes >= 60
          ? 'is-critical'
          : day.missing_minutes > 0 || day.flags.length > 0
            ? 'is-watch'
            : 'is-normal'
      const summary =
        day.status === 'INCOMPLETE'
          ? 'Eksik kapanÄ±ÅŸ veya eksik kayÄ±t'
          : day.missing_minutes > 0
            ? 'Eksik Ã§alÄ±ÅŸma sÃ¼resi'
            : day.overtime_minutes > 0
              ? 'Plan Ã¼stÃ¼ mesai'
              : day.early_arrival_minutes > 0
                ? 'Erken geliÅŸ kaydÄ±'
                : 'Ä°zleme iÅŸareti'
      return {
        date: day.date,
        label: formatDate(day.date),
        tone,
        summary,
        shiftName: day.shift_name ?? 'TanÄ±msÄ±z vardiya',
        workedMinutes: day.worked_minutes,
        overtimeMinutes: day.overtime_minutes,
        earlyArrivalMinutes: day.early_arrival_minutes,
        missingMinutes: day.missing_minutes,
        flagCount: day.flags.length,
      }
    })
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10)
}

function resolvePreset(state: Exclude<ActionState, null>): ActionPreset {
  if (state.kind === 'note') return ACTION_PRESETS.NOTE
  if (state.kind === 'override') return ACTION_PRESETS.RISK_OVERRIDE
  return ACTION_PRESETS[state.actionType]
}

function actionTitle(state: Exclude<ActionState, null>): string {
  return resolvePreset(state).title
}

export function ManagementConsoleEmployeeDetailModal({
  employeeId,
  open,
  onClose,
}: {
  employeeId: number | null
  open: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { pushToast } = useToast()
  const bounds = useMemo(() => currentMonthBounds(), [])
  const [actionState, setActionState] = useState<ActionState>(null)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [duration, setDuration] = useState<DurationValue>('3')
  const [overrideScore, setOverrideScore] = useState('50')
  const [formError, setFormError] = useState<string | null>(null)
  const [expandedTimelineKeys, setExpandedTimelineKeys] = useState<string[]>([])

  useEffect(() => {
    if (!open) {
      setActionState(null)
      setReason('')
      setNote('')
      setDuration('3')
      setOverrideScore('50')
      setFormError(null)
      setExpandedTimelineKeys([])
    }
  }, [open])

  useEffect(() => {
    if (!open || employeeId == null) return
    setExpandedTimelineKeys(defaultExpandedTimelineKeys())
  }, [open, employeeId])

  const detailQuery = useQuery({
    queryKey: ['management-console-detail', employeeId],
    queryFn: () => getControlRoomEmployeeDetail(employeeId as number),
    enabled: open && employeeId != null,
  })
  const attendanceQuery = useQuery({
    queryKey: ['management-console-detail-events', employeeId, bounds.start, bounds.end],
    queryFn: () => getAttendanceEvents({ employee_id: employeeId as number, start_date: bounds.start, end_date: bounds.end, limit: 250 }),
    enabled: open && employeeId != null,
  })
  const monthlyQuery = useQuery({
    queryKey: ['management-console-detail-monthly', employeeId, bounds.year, bounds.month],
    queryFn: () => getMonthlyEmployee({ employee_id: employeeId as number, year: bounds.year, month: bounds.month }),
    enabled: open && employeeId != null,
  })
  const notificationQuery = useQuery({
    queryKey: ['management-console-detail-notifications', employeeId, bounds.start, bounds.end],
    queryFn: () => getNotificationJobs({ employee_id: employeeId as number, start_date: bounds.start, end_date: bounds.end, offset: 0, limit: 8 }),
    enabled: open && employeeId != null,
  })

  const detail = detailQuery.data
  const employee = detail?.employee_state ?? null
  const monthDays = monthlyQuery.data?.days ?? []
  const notificationJobs = notificationQuery.data?.items ?? []
  const timeline = useMemo(() => buildTimeline(attendanceQuery.data ?? [], monthDays), [attendanceQuery.data, monthDays])
  const operationalDays = useMemo(() => buildOperationalDays(monthDays), [monthDays])
  const riskHistoryMax = Math.max(1, ...(detail?.risk_history ?? []).map((item) => item.value))
  const failedNotificationCount = notificationJobs.filter((job) => job.status === 'FAILED').length

  const toggleTimelineDay = (dateKey: string) => {
    setExpandedTimelineKeys((current) =>
      current.includes(dateKey) ? current.filter((item) => item !== dateKey) : [...current, dateKey],
    )
  }

  const startActionFlow = (nextState: Exclude<ActionState, null>) => {
    const preset = resolvePreset(nextState)
    setActionState(nextState)
    setReason(preset.reason)
    setNote(preset.note)
    setDuration(preset.duration)
    setOverrideScore(String(employee?.risk_score ?? 50))
    setFormError(null)
  }

  const actionMutation = useMutation({
    mutationFn: async () => {
      if (!employeeId || !actionState) throw new Error('Personel seÃ§ilmedi.')
      if (actionState.kind === 'action') {
        return createControlRoomEmployeeAction({
          employee_id: employeeId,
          action_type: actionState.actionType,
          reason,
          note,
          duration_days: duration === 'indefinite' ? undefined : (Number(duration) as 1 | 3 | 7),
          indefinite: duration === 'indefinite',
        })
      }
      if (actionState.kind === 'override') {
        return createControlRoomRiskOverride({
          employee_id: employeeId,
          override_score: Math.max(0, Math.min(100, Number(overrideScore) || 0)),
          reason,
          note,
          duration_days: duration === 'indefinite' ? undefined : (Number(duration) as 1 | 3 | 7),
          indefinite: duration === 'indefinite',
        })
      }
      return createControlRoomNote({ employee_id: employeeId, note })
    },
    onSuccess: (result) => {
      pushToast({ variant: 'success', title: 'Ä°ÅŸlem kaydedildi', description: result.message })
      setActionState(null)
      setReason('')
      setNote('')
      setFormError(null)
      void queryClient.invalidateQueries({ queryKey: ['control-room-overview'] })
      void queryClient.invalidateQueries({ queryKey: ['management-console-detail', employeeId] })
      void queryClient.invalidateQueries({ queryKey: ['management-console-detail-events', employeeId, bounds.start, bounds.end] })
      void queryClient.invalidateQueries({ queryKey: ['management-console-detail-monthly', employeeId, bounds.year, bounds.month] })
      void queryClient.invalidateQueries({ queryKey: ['management-console-detail-notifications', employeeId, bounds.start, bounds.end] })
    },
    onError: (error) => {
      const parsed = parseApiError(error, 'Ä°ÅŸlem kaydedilemedi.')
      setFormError(parsed.message)
      pushToast({ variant: 'error', title: 'Operasyon iÅŸlemi baÅŸarÄ±sÄ±z', description: parsed.message })
    },
  })

  return (
    <Modal
      open={open}
      title={
        employee ? (
          <span className="mc-modal__title-group">
            <span>{employee.employee.full_name} Â· Operasyon dosyasÄ±</span>
            <span className={`mc-risk-badge ${riskClass(employee.risk_status)}`}>
              {employee.risk_score} Â· {riskStatusLabel(employee.risk_status)}
            </span>
          </span>
        ) : (
          'Operasyon dosyasÄ±'
        )
      }
      onClose={onClose}
      placement="center"
      maxWidthClass="max-w-none"
      panelClassName="mc-modal__panel--detail"
    >
      {detailQuery.isLoading && !detail ? (
        <LoadingBlock label="Operasyon dosyasÄ± yÃ¼kleniyor..." />
      ) : detailQuery.isError || !detail || !employee ? (
        <ErrorBlock message="Operasyon dosyasÄ± alÄ±namadÄ±." />
      ) : (
        <div className="mc-ops">
          <header className="mc-ops__hero">
            <div className="mc-ops__hero-main">
              <p className="mc-kicker">OPERASYON DOSYASI</p>
              <h3>{employee.employee.full_name}</h3>
              <p>{employee.department_name ?? 'Departman tanÄ±msÄ±z'} Â· {employee.employee.region_name ?? 'BÃ¶lge tanÄ±msÄ±z'} Â· {todayStatusLabel(employee.today_status)}</p>
              <div className="mc-ops__chips">
                <span className={`mc-status-pill ${riskClass(employee.risk_status)}`}>{riskStatusLabel(employee.risk_status)}</span>
                <span className="mc-chip">{employee.shift_name ?? 'Vardiya tanÄ±msÄ±z'}</span>
                <span className="mc-chip">{employee.shift_window_label ?? 'Plan penceresi yok'}</span>
                <span className="mc-chip">{locationStateLabel(employee.location_state)}</span>
              </div>
            </div>
            <div className={`mc-ops__score ${riskClass(employee.risk_status)}`}>
              <span>Risk skoru</span>
              <strong>{employee.risk_score}</strong>
              <small>{formatRelative(employee.last_activity_utc)}</small>
            </div>
          </header>

          <section className="mc-ops__metrics">
            <article className="mc-ops__metric"><span>Son giriÅŸ</span><strong>{formatDateTime(employee.last_checkin_utc)}</strong></article>
            <article className="mc-ops__metric"><span>Son Ã§Ä±kÄ±ÅŸ</span><strong>{formatDateTime(employee.last_checkout_utc)}</strong></article>
            <article className="mc-ops__metric"><span>BugÃ¼nkÃ¼ sÃ¼re</span><strong><MinuteDisplay minutes={employee.worked_today_minutes} /></strong></article>
            <article className="mc-ops__metric"><span>HaftalÄ±k toplam</span><strong><MinuteDisplay minutes={employee.weekly_total_minutes} /></strong></article>
            <article className="mc-ops__metric"><span>Erken geliÅŸ</span><strong><MinuteDisplay minutes={monthlyQuery.data?.totals.early_arrival_minutes ?? 0} /></strong></article>
            <article className="mc-ops__metric"><span>Bildirim hatasÄ±</span><strong>{failedNotificationCount}</strong></article>
          </section>

          <div className="mc-ops__shell">
            <main className="mc-ops__main">
              <section className="mc-ops__section">
                <div className="mc-ops__section-head">
                  <div><h4>Operasyon Ã¶zeti</h4><p>AnlÄ±k durum, sinyaller ve kayÄ±t kalitesi</p></div>
                </div>
                <div className="mc-ops__summary-grid">
                  <article className="mc-ops__summary-card">
                    <span>Son aktivite</span>
                    <strong>{formatDateTime(employee.last_activity_utc)}</strong>
                    <small>{formatRelative(employee.last_activity_utc)}</small>
                  </article>
                  <article className="mc-ops__summary-card">
                    <span>Konum / IP</span>
                    <strong>{employee.location_label ?? 'Veri yok'}</strong>
                    <small>{employee.recent_ip ?? 'IP kaydÄ± yok'}</small>
                  </article>
                  <article className="mc-ops__summary-card">
                    <span>Cihaz kapsamÄ±</span>
                    <strong>{employee.active_devices}/{employee.total_devices} aktif</strong>
                    <small>Portal gÃ¶rÃ¼nÃ¼mÃ¼ {formatRelative(employee.last_portal_seen_utc)}</small>
                  </article>
                  <article className="mc-ops__summary-card">
                    <span>Aktif Ã¶nlem</span>
                    <strong>{employee.active_measure?.label ?? 'Aktif mÃ¼dahale yok'}</strong>
                    <small>{employee.latest_note?.note ?? 'Yeni admin notu yok'}</small>
                  </article>
                </div>
                <div className="mc-ops__signal-grid">
                  {employee.attention_flags.length ? employee.attention_flags.map((alert) => (
                    <article key={alert.code} className={`mc-ops__signal ${alert.severity === 'critical' ? 'is-critical' : alert.severity === 'warning' ? 'is-watch' : 'is-normal'}`}>
                      <strong>{alert.label}</strong>
                      <span>{riskStatusCodeLabel(alert.code)}</span>
                    </article>
                  )) : <div className="mc-empty-state">Aktif operasyon sinyali bulunmuyor.</div>}
                </div>
              </section>

              <section className="mc-ops__section">
                <div className="mc-ops__section-head">
                  <div><h4>GÃ¼nlÃ¼k akÄ±ÅŸ</h4><p>Son gÃ¼nlerdeki giriÅŸ, Ã§Ä±kÄ±ÅŸ ve vardiya sonucu</p></div>
                  <Link to={`/attendance-events?employee_id=${employee.employee.id}&start_date=${bounds.start}&end_date=${bounds.end}`} className="mc-button mc-button--ghost">Yoklama kayÄ±tlarÄ±na git</Link>
                </div>
                {attendanceQuery.isError ? <ErrorBlock message="GiriÅŸ Ã§Ä±kÄ±ÅŸ zaman Ã§izelgesi alÄ±namadÄ±." /> : null}
                <div className="mc-ops__timeline">
                  {timeline.length ? (
                    timeline.map((group) => {
                      const isExpanded = expandedTimelineKeys.includes(group.dateKey)
                      const summaryId = `timeline-${group.dateKey}`

                      return (
                        <article key={group.dateKey} className={`mc-ops__timeline-day ${isExpanded ? 'is-expanded' : ''}`}>
                          <button
                            type="button"
                            className="mc-ops__timeline-toggle"
                            onClick={() => toggleTimelineDay(group.dateKey)}
                            aria-expanded={isExpanded}
                            aria-controls={summaryId}
                          >
                            <div className="mc-ops__timeline-head">
                              <div>
                                <strong>{group.label}</strong>
                                <p>
                                  {group.day?.shift_name ?? employee.shift_name ?? 'Vardiya tanımsız'} ·{' '}
                                  {dailyStatusLabel(group.day?.status)}
                                </p>
                              </div>
                              <div className="mc-ops__timeline-meta">
                                <span><MinuteDisplay minutes={group.day?.worked_minutes ?? 0} /></span>
                                <span>Eksik: <MinuteDisplay minutes={group.day?.missing_minutes ?? 0} /></span>
                                <span className="mc-ops__timeline-chevron">{isExpanded ? 'Gizle' : 'Detay'}</span>
                              </div>
                            </div>
                          </button>

                          {isExpanded ? (
                            <div id={summaryId} className="mc-ops__timeline-details">
                              <div className="mc-ops__timeline-summary-grid">
                                <span className="mc-ops__timeline-summary-item">İlk giriş: {formatTime(group.firstIn?.ts_utc ?? null)}</span>
                                <span className="mc-ops__timeline-summary-item">Son çıkış: {formatTime(group.lastOut?.ts_utc ?? null)}</span>
                                <span className="mc-ops__timeline-summary-item">
                                  Erken geliş: <MinuteDisplay minutes={group.day?.early_arrival_minutes ?? 0} />
                                </span>
                                <span className="mc-ops__timeline-summary-item">
                                  Mesai: <MinuteDisplay minutes={group.day?.overtime_minutes ?? 0} />
                                </span>
                              </div>

                              <div className="mc-ops__event-list">
                                {group.events.map((event) => (
                                  <article
                                    key={event.id}
                                    className={`mc-ops__event-row ${event.type === 'IN' ? 'is-in' : 'is-out'}`}
                                  >
                                    <div className="mc-ops__event-line">
                                      <span
                                        className={`mc-ops__event-dot ${event.type === 'IN' ? 'is-in' : 'is-out'}`}
                                        aria-hidden="true"
                                      />
                                      <strong>{eventTypeLabel(event.type)}</strong>
                                      <span>{formatTime(event.ts_utc)}</span>
                                      <span>·</span>
                                      <span>{eventDeviceLabel(event)}</span>
                                      {event.note ? (
                                        <>
                                          <span>·</span>
                                          <span>{event.note}</span>
                                        </>
                                      ) : null}
                                    </div>
                                  </article>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </article>
                      )
                    })
                  ) : (
                    <div className="mc-empty-state">Bu dönem için giriş çıkış kaydı bulunmuyor.</div>
                  )}
                </div>
              </section>

              <section className="mc-ops__section">
                <div className="mc-ops__section-head">
                  <div><h4>Problemli gÃ¼nler</h4><p>Eksik kayÄ±t, mesai ve erken geliÅŸ Ã§etelesi</p></div>
                  <span className="mc-chip">{operationalDays.length} kayÄ±t</span>
                </div>
                <div className="mc-ops__issue-list">
                  {operationalDays.length ? operationalDays.map((day) => (
                    <article key={day.date} className={`mc-ops__issue ${day.tone}`}>
                      <div>
                        <strong>{day.label}</strong>
                        <p>{day.summary} Â· {day.shiftName}</p>
                      </div>
                      <div className="mc-ops__issue-metrics">
                        <span>Ã‡alÄ±ÅŸma <MinuteDisplay minutes={day.workedMinutes} /></span>
                        <span>Mesai <MinuteDisplay minutes={day.overtimeMinutes} /></span>
                        <span>Erken geliÅŸ <MinuteDisplay minutes={day.earlyArrivalMinutes} /></span>
                        <span>Eksik <MinuteDisplay minutes={day.missingMinutes} /></span>
                        <span>{day.flagCount} iÅŸaret</span>
                      </div>
                    </article>
                  )) : <div className="mc-empty-state">Bu ay iÃ§in dikkat gerektiren gÃ¼n bulunmuyor.</div>}
                </div>
              </section>
            </main>

            <aside className="mc-ops__aside mc-ops__aside--sticky">
              <section className="mc-ops__section mc-ops__section--sticky">
                <div className="mc-ops__section-head">
                  <div><h4>MÃ¼dahale merkezi</h4><p>Ä°nceleme, kontrol ve aÃ§Ä±klama kayÄ±tlarÄ±</p></div>
                </div>
                <div className="mc-ops__action-grid">
                  <button type="button" className={`mc-button ${ACTION_PRESETS.REVIEW.buttonClass}`} onClick={() => startActionFlow({ kind: 'action', actionType: 'REVIEW' })}>{ACTION_PRESETS.REVIEW.title}</button>
                  <button type="button" className={`mc-button ${ACTION_PRESETS.DISABLE_TEMP.buttonClass}`} onClick={() => startActionFlow({ kind: 'action', actionType: 'DISABLE_TEMP' })}>{ACTION_PRESETS.DISABLE_TEMP.title}</button>
                  <button type="button" className={`mc-button ${ACTION_PRESETS.SUSPEND.buttonClass}`} onClick={() => startActionFlow({ kind: 'action', actionType: 'SUSPEND' })}>{ACTION_PRESETS.SUSPEND.title}</button>
                  <button type="button" className={`mc-button ${ACTION_PRESETS.RISK_OVERRIDE.buttonClass}`} onClick={() => startActionFlow({ kind: 'override' })}>{ACTION_PRESETS.RISK_OVERRIDE.title}</button>
                  <button type="button" className={`mc-button ${ACTION_PRESETS.NOTE.buttonClass}`} onClick={() => startActionFlow({ kind: 'note' })}>{ACTION_PRESETS.NOTE.title}</button>
                </div>
                {actionState ? (
                  <div className="mc-ops__composer">
                    <div className="mc-ops__composer-head">
                      <strong>{actionTitle(actionState)}</strong>
                      <span>{resolvePreset(actionState).summary}</span>
                    </div>
                    {actionState.kind !== 'note' ? (
                      <>
                        <label className="mc-field"><span>Sebep</span><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ä°ÅŸlem gerekÃ§esi" /></label>
                        {actionState.kind === 'override' ? <label className="mc-field"><span>Risk skoru</span><input type="number" min={0} max={100} value={overrideScore} onChange={(event) => setOverrideScore(event.target.value)} /></label> : null}
                        <label className="mc-field"><span>SÃ¼re</span><select value={duration} onChange={(event) => setDuration(event.target.value as DurationValue)}><option value="1">1 gÃ¼n</option><option value="3">3 gÃ¼n</option><option value="7">7 gÃ¼n</option><option value="indefinite">SÃ¼resiz</option></select></label>
                      </>
                    ) : null}
                    <label className="mc-field"><span>{actionState.kind === 'note' ? 'Not' : 'Operasyon notu'}</span><textarea rows={5} value={note} onChange={(event) => setNote(event.target.value)} /></label>
                    {formError ? <div className="mc-ops__form-error">{formError}</div> : null}
                    <div className="mc-action-composer__footer">
                      <span>{actionState.kind === 'note' ? 'Sadece kayÄ±t izi oluÅŸturulur.' : duration === 'indefinite' ? 'SÃ¼resiz iÅŸlem' : `${duration} gÃ¼nlÃ¼k iÅŸlem`}</span>
                      <div className="mc-action-composer__actions">
                        <button type="button" className="mc-button mc-button--ghost" onClick={() => setActionState(null)}>Ä°ptal</button>
                        <button type="button" className="mc-button mc-button--primary" onClick={() => void actionMutation.mutateAsync()} disabled={actionMutation.isPending}>{actionMutation.isPending ? 'Kaydediliyor...' : 'Kaydet'}</button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mc-ops__placeholder">Operasyon notu veya mÃ¼dahale seÃ§ildiÄŸinde bu alanda onay formu aÃ§Ä±lÄ±r.</div>
                )}
              </section>

              <section className="mc-ops__section">
                <div className="mc-ops__section-head">
                  <div><h4>Risk analitiÄŸi</h4><p>Skor eÄŸrisi, etkileyen faktÃ¶rler ve formÃ¼l</p></div>
                </div>
                <div className="mc-risk-history">
                  {(detail.risk_history ?? []).map((point) => (
                    <article key={point.label} className="mc-risk-history__item">
                      <span>{point.label}</span>
                      <div className="mc-risk-history__bar"><div className="mc-risk-history__fill" style={{ height: `${Math.max(12, (point.value / riskHistoryMax) * 100)}%` }} /></div>
                      <strong>{point.value}</strong>
                    </article>
                  ))}
                </div>
                <div className="mc-ops__factor-list">
                  {employee.risk_factors.map((factor) => (
                    <article key={factor.code} className="mc-ops__factor">
                      <div className="mc-ops__factor-header">
                        <strong>{riskFactorLabel(factor.code, factor.label)}</strong>
                        <span className="mc-ops__factor-score">+{factor.impact_score}</span>
                      </div>
                      <p className="mc-ops__factor-desc">{factor.description}</p>
                      <div className="mc-ops__factor-side">
                        <strong>{factor.value}</strong>
                      </div>
                    </article>
                  ))}
                  {!employee.risk_factors.length ? <div className="mc-empty-state">Risk faktÃ¶rÃ¼ bulunmuyor.</div> : null}
                </div>
              </section>

              <section className="mc-ops__section">
                <div className="mc-ops__section-head">
                  <div><h4>Bildirim ve denetim izi</h4><p>Son bildirimler, notlar, Ã¶nlemler ve audit kayÄ±tlarÄ±</p></div>
                </div>
                <div className="mc-ops__feed">
                  {notificationQuery.isError ? <ErrorBlock message="Bildirim akÄ±ÅŸÄ± alÄ±namadÄ±." /> : null}
                  {notificationJobs.slice(0, 4).map((job) => (
                    <article key={job.id} className="mc-ops__feed-row">
                      <div><strong>{job.title ?? job.notification_type ?? 'Bildirim'}</strong><p>{job.description ?? 'AÃ§Ä±klama yok.'}</p></div>
                      <div className="mc-ops__feed-side"><strong>{notificationStatusLabel(job.status)}</strong><span>{notificationAudienceLabel(job.audience)}</span></div>
                    </article>
                  ))}
                  {detail.recent_measures.slice(0, 4).map((measure) => (
                    <article key={`${measure.action_type}-${measure.created_at}`} className="mc-ops__feed-row">
                      <div><strong>{measure.label}</strong><p>{measure.note}</p></div>
                      <div className="mc-ops__feed-side"><strong>{formatDateTime(measure.created_at)}</strong><span>{measure.created_by}</span></div>
                    </article>
                  ))}
                  {detail.recent_notes.slice(0, 3).map((entry) => (
                    <article key={`${entry.created_at}-${entry.created_by}`} className="mc-ops__feed-row">
                      <div><strong>Admin notu</strong><p>{entry.note}</p></div>
                      <div className="mc-ops__feed-side"><strong>{entry.created_by}</strong><span>{formatDateTime(entry.created_at)}</span></div>
                    </article>
                  ))}
                  {detail.recent_audit_entries.slice(0, 4).map((entry) => (
                    <article key={entry.audit_id} className="mc-ops__feed-row">
                      <div><strong>{entry.label}</strong><p>{formatDateTime(entry.ts_utc)}</p></div>
                      <div className="mc-ops__feed-side"><strong>{entry.actor_id}</strong><span>{entry.ip ?? 'IP yok'}</span></div>
                    </article>
                  ))}
                  {!notificationJobs.length && !detail.recent_measures.length && !detail.recent_notes.length && !detail.recent_audit_entries.length ? <div className="mc-empty-state">Denetim izi bulunmuyor.</div> : null}
                </div>
              </section>
            </aside>
          </div>
        </div>
      )}
    </Modal>
  )
}



