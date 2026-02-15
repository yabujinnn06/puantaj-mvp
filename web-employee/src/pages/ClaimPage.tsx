import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { claimDevice, parseApiError } from '../api/attendance'
import { BrandSignature } from '../components/BrandSignature'
import {
  getOrCreateDeviceFingerprint,
  getStoredDeviceFingerprint,
  setDeviceBinding,
  setStoredDeviceFingerprint,
} from '../utils/device'

type ClaimState = 'idle' | 'loading' | 'success' | 'error'

const CLAIM_TOKEN_KEY = 'pf_pending_claim_token'
const CLAIM_TOKEN_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

function readClaimTokenCookie(): string {
  if (typeof document === 'undefined') {
    return ''
  }
  const target = `${CLAIM_TOKEN_KEY}=`
  for (const rawPart of document.cookie.split(';')) {
    const part = rawPart.trim()
    if (!part.startsWith(target)) {
      continue
    }
    const encodedValue = part.slice(target.length)
    if (!encodedValue) {
      return ''
    }
    try {
      return decodeURIComponent(encodedValue).trim()
    } catch {
      return encodedValue.trim()
    }
  }
  return ''
}

function writeClaimTokenCookie(token: string): void {
  if (typeof document === 'undefined') {
    return
  }
  const secure =
    typeof window !== 'undefined' && window.location.protocol === 'https:'
      ? ';secure'
      : ''
  document.cookie = `${CLAIM_TOKEN_KEY}=${encodeURIComponent(token)};path=/;max-age=${CLAIM_TOKEN_COOKIE_MAX_AGE_SECONDS};samesite=lax${secure}`
}

function clearClaimTokenCookie(): void {
  if (typeof document === 'undefined') {
    return
  }
  const secure =
    typeof window !== 'undefined' && window.location.protocol === 'https:'
      ? ';secure'
      : ''
  document.cookie = `${CLAIM_TOKEN_KEY}=;path=/;max-age=0;samesite=lax${secure}`
}

function getPendingClaimToken(): string {
  if (typeof window === 'undefined') {
    return ''
  }
  const fromStorage = (window.localStorage.getItem(CLAIM_TOKEN_KEY) ?? '').trim()
  if (fromStorage) {
    writeClaimTokenCookie(fromStorage)
    return fromStorage
  }
  const fromCookie = readClaimTokenCookie()
  if (fromCookie) {
    window.localStorage.setItem(CLAIM_TOKEN_KEY, fromCookie)
  }
  return fromCookie
}

function setPendingClaimToken(token: string): void {
  if (typeof window === 'undefined') {
    return
  }
  const normalized = token.trim()
  if (!normalized) {
    return
  }
  window.localStorage.setItem(CLAIM_TOKEN_KEY, normalized)
  writeClaimTokenCookie(normalized)
}

function clearPendingClaimToken(): void {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(CLAIM_TOKEN_KEY)
  }
  clearClaimTokenCookie()
}

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
      if (!deviceFingerprint) {
        setStoredDeviceFingerprint(fingerprint)
      }

      setClaimState('loading')
      setErrorMessage(null)
      setRequestId(null)

      try {
        const result = await claimDevice({
          token,
          device_fingerprint: fingerprint,
        })

        setStoredDeviceFingerprint(fingerprint)
        setDeviceBinding({
          employeeId: result.employee_id,
          deviceId: result.device_id,
          deviceFingerprint: fingerprint,
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
          <Link to="/recover">Passkey ile kurtarma dene</Link>
        </div>

        <BrandSignature />
      </section>
    </main>
  )
}
