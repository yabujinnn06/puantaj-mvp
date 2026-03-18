import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { claimDevice, parseApiError } from '../api/attendance'
import { BrandSignature } from '../components/BrandSignature'
import {
  clearPendingClaimToken,
  getPendingClaimToken,
  setPendingClaimToken,
} from '../utils/claimToken'
import {
  getOrCreateDeviceFingerprint,
  getStoredDeviceFingerprint,
} from '../utils/device'

type ClaimState = 'idle' | 'loading' | 'success' | 'error'

export function ClaimPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const queryToken = (searchParams.get('token') ?? '').trim()

  const [claimState, setClaimState] = useState<ClaimState>('idle')
  const [tokenInput, setTokenInput] = useState<string>(() => queryToken || getPendingClaimToken())
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [requestId, setRequestId] = useState<string | null>(null)
  const autoAttemptedTokenRef = useRef<string>('')

  useEffect(() => {
    if (!queryToken) {
      return
    }
    setPendingClaimToken(queryToken)
    setTokenInput((prev) => (prev.trim() ? prev : queryToken))
  }, [queryToken])

  const activeToken = tokenInput.trim()

  const deviceFingerprint = useMemo(() => {
    const existing = getStoredDeviceFingerprint()
    if (existing) {
      return existing
    }
    if (!activeToken) {
      return ''
    }
    return getOrCreateDeviceFingerprint()
  }, [activeToken])

  const runClaim = useCallback(
    async (rawToken?: string) => {
      const token = (rawToken ?? tokenInput).trim()
      if (!token) {
        setClaimState('error')
        setErrorMessage('Claim token bulunamadi. Linkteki tokeni elle girin.')
        setRequestId(null)
        return
      }

      setPendingClaimToken(token)

      const fingerprint = deviceFingerprint || getOrCreateDeviceFingerprint()

      setClaimState('loading')
      setErrorMessage(null)
      setRequestId(null)

      try {
        await claimDevice({
          token,
          device_fingerprint: fingerprint,
        })

        clearPendingClaimToken()

        setClaimState('success')
        window.setTimeout(() => {
          navigate('/', { replace: true })
        }, 900)
      } catch (error) {
        const parsed = parseApiError(error, 'Cihaz baglama islemi basarisiz oldu.')
        setClaimState('error')
        setErrorMessage(parsed.message)
        setRequestId(parsed.requestId ?? null)
      }
    },
    [deviceFingerprint, navigate, tokenInput],
  )

  useEffect(() => {
    const autoToken = queryToken || getPendingClaimToken()
    if (!autoToken) {
      setClaimState('idle')
      return
    }
    if (autoAttemptedTokenRef.current === autoToken) {
      return
    }
    autoAttemptedTokenRef.current = autoToken
    setTokenInput(autoToken)
    void runClaim(autoToken)
  }, [queryToken, runClaim])

  return (
    <main className="phone-shell">
      <section className="phone-card">
        <div className="card-topbar">
          <div>
            <p className="chip">Cihaz Baglama</p>
            <h1>Cihaz Aktivasyonu</h1>
          </div>
          <Link className="topbar-link" to="/">
            Ana Sayfa
          </Link>
        </div>
        <p className="muted">Cihaz bu calisana baglanarak puantaj icin hazirlaniyor.</p>

        <div className="stack">
          <label className="field">
            <span>Claim Token</span>
            <input
              value={tokenInput}
              onChange={(event) => setTokenInput(event.target.value)}
              placeholder="token buraya"
            />
          </label>

          <label className="field">
            <span>Cihaz Parmak Izi</span>
            <input value={deviceFingerprint || '-'} readOnly />
          </label>

          <button
            type="button"
            className="btn btn-primary"
            disabled={claimState === 'loading' || !activeToken}
            onClick={() => void runClaim(activeToken)}
          >
            {claimState === 'loading' ? 'Baglaniyor...' : 'Cihazi Aktive Et'}
          </button>
        </div>

        {claimState === 'success' ? (
          <div className="notice-box notice-box-success">
            <p>
              <span className="banner-icon" aria-hidden="true">
                +
              </span>
              Cihaz basariyla baglandi
            </p>
            <p className="muted">Ana ekrana yonlendiriliyorsunuz...</p>
          </div>
        ) : null}

        {claimState === 'error' ? (
          <div className="error-box banner-error">
            <p>
              <span className="banner-icon" aria-hidden="true">
                !
              </span>
              {errorMessage ?? 'Cihaz baglama islemi basarisiz oldu.'}
            </p>
            {requestId ? <p className="request-id">request_id: {requestId}</p> : null}
          </div>
        ) : null}

        <div className="footer-link">
          <Link to="/recover">Passkey veya recovery code ile kurtarma dene</Link>
        </div>

        <BrandSignature />
      </section>
    </main>
  )
}
