import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'

import {
  getAttendanceEvents,
  getDashboardEmployeeSnapshot,
  getDevices,
  getEmployeeDeviceOverview,
  getEmployees,
  getMonthlyEmployee,
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
import { buildMonthlyAttendanceInsight, getAttendanceDayType } from '../utils/attendanceInsights'

const quickCommands = [
  {
    to: '/employees',
    label: 'Çalışan Yönetimi',
    description: 'Personel kartı, arşiv ve profil yönetimi.',
    code: 'CMD-EMP',
  },
  {
    to: '/attendance-events',
    label: 'Puantaj Kayıtları',
    description: 'Giriş-çıkış olayları ve manuel düzeltme.',
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
    description: 'Toplu/tekli push ve teslimat logları.',
    code: 'CMD-NOT',
  },
  {
    to: '/reports/employee-monthly',
    label: 'Aylık Çalışan Raporu',
    description: 'Çalışma ve fazla mesai analizi.',
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

function toTurkeyDateKey(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' })
}

function dayTypeFromDateKey(dateKey: string): string {
  const parsed = new Date(`${dateKey}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) {
    return 'Hafta İçi'
  }
  return parsed.getUTCDay() === 0 ? 'Pazar' : 'Hafta İçi'
}

function todayStatusText(status: 'NOT_STARTED' | 'IN_PROGRESS' | 'FINISHED'): string {
  if (status === 'NOT_STARTED') return 'Başlamadı'
  if (status === 'IN_PROGRESS') return 'Mesai Devam Ediyor'
  return 'Mesai Tamamlandı'
}

export function ManagementConsolePage() {
  const { pushToast } = useToast()
  const now = new Date()

  const [notifyTitle, setNotifyTitle] = useState('Yönetim Konsolu Bildirimi')
  const [notifyMessage, setNotifyMessage] = useState('')
  const [notifyPassword, setNotifyPassword] = useState('')
  const [notifyMode, setNotifyMode] = useState<'bulk' | 'single'>('bulk')
  const [notifyEmployeeInput, setNotifyEmployeeInput] = useState('')
  const [notifyEmployeeTargets, setNotifyEmployeeTargets] = useState<number[]>([])
  const [controlEmployeeId, setControlEmployeeId] = useState('')
  const [controlYear, setControlYear] = useState(String(now.getFullYear()))
  const [controlMonth, setControlMonth] = useState(String(now.getMonth() + 1))

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
    queryFn: () => getAttendanceEvents({ limit: 20 }),
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

  const parsedControlYear = Number(controlYear)
  const parsedControlMonth = Number(controlMonth)
  const controlMonthValid =
    Number.isInteger(parsedControlYear) &&
    Number.isInteger(parsedControlMonth) &&
    parsedControlMonth >= 1 &&
    parsedControlMonth <= 12

  const controlMonthlyQuery = useQuery({
    queryKey: ['management-console-control-monthly', controlEmployeeId, parsedControlYear, parsedControlMonth],
    queryFn: () =>
      getMonthlyEmployee({
        employee_id: Number(controlEmployeeId),
        year: parsedControlYear,
        month: parsedControlMonth,
      }),
    enabled: Boolean(controlEmployeeId) && controlMonthValid,
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
  const controlMonthlyDays = controlMonthlyQuery.data?.days ?? []
  const controlMonthlyInsight = useMemo(
    () => buildMonthlyAttendanceInsight(controlMonthlyDays),
    [controlMonthlyDays],
  )

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
    () => attendanceEvents.filter((event) => event.location_status === 'VERIFIED_HOME').length,
    [attendanceEvents],
  )
  const selectedTargetEmployee = useMemo(
    () => employees.find((employee) => String(employee.id) === notifyEmployeeInput) ?? null,
    [employees, notifyEmployeeInput],
  )
  const controlMonthlyByDate = useMemo(
    () => new Map(controlMonthlyDays.map((day) => [day.date, day])),
    [controlMonthlyDays],
  )
  const controlEmployeeIdNumber = Number(controlEmployeeId)

  const liveAttendanceRows = useMemo(
    () =>
      attendanceEvents.slice(0, 14).map((event) => {
        const dayKey = toTurkeyDateKey(event.ts_utc)
        const monthlyDay =
          event.employee_id === controlEmployeeIdNumber && dayKey
            ? controlMonthlyByDate.get(dayKey)
            : undefined
        return {
          event,
          dayTypeLabel: monthlyDay ? getAttendanceDayType(monthlyDay).label : dayTypeFromDateKey(dayKey),
          workedMinutes: monthlyDay?.worked_minutes ?? null,
          planOvertimeMinutes: monthlyDay?.plan_overtime_minutes ?? null,
          legalOvertimeMinutes: monthlyDay?.legal_overtime_minutes ?? null,
        }
      }),
    [attendanceEvents, controlEmployeeIdNumber, controlMonthlyByDate],
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
          <p className="management-console-subtitle">Toplu veya tekli bildirim gönderimini aynı terminalden yürütün.</p>

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
                  <button type="button" onClick={addNotificationTarget} className="management-console-action-button">
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
              <p className="management-console-inline-note">
                Toplu mod: Aktif/Pasif ayrımı olmadan tüm çalışanlara gönderilir.
              </p>
            )}

            <button type="submit" disabled={sendMutation.isPending} className="management-console-send-button">
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

            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm">
                <span className="management-console-field-label">Yıl</span>
                <input
                  type="number"
                  value={controlYear}
                  onChange={(event) => setControlYear(event.target.value)}
                  className="management-console-input mt-1"
                />
              </label>
              <label className="text-sm">
                <span className="management-console-field-label">Ay</span>
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={controlMonth}
                  onChange={(event) => setControlMonth(event.target.value)}
                  className="management-console-input mt-1"
                />
              </label>
            </div>

            {!controlEmployeeId ? (
              <p className="management-console-inline-note">Çalışan seçildiğinde canlı özet burada görünür.</p>
            ) : null}
            {controlEmployeeId && !controlMonthValid ? (
              <p className="management-console-inline-note">Yıl/ay değeri geçersiz.</p>
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
                    <p>Plan Ustu Sure: <MinuteDisplay minutes={snapshotQuery.data.current_month.plan_overtime_minutes} /></p>
                    <p>Yasal Fazla Sure: <MinuteDisplay minutes={snapshotQuery.data.current_month.extra_work_minutes} /></p>
                    <p>Yasal Fazla Mesai: <MinuteDisplay minutes={snapshotQuery.data.current_month.overtime_minutes} /></p>
                  </div>
                  <div className="management-console-block">
                    <p className="management-console-block-title">Önceki Ay</p>
                    <p>Net Çalışma: <MinuteDisplay minutes={snapshotQuery.data.previous_month.worked_minutes} /></p>
                    <p>Plan Ustu Sure: <MinuteDisplay minutes={snapshotQuery.data.previous_month.plan_overtime_minutes} /></p>
                    <p>Yasal Fazla Sure: <MinuteDisplay minutes={snapshotQuery.data.previous_month.extra_work_minutes} /></p>
                    <p>Yasal Fazla Mesai: <MinuteDisplay minutes={snapshotQuery.data.previous_month.overtime_minutes} /></p>
                  </div>
                </div>

                {controlMonthlyQuery.isLoading ? <LoadingBlock label="Aylık puantaj yükleniyor..." /> : null}
                {controlMonthlyQuery.isError ? <ErrorBlock message="Aylık puantaj alınamadı." /> : null}
                {controlMonthlyQuery.data ? (
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div className="management-console-block">
                      <p className="management-console-block-title">Çalışılan Gün</p>
                      <p>{controlMonthlyInsight.workedDayCount} gün</p>
                      <p>Hafta İçi: {controlMonthlyInsight.weekdayWorkedDayCount}</p>
                    </div>
                    <div className="management-console-block">
                      <p className="management-console-block-title">Pazar Mesaisi</p>
                      <p>{controlMonthlyInsight.sundayWorkedDayCount} gün</p>
                      <p><MinuteDisplay minutes={controlMonthlyInsight.sundayWorkedMinutes} /></p>
                    </div>
                    <div className="management-console-block">
                      <p className="management-console-block-title">Özel Gün Mesaisi</p>
                      <p>{controlMonthlyInsight.specialWorkedDayCount} gün</p>
                      <p><MinuteDisplay minutes={controlMonthlyInsight.specialWorkedMinutes} /></p>
                    </div>
                  </div>
                ) : null}

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
                        <p>
                          Koordinat: {snapshotQuery.data.latest_location.lat.toFixed(6)}, {snapshotQuery.data.latest_location.lon.toFixed(6)}
                        </p>
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
          <h4 className="management-console-title">Canlı Puantaj Kaydı</h4>
          <p className="management-console-subtitle">
            Son giriş-çıkış olayları ile gün tipi, günlük çalışma, plan üstü süre ve yasal fazla mesai görünümü.
          </p>
          <div className="management-console-table-wrap mt-3">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr>
                  <th className="py-2">Zaman</th>
                  <th>Çalışan</th>
                  <th>Gün Tipi</th>
                  <th>Tip</th>
                  <th>Konum</th>
                  <th>Günlük Çalışma</th>
                  <th>Plan Üstü</th>
                  <th>Yasal FM</th>
                </tr>
              </thead>
              <tbody>
                {liveAttendanceRows.map((row) => (
                  <tr key={row.event.id}>
                    <td className="py-2">{dt(row.event.ts_utc)}</td>
                    <td>#{row.event.employee_id} - {employeesById.get(row.event.employee_id)?.full_name ?? 'Çalışan'}</td>
                    <td>{row.dayTypeLabel}</td>
                    <td>{row.event.type}</td>
                    <td>{row.event.location_status}</td>
                    <td>{row.workedMinutes === null ? '-' : <MinuteDisplay minutes={row.workedMinutes} />}</td>
                    <td>{row.planOvertimeMinutes === null ? '-' : <MinuteDisplay minutes={row.planOvertimeMinutes} />}</td>
                    <td>{row.legalOvertimeMinutes === null ? '-' : <MinuteDisplay minutes={row.legalOvertimeMinutes} />}</td>
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
