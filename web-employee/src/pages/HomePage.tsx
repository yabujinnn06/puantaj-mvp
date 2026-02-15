import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { startRegistration } from '@simplewebauthn/browser'

import {
  checkout,
  getEmployeePushConfig,
  getEmployeeStatus,
  getPasskeyRegisterOptions,
  parseApiError,
  scanEmployeeQr,
  subscribeEmployeePush,
  verifyPasskeyRegistration,
} from '../api/attendance'
import { BrandSignature } from '../components/BrandSignature'
import { QrScanner } from '../components/QrScanner'
import type { AttendanceActionResponse, EmployeeStatusResponse } from '../types/api'
import {
  flagLabel,
  formatTs,
  hasDuplicateFlag,
  prettyFlagValue,
} from '../utils/attendance'
import { getStoredDeviceFingerprint } from '../utils/device'
import { getCurrentLocation } from '../utils/location'

type TodayStatus = EmployeeStatusResponse['today_status']
const PUSH_VAPID_KEY_STORAGE = 'pf_push_vapid_public_key'
const PUSH_REFRESH_ONCE_STORAGE = 'pf_push_refresh_once'

interface LastAction {
  codeValue?: string
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
    return 'Bugünkü giriş/çıkış tamamlandı. Yeni bir vardiya için yarını bekleyin.'
  }
  return 'QR ile giriş yaparak mesaiyi başlatın.'
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = `${base64String}${padding}`.replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index)
  }
  return outputArray
}

function isIosFamilyDevice(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }
  const ua = navigator.userAgent || ''
  if (/iPad|iPhone|iPod/i.test(ua)) {
    return true
  }
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

