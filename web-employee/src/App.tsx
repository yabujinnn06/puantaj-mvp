import { type ReactNode, useEffect } from 'react'
import { Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom'

import { BrandSignature } from './components/BrandSignature'
import { ClaimPage } from './pages/ClaimPage'
import { HomePage } from './pages/HomePage'
import { SettingsPage } from './pages/SettingsPage'
import { getStoredDeviceFingerprint } from './utils/device'

function EmployeeRouteGuard({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const hasDeviceFingerprint = Boolean(getStoredDeviceFingerprint())

  useEffect(() => {
    if (hasDeviceFingerprint) {
      return
    }

    const timer = window.setTimeout(() => {
      navigate('/claim', {
        replace: true,
        state: { from: `${location.pathname}${location.search}` },
      })
    }, 1200)

    return () => {
      window.clearTimeout(timer)
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
          <Link className="topbar-link" to="/claim">
            Aktivasyon
          </Link>
        </div>
        <div className="warn-box banner-warning">
          <p>
            <span className="banner-icon" aria-hidden="true">
              !
            </span>
            Cihaz bağlı değil. Aktivasyon linki ile cihazı bağlayın.
          </p>
        </div>
        <p className="muted">Aktivasyon ekranına yönlendiriliyorsunuz...</p>
        <div className="footer-link">
          <Link className="inline-link" to="/claim">
            Aktivasyon ekranına git
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
      <Route
        path="settings"
        element={
          <EmployeeRouteGuard>
            <SettingsPage />
          </EmployeeRouteGuard>
        }
      />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
