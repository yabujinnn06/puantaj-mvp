import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

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
import {
  ISTANBUL_TIMEZONE,
  eventSourceLabel,
  eventTypeLabel,
  formatDate,
  formatDateTime,
  formatRelative,
  locationStateLabel,
  notificationStatusLabel,
  riskClass,
  riskStatusLabel,
  todayStatusLabel,
} from './utils'

type TimelineGroup = {
  dateKey: string
  label: string
  day: MonthlyEmployeeDay | null
  events: AttendanceEvent[]
  firstIn: AttendanceEvent | null
  lastOut: AttendanceEvent | null
}

type Recommendation = {
  title: string
  description: string
  severity: 'info' | 'warning' | 'critical'
}

const DAY_KEY = new Intl.DateTimeFormat('en-CA', {
  timeZone: ISTANBUL_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function currentMonthBounds() {
  const now = new Date()
  const year = now.getFullYear()
  const monthIndex = now.getMonth()
  const start = new Date(Date.UTC(year, monthIndex, 1))
  const end = new Date(Date.UTC(year, monthIndex + 1, 0))
  return {
    year,
    month: monthIndex + 1,
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  }
}

function localDayKey(value: string) {
  return DAY_KEY.format(new Date(value))
}

function buildTimeline(events: AttendanceEvent[], monthDays: MonthlyEmployeeDay[]) {
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
      } satisfies TimelineGroup
    })
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey))
    .slice(0, 7)
}

function buildRecommendations(
  riskStatus: 'NORMAL' | 'WATCH' | 'CRITICAL',
  incompleteDays: MonthlyEmployeeDay[],
  jobs: NotificationJob[],
  hasLocationGap: boolean,
  activeMeasure: string | null,
) {
  const items: Recommendation[] = []
  if (riskStatus === 'CRITICAL') {
    items.push({
      severity: 'critical',
      title: 'Kritik risk kontrolü',
      description: 'Son 7 günlük giriş-çıkış akışını ve vardiya eşleşmesini manuel doğrulayın.',
    })
  }
  if (incompleteDays.length) {
    items.push({
      severity: 'warning',
      title: 'Eksik kayıt incelemesi',
      description: 'Incomplete veya eksik süre içeren günler için attendance olaylarını kontrol edin.',
    })
  }
  if (jobs.some((job) => job.status === 'FAILED')) {
    items.push({
      severity: 'warning',
      title: 'Bildirim teslim problemi',
      description: 'Başarısız job kayıtları için cihaz ve abonelik sağlığını doğrulayın.',
    })
  }
  if (hasLocationGap) {
    items.push({
      severity: 'info',
      title: 'Konum kapsamı zayıf',
      description: 'Konum verisi eksik ya da eski. Cihaz ve lokasyon politikalarını gözden geçirin.',
    })
  }
  if (activeMeasure) {
    items.push({
      severity: 'info',
      title: 'Aktif önlem mevcut',
      description: `${activeMeasure} işlemi sürüyor. Yeni aksiyondan önce mevcut önlemi doğrulayın.`,
    })
  }
  if (!items.length) {
    items.push({
      severity: 'info',
      title: 'Stabil görünüm',
      description: 'Ek müdahale gerektiren belirgin bir sinyal görünmüyor.',
    })
  }
  return items.slice(0, 4)
}

