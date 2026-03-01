import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import {
  getControlRoomOverview,
  getDepartments,
  getRegions,
  type ControlRoomOverviewParams,
} from '../api/admin'
import { ControlRoomMap, type ControlRoomMapMarker } from '../components/ControlRoomMap'
import { ErrorBlock } from '../components/ErrorBlock'
import { LoadingBlock } from '../components/LoadingBlock'
import { MinuteDisplay } from '../components/MinuteDisplay'
import { PageHeader } from '../components/PageHeader'
import type { ControlRoomEmployeeState, ControlRoomLocationState } from '../types/api'

function dt(value: string | null | undefined): string {
  if (!value) return '-'
  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

function relative(value: string | null | undefined): string {
  if (!value) return 'Akış yok'
  const diffMs = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(diffMs)) return '-'
  const minutes = Math.max(0, Math.round(diffMs / 60000))
  if (minutes < 1) return 'Şimdi'
  if (minutes < 60) return `${minutes} dk önce`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} sa önce`
  const days = Math.floor(hours / 24)
  return `${days} gün önce`
}

function todayStatusLabel(value: 'NOT_STARTED' | 'IN_PROGRESS' | 'FINISHED'): string {
  if (value === 'IN_PROGRESS') return 'Sahada'
  if (value === 'FINISHED') return 'Tamam'
  return 'Başlamadı'
}

function locationStateLabel(value: ControlRoomLocationState): string {
  if (value === 'LIVE') return 'Canlı'
  if (value === 'STALE') return 'Sıcak'
  if (value === 'DORMANT') return 'Soğuk'
  return 'Yok'
}

function alertSeverityLabel(value: 'info' | 'warning' | 'critical'): string {
  if (value === 'critical') return 'Kritik'
  if (value === 'warning') return 'Uyarı'
  return 'Bilgi'
}

function statusClass(value: 'NOT_STARTED' | 'IN_PROGRESS' | 'FINISHED'): string {
  if (value === 'IN_PROGRESS') return 'control-room-pill status-live'
  if (value === 'FINISHED') return 'control-room-pill status-finished'
  return 'control-room-pill status-idle'
}

function locationClass(value: ControlRoomLocationState): string {
  if (value === 'LIVE') return 'control-room-pill location-live'
  if (value === 'STALE') return 'control-room-pill location-stale'
  if (value === 'DORMANT') return 'control-room-pill location-dormant'
  return 'control-room-pill location-none'
}

function alertClass(value: 'info' | 'warning' | 'critical'): string {
  if (value === 'critical') return 'control-room-alert control-room-alert-critical'
  if (value === 'warning') return 'control-room-alert control-room-alert-warning'
  return 'control-room-alert control-room-alert-info'
}

const defaultLimit = 24

export function ControlRoomPage() {
  const [roomUnlocked, setRoomUnlocked] = useState(false)
  const [booting, setBooting] = useState(false)
  const [queryText, setQueryText] = useState('')
  const [regionId, setRegionId] = useState<number | null>(null)
  const [departmentId, setDepartmentId] = useState<number | null>(null)
  const [todayStatus, setTodayStatus] = useState<'NOT_STARTED' | 'IN_PROGRESS' | 'FINISHED' | ''>('')
  const [locationState, setLocationState] = useState<ControlRoomLocationState | ''>('')
  const [includeInactive, setIncludeInactive] = useState(false)
  const [limit, setLimit] = useState(defaultLimit)
  const [page, setPage] = useState(1)
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null)

  const regionsQuery = useQuery({ queryKey: ['regions', 'control-room'], queryFn: () => getRegions({ include_inactive: false }) })
  const departmentsQuery = useQuery({ queryKey: ['departments', 'control-room'], queryFn: getDepartments })

  const availableDepartments = useMemo(() => {
    const all = departmentsQuery.data ?? []
    if (!regionId) return all
    return all.filter((item) => item.region_id === regionId)
  }, [departmentsQuery.data, regionId])

  useEffect(() => {
    if (departmentId && !availableDepartments.some((item) => item.id === departmentId)) {
      setDepartmentId(null)
    }
  }, [availableDepartments, departmentId])

  useEffect(() => {
    if (!booting) {
      return
    }
    const timer = window.setTimeout(() => {
      setBooting(false)
      setRoomUnlocked(true)
    }, 1250)
    return () => window.clearTimeout(timer)
  }, [booting])

  useEffect(() => {
    setPage(1)
  }, [queryText, regionId, departmentId, todayStatus, locationState, includeInactive, limit])

  const params = useMemo<ControlRoomOverviewParams>(
    () => ({
      q: queryText.trim() || undefined,
      region_id: regionId ?? undefined,
      department_id: departmentId ?? undefined,
      today_status: todayStatus || undefined,
      location_state: locationState || undefined,
      include_inactive: includeInactive || undefined,
      offset: (page - 1) * limit,
      limit,
    }),
    [departmentId, includeInactive, limit, locationState, page, queryText, regionId, todayStatus],
  )

  const overviewQuery = useQuery({
    queryKey: ['control-room-overview', params],
    queryFn: () => getControlRoomOverview(params),
    enabled: roomUnlocked,
    refetchInterval: roomUnlocked ? 20_000 : false,
    placeholderData: (previousData) => previousData,
  })

  const items = overviewQuery.data?.items ?? []
  const total = overviewQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / limit))

  useEffect(() => {
    if (!items.length) {
      setSelectedEmployeeId(null)
      return
    }
    const selectedStillVisible = selectedEmployeeId
      ? items.some((item) => item.employee.id === selectedEmployeeId)
      : false
    if (!selectedStillVisible) {
      setSelectedEmployeeId(items[0].employee.id)
    }
  }, [items, selectedEmployeeId])

  const selectedEmployee = useMemo<ControlRoomEmployeeState | null>(
    () => items.find((item) => item.employee.id === selectedEmployeeId) ?? items[0] ?? null,
    [items, selectedEmployeeId],
  )

  const mapMarkers = useMemo<ControlRoomMapMarker[]>(
    () =>
      (overviewQuery.data?.map_points ?? []).map((point) => ({
        id: `employee-${point.employee_id}`,
        lat: point.lat,
        lon: point.lon,
        label: point.label,
        todayStatus: point.today_status,
        locationState: point.location_state,
      })),
    [overviewQuery.data?.map_points],
  )

  const isIntroVisible = !roomUnlocked && !booting

  if (regionsQuery.isError || departmentsQuery.isError) {
    return <ErrorBlock message="Kontrol odası filtre verileri alınamadı." />
  }

  return (
    <div className="control-room-page">
      <PageHeader
        title="Kontrol Odası"
        description="Mevcut admin oturumu içinde çalışan, harita ve telemetri odaklı operasyon paneli."
        action={
          roomUnlocked ? (
            <button
              type="button"
              className="btn-animated control-room-refresh-button"
              onClick={() => void overviewQuery.refetch()}
            >
              Veriyi Yenile
            </button>
          ) : null
        }
      />

      {isIntroVisible ? (
        <section className="control-room-intro">
          <div className="control-room-intro-copy">
            <p className="control-room-kicker">BLACKLIST CORE / LIVE SURVEILLANCE GRID</p>
            <h2 className="control-room-intro-title">Sistemin içindeki en sert operasyon ekranı.</h2>
            <p className="control-room-intro-text">
              Ayrı sistem değil. Aynı admin oturumu ile, anlık vardiya akışı, konum hareketi, cihaz-IP izi ve
              dikkat isteyen personel durumları tek odada toplanır.
            </p>
            <div className="control-room-intro-tags">
              <span className="control-room-inline-tag">Harita + tablo</span>
              <span className="control-room-inline-tag">Filtreli vardiya görünümü</span>
              <span className="control-room-inline-tag">Operasyon akış beslemesi</span>
            </div>
          </div>
          <div className="control-room-intro-side">
            <div className="control-room-intro-console">
              <div className="control-room-console-line">
                <span>AUTH</span>
                <strong>SESSION VERIFIED</strong>
              </div>
              <div className="control-room-console-line">
                <span>MODE</span>
                <strong>ADMIN LINKED</strong>
              </div>
              <div className="control-room-console-line">
                <span>GRID</span>
                <strong>READY TO ARM</strong>
              </div>
            </div>
            <button
              type="button"
              className="control-room-launch-button"
              onClick={() => setBooting(true)}
            >
              Kontrol Odasını Aç
            </button>
          </div>
        </section>
      ) : null}

      {booting ? (
        <div className="control-room-boot-overlay" role="status" aria-live="polite">
          <div className="control-room-boot-core">
            <div className="control-room-boot-ring" />
            <div className="control-room-boot-orbit" />
            <div className="control-room-boot-panel">
              <p className="control-room-boot-kicker">CONTROL CORE</p>
              <p className="control-room-boot-title">Telemetri katmanı hazırlanıyor...</p>
              <p className="control-room-boot-subtitle">vardiya / konum / cihaz / ip / alarm akışı eşleniyor</p>
            </div>
          </div>
        </div>
      ) : null}

      {roomUnlocked ? (
        <div className="control-room-shell">
          <section className="control-room-topline">
            <div>
              <p className="control-room-kicker">REAL-TIME FIELD COMMAND</p>
              <h2 className="control-room-heading">Canlı operasyon matrisi</h2>
            </div>
            <div className="control-room-topline-meta">
              <span className="control-room-inline-tag">
                Son üretim: {dt(overviewQuery.data?.generated_at_utc ?? null)}
              </span>
              <span className="control-room-inline-tag">Sayfa {page}/{totalPages}</span>
            </div>
          </section>

          <section className="control-room-kpi-grid">
            <article className="control-room-kpi-card">
              <span className="control-room-kpi-label">Filtreli personel</span>
              <strong className="control-room-kpi-value">{overviewQuery.data?.summary.total_employees ?? 0}</strong>
              <span className="control-room-kpi-meta">Aktif: {overviewQuery.data?.summary.active_employees ?? 0}</span>
            </article>
            <article className="control-room-kpi-card">
              <span className="control-room-kpi-label">Sahadakiler</span>
              <strong className="control-room-kpi-value">{overviewQuery.data?.summary.in_progress_count ?? 0}</strong>
              <span className="control-room-kpi-meta">Anlık açık vardiya</span>
            </article>
            <article className="control-room-kpi-card">
              <span className="control-room-kpi-label">Başlamayan</span>
              <strong className="control-room-kpi-value">{overviewQuery.data?.summary.not_started_count ?? 0}</strong>
              <span className="control-room-kpi-meta">Bugün giriş görünmeyen</span>
            </article>
            <article className="control-room-kpi-card">
              <span className="control-room-kpi-label">Tamamlayan</span>
              <strong className="control-room-kpi-value">{overviewQuery.data?.summary.finished_count ?? 0}</strong>
              <span className="control-room-kpi-meta">Bugünü kapatan</span>
            </article>
            <article className="control-room-kpi-card">
              <span className="control-room-kpi-label">Sayfa alarmı</span>
              <strong className="control-room-kpi-value">{overviewQuery.data?.summary.attention_on_page_count ?? 0}</strong>
              <span className="control-room-kpi-meta">Göz isteyen kayıtlar</span>
            </article>
            <article className="control-room-kpi-card">
              <span className="control-room-kpi-label">Canlı konum</span>
              <strong className="control-room-kpi-value">{overviewQuery.data?.summary.live_location_on_page_count ?? 0}</strong>
              <span className="control-room-kpi-meta">Haritada sıcak nokta</span>
            </article>
          </section>

          <div className="control-room-main-grid">
            <section className="control-room-panel control-room-filter-panel">
              <div className="control-room-panel-head">
                <div>
                  <p className="control-room-panel-kicker">FILTER STACK</p>
                  <h3>Operasyon süzgeci</h3>
                </div>
              </div>
              <div className="control-room-filter-grid">
                <label className="control-room-field">
                  <span>Çalışan / #ID</span>
                  <input
                    value={queryText}
                    onChange={(event) => setQueryText(event.target.value)}
                    placeholder="ör: Hüseyincan veya #1"
                  />
                </label>
                <label className="control-room-field">
                  <span>Bölge</span>
                  <select
                    value={regionId ?? ''}
                    onChange={(event) => setRegionId(event.target.value ? Number(event.target.value) : null)}
                  >
                    <option value="">Tümü</option>
                    {(regionsQuery.data ?? []).map((region) => (
                      <option key={region.id} value={region.id}>
                        {region.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="control-room-field">
                  <span>Departman</span>
                  <select
                    value={departmentId ?? ''}
                    onChange={(event) => setDepartmentId(event.target.value ? Number(event.target.value) : null)}
                  >
                    <option value="">Tümü</option>
                    {availableDepartments.map((department) => (
                      <option key={department.id} value={department.id}>
                        {department.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="control-room-field">
                  <span>Gün durumu</span>
                  <select value={todayStatus} onChange={(event) => setTodayStatus(event.target.value as typeof todayStatus)}>
                    <option value="">Tümü</option>
                    <option value="NOT_STARTED">Başlamadı</option>
                    <option value="IN_PROGRESS">Sahada</option>
                    <option value="FINISHED">Tamam</option>
                  </select>
                </label>
                <label className="control-room-field">
                  <span>Konum ısısı</span>
                  <select
                    value={locationState}
                    onChange={(event) => setLocationState(event.target.value as typeof locationState)}
                  >
                    <option value="">Tümü</option>
                    <option value="LIVE">Canlı</option>
                    <option value="STALE">Sıcak</option>
                    <option value="DORMANT">Soğuk</option>
                    <option value="NONE">Yok</option>
                  </select>
                </label>
                <label className="control-room-field">
                  <span>Sayfa limiti</span>
                  <select value={limit} onChange={(event) => setLimit(Number(event.target.value))}>
                    <option value="12">12</option>
                    <option value="24">24</option>
                    <option value="35">35</option>
                    <option value="50">50</option>
                  </select>
                </label>
              </div>

              <label className="control-room-toggle">
                <input
                  type="checkbox"
                  checked={includeInactive}
                  onChange={(event) => setIncludeInactive(event.target.checked)}
                />
                <span>Pasif çalışanları da dahil et</span>
              </label>
            </section>

            <section className="control-room-panel control-room-selected-panel">
              <div className="control-room-panel-head">
                <div>
                  <p className="control-room-panel-kicker">TARGET LOCK</p>
                  <h3>Seçili operatör</h3>
                </div>
                {selectedEmployee ? (
                  <Link to={`/employees/${selectedEmployee.employee.id}`} className="control-room-link-button">
                    Detayı Aç
                  </Link>
                ) : null}
              </div>

              {selectedEmployee ? (
                <div className="control-room-selected-content">
                  <div className="control-room-selected-title-row">
                    <div>
                      <h4>{selectedEmployee.employee.full_name}</h4>
                      <p>
                        {selectedEmployee.department_name ?? 'Departman yok'} / {selectedEmployee.employee.region_name ?? 'Bölge yok'}
                      </p>
                    </div>
                    <div className="control-room-chip-stack">
                      <span className={statusClass(selectedEmployee.today_status)}>
                        {todayStatusLabel(selectedEmployee.today_status)}
                      </span>
                      <span className={locationClass(selectedEmployee.location_state)}>
                        {locationStateLabel(selectedEmployee.location_state)}
                      </span>
                    </div>
                  </div>

                  <div className="control-room-selected-grid">
                    <div className="control-room-selected-block">
                      <span className="control-room-selected-label">Vardiya</span>
                      <strong>{selectedEmployee.shift_name ?? 'Atanmadı'}</strong>
                      <p>{selectedEmployee.shift_window_label ?? 'Saat penceresi yok'}</p>
                    </div>
                    <div className="control-room-selected-block">
                      <span className="control-room-selected-label">Cihaz / IP</span>
                      <strong>
                        {selectedEmployee.active_devices}/{selectedEmployee.total_devices} aktif
                      </strong>
                      <p>{selectedEmployee.recent_ip ?? 'IP yok'}</p>
                    </div>
                    <div className="control-room-selected-block">
                      <span className="control-room-selected-label">Plan üstü</span>
                      <strong>
                        <MinuteDisplay minutes={selectedEmployee.current_month.plan_overtime_minutes} />
                      </strong>
                      <p>Bu ay</p>
                    </div>
                    <div className="control-room-selected-block">
                      <span className="control-room-selected-label">Yasal FM</span>
                      <strong>
                        <MinuteDisplay minutes={selectedEmployee.current_month.overtime_minutes} />
                      </strong>
                      <p>Bu ay</p>
                    </div>
                  </div>

                  <div className="control-room-selected-timeline">
                    <div>
                      <span>Son olay</span>
                      <strong>{selectedEmployee.last_event ? dt(selectedEmployee.last_event.ts_utc) : '-'}</strong>
                    </div>
                    <div>
                      <span>Portal izi</span>
                      <strong>{dt(selectedEmployee.last_portal_seen_utc)}</strong>
                    </div>
                    <div>
                      <span>Konum</span>
                      <strong>{selectedEmployee.latest_location ? relative(selectedEmployee.latest_location.ts_utc) : 'Konum yok'}</strong>
                    </div>
                  </div>

                  <div className="control-room-alert-list">
                    {selectedEmployee.attention_flags.length ? (
                      selectedEmployee.attention_flags.map((alert) => (
                        <span key={alert.code} className={alertClass(alert.severity)}>
                          {alertSeverityLabel(alert.severity)} / {alert.label}
                        </span>
                      ))
                    ) : (
                      <span className="control-room-alert control-room-alert-clear">Açık alarm yok</span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="control-room-empty-state">Bu sayfada seçilecek kayıt bulunmuyor.</div>
              )}
            </section>
          </div>

          {overviewQuery.isLoading && !overviewQuery.data ? <LoadingBlock label="Kontrol odası yükleniyor..." /> : null}
          {overviewQuery.isError ? <ErrorBlock message="Kontrol odası verileri alınamadı." /> : null}

          {!overviewQuery.isLoading && !overviewQuery.isError ? (
            <>
              <div className="control-room-telemetry-grid">
                <section className="control-room-panel control-room-map-panel">
                  <div className="control-room-panel-head">
                    <div>
                      <p className="control-room-panel-kicker">TACTICAL MAP</p>
                      <h3>Anlık saha haritası</h3>
                    </div>
                    <span className="control-room-inline-tag">
                      Harita bu sayfadaki çalışanları gösterir
                    </span>
                  </div>
                  {mapMarkers.length ? (
                    <ControlRoomMap
                      markers={mapMarkers}
                      focusedMarkerId={selectedEmployee ? `employee-${selectedEmployee.employee.id}` : null}
                    />
                  ) : (
                    <div className="control-room-empty-map">Filtrede görünür konum kaydı yok.</div>
                  )}
                </section>

                <section className="control-room-panel control-room-feed-panel">
                  <div className="control-room-panel-head">
                    <div>
                      <p className="control-room-panel-kicker">EVENT FEED</p>
                      <h3>Canlı akış</h3>
                    </div>
                  </div>
                  <div className="control-room-feed-list">
                    {(overviewQuery.data?.recent_events ?? []).length ? (
                      overviewQuery.data?.recent_events.map((event) => (
                        <button
                          key={event.event_id}
                          type="button"
                          className="control-room-feed-item"
                          onClick={() => setSelectedEmployeeId(event.employee_id)}
                        >
                          <span className="control-room-feed-time">{dt(event.ts_utc)}</span>
                          <strong>
                            #{event.employee_id} {event.employee_name}
                          </strong>
                          <span>
                            {event.department_name ?? 'Departman yok'} / {event.event_type} / {event.location_status}
                          </span>
                        </button>
                      ))
                    ) : (
                      <div className="control-room-empty-state">Akış satırı yok.</div>
                    )}
                  </div>
                </section>
              </div>

              <section className="control-room-panel control-room-table-panel">
                <div className="control-room-panel-head">
                  <div>
                    <p className="control-room-panel-kicker">SURVEILLANCE TABLE</p>
                    <h3>Personel vardiya matrisi</h3>
                  </div>
                  <div className="control-room-pagination">
                    <button
                      type="button"
                      className="control-room-page-button"
                      disabled={page <= 1}
                      onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                    >
                      Önceki
                    </button>
                    <span>
                      {page} / {totalPages}
                    </span>
                    <button
                      type="button"
                      className="control-room-page-button"
                      disabled={page >= totalPages}
                      onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                    >
                      Sonraki
                    </button>
                  </div>
                </div>

                <div className="control-room-table-wrap">
                  <table className="control-room-table">
                    <thead>
                      <tr>
                        <th>Operatör</th>
                        <th>Durum</th>
                        <th>Konum</th>
                        <th>Vardiya</th>
                        <th>Son olay</th>
                        <th>Portal / IP</th>
                        <th>Cihaz</th>
                        <th>Plan üstü</th>
                        <th>Yasal FM</th>
                        <th>Alarm</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.length ? (
                        items.map((item) => {
                          const isSelected = selectedEmployee?.employee.id === item.employee.id
                          return (
                            <tr
                              key={item.employee.id}
                              className={isSelected ? 'is-selected' : ''}
                              onClick={() => setSelectedEmployeeId(item.employee.id)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault()
                                  setSelectedEmployeeId(item.employee.id)
                                }
                              }}
                              tabIndex={0}
                            >
                              <td>
                                <div className="control-room-person-cell">
                                  <strong>#{item.employee.id} {item.employee.full_name}</strong>
                                  <span>{item.department_name ?? 'Departman yok'}</span>
                                </div>
                              </td>
                              <td>
                                <span className={statusClass(item.today_status)}>{todayStatusLabel(item.today_status)}</span>
                              </td>
                              <td>
                                <div className="control-room-cell-stack">
                                  <span className={locationClass(item.location_state)}>{locationStateLabel(item.location_state)}</span>
                                  <small>{item.latest_location ? relative(item.latest_location.ts_utc) : 'Veri yok'}</small>
                                </div>
                              </td>
                              <td>
                                <div className="control-room-cell-stack">
                                  <strong>{item.shift_name ?? 'Atanmadı'}</strong>
                                  <small>{item.shift_window_label ?? '-'}</small>
                                </div>
                              </td>
                              <td>
                                <div className="control-room-cell-stack">
                                  <strong>{item.last_event?.event_type ?? '-'}</strong>
                                  <small>{dt(item.last_event?.ts_utc)}</small>
                                </div>
                              </td>
                              <td>
                                <div className="control-room-cell-stack">
                                  <strong>{item.recent_ip ?? '-'}</strong>
                                  <small>{dt(item.last_portal_seen_utc)}</small>
                                </div>
                              </td>
                              <td>{item.active_devices}/{item.total_devices}</td>
                              <td><MinuteDisplay minutes={item.current_month.plan_overtime_minutes} /></td>
                              <td><MinuteDisplay minutes={item.current_month.overtime_minutes} /></td>
                              <td>
                                {item.attention_flags.length ? (
                                  <div className="control-room-table-alerts">
                                    {item.attention_flags.slice(0, 2).map((alert) => (
                                      <span key={alert.code} className={alertClass(alert.severity)}>
                                        {alertSeverityLabel(alert.severity)}
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="control-room-alert control-room-alert-clear">Temiz</span>
                                )}
                              </td>
                            </tr>
                          )
                        })
                      ) : (
                        <tr>
                          <td colSpan={10}>
                            <div className="control-room-empty-state">
                              Filtrelerle eşleşen çalışan bulunamadı.
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
