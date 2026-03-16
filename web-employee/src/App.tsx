import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'

import { postEmployeeAppPresencePing, postEmployeeAppPresencePingKeepalive } from './api/attendance'
import { BrandSignature } from './components/BrandSignature'
import { ClaimPage } from './pages/ClaimPage'
import { HomePage } from './pages/HomePage'
import { RecoverPage } from './pages/RecoverPage'
import { getStoredDeviceFingerprint } from './utils/device'
import { getCachedLocation, getCurrentLocation } from './utils/location'

function EmployeeRouteGuard({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const hasDeviceFingerprint = Boolean(getStoredDeviceFingerprint())
  const queryToken = useMemo(
    () => (new URLSearchParams(location.search).get('token') ?? '').trim(),
    [location.search],
  )

  useEffect(() => {
    if (queryToken) {
      navigate(`/claim?token=${encodeURIComponent(queryToken)}`, { replace: true })
      return
    }

    if (hasDeviceFingerprint) {
      return
    }

    const recoverTimer = window.setTimeout(() => {
      navigate('/recover', {
        replace: true,
        state: { from: `${location.pathname}${location.search}` },
      })
    }, 150)

    return () => {
      window.clearTimeout(recoverTimer)
    }
  }, [hasDeviceFingerprint, location.pathname, location.search, navigate, queryToken])

  if (hasDeviceFingerprint) {
    return <>{children}</>
  }

  return (
    <main className="phone-shell">
      <section className="phone-card">
        <div className="card-topbar">
          <div>
            <p className="chip chip-warn">Uyarı</p>
            <h1>Cihaz Bağlantısı Gerekli</h1>
          </div>
          <Link className="topbar-link" to="/recover">
            Kurtarma
          </Link>
        </div>
        <div className="warn-box banner-warning">
          <p>
            <span className="banner-icon" aria-hidden="true">
              !
            </span>
            Cihaz bagli degil. Once passkey veya recovery code ile kurtarma deneyin, olmazsa aktivasyon linki kullanin.
          </p>
        </div>
        <p className="muted">Kurtarma ekranina yonlendiriliyorsunuz...</p>
        <div className="footer-link">
          <Link className="inline-link" to="/recover">
            Kurtarma ekranına git
          </Link>
        </div>
        <BrandSignature />
      </section>
    </main>
  )
}

function NotFoundPage() {
  return (
    <main className="phone-shell">
      <section className="phone-card">
        <div className="card-topbar">
          <div>
            <p className="chip chip-warn">Hata</p>
            <h1>Sayfa Bulunamadı</h1>
          </div>
          <Link className="topbar-link" to="/">
            Ana Sayfa
          </Link>
        </div>
        <p className="muted">Aradığınız ekran bu sürümde mevcut değil.</p>
        <BrandSignature />
      </section>
    </main>
  )
}

function EmployeePresenceTracker() {
  useEffect(() => {
    const deviceFingerprint = getStoredDeviceFingerprint()
    if (!deviceFingerprint) {
      return
    }

    const sessionKey = 'employee_app_presence_last_ping_at'
    const lastPingAtRaw = window.sessionStorage.getItem(sessionKey)
    if (lastPingAtRaw) {
      const lastPingAt = Number(lastPingAtRaw)
      if (Number.isFinite(lastPingAt) && Date.now() - lastPingAt < 15 * 60 * 1000) {
        return
      }
    }

    let cancelled = false
    void (async () => {
      const locationResult = await getCurrentLocation(5000)
      if (cancelled) {
        return
      }
      await postEmployeeAppPresencePing({
        device_fingerprint: deviceFingerprint,
        source: 'APP_OPEN',
        lat: locationResult.location?.lat,
        lon: locationResult.location?.lon,
        accuracy_m: locationResult.location?.accuracy_m ?? null,
      }).catch(() => undefined)
      if (!cancelled) {
        window.sessionStorage.setItem(sessionKey, String(Date.now()))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const deviceFingerprint = getStoredDeviceFingerprint()
    if (!deviceFingerprint || typeof window === 'undefined') {
      return
    }

    const handlePageHide = () => {
      const cachedLocation = getCachedLocation()
      void postEmployeeAppPresencePingKeepalive({
        device_fingerprint: deviceFingerprint,
        source: 'APP_CLOSE',
        lat: cachedLocation?.lat,
        lon: cachedLocation?.lon,
        accuracy_m: cachedLocation?.accuracy_m ?? null,
      })
    }

    window.addEventListener('pagehide', handlePageHide)
    return () => {
      window.removeEventListener('pagehide', handlePageHide)
    }
  }, [])

  return null
}

export default function App() {
  const [showBootLoader, setShowBootLoader] = useState(true)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setShowBootLoader(false)
    }, 3200)
    return () => {
      window.clearTimeout(timer)
    }
  }, [])

  return (
    <>
      <EmployeePresenceTracker />

      {showBootLoader ? (
        <div
          className="employee-boot-loader"
          role="status"
          aria-live="polite"
          aria-label="Uygulama açılıyor"
        >
          <div className="employee-boot-loader-center">
            <div className="employee-boot-loader-stage" aria-hidden="true">
              <div className="employee-boot-loader-shadow" />
              <div className="employee-boot-loader-nebula employee-boot-loader-nebula--back" />
              <div className="employee-boot-loader-nebula employee-boot-loader-nebula--front" />
              <div className="employee-boot-loader-aura" />
              <div className="employee-boot-loader-orbit employee-boot-loader-orbit--outer" />
              <div className="employee-boot-loader-orbit employee-boot-loader-orbit--mid" />
              <div className="employee-boot-loader-orbit employee-boot-loader-orbit--inner" />
              <div className="employee-boot-loader-orbit employee-boot-loader-orbit--polar" />
              <div className="employee-boot-loader-satellite employee-boot-loader-satellite--outer">
                <div className="employee-boot-loader-satellite-core" />
              </div>
              <div className="employee-boot-loader-satellite employee-boot-loader-satellite--mid">
                <div className="employee-boot-loader-satellite-core" />
              </div>
              <div className="employee-boot-loader-satellite employee-boot-loader-satellite--inner">
                <div className="employee-boot-loader-satellite-core" />
              </div>
              <div className="employee-boot-loader-logo">
                <div className="employee-boot-loader-logo-depth" />
                <div className="employee-boot-loader-logo-halo" />
                <div className="employee-boot-loader-ring employee-boot-loader-ring--back" />
                <div className="employee-boot-loader-core">
                  <span className="employee-boot-loader-monogram">Y</span>
                  <span className="employee-boot-loader-brand">YABUJIN</span>
                  <span className="employee-boot-loader-sub">EMPLOYEE CORE</span>
                </div>
                <div className="employee-boot-loader-ring employee-boot-loader-ring--front" />
                <div className="employee-boot-loader-spark employee-boot-loader-spark--a" />
                <div className="employee-boot-loader-spark employee-boot-loader-spark--b" />
              </div>
            </div>
            <p className="employee-boot-loader-text">Sistem hazırlanıyor...</p>
            <p className="employee-boot-loader-caption">Güvenli çalışma katmanı yükleniyor</p>
          </div>
        </div>
      ) : null}

      <Routes>
        <Route
          index
          element={
            <EmployeeRouteGuard>
              <HomePage />
            </EmployeeRouteGuard>
          }
        />
        <Route path="claim" element={<ClaimPage />} />
        <Route path="recover" element={<RecoverPage />} />
        <Route path="settings" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  )
}
