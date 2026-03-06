import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import {
  createDeviceInvite,
  getAttendanceEvents,
  getDashboardEmployeeSnapshot,
  getDepartments,
  getDevices,
  getEmployees,
  getLeaves,
} from '../api/admin'
import { getApiErrorMessage } from '../api/error'
import { CopyField } from '../components/CopyField'
import { EmployeeAutocompleteField } from '../components/EmployeeAutocompleteField'
import { ErrorBlock } from '../components/ErrorBlock'
import { LoadingBlock } from '../components/LoadingBlock'
import { MinuteDisplay } from '../components/MinuteDisplay'
import { Panel } from '../components/Panel'
import { useToast } from '../hooks/useToast'
import type { AttendanceEvent, DashboardEmployeeSnapshot, Employee, LeaveRecord } from '../types/api'

const inviteSchema = z.object({
  employee_id: z.coerce.number().int().positive(),
  expires_in_minutes: z.coerce.number().int().positive().max(1440),
})

function dt(value: string | null | undefined): string {
  if (!value) return '-'
  return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function monthLabel(year: number, month: number): string {
  const monthName = new Intl.DateTimeFormat('tr-TR', { month: 'long' }).format(new Date(Date.UTC(year, month - 1, 1)))
  return `${monthName} ${year}`
}

function todayStatusClass(status: 'NOT_STARTED' | 'IN_PROGRESS' | 'FINISHED'): string {
  if (status === 'FINISHED') return 'status-badge status-badge-ok'
  if (status === 'IN_PROGRESS') return 'status-badge status-badge-pending'
  return 'status-badge status-badge-neutral'
}

function todayStatusLabel(status: 'NOT_STARTED' | 'IN_PROGRESS' | 'FINISHED'): string {
  if (status === 'FINISHED') return 'Mesai tamam'
  if (status === 'IN_PROGRESS') return 'Mesai devam ediyor'
  return 'Baslamadi'
}

function attendanceTypeLabel(type: AttendanceEvent['type']): string {
  return type === 'IN' ? 'Giris' : 'Cikis'
}

function locationStatusLabel(status: AttendanceEvent['location_status']): string {
  if (status === 'VERIFIED_HOME') return 'Dogrulandi'
  if (status === 'UNVERIFIED_LOCATION') return 'Supheli'
  return 'Konum yok'
}

function leaveStatusLabel(status: LeaveRecord['status']): string {
  if (status === 'APPROVED') return 'Onayli'
  if (status === 'REJECTED') return 'Reddedildi'
  return 'Bekliyor'
}

function leaveStatusTone(status: LeaveRecord['status']): string {
  if (status === 'APPROVED') return 'dashboard-tag dashboard-tag-ok'
  if (status === 'REJECTED') return 'dashboard-tag dashboard-tag-danger'
  return 'dashboard-tag dashboard-tag-pending'
}

function shortFingerprint(fingerprint: string): string {
  if (fingerprint.length <= 16) return fingerprint
  return `${fingerprint.slice(0, 7)}...${fingerprint.slice(-7)}`
}

function copyWithFallback(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text)
  }

  return new Promise((resolve, reject) => {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', 'true')
    textarea.style.position = 'absolute'
    textarea.style.left = '-9999px'
    document.body.appendChild(textarea)
    textarea.select()

    try {
      if (document.execCommand('copy')) {
        resolve()
        return
      }
      reject(new Error('copy-failed'))
    } catch (error) {
      reject(error)
    } finally {
      document.body.removeChild(textarea)
    }
  })
}

