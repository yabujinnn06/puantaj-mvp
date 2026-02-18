import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'

import {
  getAttendanceEvents,
  getDashboardEmployeeSnapshot,
  getDevices,
  getEmployeeDeviceOverview,
  getEmployees,
  sendManualNotification,
} from '../api/admin'
import { parseApiError } from '../api/error'
import { EmployeeAutocompleteField } from '../components/EmployeeAutocompleteField'
import { ErrorBlock } from '../components/ErrorBlock'
import { LoadingBlock } from '../components/LoadingBlock'
import { MinuteDisplay } from '../components/MinuteDisplay'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'
import { useToast } from '../hooks/useToast'

const quickCommands = [
  {
    to: '/employees',
    label: 'Çalışan Yönetimi',
    description: 'Personel kartı, arşiv, profil güncelleme.',
    code: 'CMD-EMP',
  },
  {
    to: '/attendance-events',
    label: 'Puantaj Kayıtları',
    description: 'Giriş-çıkış olayları, manuel düzeltme.',
    code: 'CMD-ATT',
  },
  {
    to: '/devices',
    label: 'Cihaz Kontrolü',
    description: 'Cihaz aktivasyonu ve erişim denetimi.',
    code: 'CMD-DEV',
  },
  {
    to: '/notifications',
    label: 'Bildirim Merkezi',
    description: 'Planlı job ve push operasyonları.',
    code: 'CMD-NOT',
  },
  {
    to: '/reports/employee-monthly',
    label: 'Aylık Çalışan Raporu',
    description: 'Çalışan bazlı puantaj analizi.',
    code: 'CMD-RPT',
  },
  {
    to: '/audit-logs',
    label: 'Sistem Logları',
    description: 'İz kaydı ve güvenlik denetimi.',
    code: 'CMD-AUD',
  },
]

