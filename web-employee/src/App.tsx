import { type ReactNode, useEffect } from 'react'
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

  useEffect(() => {
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
  }, [hasDeviceFingerprint, location.pathname, location.search, navigate])

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
            Cihaz bağlı değil. Önce passkey kurtarma deneyin, olmazsa aktivasyon linki kullanın.
          </p>
        </div>
        <p className="muted">Passkey kurtarma ekranına yönlendiriliyorsunuz...</p>
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
  return (
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
  )
}