function buildDepartmentLoad(employees: Employee[], departmentNameById: Map<number, string>) {
  const counts = new Map<string, number>()

  employees.forEach((employee) => {
    const name =
      employee.department_id !== null
        ? (departmentNameById.get(employee.department_id) ?? `Departman #${employee.department_id}`)
        : 'Atanmamis'
    counts.set(name, (counts.get(name) ?? 0) + 1)
  })

  return Array.from(counts.entries())
    .map(([name, count]) => ({
      name,
      count,
      share: employees.length > 0 ? Math.round((count / employees.length) * 100) : 0,
    }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 5)
}

function buildLeaveSummary(leaves: LeaveRecord[]) {
  const pending = leaves.filter((leave) => leave.status === 'PENDING').length
  const approved = leaves.filter((leave) => leave.status === 'APPROVED').length
  const rejected = leaves.filter((leave) => leave.status === 'REJECTED').length

  return {
    pending,
    approved,
    rejected,
    recent: [...leaves]
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .slice(0, 5),
  }
}

function buildEventSummary(events: AttendanceEvent[]) {
  const checkins = events.filter((event) => event.type === 'IN').length
  const checkouts = events.filter((event) => event.type === 'OUT').length
  const anomalies = events.filter((event) => event.location_status !== 'VERIFIED_HOME').length
  const activeEmployees = new Set(events.map((event) => event.employee_id)).size

  return {
    checkins,
    checkouts,
    anomalies,
    activeEmployees,
  }
}

function renderSnapshotHighlights(snapshot: DashboardEmployeeSnapshot) {
  return [
    {
      label: 'Bu ay net sure',
      value: <MinuteDisplay minutes={snapshot.current_month.worked_minutes} />,
      note: `${snapshot.current_month.incomplete_days} eksik gun`,
    },
    {
      label: 'Plan ustu sure',
      value: <MinuteDisplay minutes={snapshot.current_month.plan_overtime_minutes} />,
      note: 'Kurala gore ekstra',
    },
    {
      label: 'Yasal fazla mesai',
      value: <MinuteDisplay minutes={snapshot.current_month.overtime_minutes} />,
      note: 'Ayrica takip edilir',
    },
    {
      label: 'Aktif cihaz',
      value: `${snapshot.active_devices}/${snapshot.total_devices}`,
      note: `Durum: ${todayStatusLabel(snapshot.today_status)}`,
    },
  ]
}

export function DashboardPage() {
  const queryClient = useQueryClient()
  const { pushToast } = useToast()

  const [employeeTargetId, setEmployeeTargetId] = useState('')
  const [expiresInMinutes, setExpiresInMinutes] = useState('30')
  const [inviteResult, setInviteResult] = useState<{ token: string; invite_url: string; expires_at: string } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const departmentsQuery = useQuery({ queryKey: ['departments'], queryFn: getDepartments })
  const employeesQuery = useQuery({ queryKey: ['employees'], queryFn: () => getEmployees({ status: 'active' }) })
  const devicesQuery = useQuery({ queryKey: ['devices'], queryFn: getDevices })
  const leavesQuery = useQuery({ queryKey: ['leaves', 'dashboard'], queryFn: () => getLeaves({}) })
  const eventsQuery = useQuery({
    queryKey: ['attendance-events', 'dashboard'],
    queryFn: () => getAttendanceEvents({ limit: 10 }),
  })

  const snapshotQuery = useQuery({
    queryKey: ['dashboard-employee-snapshot', employeeTargetId],
    queryFn: () => getDashboardEmployeeSnapshot({ employee_id: Number(employeeTargetId) }),
    enabled: Boolean(employeeTargetId),
    staleTime: 20_000,
  })

  const inviteMutation = useMutation({
    mutationFn: async (payload: { employee_id?: number; employee_name?: string; expires_in_minutes: number }) => {
      const response = await createDeviceInvite(payload)
      return {
        ...response,
        expires_at: new Date(Date.now() + payload.expires_in_minutes * 60_000).toISOString(),
      }
    },
    onSuccess: (data) => {
      setInviteResult({ token: data.token, invite_url: data.invite_url, expires_at: data.expires_at })
      setActionError(null)
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
    },
    onError: (error) => {
      setActionError(getApiErrorMessage(error, 'Claim token olusturulamadi.'))
    },
  })

  const createInvite = () => {
    setInviteResult(null)
    setActionError(null)

    const parsed = inviteSchema.safeParse({
      employee_id: employeeTargetId,
      expires_in_minutes: expiresInMinutes,
    })

    if (!parsed.success) {
      setActionError(parsed.error.issues[0]?.message ?? 'Form alanlarini kontrol et.')
      return
    }

    inviteMutation.mutate(parsed.data)
  }

  const copyText = async (value: string) => {
    try {
      await copyWithFallback(value)
      pushToast({
        variant: 'success',
        title: 'Kopyalandi',
        description: 'Deger panoya alindi.',
      })
    } catch {
      pushToast({
        variant: 'error',
        title: 'Kopyalama basarisiz',
        description: 'Tarayici panoya kopyalamaya izin vermedi.',
      })
    }
  }

  const departments = departmentsQuery.data ?? []
  const employees = employeesQuery.data ?? []
  const devices = devicesQuery.data ?? []
  const leaves = leavesQuery.data ?? []
  const events = eventsQuery.data ?? []

  const selectedEmployee = useMemo(
    () => employees.find((item) => String(item.id) === employeeTargetId) ?? null,
    [employees, employeeTargetId],
  )

  const departmentNameById = useMemo(
    () => new Map(departments.map((department) => [department.id, department.name])),
    [departments],
  )

  const deviceSummary = useMemo(() => {
    const active = devices.filter((device) => device.is_active).length
    return {
      total: devices.length,
      active,
      inactive: Math.max(devices.length - active, 0),
      coverageRate: employees.length > 0 ? Math.round((active / employees.length) * 100) : 0,
    }
  }, [devices, employees.length])

  const leaveSummary = useMemo(() => buildLeaveSummary(leaves), [leaves])
  const eventSummary = useMemo(() => buildEventSummary(events), [events])
  const departmentLoad = useMemo(() => buildDepartmentLoad(employees, departmentNameById), [employees, departmentNameById])

  const selectedDepartmentName =
    selectedEmployee?.department_id !== null && selectedEmployee?.department_id !== undefined
      ? (departmentNameById.get(selectedEmployee.department_id) ?? `Departman #${selectedEmployee.department_id}`)
      : 'Atanmamis'

  const snapshotHighlights = snapshotQuery.data ? renderSnapshotHighlights(snapshotQuery.data) : []

  if (
    departmentsQuery.isLoading ||
    employeesQuery.isLoading ||
    devicesQuery.isLoading ||
    leavesQuery.isLoading ||
    eventsQuery.isLoading
  ) {
    return <LoadingBlock />
  }

  if (
    departmentsQuery.isError ||
    employeesQuery.isError ||
    devicesQuery.isError ||
    leavesQuery.isError ||
    eventsQuery.isError
  ) {
    return <ErrorBlock message="Dashboard verileri alinamadi." />
  }

  return (
    <div className="dashboard-shell">
      <section className="dashboard-hero">
        <div className="dashboard-hero__main">
          <div className="dashboard-hero__copy">
            <p className="dashboard-kicker">Operasyon masasi</p>
            <h2>Calisan, cihaz ve puantaj nabzi tek ekranda</h2>
            <p>
              Claim token uretimi, secili calisanin canli ozeti, izin baskisi ve son attendance akisi tek panelde toplandi.
            </p>
          </div>

          <div className="dashboard-hero__pulse">
            <div className="dashboard-hero__pulse-card">
              <span>Son event akisi</span>
              <strong>{events.length} kayit</strong>
              <small>{dt(events[0]?.ts_utc)}</small>
            </div>
            <div className="dashboard-hero__pulse-card">
              <span>Konum riski</span>
              <strong>{eventSummary.anomalies} olay</strong>
              <small>Son 10 kayit icinde</small>
            </div>
            <div className="dashboard-hero__pulse-card">
              <span>Izin baskisi</span>
              <strong>{leaveSummary.pending} bekleyen</strong>
              <small>Toplam {leaves.length} talep</small>
            </div>
          </div>
        </div>

        <div className="dashboard-hero__metrics">
          <article className="dashboard-metric">
            <span>Aktif calisan</span>
            <strong>{employees.length}</strong>
            <small>{departments.length} departman dagilimi</small>
          </article>
          <article className="dashboard-metric">
            <span>Cihaz kapsama</span>
            <strong>{deviceSummary.coverageRate}%</strong>
            <small>{deviceSummary.active} aktif cihaz</small>
          </article>
          <article className="dashboard-metric">
            <span>Anlik hareket</span>
            <strong>{eventSummary.activeEmployees}</strong>
            <small>Son 10 kayitta gorunen kisi</small>
          </article>
          <article className="dashboard-metric">
            <span>Izin durumu</span>
            <strong>{leaveSummary.approved}</strong>
            <small>{leaveSummary.rejected} red, {leaveSummary.pending} bekleme</small>
          </article>
        </div>
      </section>

      <div className="dashboard-layout">
        <div className="dashboard-main">
          <Panel className="dashboard-panel dashboard-panel--focus">
            <div className="dashboard-panel__head">
              <div>
                <p className="dashboard-kicker">Secili calisan</p>
                <h4>{selectedEmployee ? selectedEmployee.full_name : 'Odak calisan secilmedi'}</h4>
                <p>
                  Bir calisan secildiginde bugunku durum, aylik mesai karsilastirmasi, son olay ve cihaz dagilimi burada
                  gorunur.
                </p>
              </div>
              {selectedEmployee ? (
                <div className="dashboard-chip-row">
                  <span className="dashboard-chip">#{selectedEmployee.id}</span>
                  <span className="dashboard-chip">{selectedDepartmentName}</span>
                  <span className="dashboard-chip">{selectedEmployee.is_active ? 'Aktif' : 'Pasif'}</span>
                </div>
              ) : null}
            </div>

            <div className="dashboard-selector">
              <EmployeeAutocompleteField
                label="Calisan ara"
                employees={employees}
                value={employeeTargetId}
                onChange={setEmployeeTargetId}
                placeholder="Calisan adi veya #ID"
                helperText="Secim yapildiginda sag panelde claim token aksiyonu da ayni kisiye baglanir."
              />
            </div>

            {!employeeTargetId ? (
              <div className="dashboard-empty">
                <div>
                  <strong>Panel beklemede</strong>
                  <p>Secili kisi olmadiginda sistemin en yogun departmanlarini ve operasyon basincini izlemeye devam edersin.</p>
                </div>
                <div className="dashboard-empty__metrics">
                  {departmentLoad.map((department) => (
                    <div key={department.name} className="dashboard-empty__metric">
                      <span>{department.name}</span>
                      <strong>{department.count}</strong>
                      <small>%{department.share} ekip payi</small>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {employeeTargetId && snapshotQuery.isLoading ? <LoadingBlock label="Calisan ozeti yukleniyor..." /> : null}
            {employeeTargetId && snapshotQuery.isError ? <ErrorBlock message="Calisan ozeti alinamadi." /> : null}

            {snapshotQuery.data ? (
              <div className="dashboard-focus">
                <div className="dashboard-highlight-grid">
                  {snapshotHighlights.map((item) => (
                    <article key={item.label} className="dashboard-highlight">
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                      <small>{item.note}</small>
                    </article>
                  ))}
                </div>

                <div className="dashboard-focus__grid">
                  <section className="dashboard-card">
                    <div className="dashboard-card__head">
                      <div>
                        <p className="dashboard-kicker">Aylik mesai</p>
                        <h5>Bu ay ve gecen ay karsilastirmasi</h5>
                      </div>
                      <span className={todayStatusClass(snapshotQuery.data.today_status)}>
                        {todayStatusLabel(snapshotQuery.data.today_status)}
                      </span>
                    </div>

                    <div className="dashboard-month-grid">
                      <article className="dashboard-month-card">
                        <span>{monthLabel(snapshotQuery.data.current_month.year, snapshotQuery.data.current_month.month)}</span>
                        <strong><MinuteDisplay minutes={snapshotQuery.data.current_month.worked_minutes} /></strong>
                        <small>Toplam net sure</small>
                        <ul>
                          <li>Plan ustu: <MinuteDisplay minutes={snapshotQuery.data.current_month.plan_overtime_minutes} /></li>
                          <li>Ekstra: <MinuteDisplay minutes={snapshotQuery.data.current_month.extra_work_minutes} /></li>
                          <li>Yasal: <MinuteDisplay minutes={snapshotQuery.data.current_month.overtime_minutes} /></li>
                          <li>Eksik gun: {snapshotQuery.data.current_month.incomplete_days}</li>
                        </ul>
                      </article>

                      <article className="dashboard-month-card dashboard-month-card--muted">
                        <span>{monthLabel(snapshotQuery.data.previous_month.year, snapshotQuery.data.previous_month.month)}</span>
                        <strong><MinuteDisplay minutes={snapshotQuery.data.previous_month.worked_minutes} /></strong>
                        <small>Gecen ay net sure</small>
                        <ul>
                          <li>Plan ustu: <MinuteDisplay minutes={snapshotQuery.data.previous_month.plan_overtime_minutes} /></li>
                          <li>Ekstra: <MinuteDisplay minutes={snapshotQuery.data.previous_month.extra_work_minutes} /></li>
                          <li>Yasal: <MinuteDisplay minutes={snapshotQuery.data.previous_month.overtime_minutes} /></li>
                          <li>Eksik gun: {snapshotQuery.data.previous_month.incomplete_days}</li>
                        </ul>
                      </article>
                    </div>
                  </section>

                  <section className="dashboard-card">
                    <div className="dashboard-card__head">
                      <div>
                        <p className="dashboard-kicker">Canli sinyal</p>
                        <h5>Son olay ve konum izi</h5>
                      </div>
                      <span className="dashboard-chip">Guncelleme {dt(snapshotQuery.data.generated_at_utc)}</span>
                    </div>

                    <div className="dashboard-live-grid">
                      <article className="dashboard-live-card">
                        <span>Son puantaj</span>
                        {snapshotQuery.data.last_event ? (
                          <>
                            <strong>{attendanceTypeLabel(snapshotQuery.data.last_event.event_type)}</strong>
                            <small>{dt(snapshotQuery.data.last_event.ts_utc)}</small>
                            <p>{locationStatusLabel(snapshotQuery.data.last_event.location_status)} · cihaz #{snapshotQuery.data.last_event.device_id}</p>
                          </>
                        ) : (
                          <>
                            <strong>Kayit yok</strong>
                            <small>Bu kisi icin puantaj olayi bulunamadi.</small>
                          </>
                        )}
                      </article>

                      <article className="dashboard-live-card">
                        <span>Son konum</span>
                        {snapshotQuery.data.latest_location ? (
                          <>
                            <strong>
                              {snapshotQuery.data.latest_location.lat.toFixed(6)}, {snapshotQuery.data.latest_location.lon.toFixed(6)}
                            </strong>
                            <small>{dt(snapshotQuery.data.latest_location.ts_utc)}</small>
                            <p>
                              {locationStatusLabel(snapshotQuery.data.latest_location.location_status)}
                              {snapshotQuery.data.latest_location.accuracy_m !== null
                                ? ` · ${Math.round(snapshotQuery.data.latest_location.accuracy_m)}m`
                                : ''}
                            </p>
                          </>
                        ) : (
                          <>
                            <strong>Konum yok</strong>
                            <small>Heniz yakalanmis bir koordinat kaydi yok.</small>
                          </>
                        )}
                      </article>
                    </div>
                  </section>
                </div>

                <section className="dashboard-card">
                  <div className="dashboard-card__head">
                    <div>
                      <p className="dashboard-kicker">Cihaz parkuru</p>
                      <h5>Bagli cihazlar ve son gorunum</h5>
                    </div>
                    <span className="dashboard-chip">
                      Aktif {snapshotQuery.data.active_devices}/{snapshotQuery.data.total_devices}
                    </span>
                  </div>

                  {snapshotQuery.data.devices.length === 0 ? (
                    <div className="dashboard-empty dashboard-empty--compact">
                      <div>
                        <strong>Cihaz bulunamadi</strong>
                        <p>Calisana ait kayitli cihaz yok.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="dashboard-device-list">
                      {snapshotQuery.data.devices.slice(0, 8).map((device) => (
                        <article key={device.id} className="dashboard-device-row">
                          <div>
                            <strong>#{device.id} · {shortFingerprint(device.device_fingerprint)}</strong>
                            <p>Olusturma: {dt(device.created_at)}</p>
                          </div>
                          <div className="dashboard-device-row__meta">
                            <span className={device.is_active ? 'dashboard-tag dashboard-tag-ok' : 'dashboard-tag dashboard-tag-danger'}>
                              {device.is_active ? 'Aktif' : 'Pasif'}
                            </span>
                            <small>Son hareket: {dt(device.last_attendance_ts_utc)}</small>
                            <small>Portal iz: {dt(device.last_seen_at_utc)}</small>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            ) : null}
          </Panel>

          <Panel className="dashboard-panel">
            <div className="dashboard-panel__head">
              <div>
                <p className="dashboard-kicker">Canli akis</p>
                <h4>Son attendance eventleri</h4>
                <p>Operasyonda neler oldugunu tablo yerine hizli okunur akista gor.</p>
              </div>

              <div className="dashboard-inline-metrics">
                <div>
                  <span>Giris</span>
                  <strong>{eventSummary.checkins}</strong>
                </div>
                <div>
                  <span>Cikis</span>
                  <strong>{eventSummary.checkouts}</strong>
                </div>
                <div>
                  <span>Supheli</span>
                  <strong>{eventSummary.anomalies}</strong>
                </div>
              </div>
            </div>

            <div className="dashboard-event-feed">
              {events.map((event) => (
                <article key={event.id} className="dashboard-event-row">
                  <div className="dashboard-event-row__main">
                    <div className="dashboard-event-row__title">
                      <strong>{event.employee_name ?? `Calisan #${event.employee_id}`}</strong>
                      <span className={event.type === 'IN' ? 'dashboard-tag dashboard-tag-ok' : 'dashboard-tag'}>
                        {attendanceTypeLabel(event.type)}
                      </span>
                    </div>
                    <p>
                      {event.department_name ?? 'Departman yok'} · cihaz #{event.device_id} · {locationStatusLabel(event.location_status)}
                    </p>
                  </div>

                  <div className="dashboard-event-row__meta">
                    <strong>{dt(event.ts_utc)}</strong>
                    <small>
                      {event.lat !== null && event.lon !== null
                        ? `${event.lat.toFixed(5)}, ${event.lon.toFixed(5)}`
                        : 'Koordinat yok'}
                    </small>
                  </div>
                </article>
              ))}
            </div>
          </Panel>
        </div>

        <aside className="dashboard-aside">
          <Panel className="dashboard-panel dashboard-panel--action">
            <div className="dashboard-panel__head">
              <div>
                <p className="dashboard-kicker">Hizli aksiyon</p>
                <h4>Claim token uretimi</h4>
                <p>Employee kurulumu icin token ve davet URL'sini ayni panelden dagit.</p>
              </div>
              <span className="dashboard-chip">Varsayilan sure 30 dk</span>
            </div>

            <div className="dashboard-action-form">
              <EmployeeAutocompleteField
                label="Calisan"
                employees={employees}
                value={employeeTargetId}
                onChange={setEmployeeTargetId}
                placeholder="Calisan adi veya #ID"
                helperText="Secili calisan dashboard ve token paneli arasinda ortak kullanilir."
              />

              <label className="text-sm text-slate-700">
                Token suresi (dakika)
                <input
                  value={expiresInMinutes}
                  onChange={(event) => setExpiresInMinutes(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white/90 px-3 py-2.5"
                  placeholder="30"
                />
              </label>
            </div>

            {selectedEmployee ? (
              <div className="dashboard-action-snapshot">
                <strong>{selectedEmployee.full_name}</strong>
                <p>#{selectedEmployee.id} · {selectedDepartmentName}</p>
              </div>
            ) : null}

            <button
              type="button"
              onClick={createInvite}
              disabled={inviteMutation.isPending || !employeeTargetId}
              className="dashboard-action-button"
            >
              {inviteMutation.isPending ? 'Claim token hazirlaniyor...' : 'Claim token olustur'}
            </button>

            {inviteResult ? (
              <div className="dashboard-invite-result">
                <div className="dashboard-invite-result__head">
                  <div>
                    <strong>Davet hazir</strong>
                    <p>Son gecerlilik: {dt(inviteResult.expires_at)}</p>
                  </div>
                  <span className="dashboard-tag dashboard-tag-ok">Hazir</span>
                </div>
                <CopyField label="Token" value={inviteResult.token} onCopy={(value) => void copyText(value)} />
                <CopyField label="Invite URL" value={inviteResult.invite_url} onCopy={(value) => void copyText(value)} />
              </div>
            ) : null}

            {actionError ? <div className="form-validation">{actionError}</div> : null}
          </Panel>

          <Panel className="dashboard-panel">
            <div className="dashboard-panel__head">
              <div>
                <p className="dashboard-kicker">Izin radari</p>
                <h4>Bekleyen ve son acilan izinler</h4>
                <p>Onay kuyruğunu bir bakista gormek icin kisa bir baski paneli.</p>
              </div>
            </div>

            <div className="dashboard-inline-metrics dashboard-inline-metrics--full">
              <div>
                <span>Bekleyen</span>
                <strong>{leaveSummary.pending}</strong>
              </div>
              <div>
                <span>Onayli</span>
                <strong>{leaveSummary.approved}</strong>
              </div>
              <div>
                <span>Reddedilen</span>
                <strong>{leaveSummary.rejected}</strong>
              </div>
            </div>

            <div className="dashboard-leave-list">
              {leaveSummary.recent.length === 0 ? (
                <div className="dashboard-empty dashboard-empty--compact">
                  <div>
                    <strong>Izin kaydi yok</strong>
                    <p>Heniz olusturulmus izin bulunmuyor.</p>
                  </div>
                </div>
              ) : (
                leaveSummary.recent.map((leave) => (
                  <article key={leave.id} className="dashboard-leave-row">
                    <div>
                      <strong>Calisan #{leave.employee_id}</strong>
                      <p>
                        {leave.start_date} - {leave.end_date}
                      </p>
                    </div>
                    <div className="dashboard-leave-row__meta">
                      <span className={leaveStatusTone(leave.status)}>{leaveStatusLabel(leave.status)}</span>
                      <small>{dt(leave.created_at)}</small>
                    </div>
                  </article>
                ))
              )}
            </div>
          </Panel>

          <Panel className="dashboard-panel">
            <div className="dashboard-panel__head">
              <div>
                <p className="dashboard-kicker">Ekip yogunlugu</p>
                <h4>Departman ve cihaz dagilimi</h4>
                <p>Calisan yukunu en ondeki ekipler uzerinden takip et.</p>
              </div>
            </div>

            <div className="dashboard-department-list">
              {departmentLoad.map((department) => (
                <article key={department.name} className="dashboard-department-row">
                  <div>
                    <strong>{department.name}</strong>
                    <p>{department.count} aktif calisan</p>
                  </div>
                  <div className="dashboard-department-row__meta">
                    <strong>%{department.share}</strong>
                    <small>Ekip payi</small>
                  </div>
                </article>
              ))}
            </div>

            <div className="dashboard-footnote">
              <strong>{deviceSummary.active}</strong> aktif cihaz, <strong>{deviceSummary.inactive}</strong> pasif cihaz.
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  )
}