function isStandaloneDisplayMode(): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return Boolean(window.matchMedia('(display-mode: standalone)').matches || nav.standalone)
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

  const [isPasskeyBusy, setIsPasskeyBusy] = useState(false)
  const [passkeyNotice, setPasskeyNotice] = useState<string | null>(null)

  const [isPushBusy, setIsPushBusy] = useState(false)
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushRuntimeSupported, setPushRuntimeSupported] = useState(true)
  const [pushRegistered, setPushRegistered] = useState(false)
  const [pushNeedsResubscribe, setPushNeedsResubscribe] = useState(false)
  const [pushRequiresStandalone, setPushRequiresStandalone] = useState(false)
  const [pushNotice, setPushNotice] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    if (window.sessionStorage.getItem(PUSH_REFRESH_ONCE_STORAGE) === '1') {
      window.sessionStorage.removeItem(PUSH_REFRESH_ONCE_STORAGE)
    }
  }, [])

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
          }
        }
      }
    }

    void loadStatus()
    return () => {
      cancelled = true
    }
  }, [deviceFingerprint, lastAction?.response.event_id])

  const syncPushState = useCallback(
    async (attemptBackendSync: boolean) => {
      if (!deviceFingerprint) {
        setPushRuntimeSupported(true)
        setPushEnabled(false)
        setPushRegistered(false)
        setPushNeedsResubscribe(false)
        setPushRequiresStandalone(false)
        return
      }
      if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        setPushRuntimeSupported(false)
        setPushEnabled(false)
        setPushRegistered(false)
        setPushNeedsResubscribe(false)
        setPushRequiresStandalone(false)
        return
      }
      setPushRuntimeSupported(true)

      try {
        const config = await getEmployeePushConfig()
        const enabled = Boolean(config.enabled && config.vapid_public_key)
        setPushEnabled(enabled)
        if (!enabled) {
          setPushRegistered(false)
          setPushNeedsResubscribe(false)
          setPushRequiresStandalone(false)
          return
        }

        const requiresStandalone = isIosFamilyDevice() && !isStandaloneDisplayMode()
        setPushRequiresStandalone(requiresStandalone)
        if (requiresStandalone) {
          setPushRegistered(false)
          setPushNeedsResubscribe(false)
          return
        }

        const registration = await navigator.serviceWorker.ready
        const existingSubscription = await registration.pushManager.getSubscription()
        const savedVapidKey =
          typeof window !== 'undefined' ? window.localStorage.getItem(PUSH_VAPID_KEY_STORAGE) : null
        const vapidKeyMismatch =
          Boolean(savedVapidKey) &&
          Boolean(config.vapid_public_key) &&
          savedVapidKey !== config.vapid_public_key
        setPushNeedsResubscribe(vapidKeyMismatch)

        if (vapidKeyMismatch) {
          setPushRegistered(false)
          return
        }

        const registered = Boolean(existingSubscription && Notification.permission === 'granted')
        setPushRegistered(registered)

        if (registered && existingSubscription && attemptBackendSync) {
          await subscribeEmployeePush({
            device_fingerprint: deviceFingerprint,
            subscription: existingSubscription.toJSON() as Record<string, unknown>,
          })
          if (config.vapid_public_key) {
            window.localStorage.setItem(PUSH_VAPID_KEY_STORAGE, config.vapid_public_key)
          }
        }
      } catch {
        setPushEnabled(false)
        setPushRegistered(false)
        setPushNeedsResubscribe(false)
        setPushRequiresStandalone(false)
      }
    },
    [deviceFingerprint],
  )

  useEffect(() => {
    void syncPushState(true)
  }, [syncPushState])

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
  const passkeyRegistered = Boolean(statusSnapshot?.passkey_registered)

  const pushGateRequired =
    Boolean(deviceFingerprint) && pushRuntimeSupported && pushEnabled && !pushRegistered
  const canQrScan = Boolean(deviceFingerprint) && !isSubmitting && !pushGateRequired
  const canCheckout = Boolean(deviceFingerprint) && !isSubmitting && hasOpenShift && !pushGateRequired

  const currentHour = new Date().getHours()
  const shouldShowEveningReminder = useMemo(() => {
    if (currentHour < 17 || currentHour > 22) return false
    return hasOpenShift
  }, [currentHour, hasOpenShift])

  const runPasskeyRegistration = async () => {
    if (!deviceFingerprint) {
      setErrorMessage('Cihaz bağlı değil. Davet linkine tıklayın.')
      return
    }

    setIsPasskeyBusy(true)
    setPasskeyNotice(null)
    setErrorMessage(null)
    setRequestId(null)

    try {
      if (!window.PublicKeyCredential) {
        throw new Error('Bu tarayıcı passkey (WebAuthn) desteklemiyor.')
      }

      const optionsData = await getPasskeyRegisterOptions({
        device_fingerprint: deviceFingerprint,
      })
      const credential = await startRegistration({
        optionsJSON: optionsData.options as unknown as Parameters<typeof startRegistration>[0]['optionsJSON'],
      })

      await verifyPasskeyRegistration({
        challenge_id: optionsData.challenge_id,
        credential: credential as unknown as Record<string, unknown>,
      })

      setStatusSnapshot((prev) => (prev ? { ...prev, passkey_registered: true } : prev))
      setPasskeyNotice('Passkey başarıyla kaydedildi. Bu cihazı daha güvenli kurtarabilirsin.')
    } catch (error) {
      const parsed = parseApiError(error, 'Passkey kaydı başarısız oldu.')
      setErrorMessage(parsed.message)
      setRequestId(parsed.requestId ?? null)
    } finally {
      setIsPasskeyBusy(false)
    }
  }

  const runPushSubscription = async () => {
    if (!deviceFingerprint) {
      setErrorMessage('Cihaz bağlı değil. Davet linkine tıklayın.')
      return
    }
    if (pushRequiresStandalone) {
      setErrorMessage('iPhone/iPad icin bildirim sadece Ana Ekran uygulamasinda calisir. Portali anasayfa ikonundan acin.')
      return
    }

    if (!pushEnabled) {
      setErrorMessage('Bildirim servisi şu anda aktif değil. İK yöneticisiyle iletişime geçin.')
      return
    }
    if (!pushRuntimeSupported) {
      setErrorMessage('Bu tarayıcı bildirim altyapısını desteklemiyor. Linki Chrome/Safari ile açın.')
      return
    }
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setErrorMessage('Bu tarayıcı bildirim aboneliğini desteklemiyor.')
      return
    }

    setIsPushBusy(true)
    setPushNotice(null)
    setErrorMessage(null)
    setRequestId(null)

    try {
      const notificationPermission =
        Notification.permission === 'default'
          ? await Notification.requestPermission()
          : Notification.permission

      if (notificationPermission !== 'granted') {
        throw new Error('Bildirim izni verilmedi. Devam etmek için bildirimi açmanız zorunlu.')
      }

      const config = await getEmployeePushConfig()
      if (!config.enabled || !config.vapid_public_key) {
        throw new Error('Bildirim servisi şu anda aktif değil.')
      }

      const registration = await navigator.serviceWorker.ready
      const savedVapidKey =
        typeof window !== 'undefined' ? window.localStorage.getItem(PUSH_VAPID_KEY_STORAGE) : null
      let subscription = await registration.pushManager.getSubscription()
      if (subscription && savedVapidKey && savedVapidKey !== config.vapid_public_key) {
        try {
          await subscription.unsubscribe()
        } catch {
          // Eski abonelik kaldırılamasa bile yeniden subscribe denemesi yapacağız.
        }
        subscription = null
      }
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey:
            urlBase64ToUint8Array(config.vapid_public_key) as unknown as BufferSource,
        })
      }

      const subscribeResult = await subscribeEmployeePush({
        device_fingerprint: deviceFingerprint,
        subscription: subscription.toJSON() as Record<string, unknown>,
        send_test: true,
      })
      if (subscribeResult.test_push_ok === false) {
        const statusPart =
          typeof subscribeResult.test_push_status_code === 'number'
            ? ` (status ${subscribeResult.test_push_status_code})`
            : ''
        const errorPart = subscribeResult.test_push_error?.trim()
          ? ` ${subscribeResult.test_push_error.trim()}`
          : ''
        throw new Error(`Sunucu push testi basarisiz${statusPart}.${errorPart}`.trim())
      }

      // Lokal doğrulama bildirimi (sunucu push testini beklemeden izin/abonelik kontrolü)
      await registration.showNotification('Puantaj Bildirimleri Açıldı', {
        body: 'Bildirim kanalı aktif. Artık sistem uyarılarını alacaksınız.',
        icon: '/employee/icons/icon-192.svg',
      })

      window.localStorage.setItem(PUSH_VAPID_KEY_STORAGE, config.vapid_public_key)
      setPushRegistered(true)
      setPushNeedsResubscribe(false)
      setPushNotice('Bildirimler bu cihazda etkinleştirildi.')
      await syncPushState(true)
      if (typeof window !== 'undefined') {
        const refreshedBefore = window.sessionStorage.getItem(PUSH_REFRESH_ONCE_STORAGE) === '1'
        if (!refreshedBefore) {
          window.sessionStorage.setItem(PUSH_REFRESH_ONCE_STORAGE, '1')
          window.setTimeout(() => {
            window.location.reload()
          }, 250)
          return
        }
      }
    } catch (error) {
      const parsed = parseApiError(error, 'Bildirim aboneliği oluşturulamadı.')
      setErrorMessage(parsed.message)
      setRequestId(parsed.requestId ?? null)
    } finally {
      setIsPushBusy(false)
    }
  }

  const runQrScan = async (rawQrValue: string) => {
    if (!deviceFingerprint) {
      setErrorMessage('Cihaz bağlı değil. Davet linkine tıklayın.')
      return
    }
    const codeValue = rawQrValue.trim()
    if (!codeValue) {
      setErrorMessage('QR kod değeri boş olamaz.')
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
      if (!locationResult.location) {
        setErrorMessage(
          locationResult.warning ??
            'QR okutma işlemi için konum izni gereklidir. Lütfen konumu açıp tekrar deneyin.',
        )
        return
      }

      const response = await scanEmployeeQr({
        code_value: codeValue,
        device_fingerprint: deviceFingerprint,
        lat: locationResult.location.lat,
        lon: locationResult.location.lon,
        accuracy_m: locationResult.location.accuracy_m,
      })
      const nextStatus: TodayStatus = response.event_type === 'IN' ? 'IN_PROGRESS' : 'FINISHED'
      setLastAction({ codeValue, response })
      setTodayStatus(nextStatus)
      setStatusSnapshot((prev) => ({
        ...(prev ?? {
          employee_id: response.employee_id,
          today_status: nextStatus,
          last_in_ts: null,
          last_out_ts: null,
          last_location_status: null,
          last_flags: {},
        }),
        has_open_shift: response.event_type === 'IN',
        today_status: nextStatus,
        last_in_ts: response.event_type === 'IN' ? response.ts_utc : (prev?.last_in_ts ?? null),
        last_out_ts: response.event_type === 'OUT' ? response.ts_utc : (prev?.last_out_ts ?? null),
        last_checkin_time_utc:
          response.event_type === 'IN' ? response.ts_utc : (prev?.last_checkin_time_utc ?? null),
        last_location_status: response.location_status,
        last_flags: response.flags,
      }))
    } catch (error) {
      const parsed = parseApiError(error, 'QR işlemi tamamlanamadı.')
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

    return {
      tone: 'warning' as const,
      text: 'Mesai bitiş kaydı alındı.',
    }
  }, [lastAction])

  const duplicateDetected = lastAction !== null && hasDuplicateFlag(lastAction.response)
  const manualCheckout = lastAction?.response.flags.MANUAL_CHECKOUT === true
  const visibleFlags = useMemo(() => {
    if (!lastAction) return []
    return Object.entries(lastAction.response.flags).filter(([key, value]) => {
      if (key === 'home_location_not_set') return false
      if (key === 'reason' && value === 'home_location_not_set') return false
      return true
    })
  }, [lastAction])

  const pushGateMessage = useMemo(() => {
    if (pushRequiresStandalone) {
      return 'iPhone/iPad bildirimleri Safari sekmesinde calismaz. Portali Ana Ekran uygulamasindan acip Bildirimleri Ac adimini tamamlayin.'
    }
    if (!pushRuntimeSupported) {
      return 'Bu tarayıcı bildirim altyapısını desteklemiyor. Linki Chrome (Android) veya Safari (iOS) ile açın.'
    }
    if (pushNeedsResubscribe) {
      return 'Bildirim anahtarı güncellendi. Devam etmek için “Bildirimleri Aç” ile aboneliği yenileyin.'
    }
    if (!pushEnabled) {
      return 'Bildirim servisi sunucuda aktif değil. İK yöneticisi ortam ayarlarını tamamlamalıdır.'
    }
    if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
      return 'Tarayıcı bildirim iznini reddetti. Ayarlardan izin verip tekrar deneyin.'
    }
    return 'Bu portalde devam etmek için bildirimleri açmanız zorunludur.'
  }, [pushEnabled, pushNeedsResubscribe, pushRequiresStandalone, pushRuntimeSupported])

  return (
    <main className="phone-shell">
      <section className="phone-card">
        <div className="card-topbar">
          <div>
            <p className="chip">Çalışan Portalı</p>
            <h1>Puantaj İşlemleri</h1>
          </div>
          <Link className="topbar-link" to="/recover">
            Kurtarma
          </Link>
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

        <div className="status-row">
          <p className="small-title">Passkey durumu</p>
          <span className={`status-pill ${passkeyRegistered ? 'state-ok' : 'state-warn'}`}>
            {passkeyRegistered ? 'Kurulu' : 'Kurulu Değil'}
          </span>
        </div>

        <div className="status-row">
          <p className="small-title">Bildirim durumu</p>
          <span
            className={`status-pill ${
              pushRegistered ? 'state-ok' : pushEnabled && pushRuntimeSupported ? 'state-warn' : 'state-err'
            }`}
          >
            {pushRegistered ? 'Açık' : !pushRuntimeSupported ? 'Destek Yok' : pushEnabled ? 'Kapalı' : 'Servis Kapalı'}
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
          {!passkeyRegistered ? (
            <button
              type="button"
              className="btn btn-soft"
              disabled={!deviceFingerprint || isPasskeyBusy || isSubmitting}
              onClick={() => void runPasskeyRegistration()}
            >
              {isPasskeyBusy ? 'Passkey kuruluyor...' : 'Passkey Kur'}
            </button>
          ) : null}

          <button type="button" className="btn btn-ghost" onClick={() => setIsHelpOpen(true)}>
            Nasıl çalışır?
          </button>

          <button
            type="button"
            className="btn btn-soft"
            disabled={!deviceFingerprint || isPushBusy || isSubmitting || pushRegistered || !pushEnabled}
            onClick={() => void runPushSubscription()}
          >
            {isPushBusy ? 'Bildirim açılıyor...' : pushRegistered ? 'Bildirimler Açık' : 'Bildirimleri Aç'}
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
            <p className="muted small-text mt-2">Daha once kurulum yaptiysan passkey ile kurtarma kullan.</p>
            <Link className="inline-link" to="/recover">
              /recover ekranına git
            </Link>
          </div>
        )}

        <div className="stack">
          <button
            type="button"
            className="btn btn-primary btn-lg"
            disabled={!canQrScan}
            onClick={() => {
              if (!canQrScan) {
                setErrorMessage(pushGateRequired ? 'Önce bildirimleri açmanız gerekir.' : todayStatusHint(todayStatus))
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
              'QR ile Giriş/Çıkış'
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
                void runQrScan(raw)
              }}
              onError={(message) => setScannerError(message)}
            />
            <button type="button" className="btn btn-soft" onClick={() => setScannerActive(false)}>
              Kamerayı Kapat
            </button>
          </div>
        ) : null}

        {passkeyNotice ? (
          <div className="notice-box notice-box-success mt-3">
            <p>{passkeyNotice}</p>
          </div>
        ) : null}

        {pushNotice ? (
          <div className="notice-box notice-box-success mt-3">
            <p>{pushNotice}</p>
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
            {lastAction.codeValue ? (
              <p>
                code_value: <strong>{lastAction.codeValue}</strong>
              </p>
            ) : null}
            <p>
              ts_utc: <strong>{formatTs(lastAction.response.ts_utc)}</strong>
            </p>

            <div className="stack-tight">
              <p className="small-title">Flags</p>
              {visibleFlags.length === 0 ? (
                <p className="muted">Flag yok</p>
              ) : (
                <ul className="flag-list">
                  {visibleFlags.map(([key, value]) => (
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

        {pushGateRequired ? (
          <div className="modal-backdrop" role="dialog" aria-modal="true">
            <div className="help-modal">
              <h2>Bildirim İzni Zorunlu</h2>
              <p>{pushGateMessage}</p>
              <div className="stack">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={isPushBusy || !pushEnabled}
                  onClick={() => void runPushSubscription()}
                >
                  {isPushBusy ? 'Bildirim açılıyor...' : 'Bildirimleri Aç'}
                </button>
                <button
                  type="button"
                  className="btn btn-soft"
                  onClick={() => void syncPushState(true)}
                >
                  Durumu Yenile
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <BrandSignature />
      </section>
    </main>
  )
}

