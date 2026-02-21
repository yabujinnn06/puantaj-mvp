import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'

import { BrandSignature } from './components/BrandSignature'
import { ClaimPage } from './pages/ClaimPage'
import { HomePage } from './pages/HomePage'
import { RecoverPage } from './pages/RecoverPage'
import { getStoredDeviceFingerprint } from './utils/device'

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

export default function App() {
  const [showBootLoader, setShowBootLoader] = useState(true)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setShowBootLoader(false)
    }, 1250)
    return () => {
      window.clearTimeout(timer)
    }
  }, [])

  return (
    <>
      {showBootLoader ? (
        <div className="employee-boot-loader" role="status" aria-live="polite" aria-label="Uygulama açılıyor">
          <div className="employee-boot-loader-center">
            <div className="employee-boot-loader-logo" aria-hidden="true">
              <div className="employee-boot-loader-halo" />
              <div className="employee-boot-loader-ring" />
              <div className="employee-boot-loader-spark" />
              <div className="employee-boot-loader-core">
                <span className="employee-boot-loader-brand">YABUJIN</span>
                <span className="employee-boot-loader-sub">EMPLOYEE CORE</span>
              </div>
            </div>
            <p className="employee-boot-loader-text">Sistem hazırlanıyor...</p>
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
