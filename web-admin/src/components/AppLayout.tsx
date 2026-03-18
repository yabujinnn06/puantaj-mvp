import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useCallback } from 'react'

import { getAdminPushConfig, healAdminDevice } from '../api/admin'
import {
  adminNavSections,
  adminPageTitles,
  type AdminNavItem,
} from '../config/adminNavigation'
import { UI_BRANDING } from '../config/ui'
import { useAuth } from '../hooks/useAuth'
import { urlBase64ToUint8Array } from '../utils/push'

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
  if (
    subscription &&
    savedVapidKey &&
    savedVapidKey !== pushConfig.vapid_public_key
  ) {
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
      applicationServerKey: urlBase64ToUint8Array(
        pushConfig.vapid_public_key,
      ) as unknown as BufferSource,
    })
  }

  await healAdminDevice({
    subscription: subscription.toJSON() as Record<string, unknown>,
    send_test: false,
  })
  window.localStorage.setItem(
    PUSH_VAPID_KEY_STORAGE,
    pushConfig.vapid_public_key,
  )
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
  const [mobileLoaderMessage, setMobileLoaderMessage] = useState(
    'İçeriğe geçiliyor...',
  )
  const canWriteNotifications = hasPermission('notifications', 'write')

  const visibleNavSections = adminNavSections
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => !item.permission || hasPermission(item.permission),
      ),
    }))
    .filter((section) => section.items.length > 0)
  const adminLogoUrl = `${import.meta.env.BASE_URL}admin-logo.svg`

  const title =
    adminPageTitles[location.pathname] ??
    (location.pathname.startsWith('/employees/')
      ? 'Çalışan Detayı'
      : 'Admin Panel')

  const isMobileViewport = () =>
    typeof window !== 'undefined' && window.innerWidth < 1024

  const isNavItemActive = (item: AdminNavItem) => {
    if (location.pathname === item.to) {
      return true
    }
    if (item.aliases?.includes(location.pathname)) {
      return true
    }
    return item.to !== '/' && location.pathname.startsWith(`${item.to}/`)
  }

  const getNavLinkClassName = (item: AdminNavItem) => {
    const isActive = isNavItemActive(item)
    return `admin-nav-link rounded-xl border px-3 py-2.5 text-sm font-medium tracking-tight transition duration-150 ${
      isActive
        ? 'border-white/10 bg-white/10 text-white shadow-[0_10px_24px_rgba(2,16,28,0.24)]'
        : 'border-transparent text-slate-300 hover:border-white/10 hover:bg-white/5 hover:text-white'
    }`
  }

  const clearMobileLoaderTimer = useCallback(() => {
    if (mobileLoaderTimerRef.current === null) {
      return
    }
    window.clearTimeout(mobileLoaderTimerRef.current)
    mobileLoaderTimerRef.current = null
  }, [])

  const runMobileTransition = useCallback(
    (target: 'content' | 'sidebar', label: string) => {
      setMobileLoaderMessage(label)
      setShowMobileNavLoader(true)
      if (target === 'content') {
        contentRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        })
      } else {
        sidebarRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        })
      }
      clearMobileLoaderTimer()
      mobileLoaderTimerRef.current = window.setTimeout(() => {
        setShowMobileNavLoader(false)
      }, 1200)
    },
    [clearMobileLoaderTimer],
  )

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
    if (!canWriteNotifications) {
      return
    }
    const lastAttemptRaw = window.sessionStorage.getItem(
      ADMIN_AUTO_HEAL_TS_STORAGE,
    )
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
  }, [canWriteNotifications, user?.admin_user_id, user?.username])

  useEffect(() => {
    if (!mobileNavPendingRef.current) {
      return
    }
    mobileNavPendingRef.current = false
    window.requestAnimationFrame(() => {
      runMobileTransition('content', 'İçeriğe geçiliyor...')
    })
  }, [location.pathname, runMobileTransition])

  useEffect(() => {
    return () => {
      clearMobileLoaderTimer()
    }
  }, [clearMobileLoaderTimer])

  return (
    <div className="admin-shell min-h-screen bg-slate-100 lg:grid lg:grid-cols-[228px_minmax(0,1fr)]">
      {showMobileNavLoader ? (
        <div
          className="mobile-nav-loader lg:hidden"
          role="status"
          aria-live="polite"
          aria-label="Sayfa geçişi"
        >
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

      <aside
        ref={sidebarRef}
        className="admin-sidebar flex flex-col px-3 py-6 text-slate-100 shadow-panel xl:px-4"
      >
        <div className="admin-brand px-2">
          <img
            src={adminLogoUrl}
            alt="Rainwater Yabujin admin logosu"
            className="admin-brand__mark"
          />
          <div className="min-w-0">
            <h1 className="admin-brand__title">Rainwater Yabujin</h1>
            <p className="admin-brand__subtitle">Yonetim Konsolu</p>
          </div>
        </div>
        <nav className="admin-nav mt-6" aria-label="Admin navigation">
          {visibleNavSections.map((section) => (
            <section
              key={section.key}
              className="admin-nav-section"
              aria-label={section.label}
            >
              <p className="admin-nav-section__label">{section.label}</p>
              <div className="flex flex-col gap-1">
                {section.items.map((item) => {
                  const isActive = isNavItemActive(item)
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={() => handleMobileNavClick(item.to)}
                      className={getNavLinkClassName(item)}
                      aria-current={isActive ? 'page' : undefined}
                    >
                      {item.label}
                    </NavLink>
                  )
                })}
              </div>
            </section>
          ))}
        </nav>
        {UI_BRANDING.showSignature ? (
          <div className="admin-signature">
            <p className="admin-signature-main">{UI_BRANDING.signatureText}</p>
            <p className="admin-signature-sub">
              {UI_BRANDING.signatureTagline}
            </p>
          </div>
        ) : null}
      </aside>

      <div ref={contentRef} className="flex min-h-screen min-w-0 flex-col">
        <header className="admin-topbar sticky top-0 z-10 border-b border-slate-200/80 bg-white/90 px-4 py-3 backdrop-blur sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-tight text-slate-900">
                {title}
              </h2>
              <p className="text-xs text-slate-500">
                Oturum: {user?.username ?? user?.sub ?? 'admin'} / Rol:{' '}
                {user?.role ?? 'admin'}
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
            <span className="admin-footer-brand">
              {UI_BRANDING.signatureText}
            </span>
            <span className="admin-footer-sub">
              {UI_BRANDING.signatureTagline}
            </span>
            <span className="admin-footer-build">
              BUILD: {UI_BRANDING.buildVersion}
            </span>
          </footer>
        ) : null}
      </div>
    </div>
  )
}
