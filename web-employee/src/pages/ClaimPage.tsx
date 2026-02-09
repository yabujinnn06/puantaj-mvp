import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { claimDevice, parseApiError } from '../api/attendance'
import { BrandSignature } from '../components/BrandSignature'
import { getOrCreateDeviceFingerprint, setDeviceBinding } from '../utils/device'

type ClaimState = 'loading' | 'success' | 'error'

export function ClaimPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = (searchParams.get('token') ?? '').trim()

  const [claimState, setClaimState] = useState<ClaimState>('loading')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [requestId, setRequestId] = useState<string | null>(null)

  const deviceFingerprint = useMemo(() => getOrCreateDeviceFingerprint(), [])

  const runClaim = useCallback(async () => {
    if (!token) {
      setClaimState('error')
      setErrorMessage('Davet bağlantısında token bulunamadı.')
      setRequestId(null)
      return
    }

    setClaimState('loading')
    setErrorMessage(null)
    setRequestId(null)

    try {
      const result = await claimDevice({
        token,
        device_fingerprint: deviceFingerprint,
      })

      setDeviceBinding({
        employeeId: result.employee_id,
        deviceId: result.device_id,
        deviceFingerprint,
      })

      setClaimState('success')
      window.setTimeout(() => {
        navigate('/', { replace: true })
      }, 900)
    } catch (error) {
      const parsed = parseApiError(error, 'Cihaz bağlama işlemi başarısız oldu.')
      setClaimState('error')
      setErrorMessage(parsed.message)
      setRequestId(parsed.requestId ?? null)
    }
  }, [deviceFingerprint, navigate, token])

  useEffect(() => {
    void runClaim()
  }, [runClaim])

  return (
    <main className="phone-shell">
      <section className="phone-card">
        <div className="card-topbar">
          <div>
            <p className="chip">Cihaz Bağlama</p>
            <h1>Cihaz Aktivasyonu</h1>
          </div>
          <Link className="topbar-link" to="/">
            Ana Sayfa
          </Link>
        </div>
        <p className="muted">Cihaz bu çalışana bağlanarak puantaj için hazırlanıyor.</p>

        <div className="stack">
          <label className="field">
            <span>Cihaz Parmak İzi</span>
            <input value={deviceFingerprint} readOnly />
          </label>
        </div>

        {claimState === 'loading' ? (
          <div className="warn-box banner-warning">
            <p>
              <span className="inline-spinner inline-spinner-dark" aria-hidden="true" />
              <span className="banner-icon" aria-hidden="true">
                !
              </span>
              Cihaz bağlanıyor...
            </p>
          </div>
        ) : null}

        {claimState === 'success' ? (
          <div className="notice-box notice-box-success">
            <p>
              <span className="banner-icon" aria-hidden="true">
                ✓
              </span>
              Cihaz başarıyla bağlandı
            </p>
            <p className="muted">Ana ekrana yönlendiriliyorsunuz...</p>
          </div>
        ) : null}

        {claimState === 'error' ? (
          <div className="error-box banner-error">
            <p>
              <span className="banner-icon" aria-hidden="true">
                !
              </span>
              {errorMessage ?? 'Cihaz bağlama işlemi başarısız oldu.'}
            </p>
            {requestId ? <p className="request-id">request_id: {requestId}</p> : null}
            <div className="mt-3">
              <button type="button" className="btn btn-primary" onClick={() => void runClaim()}>
                Tekrar dene
              </button>
            </div>
          </div>
        ) : null}

        <div className="footer-link">
          <Link to="/">Ana ekrana dön</Link>
        </div>

        <BrandSignature />
      </section>
    </main>
  )
}