function severityClass(value: Recommendation['severity']) {
  if (value === 'critical') return 'is-critical'
  if (value === 'warning') return 'is-watch'
  return 'is-normal'
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
  const [duration, setDuration] = useState<'1' | '3' | '7' | 'indefinite'>('1')
  const [overrideScore, setOverrideScore] = useState('50')

  useEffect(() => {
    if (!open) {
      setActionState(null)
      setReason('')
      setNote('')
      setDuration('1')
      setOverrideScore('50')
    }
  }, [open])

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
    queryFn: () => getNotificationJobs({ employee_id: employeeId as number, start_date: bounds.start, end_date: bounds.end, offset: 0, limit: 6 }),
    enabled: open && employeeId != null,
  })

  const actionMutation = useMutation({
    mutationFn: async () => {
      if (!employeeId || !actionState) throw new Error('Personel seçilmedi.')
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
      pushToast({ variant: 'success', title: 'Kaydedildi', description: result.message })
      setActionState(null)
      setReason('')
      setNote('')
      void queryClient.invalidateQueries({ queryKey: ['control-room-overview'] })
      void queryClient.invalidateQueries({ queryKey: ['management-console-detail', employeeId] })
    },
    onError: (error: unknown) => {
      pushToast({
        variant: 'error',
        title: 'İşlem tamamlanamadı',
        description: error instanceof Error ? error.message : 'Bilinmeyen hata',
      })
    },
  })

  const detail = detailQuery.data
  const employee = detail?.employee_state ?? null
  const monthDays = monthlyQuery.data?.days ?? []
  const notificationJobs = notificationQuery.data?.items ?? []
  const timeline = useMemo(() => buildTimeline(attendanceQuery.data ?? [], monthDays), [attendanceQuery.data, monthDays])
  const incompleteDays = useMemo(
    () => monthDays.filter((day) => day.status === 'INCOMPLETE' || day.missing_minutes > 0 || day.flags.length > 0).slice(0, 5),
    [monthDays],
  )
  const overtimeDays = useMemo(
    () => monthDays.filter((day) => day.overtime_minutes > 0 || day.legal_overtime_minutes > 0).slice(0, 5),
    [monthDays],
  )
  const attentionDays = useMemo(() => {
    const merged = new Map<string, MonthlyEmployeeDay>()
    for (const day of [...incompleteDays, ...overtimeDays]) {
      if (!merged.has(day.date)) {
        merged.set(day.date, day)
      }
    }
    return [...merged.values()].slice(0, 6)
  }, [incompleteDays, overtimeDays])
  const failedNotificationCount = notificationJobs.filter((job) => job.status === 'FAILED').length
  const riskHistoryMax = Math.max(1, ...(detail?.risk_history ?? []).map((item) => item.value))
  const recommendations = employee
    ? buildRecommendations(
        employee.risk_status,
        incompleteDays,
        notificationJobs,
        employee.location_state === 'NONE' || employee.location_state === 'DORMANT',
        employee.active_measure?.label ?? null,
      )
    : []

  return (
    <Modal
      open={open}
      title={employee ? `${employee.employee.full_name} · Operasyon dosyası` : 'Operasyon dosyası'}
      onClose={onClose}
      placement="center"
      maxWidthClass="max-w-none"
      panelClassName="mc-modal__panel--detail"
    >
      {detailQuery.isLoading && !detail ? (
        <LoadingBlock label="Personel dosyası yükleniyor..." />
      ) : detailQuery.isError || !detail || !employee ? (
        <ErrorBlock message="Personel detay bilgisi alınamadı." />
      ) : (
        <div className="mc-dossier">
          <header className="mc-dossier__hero">
            <div className="mc-dossier__hero-main">
              <p className="mc-kicker">OPERASYON DOSYASI</p>
              <h3>{employee.employee.full_name}</h3>
              <p>{employee.department_name ?? 'Departman yok'} · {employee.shift_name ?? 'Vardiya tanımı yok'} · {todayStatusLabel(employee.today_status)}</p>
              <div className="mc-dossier__hero-tags">
                <span className={`mc-status-pill ${riskClass(employee.risk_status)}`}>{riskStatusLabel(employee.risk_status)}</span>
                <span className="mc-chip">{employee.shift_window_label ?? 'Plan penceresi yok'}</span>
                <span className="mc-chip">{locationStateLabel(employee.location_state)}</span>
              </div>
              <div className="mc-dossier__hero-strip">
                <article className="mc-dossier__hero-chip">
                  <span>Son hareket</span>
                  <strong>{formatRelative(employee.last_activity_utc)}</strong>
                </article>
                <article className="mc-dossier__hero-chip">
                  <span>Aktif cihaz</span>
                  <strong>{employee.active_devices}/{employee.total_devices}</strong>
                </article>
                <article className="mc-dossier__hero-chip">
                  <span>Aktif onlem</span>
                  <strong>{employee.active_measure?.label ?? 'Yok'}</strong>
                </article>
                <article className="mc-dossier__hero-chip">
                  <span>Bildirim hata</span>
                  <strong>{failedNotificationCount}</strong>
                </article>
              </div>
            </div>
            <div className={`mc-dossier__score ${riskClass(employee.risk_status)}`}>
              <span>Risk skoru</span>
              <strong>{employee.risk_score}</strong>
              <small>{formatRelative(employee.last_activity_utc)}</small>
            </div>
          </header>

          <section className="mc-dossier__summary-grid">
            <article className="mc-dossier__stat"><span>Son giriş</span><strong>{formatDateTime(employee.last_checkin_utc)}</strong></article>
            <article className="mc-dossier__stat"><span>Son çıkış</span><strong>{formatDateTime(employee.last_checkout_utc)}</strong></article>
            <article className="mc-dossier__stat"><span>Bugünkü süre</span><strong><MinuteDisplay minutes={employee.worked_today_minutes} /></strong></article>
            <article className="mc-dossier__stat"><span>Haftalık toplam</span><strong><MinuteDisplay minutes={employee.weekly_total_minutes} /></strong></article>
            <article className="mc-dossier__stat"><span>Açık uyarı</span><strong>{employee.attention_flags.length}</strong></article>
            <article className="mc-dossier__stat"><span>Bildirim</span><strong>{notificationJobs.length}</strong><small>{failedNotificationCount} hata</small></article>
          </section>

          <div className="mc-dossier__layout">
            <aside className="mc-dossier__sidebar">
              <div className="mc-dossier__column-badge">Saha kontrolu</div>
              <section className="mc-dossier__section mc-dossier__section--signals">
                <div className="mc-dossier__section-head"><div><h4>Operasyon sinyalleri</h4><p>Aktif uyarılar ve kayıt kalitesi</p></div></div>
                <div className="mc-dossier__signal-list">
                  {employee.attention_flags.length ? employee.attention_flags.map((alert) => (
                    <article key={alert.code} className={`mc-dossier__signal ${alert.severity === 'critical' ? 'is-critical' : alert.severity === 'warning' ? 'is-watch' : 'is-normal'}`}>
                      <strong>{alert.label}</strong>
                      <span>{alert.code}</span>
                    </article>
                  )) : <div className="mc-empty-state">Aktif operasyon uyarısı bulunmuyor.</div>}
                </div>
                <div className="mc-dossier__quality-grid">
                  <article className="mc-dossier__quality-card"><span>Eksik gün</span><strong>{incompleteDays.length}</strong></article>
                  <article className="mc-dossier__quality-card"><span>Mesai günü</span><strong>{overtimeDays.length}</strong></article>
                  <article className="mc-dossier__quality-card"><span>Cihaz</span><strong>{employee.active_devices}/{employee.total_devices}</strong></article>
                  <article className="mc-dossier__quality-card"><span>Aktif önlem</span><strong>{employee.active_measure ? 'Var' : 'Yok'}</strong></article>
                </div>
              </section>

              <section className="mc-dossier__section mc-dossier__section--action">
                <div className="mc-dossier__section-head"><div><h4>Müdahale</h4><p>Kontrollü işlem ve not akışı</p></div></div>
                <div className="mc-action-strip">
                  <button type="button" className="mc-button mc-button--primary" onClick={() => setActionState({ kind: 'action', actionType: 'REVIEW' })}>İncelemeye al</button>
                  <button type="button" className="mc-button mc-button--secondary" onClick={() => setActionState({ kind: 'action', actionType: 'DISABLE_TEMP' })}>Geçici devre dışı</button>
                  <button type="button" className="mc-button mc-button--danger" onClick={() => setActionState({ kind: 'action', actionType: 'SUSPEND' })}>Askıya al</button>
                  <button type="button" className="mc-button mc-button--ghost" onClick={() => setActionState({ kind: 'override' })}>Risk override</button>
                  <button type="button" className="mc-button mc-button--ghost" onClick={() => setActionState({ kind: 'note' })}>Not ekle</button>
                </div>
                {actionState ? (
                  <div className="mc-action-composer">
                    {actionState.kind !== 'note' ? (
                      <>
                        <label className="mc-field"><span>Sebep</span><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="İşlem gerekçesi" /></label>
                        {actionState.kind === 'override' ? <label className="mc-field"><span>Risk skoru</span><input type="number" min={0} max={100} value={overrideScore} onChange={(event) => setOverrideScore(event.target.value)} /></label> : null}
                        <label className="mc-field"><span>Süre</span><select value={duration} onChange={(event) => setDuration(event.target.value as '1' | '3' | '7' | 'indefinite')}><option value="1">1 gün</option><option value="3">3 gün</option><option value="7">7 gün</option><option value="indefinite">Süresiz</option></select></label>
                      </>
                    ) : null}
                    <label className="mc-field"><span>{actionState.kind === 'note' ? 'Not' : 'İşlem notu'}</span><textarea value={note} onChange={(event) => setNote(event.target.value)} rows={4} /></label>
                    <div className="mc-action-composer__footer">
                      <span>{actionState.kind === 'note' ? 'Anlık kayıt' : `${duration === 'indefinite' ? 'Süresiz' : `${duration} gün`} işlem`}</span>
                      <div className="mc-action-composer__actions">
                        <button type="button" className="mc-button mc-button--ghost" onClick={() => setActionState(null)}>Vazgeç</button>
                        <button type="button" className="mc-button mc-button--primary" disabled={actionMutation.isPending || !note.trim() || (actionState.kind !== 'note' && !reason.trim())} onClick={() => void actionMutation.mutateAsync()}>{actionMutation.isPending ? 'Kaydediliyor...' : 'Kaydet'}</button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </section>
            </aside>

            <main className="mc-dossier__main">
              <div className="mc-dossier__column-badge">Kayit ve analiz</div>
              <section className="mc-dossier__section mc-dossier__section--timeline">
                <div className="mc-dossier__section-head">
                  <div><h4>Gün bazlı akış</h4><p>Son kayıt günleri, vardiya sonucu ve olay izi</p></div>
                  <Link to={`/attendance-events?employee_id=${employee.employee.id}&start_date=${bounds.start}&end_date=${bounds.end}`} className="mc-button mc-button--ghost">Manuel düzeltme</Link>
                </div>
                <div className="mc-dossier__timeline-days">
                  {attendanceQuery.isLoading ? <div className="mc-empty-state">Zaman çizelgesi yükleniyor...</div> : timeline.length ? timeline.map((group) => (
                    <article key={group.dateKey} className="mc-dossier__timeline-day">
                      <div className="mc-dossier__timeline-head">
                        <div><strong>{group.label}</strong><p>{group.day?.shift_name ?? employee.shift_name ?? 'Vardiya bilgisi yok'} · {group.day?.rule_source ?? 'Kural bilgisi yok'}</p></div>
                        <div className="mc-dossier__timeline-meta">
                          <span><MinuteDisplay minutes={group.day?.worked_minutes ?? 0} /></span>
                          <span>{group.day?.missing_minutes ? <MinuteDisplay minutes={group.day.missing_minutes} /> : 'Eksik yok'}</span>
                        </div>
                      </div>
                      <div className="mc-dossier__timeline-summary">
                        <span>İlk giriş: {formatDateTime(group.firstIn?.ts_utc ?? null)}</span>
                        <span>Son çıkış: {formatDateTime(group.lastOut?.ts_utc ?? null)}</span>
                      </div>
                      <div className="mc-dossier__event-list">
                        {group.events.map((event) => (
                          <article key={event.id} className="mc-dossier__event-row">
                            <div className="mc-dossier__event-main"><strong>{eventTypeLabel(event.type)}</strong><span>{formatDateTime(event.ts_utc)}</span></div>
                            <div className="mc-dossier__event-meta"><span>{eventSourceLabel(event.source)}</span><span>{event.note ?? 'Not yok'}</span></div>
                          </article>
                        ))}
                      </div>
                    </article>
                  )) : <div className="mc-empty-state">Bu dönem için giriş-çıkış kaydı bulunmuyor.</div>}
                </div>
              </section>

              <section className="mc-dossier__section mc-dossier__section--analytics">
                <div className="mc-dossier__section-head"><div><h4>Risk analitiği</h4><p>Personel özel trend ve önerilen aksiyonlar</p></div></div>
                <div className="mc-dossier__analytics">
                  <div className="mc-dossier__analytics-block">
                    <h5>Risk geçmişi</h5>
                    <div className="mc-risk-history">
                      {(detail.risk_history ?? []).map((point) => (
                        <article key={point.label} className="mc-risk-history__item">
                          <span>{point.label}</span>
                          <div className="mc-risk-history__bar"><div className="mc-risk-history__fill" style={{ height: `${Math.max(12, (point.value / riskHistoryMax) * 100)}%` }} /></div>
                          <strong>{point.value}</strong>
                        </article>
                      ))}
                    </div>
                  </div>
                  <div className="mc-dossier__analytics-block">
                    <h5>Öneriler</h5>
                    <div className="mc-dossier__recommendations">
                      {recommendations.map((item) => (
                        <article key={item.title} className={`mc-dossier__recommendation ${severityClass(item.severity)}`}>
                          <strong>{item.title}</strong>
                          <p>{item.description}</p>
                        </article>
                      ))}
                    </div>
                  </div>
                </div>
              </section>

              <section className="mc-dossier__dual">
                <section className="mc-dossier__section mc-dossier__section--feed">
                  <div className="mc-dossier__section-head"><div><h4>Mesai ve eksik günler</h4><p>Ay içindeki problemli operasyon günleri</p></div></div>
                  <div className="mc-dossier__section-meta">
                    <span className="mc-chip">{attentionDays.length} kayit</span>
                  </div>
                  <div className="mc-dossier__list">
                    {attentionDays.map((day) => (
                      <article key={`${day.date}-${day.status}`} className="mc-dossier__list-row">
                        <div><strong>{formatDate(day.date)}</strong><p>Durum: {day.status} · Vardiya: {day.shift_name ?? 'Tanımsız'}</p></div>
                        <div className="mc-dossier__list-side"><strong><MinuteDisplay minutes={Math.max(day.overtime_minutes, day.missing_minutes)} /></strong><span>{day.flags.length} flag</span></div>
                      </article>
                    ))}
                    {!overtimeDays.length && !incompleteDays.length ? <div className="mc-empty-state">Dikkat gerektiren günlük kayıt bulunmuyor.</div> : null}
                  </div>
                </section>

                <section className="mc-dossier__section mc-dossier__section--audit">
                  <div className="mc-dossier__section-head"><div><h4>Bildirim ve denetim</h4><p>Son bildirim işleri ve audit kayıtları</p></div></div>
                  <div className="mc-dossier__section-meta">
                    <span className="mc-chip">{failedNotificationCount} hata</span>
                  </div>
                  <div className="mc-dossier__list">
                    {notificationJobs.map((job) => (
                      <article key={job.id} className="mc-dossier__list-row">
                        <div><strong>{job.title ?? job.notification_type ?? 'Bildirim'}</strong><p>{job.description ?? 'Açıklama bulunmuyor.'}</p></div>
                        <div className="mc-dossier__list-side"><strong>{notificationStatusLabel(job.status)}</strong><span>{formatDateTime(job.created_at)}</span></div>
                      </article>
                    ))}
                    {detail.recent_audit_entries.slice(0, 4).map((entry) => (
                      <article key={entry.audit_id} className="mc-dossier__list-row">
                        <div><strong>{entry.label}</strong><p>{formatDateTime(entry.ts_utc)}</p></div>
                        <div className="mc-dossier__list-side"><strong>{entry.actor_id}</strong><span>{entry.ip ?? 'IP yok'}</span></div>
                      </article>
                    ))}
                    {!notificationJobs.length && !detail.recent_audit_entries.length ? <div className="mc-empty-state">Bildirim veya audit kaydı bulunmuyor.</div> : null}
                  </div>
                </section>
              </section>
            </main>
          </div>
        </div>
      )}
    </Modal>
  )
}
