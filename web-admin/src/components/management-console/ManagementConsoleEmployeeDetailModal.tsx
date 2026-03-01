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
import type { ActionState } from './types'
import {
  eventSourceLabel,
  eventTypeLabel,
  formatDate,
  formatDateTime,
  formatRelative,
  notificationStatusLabel,
  riskClass,
  riskStatusLabel,
  todayStatusLabel,
} from './utils'

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

function durationLabel(duration: '1' | '3' | '7' | 'indefinite') {
  if (duration === 'indefinite') return 'Süresiz'
  return `${duration} gün`
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
    queryFn: () =>
      getAttendanceEvents({
        employee_id: employeeId as number,
        start_date: bounds.start,
        end_date: bounds.end,
        limit: 250,
      }),
    enabled: open && employeeId != null,
  })

  const monthlyQuery = useQuery({
    queryKey: ['management-console-detail-monthly', employeeId, bounds.year, bounds.month],
    queryFn: () =>
      getMonthlyEmployee({
        employee_id: employeeId as number,
        year: bounds.year,
        month: bounds.month,
      }),
    enabled: open && employeeId != null,
  })

  const notificationQuery = useQuery({
    queryKey: ['management-console-detail-notifications', employeeId, bounds.start, bounds.end],
    queryFn: () =>
      getNotificationJobs({
        employee_id: employeeId as number,
        start_date: bounds.start,
        end_date: bounds.end,
        offset: 0,
        limit: 6,
      }),
    enabled: open && employeeId != null,
  })

  const actionMutation = useMutation({
    mutationFn: async () => {
      if (!employeeId || !actionState) {
        throw new Error('Personel seçilmedi.')
      }

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
      setDuration('1')
      setOverrideScore('50')
      void queryClient.invalidateQueries({ queryKey: ['control-room-overview'] })
      void queryClient.invalidateQueries({ queryKey: ['management-console-detail', employeeId] })
      void queryClient.invalidateQueries({
        queryKey: ['management-console-detail-notifications', employeeId, bounds.start, bounds.end],
      })
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
  const riskHistoryMax = Math.max(1, ...(detail?.risk_history ?? []).map((item) => item.value))
  const recentEvents = useMemo(
    () =>
      [...(attendanceQuery.data ?? [])]
        .sort((left, right) => new Date(right.ts_utc).getTime() - new Date(left.ts_utc).getTime())
        .slice(0, 12),
    [attendanceQuery.data],
  )
  const overtimeDays = useMemo(
    () =>
      (monthlyQuery.data?.days ?? [])
        .filter(
          (day) =>
            day.overtime_minutes > 0 ||
            day.plan_overtime_minutes > 0 ||
            day.legal_overtime_minutes > 0 ||
            day.legal_extra_work_minutes > 0,
        )
        .sort((left, right) => right.date.localeCompare(left.date))
        .slice(0, 8),
    [monthlyQuery.data?.days],
  )

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
        <div className="mc-detail">
          <header className="mc-detail__hero">
            <div className="mc-detail__identity">
              <p className="mc-kicker">PERSONEL DOSYASI</p>
              <h3>{employee.employee.full_name}</h3>
              <p>
                {employee.department_name ?? 'Departman yok'} · {employee.shift_name ?? 'Vardiya tanımı yok'} ·{' '}
                {todayStatusLabel(employee.today_status)}
              </p>
              <div className="mc-detail__hero-tags">
                <span className={`mc-status-pill ${riskClass(employee.risk_status)}`}>
                  {riskStatusLabel(employee.risk_status)}
                </span>
                <span className="mc-chip">{employee.shift_window_label ?? 'Plan penceresi yok'}</span>
                <span className="mc-chip">{employee.location_label ?? 'Konum bilgisi yok'}</span>
              </div>
            </div>

            <div className={`mc-detail__score ${riskClass(employee.risk_status)}`}>
              <strong>{employee.risk_score}</strong>
              <span>{riskStatusLabel(employee.risk_status)}</span>
            </div>
          </header>

          <section className="mc-detail__summary-grid">
            <article className="mc-detail__stat">
              <span>Son giriş</span>
              <strong>{formatDateTime(employee.last_checkin_utc)}</strong>
            </article>
            <article className="mc-detail__stat">
              <span>Son çıkış</span>
              <strong>{formatDateTime(employee.last_checkout_utc)}</strong>
            </article>
            <article className="mc-detail__stat">
              <span>Bugünkü süre</span>
              <strong>
                <MinuteDisplay minutes={employee.worked_today_minutes} />
              </strong>
            </article>
            <article className="mc-detail__stat">
              <span>Haftalık toplam</span>
              <strong>
                <MinuteDisplay minutes={employee.weekly_total_minutes} />
              </strong>
            </article>
            <article className="mc-detail__stat">
              <span>Son aktivite</span>
              <strong>{formatRelative(employee.last_activity_utc)}</strong>
            </article>
            <article className="mc-detail__stat">
              <span>Konum / IP</span>
              <strong>{employee.location_label ?? '-'}</strong>
              <small>{employee.recent_ip ?? 'IP yok'}</small>
            </article>
          </section>

          <div className="mc-detail__content">
            <main className="mc-detail__primary">
              <section className="mc-detail__section">
                <div className="mc-detail__section-head">
                  <div>
                    <h4>Giriş / çıkış zaman çizelgesi</h4>
                    <p>Bu aya ait son olaylar ve kaynak bilgileri</p>
                  </div>
                  <Link
                    to={`/attendance-events?employee_id=${employee.employee.id}&start_date=${bounds.start}&end_date=${bounds.end}`}
                    className="mc-button mc-button--ghost"
                  >
                    Manuel düzeltme
                  </Link>
                </div>
                <div className="mc-timeline">
                  {attendanceQuery.isLoading ? (
                    <div className="mc-empty-state">Zaman çizelgesi yükleniyor...</div>
                  ) : recentEvents.length ? (
                    recentEvents.map((event) => (
                      <article key={event.id} className="mc-timeline__item">
                        <div className="mc-timeline__icon">{event.type === 'IN' ? 'G' : 'Ç'}</div>
                        <div className="mc-timeline__body">
                          <strong>{eventTypeLabel(event.type)}</strong>
                          <p>{formatDateTime(event.ts_utc)}</p>
                        </div>
                        <div className="mc-timeline__meta">
                          <span>{eventSourceLabel(event.source)}</span>
                          <span>{event.note ?? 'Not yok'}</span>
                        </div>
                      </article>
                    ))
                  ) : (
                    <div className="mc-empty-state">Bu dönem için giriş-çıkış kaydı bulunmuyor.</div>
                  )}
                </div>
              </section>

              <section className="mc-detail__section">
                <div className="mc-detail__section-head">
                  <div>
                    <h4>Fazla mesai geçmişi</h4>
                    <p>Ay içindeki mesai aşımı görülen günler</p>
                  </div>
                </div>
                <div className="mc-detail__list">
                  {monthlyQuery.isLoading ? (
                    <div className="mc-empty-state">Mesai özeti yükleniyor...</div>
                  ) : overtimeDays.length ? (
                    overtimeDays.map((day) => (
                      <article key={day.date} className="mc-detail__list-row">
                        <div>
                          <strong>{formatDate(day.date)}</strong>
                          <p>
                            Giriş: {day.in ?? '-'} · Çıkış: {day.out ?? '-'}
                          </p>
                        </div>
                        <div className="mc-detail__list-side">
                          <strong>
                            <MinuteDisplay minutes={day.overtime_minutes} />
                          </strong>
                          <span>Toplam mesai</span>
                        </div>
                      </article>
                    ))
                  ) : (
                    <div className="mc-empty-state">Bu ay kayıtlı fazla mesai yok.</div>
                  )}
                </div>
              </section>

              <section className="mc-detail__section">
                <div className="mc-detail__section-head">
                  <div>
                    <h4>İnceleme izi</h4>
                    <p>Son yönetim ve sistem kayıtları</p>
                  </div>
                </div>
                <div className="mc-detail__list">
                  {detail.recent_audit_entries.length ? (
                    detail.recent_audit_entries.slice(0, 8).map((entry) => (
                      <article key={entry.audit_id} className="mc-detail__list-row">
                        <div>
                          <strong>{entry.label}</strong>
                          <p>{formatDateTime(entry.ts_utc)}</p>
                        </div>
                        <div className="mc-detail__list-side">
                          <strong>{entry.actor_id}</strong>
                          <span>{entry.ip ?? 'IP yok'}</span>
                        </div>
                      </article>
                    ))
                  ) : (
                    <div className="mc-empty-state">Audit kaydı bulunmuyor.</div>
                  )}
                </div>
              </section>
            </main>

            <aside className="mc-detail__secondary">
              <section className="mc-detail__section">
                <div className="mc-detail__section-head">
                  <div>
                    <h4>Risk geçmişi</h4>
                    <p>Haftalık risk değişimi ve yoğunluk trendi</p>
                  </div>
                </div>
                <div className="mc-risk-history">
                  {(detail.risk_history ?? []).length ? (
                    detail.risk_history.map((point) => (
                      <article key={point.label} className="mc-risk-history__item">
                        <span>{point.label}</span>
                        <div className="mc-risk-history__bar">
                          <div
                            className="mc-risk-history__fill"
                            style={{ height: `${Math.max(12, (point.value / riskHistoryMax) * 100)}%` }}
                          />
                        </div>
                        <strong>{point.value.toFixed(1)}</strong>
                      </article>
                    ))
                  ) : (
                    <div className="mc-empty-state">Risk geçmişi verisi bulunmuyor.</div>
                  )}
                </div>
              </section>

              <section className="mc-detail__section">
                <div className="mc-detail__section-head">
                  <div>
                    <h4>Risk faktörleri</h4>
                    <p>Skoru etkileyen son sinyaller</p>
                  </div>
                </div>
                <div className="mc-detail__list">
                  {employee.risk_factors.length ? (
                    employee.risk_factors.map((factor) => (
                      <article key={factor.code} className="mc-detail__list-row">
                        <div>
                          <strong>{factor.label}</strong>
                          <p>{factor.description}</p>
                        </div>
                        <div className="mc-detail__list-side">
                          <strong>+{factor.impact_score}</strong>
                          <span>{factor.value}</span>
                        </div>
                      </article>
                    ))
                  ) : (
                    <div className="mc-empty-state">Aktif risk faktörü bulunmuyor.</div>
                  )}
                </div>
              </section>

              <section className="mc-detail__section">
                <div className="mc-detail__section-head">
                  <div>
                    <h4>Notlar ve önlemler</h4>
                    <p>Son yönetim müdahaleleri ve açıklamalar</p>
                  </div>
                </div>
                <div className="mc-detail__list">
                  {detail.recent_measures.map((measure, index) => (
                    <article key={`${measure.created_at}-${index}`} className="mc-detail__list-row">
                      <div>
                        <strong>{measure.label}</strong>
                        <p>{measure.reason}</p>
                      </div>
                      <div className="mc-detail__list-side">
                        <strong>{formatDateTime(measure.created_at)}</strong>
                        <span>{measure.duration_days ? `${measure.duration_days} gün` : 'Süresiz'}</span>
                      </div>
                    </article>
                  ))}
                  {detail.recent_notes.map((entry, index) => (
                    <article key={`${entry.created_at}-${index}`} className="mc-detail__list-row">
                      <div>
                        <strong>{entry.created_by}</strong>
                        <p>{entry.note}</p>
                      </div>
                      <div className="mc-detail__list-side">
                        <strong>{formatDateTime(entry.created_at)}</strong>
                        <span>Not</span>
                      </div>
                    </article>
                  ))}
                  {!detail.recent_measures.length && !detail.recent_notes.length ? (
                    <div className="mc-empty-state">Kayıtlı not veya önlem bulunmuyor.</div>
                  ) : null}
                </div>
              </section>

              <section className="mc-detail__section">
                <div className="mc-detail__section-head">
                  <div>
                    <h4>Son bildirimler</h4>
                    <p>Bu aya ait son notification kayıtları</p>
                  </div>
                </div>
                <div className="mc-detail__list">
                  {notificationQuery.isLoading ? (
                    <div className="mc-empty-state">Bildirimler yükleniyor...</div>
                  ) : notificationQuery.data?.items.length ? (
                    notificationQuery.data.items.map((job) => (
                      <article key={job.id} className="mc-detail__list-row">
                        <div>
                          <strong>{job.title ?? job.notification_type ?? 'Bildirim'}</strong>
                          <p>{job.description ?? 'Açıklama bulunmuyor.'}</p>
                        </div>
                        <div className="mc-detail__list-side">
                          <strong>{notificationStatusLabel(job.status)}</strong>
                          <span>{formatDateTime(job.created_at)}</span>
                        </div>
                      </article>
                    ))
                  ) : (
                    <div className="mc-empty-state">Bu dönem için bildirim kaydı bulunmuyor.</div>
                  )}
                </div>
              </section>

              <section className="mc-detail__section mc-detail__section--action">
                <div className="mc-detail__section-head">
                  <div>
                    <h4>Müdahale</h4>
                    <p>Kontrollü işlem, inceleme ve not akışı</p>
                  </div>
                </div>

                <div className="mc-action-strip">
                  <button
                    type="button"
                    className="mc-button mc-button--primary"
                    onClick={() => setActionState({ kind: 'action', actionType: 'REVIEW' })}
                  >
                    İncelemeye al
                  </button>
                  <button
                    type="button"
                    className="mc-button mc-button--secondary"
                    onClick={() => setActionState({ kind: 'action', actionType: 'DISABLE_TEMP' })}
                  >
                    Geçici devre dışı
                  </button>
                  <button
                    type="button"
                    className="mc-button mc-button--danger"
                    onClick={() => setActionState({ kind: 'action', actionType: 'SUSPEND' })}
                  >
                    Askıya al
                  </button>
                  <button
                    type="button"
                    className="mc-button mc-button--ghost"
                    onClick={() => setActionState({ kind: 'override' })}
                  >
                    Risk override
                  </button>
                  <button
                    type="button"
                    className="mc-button mc-button--ghost"
                    onClick={() => setActionState({ kind: 'note' })}
                  >
                    Not ekle
                  </button>
                </div>

                {actionState ? (
                  <div className="mc-action-composer">
                    {actionState.kind !== 'note' ? (
                      <>
                        <label className="mc-field">
                          <span>Sebep</span>
                          <input
                            value={reason}
                            onChange={(event) => setReason(event.target.value)}
                            placeholder="İşlem gerekçesi"
                          />
                        </label>

                        {actionState.kind === 'override' ? (
                          <label className="mc-field">
                            <span>Risk skoru</span>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={overrideScore}
                              onChange={(event) => setOverrideScore(event.target.value)}
                            />
                          </label>
                        ) : null}

                        <label className="mc-field">
                          <span>Süre</span>
                          <select
                            value={duration}
                            onChange={(event) => setDuration(event.target.value as '1' | '3' | '7' | 'indefinite')}
                          >
                            <option value="1">1 gün</option>
                            <option value="3">3 gün</option>
                            <option value="7">7 gün</option>
                            <option value="indefinite">Süresiz</option>
                          </select>
                        </label>
                      </>
                    ) : null}

                    <label className="mc-field">
                      <span>{actionState.kind === 'note' ? 'Not' : 'İşlem notu'}</span>
                      <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={4} />
                    </label>

                    <div className="mc-action-composer__footer">
                      <span>Süre: {actionState.kind === 'note' ? 'Anlık kayıt' : durationLabel(duration)}</span>
                      <div className="mc-action-composer__actions">
                        <button
                          type="button"
                          className="mc-button mc-button--ghost"
                          onClick={() => setActionState(null)}
                        >
                          Vazgeç
                        </button>
                        <button
                          type="button"
                          className="mc-button mc-button--primary"
                          disabled={
                            actionMutation.isPending ||
                            !note.trim() ||
                            (actionState.kind !== 'note' && !reason.trim())
                          }
                          onClick={() => void actionMutation.mutateAsync()}
                        >
                          {actionMutation.isPending ? 'Kaydediliyor...' : 'Kaydet'}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </section>
            </aside>
          </div>
        </div>
      )}
    </Modal>
  )
}
