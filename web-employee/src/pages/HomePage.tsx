import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { checkin, checkout, getEmployeeStatus, parseApiError } from '../api/attendance'
import { BrandSignature } from '../components/BrandSignature'
import { QrScanner } from '../components/QrScanner'
import type { AttendanceActionResponse, EmployeeStatusResponse } from '../types/api'
import {
  flagLabel,
  formatTs,
  hasDuplicateFlag,
  locationStatusClass,
  locationStatusLabel,
  parseQrPayload,
  prettyFlagValue,
} from '../utils/attendance'
import { getStoredDeviceFingerprint } from '../utils/device'
import { getCurrentLocation } from '../utils/location'

type TodayStatus = EmployeeStatusResponse['today_status']

interface LastAction {
  siteId?: string
  response: AttendanceActionResponse
}

function eventTypeLabel(eventType: 'IN' | 'OUT'): string {
  return eventType === 'IN' ? 'Giriş' : 'Çıkış'
}

function todayStatusLabel(status: TodayStatus): string {
  if (status === 'IN_PROGRESS') return 'Mesai Devam Ediyor'
  if (status === 'FINISHED') return 'Bugün Tamamlandı'
  return 'Henüz Başlamadı'
}

function todayStatusHint(status: TodayStatus): string {
  if (status === 'IN_PROGRESS') {
    return 'Mesaiyi bitirerek bugünkü kaydı tamamlayın.'
  }
  if (status === 'FINISHED') {
    return 'Bugünkü giriş/çıkış tamamlandı. Yeni giriş yarın yapılabilir.'
  }
  return 'QR ile giriş yaparak mesaiyi başlatın.'
}

