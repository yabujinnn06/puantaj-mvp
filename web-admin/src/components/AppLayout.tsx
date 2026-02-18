import { NavLink, Outlet, useLocation } from 'react-router-dom'

import { UI_BRANDING } from '../config/ui'
import { useAuth } from '../hooks/useAuth'

const navItems = [
  { to: '/dashboard', label: 'Genel Bakis' },
  { to: '/regions', label: 'Bolgeler', permission: 'regions' },
  { to: '/departments', label: 'Departmanlar', permission: 'departments' },
  { to: '/employees', label: 'Calisanlar', permission: 'employees' },
  { to: '/quick-setup', label: 'Hizli Ayarlar', permission: 'schedule' },
  { to: '/work-rules', label: 'Mesai Kurallari', permission: 'work_rules' },
  { to: '/attendance-events', label: 'Yoklama Kayitlari', permission: 'attendance_events' },
  { to: '/devices', label: 'Cihazlar', permission: 'devices' },
  { to: '/compliance-settings', label: 'Uyumluluk Ayarlari', permission: 'compliance' },
  { to: '/qr-kodlar', label: 'QR Kodlar' },
  { to: '/leaves', label: 'Izinler', permission: 'leaves' },
  { to: '/reports/employee-monthly', label: 'Aylik Calisan Raporu', permission: 'reports' },
  { to: '/reports/department-summary', label: 'Departman Ozeti', permission: 'reports' },
  { to: '/reports/excel-export', label: 'Excel Disa Aktar', permission: 'reports' },
  { to: '/notifications', label: 'Bildirimler', permission: 'audit' },
  { to: '/audit-logs', label: 'Sistem Loglari', permission: 'audit' },
  { to: '/admin-users', label: 'Admin Kullanicilari', permission: 'admin_users' },
]

const pageTitles: Record<string, string> = {
  '/dashboard': 'Genel Bakis',
  '/regions': 'Bolgeler',
  '/departments': 'Departmanlar',
  '/employees': 'Calisanlar',
  '/quick-setup': 'Hizli Ayarlar',
  '/work-rules': 'Mesai Kurallari',
  '/attendance-events': 'Yoklama Kayitlari',
  '/devices': 'Cihazlar',
  '/compliance-settings': 'Uyumluluk Ayarlari',
  '/qr-kodlar': 'QR Kodlar',
  '/leaves': 'Izinler',
  '/reports/employee-monthly': 'Aylik Calisan Raporu',
  '/reports/department-summary': 'Departman Ozeti',
  '/reports/excel-export': 'Excel Disa Aktar',
  '/notifications': 'Bildirimler',
  '/audit-logs': 'Sistem Loglari',
  '/admin-users': 'Admin Kullanicilari',
}

export function AppLayout() {
  const location = useLocation()
  const { user, logout, hasPermission } = useAuth()

  const visibleNavItems = navItems.filter((item) => !item.permission || hasPermission(item.permission))

  const title =
    pageTitles[location.pathname] ??
    (location.pathname.startsWith('/employees/') ? 'Calisan Detayi' : 'Admin Panel')

  return (
    <div className="admin-shell min-h-screen bg-slate-100 lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="admin-sidebar flex flex-col px-4 py-6 text-slate-100 shadow-panel">
        <h1 className="px-2 text-xl font-bold tracking-tight">Puantaj Admin</h1>
        <p className="px-2 pt-1 text-xs text-slate-400">FastAPI Yonetim Paneli</p>
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
        {UI_BRANDING.showSignature ? (
          <div className="admin-signature">
            <p className="admin-signature-main">{UI_BRANDING.signatureText}</p>
            <p className="admin-signature-sub">{UI_BRANDING.signatureTagline}</p>
          </div>
        ) : null}
      </aside>

      <div className="flex min-h-screen flex-col">
        <header className="admin-topbar border-b border-slate-200 bg-white/90 px-4 py-4 backdrop-blur sm:px-6">
          <div className="flex items-center justify-between gap-3">
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
              Cikis
            </button>
          </div>
        </header>

        <main className="admin-main flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
        {UI_BRANDING.showSignature ? (
          <footer className="admin-footer-signature px-6 pb-4 pt-1 text-center text-xs tracking-wide text-slate-500">
            <span className="admin-footer-brand">{UI_BRANDING.signatureText}</span>
            <span className="admin-footer-sub">{UI_BRANDING.signatureTagline}</span>
            <span className="admin-footer-build">BUILD: {UI_BRANDING.buildVersion}</span>
          </footer>
        ) : null}
      </div>
    </div>
  )
}