function dt(value: string | null | undefined): string {
  if (!value) return '-'
  return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function todayStatusText(status: 'NOT_STARTED' | 'IN_PROGRESS' | 'FINISHED'): string {
  if (status === 'NOT_STARTED') return 'Başlamadı'
  if (status === 'IN_PROGRESS') return 'Mesai Devam Ediyor'
  return 'Mesai Tamamlandı'
}

export function ManagementConsolePage() {
  const { pushToast } = useToast()

  const [notifyTitle, setNotifyTitle] = useState('Yönetim Konsolu Bildirimi')
  const [notifyMessage, setNotifyMessage] = useState('')
  const [notifyPassword, setNotifyPassword] = useState('')
  const [notifyMode, setNotifyMode] = useState<'bulk' | 'single'>('bulk')
  const [notifyEmployeeInput, setNotifyEmployeeInput] = useState('')
  const [notifyEmployeeTargets, setNotifyEmployeeTargets] = useState<number[]>([])
  const [controlEmployeeId, setControlEmployeeId] = useState('')

  const employeesQuery = useQuery({
    queryKey: ['employees', 'management-console'],
    queryFn: () => getEmployees({ status: 'all', include_inactive: true }),
    refetchInterval: 30_000,
  })
  const devicesQuery = useQuery({
    queryKey: ['devices', 'management-console'],
    queryFn: getDevices,
    refetchInterval: 30_000,
  })
  const attendanceQuery = useQuery({
    queryKey: ['attendance-events', 'management-console'],
    queryFn: () => getAttendanceEvents({ limit: 14 }),
    refetchInterval: 20_000,
  })
  const deviceOverviewQuery = useQuery({
    queryKey: ['employee-device-overview', 'management-console'],
    queryFn: () => getEmployeeDeviceOverview({ limit: 12, device_limit: 2, include_inactive: false }),
    refetchInterval: 20_000,
  })
  const snapshotQuery = useQuery({
    queryKey: ['dashboard-employee-snapshot', 'management-console', controlEmployeeId],
    queryFn: () => getDashboardEmployeeSnapshot({ employee_id: Number(controlEmployeeId) }),
    enabled: Boolean(controlEmployeeId),
    staleTime: 15_000,
  })

  const sendMutation = useMutation({
    mutationFn: sendManualNotification,
    onSuccess: (result) => {
      pushToast({
        variant: 'success',
        title: 'Bildirim gönderildi',
        description: `Hedef: ${result.total_targets} / Gönderilen: ${result.sent}`,
      })
      setNotifyMessage('')
      if (notifyMode === 'single') {
        setNotifyEmployeeTargets([])
        setNotifyEmployeeInput('')
      }
    },
    onError: (error) => {
      const parsed = parseApiError(error, 'Bildirim gönderimi başarısız.')
      pushToast({ variant: 'error', title: 'Gönderim başarısız', description: parsed.message })
    },
  })

  const employees = employeesQuery.data ?? []
  const devices = devicesQuery.data ?? []
  const attendanceEvents = attendanceQuery.data ?? []
  const deviceOverview = deviceOverviewQuery.data ?? []

  const employeesById = useMemo(
    () => new Map(employees.map((employee) => [employee.id, employee])),
    [employees],
  )
  const activeEmployeeCount = useMemo(
    () => employees.filter((employee) => employee.is_active).length,
    [employees],
  )
  const activeDeviceCount = useMemo(
    () => devices.filter((device) => device.is_active).length,
    [devices],
  )
  const verifiedLocationCount = useMemo(
    () =>
      attendanceEvents.filter((event) => event.location_status === 'VERIFIED_HOME').length,
    [attendanceEvents],
  )

  const selectedTargetEmployee = useMemo(
    () => employees.find((employee) => String(employee.id) === notifyEmployeeInput) ?? null,
    [employees, notifyEmployeeInput],
  )

  const addNotificationTarget = () => {
    const parsedId = Number(notifyEmployeeInput)
    if (!Number.isInteger(parsedId) || parsedId <= 0) {
      pushToast({ variant: 'error', title: 'Hedef eklenemedi', description: 'Önce çalışan seçin.' })
      return
    }
    if (notifyEmployeeTargets.includes(parsedId)) {
      pushToast({ variant: 'info', title: 'Hedef zaten eklendi', description: `#${parsedId} listede var.` })
      return
    }
    setNotifyEmployeeTargets((prev) => [...prev, parsedId])
    setNotifyEmployeeInput('')
  }

  const removeNotificationTarget = (employeeId: number) => {
    setNotifyEmployeeTargets((prev) => prev.filter((id) => id !== employeeId))
  }

  const handleSendNotification = (event: FormEvent) => {
    event.preventDefault()

    if (!notifyTitle.trim() || !notifyMessage.trim() || !notifyPassword.trim()) {
      pushToast({
        variant: 'error',
        title: 'Eksik alan',
        description: 'Başlık, mesaj ve yönetici şifresi zorunludur.',
      })
      return
    }

    if (notifyMode === 'single' && notifyEmployeeTargets.length === 0) {
      pushToast({
        variant: 'error',
        title: 'Hedef seçilmedi',
        description: 'Tekli bildirim için en az bir çalışan seçin.',
      })
      return
    }

    sendMutation.mutate({
      title: notifyTitle.trim(),
      message: notifyMessage.trim(),
      password: notifyPassword.trim(),
      target: 'employees',
      employee_ids: notifyMode === 'single' ? notifyEmployeeTargets : undefined,
    })
  }

  if (employeesQuery.isLoading || devicesQuery.isLoading || attendanceQuery.isLoading || deviceOverviewQuery.isLoading) {
    return <LoadingBlock label="Yönetim konsolu yükleniyor..." />
  }

  if (employeesQuery.isError || devicesQuery.isError || attendanceQuery.isError || deviceOverviewQuery.isError) {
    return <ErrorBlock message="Yönetim konsolu verileri alınamadı." />
  }

  return (
    <div className="management-console-screen space-y-4">
      <PageHeader
        title="Yönetim Konsolu"
        description="Tek merkezden bildirim, puantaj, konum ve cihaz operasyonlarını disiplinli akışla yönetin."
      />

      <div className="management-console-kpi-grid">
        <Panel className="management-console-kpi-card">
          <p className="management-console-kpi-label">Toplam Çalışan</p>
          <p className="management-console-kpi-value">{employees.length}</p>
          <p className="management-console-kpi-meta">Aktif: {activeEmployeeCount}</p>
        </Panel>
        <Panel className="management-console-kpi-card">
          <p className="management-console-kpi-label">Toplam Cihaz</p>
          <p className="management-console-kpi-value">{devices.length}</p>
          <p className="management-console-kpi-meta">Aktif: {activeDeviceCount}</p>
        </Panel>
        <Panel className="management-console-kpi-card">
          <p className="management-console-kpi-label">Canlı Olay Akışı</p>
          <p className="management-console-kpi-value">{attendanceEvents.length}</p>
          <p className="management-console-kpi-meta">Doğrulanmış konum: {verifiedLocationCount}</p>
        </Panel>
        <Panel className="management-console-kpi-card">
          <p className="management-console-kpi-label">Cihaz Görünüm Satırı</p>
          <p className="management-console-kpi-value">{deviceOverview.length}</p>
          <p className="management-console-kpi-meta">Son yenileme: {dt(new Date().toISOString())}</p>
        </Panel>
      </div>

      <Panel className="management-console-panel">
        <h4 className="management-console-title">Komut Merkezi</h4>
        <p className="management-console-subtitle">
          Dağınık ekranlar arasında dolaşmak yerine kritik yönetim modüllerine tek panelden erişin.
        </p>
        <div className="management-console-command-grid">
          {quickCommands.map((command) => (
            <Link key={command.to} to={command.to} className="management-console-command-card">
              <span className="management-console-command-code">{command.code}</span>
              <p className="management-console-command-label">{command.label}</p>
              <p className="management-console-command-desc">{command.description}</p>
            </Link>
          ))}
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[1.06fr_1.35fr]">
        <Panel className="management-console-panel">
          <h4 className="management-console-title">Bildirim Terminali</h4>
          <p className="management-console-subtitle">
            Toplu veya tekli bildirim gönderimini aynı terminalden yürütün.
          </p>

          <form className="management-console-terminal mt-3 space-y-3" onSubmit={handleSendNotification}>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm">
                <span className="management-console-field-label">Gönderim Modu</span>
                <select
                  value={notifyMode}
                  onChange={(e) => setNotifyMode(e.target.value as 'bulk' | 'single')}
                  className="management-console-input mt-1"
                >
                  <option value="bulk">Toplu (Tüm Çalışanlar)</option>
                  <option value="single">Tekli (Seçili Çalışanlar)</option>
                </select>
              </label>
              <label className="text-sm">
                <span className="management-console-field-label">Yönetici Şifresi</span>
                <input
                  type="password"
                  value={notifyPassword}
                  onChange={(e) => setNotifyPassword(e.target.value)}
                  className="management-console-input mt-1"
                  placeholder="Şifre"
                />
              </label>
            </div>

            <label className="text-sm">
              <span className="management-console-field-label">Başlık</span>
              <input
                value={notifyTitle}
                onChange={(e) => setNotifyTitle(e.target.value)}
                className="management-console-input mt-1"
                placeholder="Bildirim başlığı"
              />
            </label>

            <label className="text-sm">
              <span className="management-console-field-label">Mesaj</span>
              <textarea
                rows={4}
                value={notifyMessage}
                onChange={(e) => setNotifyMessage(e.target.value)}
                className="management-console-input mt-1"
                placeholder="Mesaj içeriği"
              />
            </label>

            {notifyMode === 'single' ? (
              <div className="space-y-2">
                <EmployeeAutocompleteField
                  label="Hedef çalışan"
                  employees={employees}
                  value={notifyEmployeeInput}
                  onChange={setNotifyEmployeeInput}
                  helperText="Çalışan seçip listeye ekleyin."
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={addNotificationTarget}
                    className="management-console-action-button"
                  >
                    Hedefe Ekle
                  </button>
                  {selectedTargetEmployee ? (
                    <span className="management-console-inline-note">
                      Seçili: #{selectedTargetEmployee.id} - {selectedTargetEmployee.full_name}
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {notifyEmployeeTargets.length === 0 ? (
                    <span className="management-console-inline-note">Henüz hedef çalışan eklenmedi.</span>
                  ) : (
                    notifyEmployeeTargets.map((employeeId) => (
                      <button
                        key={employeeId}
                        type="button"
                        onClick={() => removeNotificationTarget(employeeId)}
                        className="management-console-chip"
                      >
                        #{employeeId} - {employeesById.get(employeeId)?.full_name ?? 'Çalışan'} ×
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <p className="management-console-inline-note">Toplu mod: Aktif/Pasif ayrımı olmadan tüm çalışanlara gönderilir.</p>
            )}

            <button
              type="submit"
              disabled={sendMutation.isPending}
              className="management-console-send-button"
            >
              {sendMutation.isPending ? 'Gönderiliyor...' : 'Bildirimi Gönder'}
            </button>
          </form>
        </Panel>

        <Panel className="management-console-panel">
          <h4 className="management-console-title">Çalışan Kontrol Odası</h4>
          <p className="management-console-subtitle">
            Tek çalışan için puantaj, konum ve cihaz metriklerini anlık izleyin.
          </p>

          <div className="management-console-terminal mt-3 space-y-3">
            <EmployeeAutocompleteField
              label="Kontrol edilecek çalışan"
              employees={employees}
              value={controlEmployeeId}
              onChange={setControlEmployeeId}
              helperText="Seçildiğinde puantaj ve konum panelleri otomatik güncellenir."
            />

            {!controlEmployeeId ? (
              <p className="management-console-inline-note">Çalışan seçildiğinde canlı özet burada görünür.</p>
            ) : null}

            {controlEmployeeId && snapshotQuery.isLoading ? <LoadingBlock label="Canlı özet yükleniyor..." /> : null}
            {controlEmployeeId && snapshotQuery.isError ? <ErrorBlock message="Çalışan özeti alınamadı." /> : null}

            {snapshotQuery.data ? (
              <div className="space-y-3">
                <div className="management-console-strip">
                  <span className="management-console-strip-tag">Durum</span>
                  <span>{todayStatusText(snapshotQuery.data.today_status)}</span>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="management-console-block">
                    <p className="management-console-block-title">Bu Ay</p>
                    <p>Net Çalışma: <MinuteDisplay minutes={snapshotQuery.data.current_month.worked_minutes} /></p>
                    <p>Fazla Süre: <MinuteDisplay minutes={snapshotQuery.data.current_month.extra_work_minutes} /></p>
                    <p>Fazla Mesai: <MinuteDisplay minutes={snapshotQuery.data.current_month.overtime_minutes} /></p>
                  </div>
                  <div className="management-console-block">
                    <p className="management-console-block-title">Önceki Ay</p>
                    <p>Net Çalışma: <MinuteDisplay minutes={snapshotQuery.data.previous_month.worked_minutes} /></p>
                    <p>Fazla Süre: <MinuteDisplay minutes={snapshotQuery.data.previous_month.extra_work_minutes} /></p>
                    <p>Fazla Mesai: <MinuteDisplay minutes={snapshotQuery.data.previous_month.overtime_minutes} /></p>
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="management-console-block">
                    <p className="management-console-block-title">Son Puantaj</p>
                    {snapshotQuery.data.last_event ? (
                      <>
                        <p>Tip: {snapshotQuery.data.last_event.event_type}</p>
                        <p>Zaman: {dt(snapshotQuery.data.last_event.ts_utc)}</p>
                        <p>Konum Durumu: {snapshotQuery.data.last_event.location_status}</p>
                      </>
                    ) : (
                      <p>Kayıt bulunmuyor.</p>
                    )}
                  </div>
                  <div className="management-console-block">
                    <p className="management-console-block-title">Son Konum</p>
                    {snapshotQuery.data.latest_location ? (
                      <>
                        <p>Koordinat: {snapshotQuery.data.latest_location.lat.toFixed(6)}, {snapshotQuery.data.latest_location.lon.toFixed(6)}</p>
                        <p>Doğruluk: {snapshotQuery.data.latest_location.accuracy_m ?? '-'} m</p>
                        <p>Zaman: {dt(snapshotQuery.data.latest_location.ts_utc)}</p>
                      </>
                    ) : (
                      <p>Konum verisi yok.</p>
                    )}
                  </div>
                </div>

                <div className="management-console-strip">
                  <span className="management-console-strip-tag">Cihaz</span>
                  <span>
                    Aktif {snapshotQuery.data.active_devices} / Toplam {snapshotQuery.data.total_devices}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Link to={`/employees/${snapshotQuery.data.employee.id}`} className="management-console-action-button">
                    Çalışan Detayını Aç
                  </Link>
                  <Link to="/attendance-events" className="management-console-action-button">
                    Puantaj Olaylarına Git
                  </Link>
                  <Link to="/devices" className="management-console-action-button">
                    Cihaz Paneline Git
                  </Link>
                </div>
              </div>
            ) : null}
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel className="management-console-panel">
          <h4 className="management-console-title">Cihaz Erişim Akışı</h4>
          <p className="management-console-subtitle">
            Çalışan bazında cihaz yoğunluğu ve aktif cihaz oranı.
          </p>
          <div className="management-console-table-wrap mt-3">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr>
                  <th className="py-2">Çalışan</th>
                  <th>Departman</th>
                  <th>Aktif/Toplam</th>
                  <th>İşlem</th>
                </tr>
              </thead>
              <tbody>
                {deviceOverview.slice(0, 10).map((row) => (
                  <tr key={row.employee_id}>
                    <td className="py-2">#{row.employee_id} - {row.employee_name}</td>
                    <td>{row.department_name ?? '-'}</td>
                    <td>{row.active_devices}/{row.total_devices}</td>
                    <td>
                      <Link className="management-console-link" to={`/employees/${row.employee_id}`}>
                        Detay
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel className="management-console-panel">
          <h4 className="management-console-title">Canlı Puantaj Akışı</h4>
          <p className="management-console-subtitle">
            Son giriş-çıkış olayları ve konum doğrulama durumu.
          </p>
          <div className="management-console-table-wrap mt-3">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr>
                  <th className="py-2">Zaman</th>
                  <th>Çalışan</th>
                  <th>Tip</th>
                  <th>Konum</th>
                </tr>
              </thead>
              <tbody>
                {attendanceEvents.slice(0, 12).map((event) => (
                  <tr key={event.id}>
                    <td className="py-2">{dt(event.ts_utc)}</td>
                    <td>#{event.employee_id} - {employeesById.get(event.employee_id)?.full_name ?? 'Çalışan'}</td>
                    <td>{event.type}</td>
                    <td>{event.location_status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  )
}
