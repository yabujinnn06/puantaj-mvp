import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

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
const PUSH_TEST_RETRYABLE_STATUS_CODES = new Set([404, 410])
const INSTALL_BANNER_DISMISS_UNTIL_STORAGE = 'pf_install_banner_dismiss_until'
const INSTALL_BANNER_DISMISS_MS = 1000 * 60 * 60 * 8
const IOS_INSTALL_ONBOARDING_SEEN_STORAGE = 'pf_ios_install_onboarding_seen'
const QrScanner = lazy(() =>
  import('../components/QrScanner').then((module) => ({ default: module.QrScanner })),
)

interface LastAction {
  codeValue?: string
  response: AttendanceActionResponse
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

function eventTypeLabel(eventType: 'IN' | 'OUT'): string {
  return eventType === 'IN' ? 'GiriÅŸ' : 'Ã‡Ä±kÄ±ÅŸ'
}

function todayStatusLabel(status: TodayStatus): string {
  if (status === 'IN_PROGRESS') return 'Mesai Devam Ediyor'
  if (status === 'FINISHED') return 'BugÃ¼n TamamlandÄ±'
  return 'HenÃ¼z BaÅŸlamadÄ±'
}

function todayStatusHint(status: TodayStatus): string {
  if (status === 'IN_PROGRESS') {
    return 'Mesaiyi bitirerek bugÃ¼nkÃ¼ kaydÄ± tamamlayÄ±n.'
  }
  if (status === 'FINISHED') {
    return 'BugÃ¼nkÃ¼ giriÅŸ/Ã§Ä±kÄ±ÅŸ tamamlandÄ±. Yeni bir vardiya iÃ§in yarÄ±nÄ± bekleyin.'
  }
  return 'QR ile giriÅŸ yaparak mesaiyi baÅŸlatÄ±n.'
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

function isSecurePushContext(): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  return Boolean(window.isSecureContext)
}

function isPushTestRetryable(statusCode: number | null | undefined): boolean {
  if (typeof statusCode !== 'number') {
    return false
  }
  return PUSH_TEST_RETRYABLE_STATUS_CODES.has(statusCode)
}

function formatPushTestFailureMessage(
  statusCode: number | null | undefined,
  rawError: string | null | undefined,
): string {
  if (statusCode === 410 || statusCode === 404) {
    return 'Bildirim aboneliÄŸi sÃ¼resi dolmuÅŸ. Abonelik otomatik yenilenirken hata oluÅŸtu, lÃ¼tfen tekrar deneyin.'
  }
  const statusPart = typeof statusCode === 'number' ? ` (status ${statusCode})` : ''
  const errorPart = rawError?.trim() ? ` ${rawError.trim()}` : ''
  return `Sunucu push testi baÅŸarÄ±sÄ±z${statusPart}.${errorPart}`.trim()
}

function getInstallBannerDismissUntil(): number {
  if (typeof window === 'undefined') {
    return 0
  }
  const raw = window.localStorage.getItem(INSTALL_BANNER_DISMISS_UNTIL_STORAGE)
  if (!raw) {
    return 0
  }
  const value = Number(raw)
  return Number.isFinite(value) ? value : 0
}

function isInstallBannerDismissed(): boolean {
  const dismissUntil = getInstallBannerDismissUntil()
  return dismissUntil > Date.now()
}

function hasSeenIosInstallOnboarding(): boolean {
  if (typeof window === 'undefined') {
    return true
  }
  return window.localStorage.getItem(IOS_INSTALL_ONBOARDING_SEEN_STORAGE) === '1'
}

function markIosInstallOnboardingSeen(): void {
  if (typeof window === 'undefined') {
    return
  }
  window.localStorage.setItem(IOS_INSTALL_ONBOARDING_SEEN_STORAGE, '1')
}

function playQrSuccessTone() {
  if (typeof window === 'undefined') {
    return
  }

  type WindowWithWebkitAudioContext = Window & {
    webkitAudioContext?: typeof AudioContext
  }
  const AudioContextCtor =
    window.AudioContext || (window as WindowWithWebkitAudioContext).webkitAudioContext
  if (!AudioContextCtor) {
    return
  }

  try {
    const audioContext = new AudioContextCtor()
    const oscillator = audioContext.createOscillator()
    const gainNode = audioContext.createGain()

    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(680, audioContext.currentTime)
    oscillator.frequency.exponentialRampToValueAtTime(1280, audioContext.currentTime + 0.18)

    gainNode.gain.setValueAtTime(0.0001, audioContext.currentTime)
    gainNode.gain.exponentialRampToValueAtTime(0.15, audioContext.currentTime + 0.02)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.26)

    oscillator.connect(gainNode)
    gainNode.connect(audioContext.destination)

    oscillator.start(audioContext.currentTime)
    oscillator.stop(audioContext.currentTime + 0.26)
    oscillator.onended = () => {
      void audioContext.close()
    }
  } catch {
    // Sessiz fallback: ses desteÄŸi yoksa iÅŸlem normal devam eder.
  }
}

