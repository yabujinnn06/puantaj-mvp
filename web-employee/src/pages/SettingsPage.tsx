import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { parseApiError, setEmployeeHomeLocation } from '../api/attendance'
import { BrandSignature } from '../components/BrandSignature'
import { getStoredDeviceFingerprint } from '../utils/device'
import { getCurrentLocation } from '../utils/location'

interface LocationPreview {
  lat: number
  lon: number
  accuracy_m: number
}

export function SettingsPage() {
  const navigate = useNavigate()
  const redirectTimerRef = useRef<number | null>(null)

  const [deviceFingerprint] = useState(() => getStoredDeviceFingerprint())
  const [radiusM, setRadiusM] = useState('300')
  const [consent, setConsent] = useState(false)
  const [preview, setPreview] = useState<LocationPreview | null>(null)
  const [isLocating, setIsLocating] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [locationWarning, setLocationWarning] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [requestId, setRequestId] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  useEffect(() => {
    return () => {
      if (redirectTimerRef.current !== null) {
        window.clearTimeout(redirectTimerRef.current)
      }
    }
  }, [])

  const fetchPreview = async () => {
    setErrorMessage(null)
    setRequestId(null)
    setSuccessMessage(null)
    setLocationWarning(null)

    if (!deviceFingerprint) {
      setErrorMessage('Cihaz bağlı değil. Lütfen davet linkine tıklayın.')
      return
    }

    setIsLocating(true)
    try {
      const locationResult = await getCurrentLocation()
      setLocationWarning(locationResult.warning)
      if (!locationResult.location) {
        setErrorMessage('Konum önizlemesi alınamadı. Konum iznini kontrol edin.')
        return
      }
      setPreview(locationResult.location)
    } finally {
      setIsLocating(false)
    }
  }

  const saveHomeLocation = async () => {
    setErrorMessage(null)
    setRequestId(null)
    setSuccessMessage(null)
    setLocationWarning(null)

    if (!deviceFingerprint) {
      setErrorMessage('Cihaz bağlı değil. Lütfen davet linkine tıklayın.')
      return
    }
    if (!preview) {
      setErrorMessage('Önce konum önizlemesini alın.')
      return
    }
    if (!consent) {
      setErrorMessage('Kaydetmek için açık rıza vermelisiniz.')
      return
    }

    const parsedRadius = Number(radiusM)
    if (!Number.isFinite(parsedRadius) || parsedRadius <= 0) {
      setErrorMessage('Yarıçap değeri geçersiz.')
      return
    }

    setIsSaving(true)
    try {
      const locationResult = await getCurrentLocation()
      setLocationWarning(locationResult.warning)
      if (!locationResult.location) {
        setErrorMessage('Konum alınamadı. Konum iznini kontrol edin.')
        return
      }

      setPreview(locationResult.location)
      await setEmployeeHomeLocation({
        device_fingerprint: deviceFingerprint,
        home_lat: locationResult.location.lat,
        home_lon: locationResult.location.lon,
        radius_m: Math.trunc(parsedRadius),
      })
      setSuccessMessage('Ev konumu kaydedildi')

      redirectTimerRef.current = window.setTimeout(() => {
        navigate('/', { replace: true })
      }, 1000)
    } catch (error) {
      const parsed = parseApiError(error, 'Ev konumu kaydedilemedi.')
      if (parsed.code === 'HOME_LOCATION_ALREADY_SET') {
        setErrorMessage('Ev konumu zaten kayıtlı. Değişiklik için İK ile iletişime geçin.')
      } else if (parsed.code === 'DEVICE_NOT_CLAIMED') {
        setErrorMessage('Cihaz bağlı değil. Lütfen davet linkine tıklayın.')
      } else {
        setErrorMessage(parsed.message)
      }
      setRequestId(parsed.requestId ?? null)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <main className="phone-shell">
      <section className="phone-card">
        <div className="card-topbar">
          <div>
            <p className="chip">Ayarlar</p>
            <h1>Ev Konumu</h1>
          </div>
          <Link className="topbar-link" to="/">
            Ana Sayfa
          </Link>
        </div>
        <p className="muted">Ev konumu puantajda konum doğrulaması için kullanılır.</p>

        {deviceFingerprint ? (
          <div className="device-box">
            <p className="muted small-text">Cihaz Parmak İzi: {deviceFingerprint}</p>
          </div>
        ) : (
          <div className="warn-box banner-warning">
            <p>
              <span className="banner-icon" aria-hidden="true">
                !
              </span>
              Cihaz bağlı değil. Lütfen davet linkine tıklayın.
            </p>
            <Link className="inline-link" to="/claim">
              /claim ekranına git
            </Link>
          </div>
        )}

        <div className="stack">
          <button
            type="button"
            className="btn btn-soft"
            disabled={!deviceFingerprint || isLocating || isSaving}
            onClick={() => void fetchPreview()}
          >
            {isLocating ? (
              <>
                <span className="inline-spinner inline-spinner-dark" aria-hidden="true" />
                Konum alınıyor...
              </>
            ) : (
              'Konum Önizle'
            )}
          </button>

          <label className="field">
            <span>Yarıçap (metre)</span>
            <select
              value={radiusM}
              onChange={(event) => setRadiusM(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              disabled={isSaving}
            >
              <option value="150">150 m</option>
              <option value="200">200 m</option>
              <option value="300">300 m</option>
              <option value="500">500 m</option>
            </select>
          </label>

          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
              disabled={isSaving}
              className="mt-1"
            />
            <span>Ev konumumun puantaj doğrulaması için kaydedilmesine açık rıza veriyorum.</span>
          </label>

          {!consent ? <p className="warn-text">Kaydetmek için açık rıza vermelisiniz.</p> : null}

          <button
            type="button"
            className="btn btn-primary"
            disabled={!deviceFingerprint || !preview || !consent || isSaving}
            onClick={() => void saveHomeLocation()}
          >
            {isSaving ? (
              <>
                <span className="inline-spinner" aria-hidden="true" />
                Kaydediliyor...
              </>
            ) : (
              'Ev Konumunu Kaydet'
            )}
          </button>
        </div>

        {preview ? (
          <div className="result-box">
            <h2>Konum Önizleme</h2>
            <p>
              Konum alındı: ({preview.lat.toFixed(6)}, {preview.lon.toFixed(6)}) ± {Math.round(preview.accuracy_m)} m
            </p>
          </div>
        ) : null}

        {locationWarning ? (
          <div className="warn-box banner-warning">
            <p>
              <span className="banner-icon" aria-hidden="true">
                !
              </span>
              {locationWarning}
            </p>
          </div>
        ) : null}

        {successMessage ? (
          <div className="notice-box notice-box-success">
            <p>
              <span className="banner-icon" aria-hidden="true">
                ✓
              </span>
              {successMessage}
            </p>
          </div>
        ) : null}

        {errorMessage ? (
          <div className="error-box banner-error">
            <p>
              <span className="banner-icon" aria-hidden="true">
                !
              </span>
              {errorMessage}
            </p>
            {requestId ? <p className="request-id">request_id: {requestId}</p> : null}
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
