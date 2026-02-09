import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { startAuthentication } from '@simplewebauthn/browser'

import { getPasskeyRecoverOptions, parseApiError, verifyPasskeyRecover } from '../api/attendance'
import { BrandSignature } from '../components/BrandSignature'
import { setDeviceBinding, setStoredDeviceFingerprint } from '../utils/device'

export function RecoverPage() {
  const navigate = useNavigate()
  const [isBusy, setIsBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [requestId, setRequestId] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const runRecover = async () => {
    setIsBusy(true)
    setErrorMessage(null)
    setRequestId(null)
    setSuccessMessage(null)

    try {
      if (!window.PublicKeyCredential) {
        throw new Error('Bu tarayıcı Passkey (WebAuthn) desteklemiyor.')
      }

      const optionsData = await getPasskeyRecoverOptions()
      const assertion = await startAuthentication({
        optionsJSON: optionsData.options as unknown as Parameters<typeof startAuthentication>[0]['optionsJSON'],
      })

      const verifyData = await verifyPasskeyRecover({
        challenge_id: optionsData.challenge_id,
        credential: assertion as unknown as Record<string, unknown>,
      })

      setStoredDeviceFingerprint(verifyData.device_fingerprint)
      setDeviceBinding({
        employeeId: verifyData.employee_id,
        deviceId: verifyData.device_id,
        deviceFingerprint: verifyData.device_fingerprint,
      })

      setSuccessMessage('Cihaz kimliği passkey ile geri yüklendi. Ana ekrana yönlendiriliyorsunuz...')
      window.setTimeout(() => {
        navigate('/', { replace: true })
      }, 700)
    } catch (error) {
      const parsed = parseApiError(error, 'Passkey kurtarma işlemi başarısız oldu.')
      setErrorMessage(parsed.message)
      setRequestId(parsed.requestId ?? null)
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <main className="phone-shell">
      <section className="phone-card">
        <div className="card-topbar">
          <div>
            <p className="chip">Cihaz Kurtarma</p>
            <h1>Passkey ile Geri Yükle</h1>
          </div>
          <Link className="topbar-link" to="/claim">
            Aktivasyon
          </Link>
        </div>

        <p className="muted">
          Tarayıcı verisi temizlendiyse cihaz parmak izi kaybolabilir. Daha önce kurduğun passkey ile cihaz
          kimliğini geri alabilirsin.
        </p>

        <div className="stack">
          <button type="button" className="btn btn-primary btn-lg" disabled={isBusy} onClick={() => void runRecover()}>
            {isBusy ? (
              <>
                <span className="inline-spinner" aria-hidden="true" />
                Doğrulanıyor...
              </>
            ) : (
              'Passkey ile Cihazı Geri Yükle'
            )}
          </button>

          <Link className="btn btn-soft btn-lg" to="/claim">
            Davet Linki ile Devam Et
          </Link>
        </div>

        {successMessage ? (
          <div className="notice-box notice-box-success mt-3">
            <p>{successMessage}</p>
          </div>
        ) : null}

        {errorMessage ? (
          <div className="error-box banner-error mt-3">
            <p>{errorMessage}</p>
            {requestId ? <p className="request-id">request_id: {requestId}</p> : null}
          </div>
        ) : null}

        <BrandSignature />
      </section>
    </main>
  )
}
