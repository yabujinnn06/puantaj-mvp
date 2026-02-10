import { NavLink, Outlet, useLocation } from 'react-router-dom'

import { UI_BRANDING } from '../config/ui'
import { useAuth } from '../hooks/useAuth'

const navItems = [
  { to: '/dashboard', label: 'Genel Bakış' },
  { to: '/regions', label: 'Bolgeler', permission: 'regions' },
  { to: '/departments', label: 'Departmanlar', permission: 'departments' },
  { to: '/employees', label: 'Çalışanlar', permission: 'employees' },
  { to: '/quick-setup', label: 'Hızlı Ayarlar', permission: 'schedule' },
  { to: '/work-rules', label: 'Mesai Kuralları', permission: 'work_rules' },
  { to: '/attendance-events', label: 'Yoklama Kayıtları', permission: 'attendance_events' },
  { to: '/devices', label: 'Cihazlar', permission: 'devices' },
  { to: '/compliance-settings', label: 'Uyumluluk Ayarları', permission: 'compliance' },
  { to: '/qr-kodlar', label: 'QR Kodlar' },
  { to: '/leaves', label: 'İzinler', permission: 'leaves' },
  { to: '/reports/employee-monthly', label: 'Aylık Çalışan Raporu', permission: 'reports' },
  { to: '/reports/department-summary', label: 'Departman Özeti', permission: 'reports' },
  { to: '/reports/excel-export', label: 'Excel Dışa Aktar', permission: 'reports' },
  { to: '/audit-logs', label: 'Sistem Logları', permission: 'audit' },
  { to: '/admin-users', label: 'Admin Kullanıcıları', permission: 'admin_users' },
]

const pageTitles: Record<string, string> = {
  '/dashboard': 'Genel Bakış',
  '/regions': 'Bolgeler',
  '/departments': 'Departmanlar',
  '/employees': 'Çalışanlar',
  '/quick-setup': 'Hızlı Ayarlar',
  '/work-rules': 'Mesai Kuralları',
  '/attendance-events': 'Yoklama Kayıtları',
  '/devices': 'Cihazlar',
  '/compliance-settings': 'Uyumluluk Ayarları',
  '/qr-kodlar': 'QR Kodlar',
  '/leaves': 'İzinler',
  '/reports/employee-monthly': 'Aylık Çalışan Raporu',
  '/reports/department-summary': 'Departman Özeti',
  '/reports/excel-export': 'Excel Dışa Aktar',
  '/audit-logs': 'Sistem Logları',
  '/admin-users': 'Admin Kullanıcıları',
}

export function AppLayout() {
  const location = useLocation()
  const { user, logout, hasPermission } = useAuth()
  const visibleNavItems = navItems.filter((item) => !item.permission || hasPermission(item.permission))

  const title =
    pageTitles[location.pathname] ??
    (location.pathname.startsWith('/employees/') ? 'Çalışan Detayı' : 'Admin Panel')

  return (
    <div className="admin-shell min-h-screen bg-slate-100 lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="admin-sidebar flex flex-col px-4 py-6 text-slate-100 shadow-panel">
        <h1 className="px-2 text-xl font-bold tracking-tight">Puantaj Admin</h1>
        <p className="px-2 pt-1 text-xs text-slate-400">FastAPI Yönetim Paneli</p>
        <nav className="mt-6 flex flex-col gap-1">
          {visibleNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 text-sm font-medium transition ${
                  isActive
                    ? 'bg-brand-600 text-white shadow-md'
                    : 'text-slate-300 hover:bg-slate-800/85 hover:text-white'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        {UI_BRANDING.showSignature ? <p className="admin-signature">{UI_BRANDING.signatureText}</p> : null}
      </aside>

      <div className="flex min-h-screen flex-col">
        <header className="admin-topbar border-b border-slate-200 bg-white/90 px-6 py-4 backdrop-blur">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
              <p className="text-xs text-slate-500">
                Oturum: {user?.username ?? user?.sub ?? 'admin'} / Rol: {user?.role ?? 'admin'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              className="btn-animated rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              Çıkış
            </button>
          </div>
        </header>

        <main className="admin-main flex-1 p-6">
          <Outlet />
        </main>
        {UI_BRANDING.showSignature ? (
          <footer className="px-6 pb-4 pt-1 text-center text-xs tracking-wide text-slate-500">
            {UI_BRANDING.signatureText} • Build: {UI_BRANDING.buildVersion}
          </footer>
        ) : null}
      </div>
    </div>
  )
}
