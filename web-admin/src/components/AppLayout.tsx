import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'

import { getAdminPushConfig, healAdminDevice } from '../api/admin'
import { UI_BRANDING } from '../config/ui'
import { useAuth } from '../hooks/useAuth'
import { urlBase64ToUint8Array } from '../utils/push'

const navItems = [
  { to: '/management-console', label: 'Yönetim Konsolu' },
  { to: '/control-room', label: 'Operasyonel Güvenlik Matrisi' },
  { to: '/dashboard', label: 'Genel Bakış' },
  { to: '/regions', label: 'Bölgeler', permission: 'regions' },
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
  { to: '/notifications', label: 'Bildirimler', permission: 'audit' },
  { to: '/audit-logs', label: 'Sistem Logları', permission: 'audit' },
  { to: '/admin-users', label: 'Admin Kullanıcıları', permission: 'admin_users' },
]

const pageTitles: Record<string, string> = {
  '/management-console': 'Yönetim Konsolu',
  '/control-room': 'Operasyonel Güvenlik Matrisi',
  '/dashboard': 'Genel Bakış',
  '/regions': 'Bölgeler',
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
  '/notifications': 'Bildirimler',
  '/audit-logs': 'Sistem Logları',
  '/admin-users': 'Admin Kullanıcıları',
}

const PUSH_VAPID_KEY_STORAGE = 'pf_admin_push_vapid_public_key'
const ADMIN_AUTO_HEAL_TS_STORAGE = 'pf_admin_push_auto_heal_ts'
const ADMIN_AUTO_HEAL_INTERVAL_MS = 10 * 60 * 1000

async function autoHealAdminPushClaim(): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return
  }
  if (Notification.permission !== 'granted') {
    return
  }

  const pushConfig = await getAdminPushConfig()
  if (!pushConfig.enabled || !pushConfig.vapid_public_key) {
    return
  }

  const swUrl = `${import.meta.env.BASE_URL}admin-sw.js`
  const registration = await navigator.serviceWorker.register(swUrl, {
    scope: import.meta.env.BASE_URL,
  })

  let subscription = await registration.pushManager.getSubscription()
  const savedVapidKey = window.localStorage.getItem(PUSH_VAPID_KEY_STORAGE)
  if (subscription && savedVapidKey && savedVapidKey !== pushConfig.vapid_public_key) {
    try {
      await subscription.unsubscribe()
    } catch {
      // best effort
    }
    subscription = null
  }

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(pushConfig.vapid_public_key) as unknown as BufferSource,
    })
  }

  await healAdminDevice({
    subscription: subscription.toJSON() as Record<string, unknown>,
    send_test: false,
  })
  window.localStorage.setItem(PUSH_VAPID_KEY_STORAGE, pushConfig.vapid_public_key)
  window.sessionStorage.setItem(ADMIN_AUTO_HEAL_TS_STORAGE, String(Date.now()))
}

