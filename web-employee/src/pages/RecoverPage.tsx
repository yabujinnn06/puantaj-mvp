import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { startAuthentication } from '@simplewebauthn/browser'

import {
  getPasskeyRecoverOptions,
  parseApiError,
  recoverDeviceWithCode,
  verifyPasskeyRecover,
} from '../api/attendance'
import { BrandSignature } from '../components/BrandSignature'
import { setDeviceBinding, setStoredDeviceFingerprint } from '../utils/device'

export function RecoverPage() {
  const navigate = useNavigate()
  const [isPasskeyBusy, setIsPasskeyBusy] = useState(false)
  const [isCodeBusy, setIsCodeBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [requestId, setRequestId] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [employeeId, setEmployeeId] = useState('')
  const [recoveryPin, setRecoveryPin] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')

  const applyRecoveredDevice = (
    nextEmployeeId: number,
    nextDeviceId: number,
    nextFingerprint: string,
    successText: string,
  ) => {
    setStoredDeviceFingerprint(nextFingerprint)
    setDeviceBinding({
      employeeId: nextEmployeeId,
      deviceId: nextDeviceId,
      deviceFingerprint: nextFingerprint,
    })
    setSuccessMessage(successText)
    window.setTimeout(() => {
      navigate('/', { replace: true })
    }, 700)
  }

  const runPasskeyRecover = async () => {
    setIsPasskeyBusy(true)
    setErrorMessage(null)
    setRequestId(null)
    setSuccessMessage(null)

    try {
      if (!window.PublicKeyCredential) {
        throw new Error('Bu tarayici passkey (WebAuthn) desteklemiyor.')
      }

      const optionsData = await getPasskeyRecoverOptions()
      const assertion = await startAuthentication({
        optionsJSON: optionsData.options as unknown as Parameters<typeof startAuthentication>[0]['optionsJSON'],
      })

      const verifyData = await verifyPasskeyRecover({
        challenge_id: optionsData.challenge_id,
        credential: assertion as unknown as Record<string, unknown>,
      })

      applyRecoveredDevice(
        verifyData.employee_id,
        verifyData.device_id,
        verifyData.device_fingerprint,
        'Cihaz kimligi passkey ile geri yuklendi. Yonlendiriliyorsunuz...',
      )
    } catch (error) {
      const parsed = parseApiError(error, 'Passkey kurtarma islemi basarisiz oldu.')
      setErrorMessage(parsed.message)
      setRequestId(parsed.requestId ?? null)
    } finally {
      setIsPasskeyBusy(false)
    }
  }

  const runRecoveryCodeRecover = async () => {
    setIsCodeBusy(true)
    setErrorMessage(null)
    setRequestId(null)
    setSuccessMessage(null)

    try {
      const parsedEmployeeId = Number(employeeId)
      if (!Number.isInteger(parsedEmployeeId) || parsedEmployeeId <= 0) {
        throw new Error('Gecerli bir calisan ID girin.')
      }
      if (recoveryPin.trim().length < 6) {
        throw new Error('Recovery PIN en az 6 haneli olmali.')
      }
      if (recoveryCode.trim().length < 4) {
        throw new Error('Recovery code girin.')
      }

      const result = await recoverDeviceWithCode({
        employee_id: parsedEmployeeId,
        recovery_pin: recoveryPin.trim(),
        recovery_code: recoveryCode.trim(),
      })

      applyRecoveredDevice(
        result.employee_id,
        result.device_id,
        result.device_fingerprint,
        'Cihaz kimligi recovery code ile geri yuklendi. Yonlendiriliyorsunuz...',
      )
    } catch (error) {
      const parsed = parseApiError(error, 'Recovery code ile kurtarma basarisiz oldu.')
      setErrorMessage(parsed.message)
      setRequestId(parsed.requestId ?? null)
    } finally {
      setIsCodeBusy(false)
    }
  }

  return (
    <main className="phone-shell">
      <section className="phone-card">
        <div className="card-topbar">
          <div>
            <p className="chip">Cihaz Kurtarma</p>
            <h1>Passkey Zorunlu Degil</h1>
          </div>
          <Link className="topbar-link" to="/claim">
            Aktivasyon
          </Link>
        </div>

        <p className="muted">
          Tarayici verisi temizlendiyse cihaz parmak izi kaybolabilir. Kurtarma icin passkey kullanabilir veya
          daha once aldiginiz <strong>Recovery Code + PIN</strong> ile giris yapabilirsiniz.
        </p>

        <section className="stack mt-3">
          <button
            type="button"
            className="btn btn-primary btn-lg"
            disabled={isPasskeyBusy || isCodeBusy}
            onClick={() => void runPasskeyRecover()}
          >
            {isPasskeyBusy ? (
              <>
                <span className="inline-spinner" aria-hidden="true" />
                Dogrulaniyor...
              </>
            ) : (
              'Passkey ile Kurtar'
            )}
          </button>
        </section>

        <section className="stack mt-3">
          <label className="field" htmlFor="employeeIdInput">
            <span>Calisan ID</span>
            <input
              id="employeeIdInput"
              inputMode="numeric"
              value={employeeId}
              onChange={(event) => setEmployeeId(event.target.value)}
              placeholder="Orn: 42"
            />
          </label>

          <label className="field" htmlFor="recoveryPinInput">
            <span>Recovery PIN</span>
            <input
              id="recoveryPinInput"
              type="password"
              inputMode="numeric"
              value={recoveryPin}
              onChange={(event) => setRecoveryPin(event.target.value)}
              placeholder="6+ hane"
            />
          </label>

          <label className="field" htmlFor="recoveryCodeInput">
            <span>Recovery Code</span>
            <input
              id="recoveryCodeInput"
              value={recoveryCode}
              onChange={(event) => setRecoveryCode(event.target.value)}
              placeholder="Orn: AB3D-9K2M"
            />
          </label>

          <button
            type="button"
            className="btn btn-soft btn-lg"
            disabled={isCodeBusy || isPasskeyBusy}
            onClick={() => void runRecoveryCodeRecover()}
          >
            {isCodeBusy ? (
              <>
                <span className="inline-spinner" aria-hidden="true" />
                Dogrulaniyor...
              </>
            ) : (
              'Recovery Code ile Kurtar'
            )}
          </button>
        </section>

        <div className="stack mt-3">
          <Link className="btn btn-ghost btn-lg" to="/claim">
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