export function HomePage() {
  const [deviceFingerprint] = useState(() => getStoredDeviceFingerprint())
  const [scannerActive, setScannerActive] = useState(false)
  const [scanSuccessFxOpen, setScanSuccessFxOpen] = useState(false)
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
  const [pushSecondChanceOpen, setPushSecondChanceOpen] = useState(false)
  const [pushGateDismissed, setPushGateDismissed] = useState(false)
  const [isStandaloneApp, setIsStandaloneApp] = useState(() => isStandaloneDisplayMode())
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [installBannerVisible, setInstallBannerVisible] = useState(false)
  const [isInstallPromptBusy, setIsInstallPromptBusy] = useState(false)
  const [installNotice, setInstallNotice] = useState<string | null>(null)
  const [iosInstallOnboardingOpen, setIosInstallOnboardingOpen] = useState(false)
  const [iosInstallOnboardingDismissed, setIosInstallOnboardingDismissed] = useState(() =>
    hasSeenIosInstallOnboarding(),
  )
  const scanSuccessFxTimerRef = useRef<number | null>(null)
  const actionPanelRef = useRef<HTMLElement | null>(null)
  const qrPanelAutoFocusDoneRef = useRef(false)

  const clearScanSuccessFxTimer = useCallback(() => {
    if (scanSuccessFxTimerRef.current !== null) {
      window.clearTimeout(scanSuccessFxTimerRef.current)
      scanSuccessFxTimerRef.current = null
    }
  }, [])

  const triggerScanSuccessFx = useCallback(() => {
    clearScanSuccessFxTimer()
    setScanSuccessFxOpen(true)
    playQrSuccessTone()
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate?.([30, 20, 45])
    }
    scanSuccessFxTimerRef.current = window.setTimeout(() => {
      setScanSuccessFxOpen(false)
      scanSuccessFxTimerRef.current = null
    }, 1500)
  }, [clearScanSuccessFxTimer])

  useEffect(() => {
    return () => {
      clearScanSuccessFxTimer()
    }
  }, [clearScanSuccessFxTimer])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const handleDisplayModeChange = () => {
      setIsStandaloneApp(isStandaloneDisplayMode())
    }
    const handleBeforeInstallPrompt = (event: Event) => {
      const promptEvent = event as BeforeInstallPromptEvent
      promptEvent.preventDefault()
      setInstallPromptEvent(promptEvent)
      if (!isInstallBannerDismissed() && !isStandaloneDisplayMode()) {
        setInstallBannerVisible(true)
      }
    }
    const handleAppInstalled = () => {
      setInstallPromptEvent(null)
      setInstallBannerVisible(false)
      setIosInstallOnboardingOpen(false)
      setIosInstallOnboardingDismissed(true)
      markIosInstallOnboardingSeen()
      setInstallNotice('Uygulama ana ekrana eklendi.')
      setIsStandaloneApp(true)
    }

    const displayModeMedia = window.matchMedia('(display-mode: standalone)')
    handleDisplayModeChange()

    if (typeof displayModeMedia.addEventListener === 'function') {
      displayModeMedia.addEventListener('change', handleDisplayModeChange)
    } else {
      displayModeMedia.addListener(handleDisplayModeChange)
    }
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt as EventListener)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      if (typeof displayModeMedia.removeEventListener === 'function') {
        displayModeMedia.removeEventListener('change', handleDisplayModeChange)
      } else {
        displayModeMedia.removeListener(handleDisplayModeChange)
      }
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt as EventListener)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  useEffect(() => {
    if (isStandaloneApp) {
      setInstallBannerVisible(false)
      setIosInstallOnboardingOpen(false)
      setIosInstallOnboardingDismissed(true)
      markIosInstallOnboardingSeen()
      return
    }
    if (isInstallBannerDismissed()) {
      return
    }
    if (installPromptEvent || isIosFamilyDevice()) {
      setInstallBannerVisible(true)
    }
  }, [installPromptEvent, isStandaloneApp])

  useEffect(() => {
    if (!isIosFamilyDevice() || isStandaloneApp) {
      setIosInstallOnboardingOpen(false)
      return
    }
    if (!iosInstallOnboardingDismissed) {
      setIosInstallOnboardingOpen(true)
    }
  }, [iosInstallOnboardingDismissed, isStandaloneApp])

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
        const parsed = parseApiError(error, 'Durum alÄ±namadÄ±.')
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
        setPushSecondChanceOpen(false)
        return
      }
      if (typeof window === 'undefined') {
        setPushRuntimeSupported(false)
        setPushEnabled(false)
        setPushRegistered(false)
        setPushNeedsResubscribe(false)
        setPushRequiresStandalone(false)
        setPushSecondChanceOpen(false)
        return
      }

      const runtimeSupported =
        isSecurePushContext() && 'serviceWorker' in navigator && 'PushManager' in window
      setPushRuntimeSupported(runtimeSupported)

      try {
        const config = await getEmployeePushConfig()
        const enabled = Boolean(config.enabled && config.vapid_public_key)
        setPushEnabled(enabled)
        if (!enabled) {
          setPushRegistered(false)
          setPushNeedsResubscribe(false)
          setPushRequiresStandalone(false)
          setPushSecondChanceOpen(false)
          return
        }

        const requiresStandalone = isIosFamilyDevice() && !isStandaloneDisplayMode()
        setPushRequiresStandalone(requiresStandalone)
        if (requiresStandalone || !runtimeSupported) {
          setPushRegistered(false)
          setPushNeedsResubscribe(false)
          setPushSecondChanceOpen(false)
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

        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          setPushSecondChanceOpen(false)
        }

        const registered = Boolean(existingSubscription && Notification.permission === 'granted')
        setPushRegistered(registered)
        if (registered) {
          setPushSecondChanceOpen(false)
        }

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
        setPushSecondChanceOpen(false)
      }
    },
    [deviceFingerprint],
  )

  useEffect(() => {
    void syncPushState(true)
  }, [syncPushState])

  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void syncPushState(true)
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [syncPushState])

  useEffect(() => {
    const gateRequired = Boolean(deviceFingerprint) && pushEnabled && !pushRegistered
    if (!gateRequired || isStandaloneApp) {
      setPushGateDismissed(false)
    }
  }, [deviceFingerprint, isStandaloneApp, pushEnabled, pushRegistered])

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
    Boolean(deviceFingerprint) && pushEnabled && !pushRegistered
  const pushGateCanBeDismissedForInstall =
    pushGateRequired && pushRequiresStandalone && !isStandaloneApp
  const showPushGateModal =
    pushGateRequired && (!pushGateCanBeDismissedForInstall || !pushGateDismissed)
  const canQrScan = Boolean(deviceFingerprint) && !isSubmitting && !pushGateRequired
  const canCheckout = Boolean(deviceFingerprint) && !isSubmitting && hasOpenShift && !pushGateRequired

  const currentHour = new Date().getHours()
  const shouldShowEveningReminder = useMemo(() => {
    if (currentHour < 17 || currentHour > 22) return false
    return hasOpenShift
  }, [currentHour, hasOpenShift])

  const dismissInstallBanner = useCallback(() => {
    setInstallBannerVisible(false)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(
        INSTALL_BANNER_DISMISS_UNTIL_STORAGE,
        String(Date.now() + INSTALL_BANNER_DISMISS_MS),
      )
    }
  }, [])

  const dismissIosInstallOnboarding = useCallback(() => {
    setIosInstallOnboardingOpen(false)
    setIosInstallOnboardingDismissed(true)
    markIosInstallOnboardingSeen()
  }, [])

  const openIosInstallOnboarding = useCallback(() => {
    setInstallNotice(null)
    setPushGateDismissed(true)
    setIosInstallOnboardingOpen(true)
  }, [])

  const runInstallPrompt = useCallback(async () => {
    setInstallNotice(null)

    if (isIosFamilyDevice() && !installPromptEvent) {
      setInstallNotice('Kurulum iÃ§in Safari paylaÅŸ menÃ¼sÃ¼nden "Ana Ekrana Ekle" adÄ±mÄ±nÄ± kullanÄ±n.')
      return
    }
    if (!installPromptEvent) {
      setInstallNotice('Bu tarayÄ±cÄ± otomatik kurulum penceresi sunmuyor.')
      return
    }

    setIsInstallPromptBusy(true)
    try {
      await installPromptEvent.prompt()
      const choice = await installPromptEvent.userChoice
      if (choice.outcome === 'accepted') {
        setInstallBannerVisible(false)
      }
    } catch {
      setInstallNotice('Kurulum penceresi aÃ§Ä±lamadÄ±. TarayÄ±cÄ± menÃ¼sÃ¼nden Ana Ekrana Ekle deneyin.')
    } finally {
      setInstallPromptEvent(null)
      setIsInstallPromptBusy(false)
    }
  }, [installPromptEvent])

  const installBannerEligible = useMemo(() => {
    if (isStandaloneApp) {
      return false
    }
    return Boolean(installPromptEvent) || isIosFamilyDevice()
  }, [installPromptEvent, isStandaloneApp])

  const showInstallBanner = installBannerVisible && installBannerEligible
  const showIosInstallOnboarding =
    iosInstallOnboardingOpen &&
    isIosFamilyDevice() &&
    !isStandaloneApp &&
    !scannerActive &&
    !isHelpOpen &&
    !showPushGateModal
  const showIosInstallDock =
    isIosFamilyDevice() &&
    !isStandaloneApp &&
    iosInstallOnboardingDismissed &&
    !iosInstallOnboardingOpen &&
    !scannerActive &&
    !isHelpOpen
  const installPrimaryLabel =
    isIosFamilyDevice() && !installPromptEvent ? 'Ana Ekrana Ekle' : 'UygulamayÄ± YÃ¼kle'
  const installBannerHint =
    isIosFamilyDevice() && !installPromptEvent
      ? 'Safari PaylaÅŸ menÃ¼sÃ¼nden Ana Ekrana Ekle adÄ±mÄ±yla hÄ±zlÄ± kurulum yapabilirsiniz.'
      : 'UygulamayÄ± ana ekrana ekleyerek daha stabil ve hÄ±zlÄ± kullanÄ±n.'

  useEffect(() => {
    if (qrPanelAutoFocusDoneRef.current || typeof window === 'undefined') {
      return
    }
    const isMobileViewport =
      typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 979px)').matches : true
    if (!isMobileViewport) {
      qrPanelAutoFocusDoneRef.current = true
      return
    }
    if (scannerActive || isHelpOpen || showPushGateModal || showIosInstallOnboarding) {
      return
    }

    const actionPanel = actionPanelRef.current
    if (!actionPanel) {
      return
    }

    qrPanelAutoFocusDoneRef.current = true
    const rect = actionPanel.getBoundingClientRect()
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight
    const fullyVisible = rect.top >= 0 && rect.bottom <= viewportHeight * 0.98
    if (!fullyVisible) {
      actionPanel.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [isHelpOpen, scannerActive, showIosInstallOnboarding, showPushGateModal])

  const runPasskeyRegistration = async () => {
    if (!deviceFingerprint) {
      setErrorMessage('Cihaz baÄŸlÄ± deÄŸil. Davet linkine tÄ±klayÄ±n.')
      return
    }

    setIsPasskeyBusy(true)
    setPasskeyNotice(null)
    setErrorMessage(null)
    setRequestId(null)

    try {
      if (!window.PublicKeyCredential) {
        throw new Error('Bu tarayÄ±cÄ± passkey (WebAuthn) desteklemiyor.')
      }

      const optionsData = await getPasskeyRegisterOptions({
        device_fingerprint: deviceFingerprint,
      })
      const { startRegistration } = await import('@simplewebauthn/browser')
      const credential = await startRegistration({
        optionsJSON: optionsData.options as unknown as Parameters<typeof startRegistration>[0]['optionsJSON'],
      })

      await verifyPasskeyRegistration({
        challenge_id: optionsData.challenge_id,
        credential: credential as unknown as Record<string, unknown>,
      })

      setStatusSnapshot((prev) => (prev ? { ...prev, passkey_registered: true } : prev))
      setPasskeyNotice('Passkey baÅŸarÄ±yla kaydedildi. Bu cihazÄ± daha gÃ¼venli kurtarabilirsin.')
    } catch (error) {
      const parsed = parseApiError(error, 'Passkey kaydÄ± baÅŸarÄ±sÄ±z oldu.')
      setErrorMessage(parsed.message)
      setRequestId(parsed.requestId ?? null)
    } finally {
      setIsPasskeyBusy(false)
    }
  }

  const runPushSubscription = async (isSecondAttempt = false) => {
    if (!deviceFingerprint) {
      setErrorMessage('Cihaz baÄŸlÄ± deÄŸil. Davet linkine tÄ±klayÄ±n.')
      return
    }
    if (pushRequiresStandalone) {
      setErrorMessage('iPhone/iPad iÃ§in bildirim sadece Ana Ekran uygulamasÄ±nda Ã§alÄ±ÅŸÄ±r. PortalÄ± ana ekran ikonundan aÃ§Ä±n.')
      return
    }

    if (!pushEnabled) {
      setErrorMessage('Bildirim servisi ÅŸu anda aktif deÄŸil. Ä°K yÃ¶neticisiyle iletiÅŸime geÃ§in.')
      return
    }
    if (!pushRuntimeSupported) {
      setErrorMessage('Bu tarayÄ±cÄ± bildirim altyapÄ±sÄ±nÄ± desteklemiyor veya gÃ¼venli baÄŸlantÄ± (HTTPS) yok.')
      return
    }
    if (
      typeof window === 'undefined' ||
      !isSecurePushContext() ||
      !('serviceWorker' in navigator) ||
      !('PushManager' in window)
    ) {
      setErrorMessage('Bu tarayÄ±cÄ± bildirim aboneliÄŸini desteklemiyor.')
      return
    }

    setIsPushBusy(true)
    setPushNotice(null)
    setErrorMessage(null)
    setRequestId(null)

    try {
      const notificationPermission =
        Notification.permission === 'default' || isSecondAttempt
          ? await Notification.requestPermission()
          : Notification.permission

      if (notificationPermission !== 'granted') {
        if (!isSecondAttempt) {
          setPushSecondChanceOpen(true)
          setPushNotice('Bildirimler zorunlu. Devam etmek iÃ§in bir kez daha izin istemeniz gerekiyor.')
          setErrorMessage('Bildirim izni verilmedi. â€œTekrar Sor (2/2)â€ butonu ile ikinci kez izin isteyin.')
          return
        }

        setPushSecondChanceOpen(false)
        throw new Error('Bildirim izni ikinci kez de verilmedi. Bildirim aÃ§Ä±lmadan sistem kullanÄ±lamaz.')
      }

      setPushSecondChanceOpen(false)

      const config = await getEmployeePushConfig()
      if (!config.enabled || !config.vapid_public_key) {
        throw new Error('Bildirim servisi ÅŸu anda aktif deÄŸil.')
      }
      const vapidPublicKey = config.vapid_public_key

      const registration = await navigator.serviceWorker.ready
      const savedVapidKey =
        typeof window !== 'undefined' ? window.localStorage.getItem(PUSH_VAPID_KEY_STORAGE) : null
      let subscription = await registration.pushManager.getSubscription()
      const ensureSubscription = async (forceRefresh: boolean): Promise<PushSubscription> => {
        let currentSubscription = subscription
        const hasVapidMismatch =
          Boolean(currentSubscription) &&
          Boolean(savedVapidKey) &&
          savedVapidKey !== vapidPublicKey

        if (currentSubscription && (forceRefresh || hasVapidMismatch)) {
          try {
            await currentSubscription.unsubscribe()
          } catch {
            // Abonelik zaten kopuk olabilir; yeni abonelik ile devam ediyoruz.
          }
          currentSubscription = null
        }

        if (!currentSubscription) {
          currentSubscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey:
              urlBase64ToUint8Array(vapidPublicKey) as unknown as BufferSource,
          })
        }

        subscription = currentSubscription
        return currentSubscription
      }

      let ensuredSubscription = await ensureSubscription(false)
      let subscribeResult = await subscribeEmployeePush({
        device_fingerprint: deviceFingerprint,
        subscription: ensuredSubscription.toJSON() as Record<string, unknown>,
        send_test: true,
      })

      if (subscribeResult.test_push_ok === false && isPushTestRetryable(subscribeResult.test_push_status_code)) {
        ensuredSubscription = await ensureSubscription(true)
        subscribeResult = await subscribeEmployeePush({
          device_fingerprint: deviceFingerprint,
          subscription: ensuredSubscription.toJSON() as Record<string, unknown>,
          send_test: true,
        })
      }

      if (subscribeResult.test_push_ok === false) {
        throw new Error(
          formatPushTestFailureMessage(
            subscribeResult.test_push_status_code,
            subscribeResult.test_push_error,
          ),
        )
      }

      // iOS dahil bazÄ± tarayÄ±cÄ±larda showNotification istemci tarafÄ±nda hata verebilir.
      // Bu adÄ±mÄ± non-fatal tutuyoruz; asÄ±l doÄŸrulama sunucu push testidir.
      try {
        await registration.showNotification('Puantaj Bildirimleri AÃ§Ä±ldÄ±', {
          body: 'Bildirim kanalÄ± aktif. ArtÄ±k sistem uyarÄ±larÄ±nÄ± alacaksÄ±nÄ±z.',
          icon: '/employee/icons/icon-192.png',
          badge: '/employee/icons/icon-192.png',
        })
      } catch {
        // no-op
      }

      window.localStorage.setItem(PUSH_VAPID_KEY_STORAGE, vapidPublicKey)
      setPushRegistered(true)
      setPushNeedsResubscribe(false)
      setPushNotice('Bildirimler bu cihazda etkinleÅŸtirildi.')
      setPushSecondChanceOpen(false)
      await syncPushState(true)
    } catch (error) {
      const parsed = parseApiError(error, 'Bildirim aboneliÄŸi oluÅŸturulamadÄ±.')
      setErrorMessage(parsed.message)
      setRequestId(parsed.requestId ?? null)
    } finally {
      setIsPushBusy(false)
    }
  }

  const runQrScan = async (rawQrValue: string) => {
    if (!deviceFingerprint) {
      setErrorMessage('Cihaz baÄŸlÄ± deÄŸil. Davet linkine tÄ±klayÄ±n.')
      return
    }
    const codeValue = rawQrValue.trim()
    if (!codeValue) {
      setErrorMessage('QR kod deÄŸeri boÅŸ olamaz.')
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
            'QR okutma iÅŸlemi iÃ§in konum izni gereklidir. LÃ¼tfen konumu aÃ§Ä±p tekrar deneyin.',
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
      triggerScanSuccessFx()
    } catch (error) {
      const parsed = parseApiError(error, 'QR iÅŸlemi tamamlanamadÄ±.')
      setErrorMessage(parsed.message)
      setRequestId(parsed.requestId ?? null)
    } finally {
      setIsSubmitting(false)
      setPendingAction(null)
    }
  }

  const runCheckout = async () => {
    if (!deviceFingerprint) {
      setErrorMessage('Cihaz baÄŸlÄ± deÄŸil. Davet linkine tÄ±klayÄ±n.')
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
      const parsed = parseApiError(error, 'Mesai bitiÅŸ kaydÄ± oluÅŸturulamadÄ±.')
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
        text: 'GiriÅŸ kaydedildi',
      }
    }

    return {
      tone: 'warning' as const,
      text: 'Mesai bitiÅŸ kaydÄ± alÄ±ndÄ±.',
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
      return 'iPhone/iPad bildirimleri Safari sekmesinde Ã§alÄ±ÅŸmaz. PortalÄ± Ana Ekran uygulamasÄ±ndan aÃ§Ä±p "Bildirimleri AÃ§" adÄ±mÄ±nÄ± tamamlayÄ±n.'
    }
    if (!pushRuntimeSupported) {
      return 'Bu tarayÄ±cÄ± bildirim altyapÄ±sÄ±nÄ± desteklemiyor veya baÄŸlantÄ± gÃ¼venli deÄŸil. Linki HTTPS altÄ±nda Safari (iOS) veya Chrome (Android) ile aÃ§Ä±n.'
    }
    if (pushNeedsResubscribe) {
      return 'Bildirim anahtarÄ± gÃ¼ncellendi. Devam etmek iÃ§in "Bildirimleri AÃ§" ile aboneliÄŸi yenileyin.'
    }
    if (!pushEnabled) {
      return 'Bildirim servisi sunucuda aktif deÄŸil. Ä°K yÃ¶neticisi ortam ayarlarÄ±nÄ± tamamlamalÄ±dÄ±r.'
    }
    if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
      return 'TarayÄ±cÄ± bildirim iznini reddetti. TarayÄ±cÄ± ayarlarÄ±ndan izin verip tekrar deneyin.'
    }
    return 'Bu portalda devam etmek iÃ§in bildirimleri aÃ§manÄ±z zorunludur.'
  }, [pushEnabled, pushNeedsResubscribe, pushRequiresStandalone, pushRuntimeSupported])

  const todayStatusClass = useMemo(() => {
    if (todayStatus === 'FINISHED') return 'state-ok'
    if (todayStatus === 'IN_PROGRESS') return 'state-warn'
    return 'state-err'
  }, [todayStatus])

  return (
    <main className="phone-shell">
      <section className="phone-card employee-home-card">
        <div className="card-topbar">
          <div>
            <p className="chip">Ã‡alÄ±ÅŸan PortalÄ±</p>
            <h1>Puantaj Ä°ÅŸlemleri</h1>
          </div>
          <Link className="topbar-link" to="/recover">
            Kurtarma
          </Link>
        </div>

        {showInstallBanner ? (
          <section className="install-banner" role="region" aria-label="Uygulama kurulumu">
            <div className="install-banner-copy">
              <p className="install-banner-kicker">YABUJIN APP</p>
              <p className="install-banner-title">Ana ekrana ekleyip uygulama gibi kullanÄ±n</p>
              <p className="install-banner-subtitle">{installBannerHint}</p>
            </div>
            <div className="install-banner-actions">
              <button
                type="button"
                className="btn btn-primary install-banner-btn"
                disabled={isInstallPromptBusy}
                onClick={() => void runInstallPrompt()}
              >
                {isInstallPromptBusy ? 'AÃ§Ä±lÄ±yor...' : installPrimaryLabel}
              </button>
              <button type="button" className="btn btn-ghost install-banner-dismiss" onClick={dismissInstallBanner}>
                Daha Sonra
              </button>
            </div>
          </section>
        ) : null}

        {showIosInstallDock ? (
          <div className="ios-install-dock" role="region" aria-label="Ana ekrana ekleme kisayolu">
            <div>
              <p className="ios-install-dock-title">Ana Ekrana Ekle</p>
              <p className="ios-install-dock-subtitle">Uygulama gibi kullanmak icin kurulumu tamamlayin.</p>
            </div>
            <button type="button" className="btn btn-soft ios-install-dock-btn" onClick={openIosInstallOnboarding}>
              Ana Ekrana Ekle
            </button>
          </div>
        ) : null}

        <div className="employee-workbench">
          <section className="employee-command-surface">
            <div className="employee-hero">
              <div className="employee-hero-copy">
                <p className="employee-hero-kicker">GÃ¼nlÃ¼k Ã‡alÄ±ÅŸma EkranÄ±</p>
                <h2 className="employee-hero-title">{todayStatusLabel(todayStatus)}</h2>
                <p className="employee-hero-subtitle">{todayStatusHint(todayStatus)}</p>
              </div>
              <span className={`employee-hero-indicator ${todayStatusClass}`}>CanlÄ±</span>
            </div>

            <div className="status-grid">
              <article className="status-card">
                <p className="small-title">BugÃ¼nkÃ¼ Durum</p>
                <span className={`status-pill ${todayStatusClass}`}>{todayStatusLabel(todayStatus)}</span>
              </article>

              <article className="status-card">
                <p className="small-title">Passkey Durumu</p>
                <span className={`status-pill ${passkeyRegistered ? 'state-ok' : 'state-warn'}`}>
                  {passkeyRegistered ? 'Kurulu' : 'Kurulu DeÄŸil'}
                </span>
              </article>

              <article className="status-card">
                <p className="small-title">Bildirim Durumu</p>
                <span
                  className={`status-pill ${
                    pushRegistered ? 'state-ok' : pushEnabled && pushRuntimeSupported ? 'state-warn' : 'state-err'
                  }`}
                >
                  {pushRegistered
                    ? 'AÃ§Ä±k'
                    : !pushRuntimeSupported
                      ? 'Destek Yok'
                      : pushEnabled
                        ? 'KapalÄ±'
                        : 'Servis KapalÄ±'}
                </span>
              </article>
            </div>

            {hasOpenShift ? (
              <div className="notice-box notice-box-warning">
                <p>
                  <span className="banner-icon" aria-hidden="true">
                    !
                  </span>
                  AÃ§Ä±k vardiya var, Ã§Ä±kÄ±ÅŸ kaydÄ± bekleniyor.
                </p>
                {openShiftCheckinTime ? <p className="small-text">Son giriÅŸ: {formatTs(openShiftCheckinTime)}</p> : null}
              </div>
            ) : null}

            {!passkeyRegistered ? (
              <section className="passkey-brief passkey-brief-setup" aria-live="polite">
                <p className="passkey-brief-kicker">GÃœVENLÄ°K ADIMI</p>
                <h3 className="passkey-brief-title">Passkey kurulumunu tamamlayÄ±n</h3>
                <p className="passkey-brief-text">
                  Cihaz verisi silinse bile hesabÄ±nÄ±zÄ± geri yÃ¼kleyip QR ile mesaiye kesintisiz devam edebilirsiniz.
                </p>
                <ul className="passkey-brief-list">
                  <li>TarayÄ±cÄ± verisi silinirse hesabÄ±nÄ±zÄ± geri kazanÄ±rsÄ±nÄ±z.</li>
                  <li>Åifre ezberlemeden biyometrik doÄŸrulama kullanÄ±rsÄ±nÄ±z.</li>
                  <li>Yeni cihazda kurtarma sÃ¼resi ciddi ÅŸekilde kÄ±salÄ±r.</li>
                </ul>
                <div className="passkey-brief-actions">
                  <button
                    type="button"
                    className="btn btn-primary passkey-brief-btn"
                    disabled={!deviceFingerprint || isPasskeyBusy || isSubmitting}
                    onClick={() => void runPasskeyRegistration()}
                  >
                    {isPasskeyBusy ? 'Passkey kuruluyor...' : 'Passkey Kur'}
                  </button>
                  <Link className="inline-link passkey-brief-link" to="/recover">
                    Kurtarma ekranÄ±nÄ± gÃ¶r
                  </Link>
                </div>
              </section>
            ) : (
              <section className="passkey-brief passkey-brief-ready">
                <p className="passkey-brief-kicker">PASSKEY AKTÄ°F</p>
                <p className="passkey-brief-text">
                  Cihaz verisi silinirse <strong>/recover</strong> ekranÄ± ile kimliÄŸini geri yÃ¼kleyebilirsin.
                </p>
              </section>
            )}

            <div className="status-cta-row status-cta-row-compact">
              <button type="button" className="btn btn-ghost" onClick={() => setIsHelpOpen(true)}>
                NasÄ±l Ã§alÄ±ÅŸÄ±r?
              </button>

              <button
                type="button"
                className="btn btn-soft"
                disabled={
                  !deviceFingerprint ||
                  isPushBusy ||
                  isSubmitting ||
                  pushRegistered ||
                  !pushEnabled ||
                  !pushRuntimeSupported
                }
                onClick={() => {
                  if (pushRequiresStandalone) {
                    openIosInstallOnboarding()
                    return
                  }
                  void runPushSubscription()
                }}
              >
                {isPushBusy
                  ? 'Bildirim aÃ§Ä±lÄ±yor...'
                  : pushRegistered
                    ? 'Bildirimler AÃ§Ä±k'
                    : pushRequiresStandalone
                      ? 'Ana Ekrana Ekle'
                      : 'Bildirimleri AÃ§'}
              </button>
            </div>
          </section>

          <section className="employee-action-surface">
            <section className="action-panel" ref={actionPanelRef}>
              <div className="action-panel-head">
                <p className="small-title">Komut Merkezi</p>
                <span className="action-panel-kicker">HÄ±zlÄ± Ä°ÅŸlemler</span>
              </div>
              <div className="stack">
                <button
                  type="button"
                  className="btn btn-primary btn-lg"
                  disabled={!canQrScan}
                  onClick={() => {
                    if (!canQrScan) {
                      setErrorMessage(pushGateRequired ? 'Ã–nce bildirimleri aÃ§manÄ±z gerekir.' : todayStatusHint(todayStatus))
                      return
                    }
                    setScannerError(null)
                    setScannerActive(true)
                  }}
                >
                  {isSubmitting && pendingAction === 'checkin' ? (
                    <>
                      <span className="inline-spinner" aria-hidden="true" />
                      Ä°ÅŸlem yapÄ±lÄ±yor...
                    </>
                  ) : (
                    'QR ile Ä°ÅŸlem BaÅŸlat'
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
                      Ä°ÅŸlem yapÄ±lÄ±yor...
                    </>
                  ) : (
                    'Mesaiyi GÃ¼venli Bitir'
                  )}
                </button>
              </div>

              <ol className="action-flow">
                <li>QR okutun ve iÅŸlemi baÅŸlatÄ±n.</li>
                <li>Mesai sonunda gÃ¼venli bitiÅŸ yapÄ±n.</li>
                <li>Durum kartlarÄ±ndan anlÄ±k takibi doÄŸrulayÄ±n.</li>
              </ol>

              <p className="muted small-text employee-flow-hint">
                {pushGateRequired
                  ? 'Devam etmek iÃ§in Ã¶nce bildirim adÄ±mÄ±nÄ± tamamlayÄ±n.'
                  : 'QR ile iÅŸlem baÅŸlatabilir veya aÃ§Ä±k vardiyayÄ± gÃ¼venli ÅŸekilde kapatabilirsiniz.'}
              </p>
            </section>

            {deviceFingerprint ? (
              <div className="device-box">
                <p className="muted small-text">Cihaz Parmak Ä°zi: {deviceFingerprint}</p>
              </div>
            ) : (
              <div className="warn-box">
                <p>Cihaz baÄŸlÄ± deÄŸil. Davet linkine tÄ±klayÄ±n.</p>
                <Link className="inline-link" to="/claim">
                  /claim ekranÄ±na git
                </Link>
                <p className="muted small-text mt-2">Daha once kurulum yaptiysan passkey ile kurtarma kullan.</p>
                <Link className="inline-link" to="/recover">
                  /recover ekranÄ±na git
                </Link>
              </div>
            )}
          </section>
        </div>

        {shouldShowEveningReminder ? (
          <div className="notice-box notice-box-warning">
            <p>
              <span className="banner-icon" aria-hidden="true">
                !
              </span>
              HatÄ±rlatma: Mesaiyi bitirmeyi unutmayÄ±n.
            </p>
          </div>
        ) : null}

        {scannerActive ? (
          <div
            className="modal-backdrop scanner-modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="QR tarama penceresi"
            onClick={() => setScannerActive(false)}
          >
            <section className="scanner-modal" onClick={(event) => event.stopPropagation()}>
              <div className="scanner-modal-head">
                <p className="scanner-modal-kicker">HÄ±zlÄ± QR Tarama</p>
                <button
                  type="button"
                  className="scanner-modal-close"
                  aria-label="QR tarama penceresini kapat"
                  onClick={() => setScannerActive(false)}
                >
                  Ã—
                </button>
              </div>
              <p className="scanner-title">QR kodu kameraya tutun</p>
              <p className="scanner-subtitle">
                Kod algÄ±landÄ±ÄŸÄ± anda puantaj iÅŸlemi otomatik baÅŸlatÄ±lÄ±r.
              </p>
              <Suspense fallback={<div className="scanner-overlay scanner-loading">Kamera modÃ¼lÃ¼ yÃ¼kleniyor...</div>}>
                <QrScanner
                  active={scannerActive}
                  onDetected={(raw) => {
                    setScannerActive(false)
                    void runQrScan(raw)
                  }}
                  onError={(message) => setScannerError(message)}
                />
              </Suspense>
              <div className="scanner-modal-actions">
                <button type="button" className="btn btn-soft" onClick={() => setScannerActive(false)}>
                  KamerayÄ± Kapat
                </button>
              </div>
            </section>
          </div>
        ) : null}

        {scanSuccessFxOpen ? (
          <div className="scan-success-overlay" role="status" aria-live="polite" aria-label="QR onaylandÄ±">
            <div className="scan-success-logo" aria-hidden="true">
              <div className="scan-success-halo" />
              <div className="scan-success-ring" />
              <div className="scan-success-spark" />
              <div className="scan-success-core">
                <span className="scan-success-brand">YABUJIN</span>
                <span className="scan-success-sub">ONAYLANDI</span>
              </div>
            </div>
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

        {installNotice ? (
          <div className="notice-box notice-box-warning mt-3">
            <p>{installNotice}</p>
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
                {resultMessage.tone === 'success' ? 'âœ“' : '!'}
              </span>
              {resultMessage.text}
            </p>
            <div className="chips">
              {duplicateDetected ? <span className="status-pill state-warn">MÃ¼kerrer kayÄ±t</span> : null}
              {manualCheckout ? <span className="manual-badge">Manuel Ã§Ä±kÄ±ÅŸ yapÄ±ldÄ±</span> : null}
            </div>
          </div>
        ) : null}

        {lastAction ? (
          <section className="result-box">
            <h2>Son Ä°ÅŸlem</h2>
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

        {showIosInstallOnboarding ? (
          <div className="modal-backdrop install-onboarding-backdrop" role="dialog" aria-modal="true">
            <div className="help-modal install-onboarding-modal">
              <p className="install-onboarding-kicker">IPHONE KURULUM</p>
              <h2>Ana Ekrana Ekle</h2>
              <p>Bu portali uygulama gibi kullanmak icin bir kez Ana Ekrana ekleyin.</p>
              <ol className="install-onboarding-list">
                <li>Safari altindaki Paylas ikonuna dokunun.</li>
                <li>Ana Ekrana Ekle secenegini secin.</li>
                <li>YABUJIN kisayolunu acip devam edin.</li>
              </ol>
              <div className="stack">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={isInstallPromptBusy}
                  onClick={() => void runInstallPrompt()}
                >
                  {isInstallPromptBusy ? 'Aciliyor...' : 'Ana Ekrana Ekle'}
                </button>
                <button type="button" className="btn btn-soft" onClick={dismissIosInstallOnboarding}>
                  Anladim
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {isHelpOpen ? (
          <div className="modal-backdrop" role="dialog" aria-modal="true">
            <div className="help-modal">
              <h2>Mesai BitiÅŸ Bilgilendirmesi</h2>
              <p>GÃ¼n iÃ§inde giriÅŸten sonra Ã§Ä±kÄ±ÅŸÄ± mutlaka "Mesaiyi Bitir" ile tamamlayÄ±n.</p>
              <button type="button" className="btn btn-primary" onClick={() => setIsHelpOpen(false)}>
                AnladÄ±m
              </button>
            </div>
          </div>
        ) : null}

        {showPushGateModal ? (
          <div className="modal-backdrop" role="dialog" aria-modal="true">
            <div className="help-modal">
              <h2>Bildirim Ä°zni Zorunlu</h2>
              <p>
                {pushSecondChanceOpen
                  ? 'Bildirim izni ilk denemede verilmedi. Bu Ã¶zellik sistemin zorunlu bir parÃ§asÄ±. LÃ¼tfen son kez izin verin.'
                  : pushGateMessage}
              </p>
              <div className="stack">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={isPushBusy || !pushEnabled || !pushRuntimeSupported}
                  onClick={() => {
                    if (pushRequiresStandalone) {
                      openIosInstallOnboarding()
                      return
                    }
                    void runPushSubscription(pushSecondChanceOpen)
                  }}
                >
                  {isPushBusy
                    ? 'Bildirim aÃ§Ä±lÄ±yor...'
                    : pushRequiresStandalone
                      ? 'Ana Ekrana Ekle'
                    : pushSecondChanceOpen
                      ? 'Tekrar Sor (2/2)'
                      : 'Bildirimleri AÃ§'}
                </button>
                <button
                  type="button"
                  className="btn btn-soft"
                  onClick={() => {
                    setPushSecondChanceOpen(false)
                    void syncPushState(true)
                  }}
                >
                  {pushSecondChanceOpen ? 'Bu Kez Kapat' : 'Durumu Yenile'}
                </button>
                {pushGateCanBeDismissedForInstall ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      setPushSecondChanceOpen(false)
                      setPushGateDismissed(true)
                    }}
                  >
                    Simdilik Kapat
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        <BrandSignature />
      </section>
    </main>
  )
}