export function AppLayout() {
  const location = useLocation()
  const { user, logout, hasPermission } = useAuth()
  const sidebarRef = useRef<HTMLElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const mobileNavPendingRef = useRef(false)
  const mobileLoaderTimerRef = useRef<number | null>(null)
  const [showMobileNavLoader, setShowMobileNavLoader] = useState(false)
  const [mobileLoaderMessage, setMobileLoaderMessage] = useState('İçeriğe geçiliyor...')
  const canWriteAudit = hasPermission('audit', 'write')

  const visibleNavItems = navItems.filter((item) => !item.permission || hasPermission(item.permission))

  const title =
    pageTitles[location.pathname] ??
    (location.pathname.startsWith('/employees/') ? 'Çalışan Detayı' : 'Admin Panel')

  const isMobileViewport = () => typeof window !== 'undefined' && window.innerWidth < 1024

  const clearMobileLoaderTimer = () => {
    if (mobileLoaderTimerRef.current === null) {
      return
    }
    window.clearTimeout(mobileLoaderTimerRef.current)
    mobileLoaderTimerRef.current = null
  }

  const runMobileTransition = (target: 'content' | 'sidebar', label: string) => {
    setMobileLoaderMessage(label)
    setShowMobileNavLoader(true)
    if (target === 'content') {
      contentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } else {
      sidebarRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    clearMobileLoaderTimer()
    mobileLoaderTimerRef.current = window.setTimeout(() => {
      setShowMobileNavLoader(false)
    }, 1200)
  }

  const handleMobileNavClick = (targetPath: string) => {
    if (!isMobileViewport()) {
      return
    }

    if (location.pathname === targetPath) {
      window.requestAnimationFrame(() => {
        runMobileTransition('content', 'İçeriğe geçiliyor...')
      })
      return
    }

    setMobileLoaderMessage('İçeriğe geçiliyor...')
    setShowMobileNavLoader(true)
    mobileNavPendingRef.current = true
  }

  const handleMobileSidebarJump = () => {
    if (!isMobileViewport()) {
      return
    }
    window.requestAnimationFrame(() => {
      runMobileTransition('sidebar', "Sidebar'a dönülüyor...")
    })
  }

  useEffect(() => {
    if (!isMobileViewport()) {
      return
    }
    window.scrollTo({ top: 0 })
  }, [])

  useEffect(() => {
    if (!canWriteAudit) {
      return
    }
    const lastAttemptRaw = window.sessionStorage.getItem(ADMIN_AUTO_HEAL_TS_STORAGE)
    const lastAttempt = lastAttemptRaw ? Number(lastAttemptRaw) : 0
    if (Number.isFinite(lastAttempt) && lastAttempt > 0) {
      const elapsedMs = Date.now() - lastAttempt
      if (elapsedMs < ADMIN_AUTO_HEAL_INTERVAL_MS) {
        return
      }
    }
    void autoHealAdminPushClaim().catch(() => {
      // silent fallback: explicit heal action is still available in notifications page
    })
  }, [canWriteAudit, user?.admin_user_id, user?.username])

  useEffect(() => {
    if (!mobileNavPendingRef.current) {
      return
    }
    mobileNavPendingRef.current = false
    window.requestAnimationFrame(() => {
      runMobileTransition('content', 'İçeriğe geçiliyor...')
    })
  }, [location.pathname])

  useEffect(() => {
    return () => {
      clearMobileLoaderTimer()
    }
  }, [])

  return (
    <div className="admin-shell min-h-screen bg-slate-100 lg:grid lg:grid-cols-[228px_minmax(0,1fr)]">
      {showMobileNavLoader ? (
        <div className="mobile-nav-loader lg:hidden" role="status" aria-live="polite" aria-label="Sayfa geçişi">
          <div className="mobile-nav-loader-logo" aria-hidden="true">
            <div className="mobile-nav-loader-halo" />
            <div className="mobile-nav-loader-ring" />
            <div className="mobile-nav-loader-spark" />
            <div className="mobile-nav-loader-core">
              <span className="mobile-nav-loader-brand">YABUJIN</span>
              <span className="mobile-nav-loader-sub">CONTROL CORE</span>
            </div>
          </div>
          <p className="mobile-nav-loader-text">{mobileLoaderMessage}</p>
        </div>
      ) : null}

      <aside ref={sidebarRef} className="admin-sidebar flex flex-col px-3 py-6 text-slate-100 shadow-panel xl:px-4">
        <h1 className="px-2 text-xl font-bold tracking-tight">Puantaj Admin</h1>
        <p className="px-2 pt-1 text-xs text-slate-400">FastAPI Yönetim Paneli</p>
        <nav className="mt-6 flex flex-col gap-1">
          {visibleNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => handleMobileNavClick(item.to)}
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

      <div ref={contentRef} className="flex min-h-screen min-w-0 flex-col">
        <header className="admin-topbar border-b border-slate-200 bg-white/90 px-4 py-4 backdrop-blur sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
              <p className="text-xs text-slate-500">
                Oturum: {user?.username ?? user?.sub ?? 'admin'} / Rol: {user?.role ?? 'admin'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleMobileSidebarJump}
                className="btn-animated rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 lg:hidden"
              >
                Sidebar'a Git
              </button>
              <button
                type="button"
                onClick={() => void logout()}
                className="btn-animated rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
              >
                Çıkış
              </button>
            </div>
          </div>
        </header>

        <main className="admin-main min-w-0 flex-1 p-4 sm:p-6">
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