export function HomePage() {
  const [deviceFingerprint] = useState(() => getStoredDeviceFingerprint())
  const [scannerActive, setScannerActive] = useState(false)
  const [scannerError, setScannerError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pendingAction, setPendingAction] = useState<'checkin' | 'checkout' | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [locationWarning, setLocationWarning] = useState<string | null>(null)
  const [requestId, setRequestId] = useState<string | null>(null)
  const [lastAction, setLastAction] = useState<LastAction | null>(null)
  const [todayStatus, setTodayStatus] = useState<TodayStatus>('NOT_STARTED')
  const [statusSnapshot, setStatusSnapshot] = useState<EmployeeStatusResponse | null>(null)
  const [isHelpOpen, setIsHelpOpen] = useState(false)

  useEffect(() => {
    if (!deviceFingerprint) {
      setTodayStatus('NOT_STARTED')
      setStatusSnapshot(null)
      return
    }

    let cancelled = false
    const loadStatus = async () => {
      try {
        const statusData = await getEmployeeStatus(deviceFingerprint)
        if (!cancelled) {
          setStatusSnapshot(statusData)
          setTodayStatus(statusData.today_status)
        }
      } catch (error) {
        const parsed = parseApiError(error, 'Durum alınamadı.')
        if (!cancelled) {
          if (parsed.code === 'DEVICE_NOT_CLAIMED') {
            setTodayStatus('NOT_STARTED')
            setStatusSnapshot(null)
          } else {
            setStatusSnapshot(null)
          }
        }
      }
    }

    void loadStatus()
    return () => {
      cancelled = true
    }
  }, [deviceFingerprint, lastAction?.response.event_id])

  const hasOpenShift = useMemo(() => {
    if (!deviceFingerprint) {
      return false
    }
    if (typeof statusSnapshot?.has_open_shift === 'boolean') {
      return statusSnapshot.has_open_shift
    }
    return todayStatus === 'IN_PROGRESS'
  }, [deviceFingerprint, statusSnapshot?.has_open_shift, todayStatus])

  const openShiftCheckinTime = statusSnapshot?.last_checkin_time_utc ?? statusSnapshot?.last_in_ts ?? null

  const canCheckin = Boolean(deviceFingerprint) && !isSubmitting && todayStatus === 'NOT_STARTED' && !hasOpenShift
  const canCheckout = Boolean(deviceFingerprint) && !isSubmitting && hasOpenShift

  const currentHour = new Date().getHours()
  const shouldShowEveningReminder = useMemo(() => {
    if (currentHour < 17 || currentHour > 22) return false
    return hasOpenShift
  }, [currentHour, hasOpenShift])

  const runCheckinFromQr = async (rawQrValue: string) => {
    if (!deviceFingerprint) {
      setErrorMessage('Cihaz bağlı değil. Davet linkine tıklayın.')
      return
    }
    if (todayStatus !== 'NOT_STARTED' || hasOpenShift) {
      setErrorMessage(todayStatusHint(todayStatus))
      return
    }

    const payload = parseQrPayload(rawQrValue)
    if (!payload) {
      setErrorMessage(
        'QR formatı geçersiz. Desteklenen formatlar: {"site_id":"HQ","type":"IN"} veya site_id=HQ&type=IN',
      )
      setRequestId(null)
      return
    }
    if (payload.type !== 'IN') {
      setErrorMessage('Bu QR giriş için değil.')
      setRequestId(null)
      return
    }

    setIsSubmitting(true)
    setPendingAction('checkin')
    setErrorMessage(null)
    setLocationWarning(null)
    setRequestId(null)

    try {
      const locationResult = await getCurrentLocation()
      setLocationWarning(locationResult.warning)
      const response = await checkin({
        device_fingerprint: deviceFingerprint,
        qr: {
          type: 'IN',
          site_id: payload.site_id,
          shift_id: payload.shift_id,
        },
        lat: locationResult.location?.lat,
        lon: locationResult.location?.lon,
        accuracy_m: locationResult.location?.accuracy_m,
      })
      setLastAction({ siteId: payload.site_id, response })
      setTodayStatus('IN_PROGRESS')
      setStatusSnapshot((prev) => ({
        ...(prev ?? {
          employee_id: response.employee_id,
          today_status: 'IN_PROGRESS',
          last_in_ts: null,
          last_out_ts: null,
          last_location_status: null,
          last_flags: {},
        }),
        has_open_shift: true,
        today_status: 'IN_PROGRESS',
        last_in_ts: response.ts_utc,
        last_checkin_time_utc: response.ts_utc,
        last_location_status: response.location_status,
        last_flags: response.flags,
      }))
    } catch (error) {
      const parsed = parseApiError(error, 'Giriş kaydı oluşturulamadı.')
      setErrorMessage(parsed.message)
      setRequestId(parsed.requestId ?? null)
    } finally {
      setIsSubmitting(false)
      setPendingAction(null)
    }
  }

  const runCheckout = async () => {
    if (!deviceFingerprint) {
      setErrorMessage('Cihaz bağlı değil. Davet linkine tıklayın.')
      return
    }
    if (!hasOpenShift) {
      setErrorMessage(todayStatusHint(todayStatus))
      return
    }

    setIsSubmitting(true)
    setPendingAction('checkout')
    setErrorMessage(null)
    setLocationWarning(null)
    setRequestId(null)

    try {
      const locationResult = await getCurrentLocation()
      setLocationWarning(locationResult.warning)
      const response = await checkout({
        device_fingerprint: deviceFingerprint,
        lat: locationResult.location?.lat,
        lon: locationResult.location?.lon,
        accuracy_m: locationResult.location?.accuracy_m,
        manual: true,
      })
      setLastAction({ response })
      setTodayStatus('FINISHED')
      setStatusSnapshot((prev) => ({
        ...(prev ?? {
          employee_id: response.employee_id,
          today_status: 'FINISHED',
          last_in_ts: null,
          last_out_ts: null,
          last_location_status: null,
          last_flags: {},
        }),
        has_open_shift: false,
        today_status: 'FINISHED',
        last_out_ts: response.ts_utc,
        last_location_status: response.location_status,
        last_flags: response.flags,
      }))
    } catch (error) {
      const parsed = parseApiError(error, 'Mesai bitiş kaydı oluşturulamadı.')
      setErrorMessage(parsed.message)
      setRequestId(parsed.requestId ?? null)
    } finally {
      setIsSubmitting(false)
      setPendingAction(null)
    }
  }

  const resultMessage = useMemo(() => {
    if (!lastAction) return null

    const { response } = lastAction
    if (response.event_type === 'IN') {
      return {
        tone: 'success' as const,
        text: 'Giriş kaydedildi',
      }
    }

    if (response.location_status === 'VERIFIED_HOME') {
      return {
        tone: 'success' as const,
        text: 'Mesai bitiş kaydı alındı (konum doğrulandı)',
      }
    }

    return {
      tone: 'warning' as const,
      text: 'Mesai bitiş kaydı alındı.',
    }
  }, [lastAction])

  const duplicateDetected = lastAction !== null && hasDuplicateFlag(lastAction.response)
  const manualCheckout = lastAction?.response.flags.MANUAL_CHECKOUT === true

  return (
    <main className="phone-shell">
      <section className="phone-card">
        <div className="card-topbar">
          <div>
            <p className="chip">Çalışan Portalı</p>
            <h1>Puantaj İşlemleri</h1>
          </div>
        </div>

        <div className="status-row">
          <p className="small-title">Bugünkü durum</p>
          <span
            className={`status-pill ${
              todayStatus === 'FINISHED' ? 'state-ok' : todayStatus === 'IN_PROGRESS' ? 'state-warn' : 'state-err'
            }`}
          >
            {todayStatusLabel(todayStatus)}
          </span>
        </div>

        {hasOpenShift ? (
          <div className="notice-box notice-box-warning">
            <p>
              <span className="banner-icon" aria-hidden="true">
                !
              </span>
              Açık vardiya var, çıkış kaydı bekleniyor.
            </p>
            {openShiftCheckinTime ? <p className="small-text">Son giriş: {formatTs(openShiftCheckinTime)}</p> : null}
          </div>
        ) : null}

        <div className="status-cta-row">
          <button type="button" className="btn btn-ghost" onClick={() => setIsHelpOpen(true)}>
            Nasıl çalışır?
          </button>
        </div>

        {deviceFingerprint ? (
          <div className="device-box">
            <p className="muted small-text">Cihaz Parmak İzi: {deviceFingerprint}</p>
          </div>
        ) : (
          <div className="warn-box">
            <p>Cihaz bağlı değil. Davet linkine tıklayın.</p>
            <Link className="inline-link" to="/claim">
              /claim ekranına git
            </Link>
          </div>
        )}

        <div className="stack">
          <button
            type="button"
            className="btn btn-primary btn-lg"
            disabled={!canCheckin}
            onClick={() => {
              if (!canCheckin) {
                setErrorMessage(todayStatusHint(todayStatus))
                return
              }
              setScannerError(null)
              setScannerActive(true)
            }}
          >
            {isSubmitting && pendingAction === 'checkin' ? (
              <>
                <span className="inline-spinner" aria-hidden="true" />
                İşlem yapılıyor...
              </>
            ) : (
              'QR ile Giriş'
            )}
          </button>

          <button
            type="button"
            className="btn btn-outline btn-lg"
            disabled={!canCheckout}
            onClick={() => {
              setScannerActive(false)
              void runCheckout()
            }}
          >
            {isSubmitting && pendingAction === 'checkout' ? (
              <>
                <span className="inline-spinner inline-spinner-dark" aria-hidden="true" />
                İşlem yapılıyor...
              </>
            ) : (
              'Mesaiyi Bitir'
            )}
          </button>
        </div>

        <p className="muted small-text">{todayStatusHint(todayStatus)}</p>

        {shouldShowEveningReminder ? (
          <div className="notice-box notice-box-warning">
            <p>
              <span className="banner-icon" aria-hidden="true">
                !
              </span>
              Hatırlatma: Mesaiyi bitirmeyi unutmayın.
            </p>
          </div>
        ) : null}

        {scannerActive ? (
          <div className="scanner-card">
            <p className="scanner-title">QR okutmak için kodu kameraya tutun</p>
            <QrScanner
              active={scannerActive}
              onDetected={(raw) => {
                setScannerActive(false)
                void runCheckinFromQr(raw)
              }}
              onError={(message) => setScannerError(message)}
            />
            <button type="button" className="btn btn-soft" onClick={() => setScannerActive(false)}>
              Kamerayı Kapat
            </button>
          </div>
        ) : null}

        {scannerError ? (
          <div className="warn-box banner-warning">
            <p>
              <span className="banner-icon" aria-hidden="true">
                !
              </span>
              {scannerError}
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

        {resultMessage ? (
          <div className={`notice-box ${resultMessage.tone === 'success' ? 'notice-box-success' : 'notice-box-warning'}`}>
            <p>
              <span className="banner-icon" aria-hidden="true">
                {resultMessage.tone === 'success' ? '✓' : '!'}
              </span>
              {resultMessage.text}
            </p>
            {lastAction ? <p className="small-text">Konum durumu: {locationStatusLabel(lastAction.response.location_status)}</p> : null}
            <div className="chips">
              {duplicateDetected ? <span className="status-pill state-warn">Mükerrer kayıt</span> : null}
              {manualCheckout ? <span className="manual-badge">Manuel çıkış yapıldı</span> : null}
            </div>
          </div>
        ) : null}

        {lastAction ? (
          <section className="result-box">
            <h2>Son İşlem</h2>
            <p>
              event_type: <strong>{lastAction.response.event_type}</strong> ({eventTypeLabel(lastAction.response.event_type)})
            </p>
            {lastAction.siteId ? (
              <p>
                site_id: <strong>{lastAction.siteId}</strong>
              </p>
            ) : null}
            <p>
              ts_utc: <strong>{formatTs(lastAction.response.ts_utc)}</strong>
            </p>
            <p>
              location_status:{' '}
              <span className={`status-pill ${locationStatusClass(lastAction.response.location_status)}`}>
                {locationStatusLabel(lastAction.response.location_status)}
              </span>
            </p>

            <div className="stack-tight">
              <p className="small-title">Flags</p>
              {Object.keys(lastAction.response.flags).length === 0 ? (
                <p className="muted">Flag yok</p>
              ) : (
                <ul className="flag-list">
                  {Object.entries(lastAction.response.flags).map(([key, value]) => (
                    <li key={key}>
                      <strong>{flagLabel(key, value)}</strong>: {prettyFlagValue(value)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        ) : null}

        {isHelpOpen ? (
          <div className="modal-backdrop" role="dialog" aria-modal="true">
            <div className="help-modal">
              <h2>Mesai Bitiş Bilgilendirmesi</h2>
              <p>Gün içinde girişten sonra çıkışı mutlaka “Mesaiyi Bitir” ile tamamlayın.</p>
              <button type="button" className="btn btn-primary" onClick={() => setIsHelpOpen(false)}>
                Anladım
              </button>
            </div>
          </div>
        ) : null}

        <BrandSignature />
      </section>
    </main>
  )
}
