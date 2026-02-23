import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  checkout,
  getEmployeePushConfig,
  getRecoveryCodeStatus,
  getEmployeeStatus,
  getPasskeyRegisterOptions,
  issueRecoveryCodes,
  postEmployeeInstallFunnelEvent,
  parseApiError,
  scanEmployeeQr,
  subscribeEmployeePush,
  verifyPasskeyRegistration,
  type ParsedApiError,
} from '../api/attendance'
import { BrandSignature } from '../components/BrandSignature'
import type { AttendanceActionResponse, EmployeeStatusResponse } from '../types/api'
import {
  flagLabel,
  formatTs,
  hasDuplicateFlag,
  prettyFlagValue,
} from '../utils/attendance'
import { clearStoredDeviceFingerprint, getStoredDeviceFingerprint } from '../utils/device'
import { getCurrentLocation } from '../utils/location'

type TodayStatus = EmployeeStatusResponse['today_status']
const PUSH_VAPID_KEY_STORAGE = 'pf_push_vapid_public_key'
const PUSH_TEST_RETRYABLE_STATUS_CODES = new Set([404, 410])
const INSTALL_BANNER_DISMISS_UNTIL_STORAGE = 'pf_install_banner_dismiss_until'
const INSTALL_BANNER_DISMISS_MS = 1000 * 60 * 60 * 24
const IOS_INSTALL_ONBOARDING_SEEN_STORAGE = 'pf_ios_install_onboarding_seen'
const IOS_INSTALL_ONBOARDING_DISMISS_UNTIL_STORAGE = 'pf_ios_install_onboarding_dismiss_until'
const INSTALL_FUNNEL_STORAGE = 'pf_install_funnel_v2'
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

type WindowWithDeferredInstallPrompt = Window & {
  __pfDeferredInstallPrompt?: BeforeInstallPromptEvent | null
}

type InstallFunnelEvent =
  | 'banner_shown'
  | 'install_cta_clicked'
  | 'ios_onboarding_opened'
  | 'android_onboarding_opened'
  | 'install_prompt_opened'
  | 'install_prompt_accepted'
  | 'install_prompt_dismissed'
  | 'app_installed'
  | 'ios_inapp_browser_detected'
  | 'install_link_copied'

interface InstallFunnelSnapshot {
  firstSeenAt: number | null
  lastEventAt: number | null
  lastAttemptAt: number | null
  bannerShownCount: number
  installCtaClickCount: number
  iosOnboardingOpenCount: number
  androidOnboardingOpenCount: number
  installPromptOpenCount: number
  installPromptAcceptedCount: number
  installPromptDismissedCount: number
  appInstalledCount: number
  iosInAppBrowserDetectedCount: number
  installLinkCopiedCount: number
}

interface IosBrowserContext {
  isIos: boolean
  isSafari: boolean
  isInAppBrowser: boolean
  browserLabel: string
}

const EMPTY_INSTALL_FUNNEL_SNAPSHOT: InstallFunnelSnapshot = {
  firstSeenAt: null,
  lastEventAt: null,
  lastAttemptAt: null,
  bannerShownCount: 0,
  installCtaClickCount: 0,
  iosOnboardingOpenCount: 0,
  androidOnboardingOpenCount: 0,
  installPromptOpenCount: 0,
  installPromptAcceptedCount: 0,
  installPromptDismissedCount: 0,
  appInstalledCount: 0,
  iosInAppBrowserDetectedCount: 0,
  installLinkCopiedCount: 0,
}

function finiteOrDefault(value: unknown, fallback = 0): number {
  if (typeof value !== 'number') {
    return fallback
  }
  return Number.isFinite(value) ? value : fallback
}

function finiteTimestampOrNull(value: unknown): number | null {
  if (typeof value !== 'number') {
    return null
  }
  if (!Number.isFinite(value) || value <= 0) {
    return null
  }
  return value
}

function loadInstallFunnelSnapshot(): InstallFunnelSnapshot {
  if (typeof window === 'undefined') {
    return EMPTY_INSTALL_FUNNEL_SNAPSHOT
  }
  const raw = window.localStorage.getItem(INSTALL_FUNNEL_STORAGE)
  if (!raw) {
    return EMPTY_INSTALL_FUNNEL_SNAPSHOT
  }
  try {
    const parsed = JSON.parse(raw) as Partial<InstallFunnelSnapshot>
    return {
      firstSeenAt: finiteTimestampOrNull(parsed.firstSeenAt),
      lastEventAt: finiteTimestampOrNull(parsed.lastEventAt),
      lastAttemptAt: finiteTimestampOrNull(parsed.lastAttemptAt),
      bannerShownCount: finiteOrDefault(parsed.bannerShownCount),
      installCtaClickCount: finiteOrDefault(parsed.installCtaClickCount),
      iosOnboardingOpenCount: finiteOrDefault(parsed.iosOnboardingOpenCount),
      androidOnboardingOpenCount: finiteOrDefault(parsed.androidOnboardingOpenCount),
      installPromptOpenCount: finiteOrDefault(parsed.installPromptOpenCount),
      installPromptAcceptedCount: finiteOrDefault(parsed.installPromptAcceptedCount),
      installPromptDismissedCount: finiteOrDefault(parsed.installPromptDismissedCount),
      appInstalledCount: finiteOrDefault(parsed.appInstalledCount),
      iosInAppBrowserDetectedCount: finiteOrDefault(parsed.iosInAppBrowserDetectedCount),
      installLinkCopiedCount: finiteOrDefault(parsed.installLinkCopiedCount),
    }
  } catch {
    return EMPTY_INSTALL_FUNNEL_SNAPSHOT
  }
}

function saveInstallFunnelSnapshot(snapshot: InstallFunnelSnapshot): void {
  if (typeof window === 'undefined') {
    return
  }
  window.localStorage.setItem(INSTALL_FUNNEL_STORAGE, JSON.stringify(snapshot))
}

function nextInstallFunnelSnapshot(
  current: InstallFunnelSnapshot,
  event: InstallFunnelEvent,
): InstallFunnelSnapshot {
  const now = Date.now()
  const next: InstallFunnelSnapshot = {
    ...current,
    firstSeenAt: current.firstSeenAt ?? now,
    lastEventAt: now,
  }
  switch (event) {
    case 'banner_shown':
      next.bannerShownCount += 1
      break
    case 'install_cta_clicked':
      next.installCtaClickCount += 1
      next.lastAttemptAt = now
      break
    case 'ios_onboarding_opened':
      next.iosOnboardingOpenCount += 1
      break
    case 'android_onboarding_opened':
      next.androidOnboardingOpenCount += 1
      break
    case 'install_prompt_opened':
      next.installPromptOpenCount += 1
      break
    case 'install_prompt_accepted':
      next.installPromptAcceptedCount += 1
      next.lastAttemptAt = now
      break
    case 'install_prompt_dismissed':
      next.installPromptDismissedCount += 1
      next.lastAttemptAt = now
      break
    case 'app_installed':
      next.appInstalledCount += 1
      next.lastAttemptAt = now
      break
    case 'ios_inapp_browser_detected':
      next.iosInAppBrowserDetectedCount += 1
      break
    case 'install_link_copied':
      next.installLinkCopiedCount += 1
      break
  }
  return next
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

function isAndroidDevice(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }
  return /Android/i.test(navigator.userAgent || '')
}

function isStandaloneDisplayMode(): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return Boolean(window.matchMedia('(display-mode: standalone)').matches || nav.standalone)
}

function detectIosBrowserContext(): IosBrowserContext {
  if (typeof navigator === 'undefined') {
    return {
      isIos: false,
      isSafari: false,
      isInAppBrowser: false,
      browserLabel: 'Bilinmeyen',
    }
  }
  const ua = navigator.userAgent || ''
  const isIos = isIosFamilyDevice()
  if (!isIos) {
    return {
      isIos: false,
      isSafari: false,
      isInAppBrowser: false,
      browserLabel: 'Bilinmeyen',
    }
  }

  const isCriOS = /CriOS/i.test(ua)
  const isFxiOS = /FxiOS/i.test(ua)
  const isEdgiOS = /EdgiOS/i.test(ua)
  const hasSafariToken = /Safari/i.test(ua)
  const isSafari = hasSafariToken && !isCriOS && !isFxiOS && !isEdgiOS
  const isKnownInAppBrowser =
    /(Instagram|FBAN|FBAV|Line|MicroMessenger|WhatsApp|Telegram|Twitter|TikTok|Snapchat|LinkedInApp)/i.test(
      ua,
    ) || /\bwv\b/i.test(ua)
  const isWebViewStyleUa = /\b(iPhone|iPad|iPod)\b.*AppleWebKit(?!.*Safari)/i.test(ua)
  const isInAppBrowser = !isSafari && (isKnownInAppBrowser || isWebViewStyleUa)

  if (isSafari) {
    return { isIos: true, isSafari: true, isInAppBrowser: false, browserLabel: 'Safari' }
  }
  if (isCriOS) {
    return { isIos: true, isSafari: false, isInAppBrowser: false, browserLabel: 'Chrome (iOS)' }
  }
  if (isFxiOS) {
    return { isIos: true, isSafari: false, isInAppBrowser: false, browserLabel: 'Firefox (iOS)' }
  }
  if (isEdgiOS) {
    return { isIos: true, isSafari: false, isInAppBrowser: false, browserLabel: 'Edge (iOS)' }
  }
  return {
    isIos: true,
    isSafari: false,
    isInAppBrowser,
    browserLabel: isInAppBrowser ? 'Uygulama içi tarayıcı' : 'iOS tarayıcı',
  }
}

function getDeferredInstallPromptFromWindow(): BeforeInstallPromptEvent | null {
  if (typeof window === 'undefined') {
    return null
  }
  const raw = (window as WindowWithDeferredInstallPrompt).__pfDeferredInstallPrompt
  return raw ?? null
}

function setDeferredInstallPromptOnWindow(event: BeforeInstallPromptEvent | null): void {
  if (typeof window === 'undefined') {
    return
  }
  ;(window as WindowWithDeferredInstallPrompt).__pfDeferredInstallPrompt = event
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
    return 'Bildirim aboneliği süresi dolmuş. Abonelik otomatik yenilenirken hata oluştu, lütfen tekrar deneyin.'
  }
  const statusPart = typeof statusCode === 'number' ? ` (status ${statusCode})` : ''
  const errorPart = rawError?.trim() ? ` ${rawError.trim()}` : ''
  return `Sunucu push testi başarısız${statusPart}.${errorPart}`.trim()
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

function getIosInstallOnboardingDismissUntil(): number {
  if (typeof window === 'undefined') {
    return 0
  }
  const raw = window.localStorage.getItem(IOS_INSTALL_ONBOARDING_DISMISS_UNTIL_STORAGE)
  if (raw) {
    const parsed = Number(raw)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }

  if (window.localStorage.getItem(IOS_INSTALL_ONBOARDING_SEEN_STORAGE) === '1') {
    const migratedDismissUntil = Date.now() + INSTALL_BANNER_DISMISS_MS
    window.localStorage.setItem(
      IOS_INSTALL_ONBOARDING_DISMISS_UNTIL_STORAGE,
      String(migratedDismissUntil),
    )
    return migratedDismissUntil
  }
  return 0
}

function setIosInstallOnboardingDismissUntil(untilTs: number): void {
  if (typeof window === 'undefined') {
    return
  }
  window.localStorage.setItem(IOS_INSTALL_ONBOARDING_DISMISS_UNTIL_STORAGE, String(untilTs))
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
    gainNode.gain.exponentialRampToValueAtTime(0.24, audioContext.currentTime + 0.02)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.26)

    oscillator.connect(gainNode)
    gainNode.connect(audioContext.destination)

    oscillator.start(audioContext.currentTime)
    oscillator.stop(audioContext.currentTime + 0.26)
    oscillator.onended = () => {
      void audioContext.close()
    }
  } catch {
    // Sessiz fallback: ses desteği yoksa işlem normal devam eder.
  }
}

export function HomePage() {
  const [deviceFingerprint, setDeviceFingerprint] = useState<string | null>(() =>
    getStoredDeviceFingerprint(),
  )
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
  const [isRecoveryBusy, setIsRecoveryBusy] = useState(false)
  const [recoveryReady, setRecoveryReady] = useState(false)
  const [recoveryCodeCount, setRecoveryCodeCount] = useState(0)
  const [recoveryExpiresAt, setRecoveryExpiresAt] = useState<string | null>(null)
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null)
  const [recoveryCodesPreview, setRecoveryCodesPreview] = useState<string[] | null>(null)

  const [isPushBusy, setIsPushBusy] = useState(false)
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushRuntimeSupported, setPushRuntimeSupported] = useState(true)
  const [pushRegistered, setPushRegistered] = useState(false)
  const [pushNeedsResubscribe, setPushNeedsResubscribe] = useState(false)
  const [pushRequiresStandalone, setPushRequiresStandalone] = useState(false)
  const [pushNotice, setPushNotice] = useState<string | null>(null)
  const [pushSecondChanceOpen, setPushSecondChanceOpen] = useState(false)
  const [pushGateDismissed, setPushGateDismissed] = useState(false)
  const [pushGateRequestedByQr, setPushGateRequestedByQr] = useState(false)
  const [isStandaloneApp, setIsStandaloneApp] = useState(() => isStandaloneDisplayMode())
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(() =>
    getDeferredInstallPromptFromWindow(),
  )
  const [installBannerVisible, setInstallBannerVisible] = useState(false)
  const [isInstallPromptBusy, setIsInstallPromptBusy] = useState(false)
  const [installNotice, setInstallNotice] = useState<string | null>(null)
  const [iosInstallOnboardingOpen, setIosInstallOnboardingOpen] = useState(false)
  const [androidInstallOnboardingOpen, setAndroidInstallOnboardingOpen] = useState(false)
  const [iosInstallOnboardingDismissUntil, setIosInstallOnboardingDismissUntilState] = useState(
    () => getIosInstallOnboardingDismissUntil(),
  )
  const [installFunnelSnapshot, setInstallFunnelSnapshot] = useState<InstallFunnelSnapshot>(() =>
    loadInstallFunnelSnapshot(),
  )
  const scanSuccessFxTimerRef = useRef<number | null>(null)
  const actionPanelRef = useRef<HTMLElement | null>(null)
  const qrPanelAutoFocusDoneRef = useRef(false)
  const installBannerVisiblePrevRef = useRef(false)
  const iosOnboardingVisiblePrevRef = useRef(false)
  const androidOnboardingVisiblePrevRef = useRef(false)
  const iosInAppBrowserLoggedRef = useRef(false)
  const iosBrowserContext = useMemo(() => detectIosBrowserContext(), [])
  const installFunnelLastSentRef = useRef<Record<string, number>>({})

  const sendInstallFunnelEvent = useCallback(
    (event: InstallFunnelEvent, snapshot: InstallFunnelSnapshot) => {
      if (!deviceFingerprint) {
        return
      }
      const now = Date.now()
      const dedupeKey = `${deviceFingerprint}:${event}`
      const previousSentAt = installFunnelLastSentRef.current[dedupeKey] ?? 0
      const minIntervalMs = event === 'banner_shown' ? 30_000 : 1_500
      if (now - previousSentAt < minIntervalMs) {
        return
      }
      installFunnelLastSentRef.current[dedupeKey] = now

      void postEmployeeInstallFunnelEvent({
        device_fingerprint: deviceFingerprint,
        event,
        occurred_at_ms: now,
        context: {
          standalone: isStandaloneApp,
          push_enabled: pushEnabled,
          push_registered: pushRegistered,
          push_requires_standalone: pushRequiresStandalone,
          install_prompt_ready: Boolean(installPromptEvent),
          ios_is_device: iosBrowserContext.isIos,
          ios_is_safari: iosBrowserContext.isSafari,
          ios_in_app_browser: iosBrowserContext.isInAppBrowser,
          browser_label: iosBrowserContext.browserLabel,
          banner_shown_count: snapshot.bannerShownCount,
          install_cta_click_count: snapshot.installCtaClickCount,
          ios_onboarding_open_count: snapshot.iosOnboardingOpenCount,
          android_onboarding_open_count: snapshot.androidOnboardingOpenCount,
          prompt_open_count: snapshot.installPromptOpenCount,
          prompt_accepted_count: snapshot.installPromptAcceptedCount,
          prompt_dismissed_count: snapshot.installPromptDismissedCount,
          app_installed_count: snapshot.appInstalledCount,
          link_copied_count: snapshot.installLinkCopiedCount,
        },
      }).catch(() => {
        // Best-effort telemetry: UX akisini asla bloke etmez.
      })
    },
    [
      deviceFingerprint,
      installPromptEvent,
      iosBrowserContext.browserLabel,
      iosBrowserContext.isInAppBrowser,
      iosBrowserContext.isIos,
      iosBrowserContext.isSafari,
      isStandaloneApp,
      pushEnabled,
      pushRegistered,
      pushRequiresStandalone,
    ],
  )

  const trackInstallFunnel = useCallback(
    (event: InstallFunnelEvent) => {
      setInstallFunnelSnapshot((current) => {
        const next = nextInstallFunnelSnapshot(current, event)
        saveInstallFunnelSnapshot(next)
        sendInstallFunnelEvent(event, next)
        return next
      })
    },
    [sendInstallFunnelEvent],
  )

  const iosInAppBrowserBlocked =
    iosBrowserContext.isIos && iosBrowserContext.isInAppBrowser && !isStandaloneApp
  const iosInstallOnboardingDismissed = iosInstallOnboardingDismissUntil > Date.now()
  const hasAttendanceActivity = Boolean(lastAction || statusSnapshot?.last_in_ts || statusSnapshot?.last_out_ts)

  const handleDeviceNotClaimed = useCallback((parsed: ParsedApiError): boolean => {
    if (parsed.code !== 'DEVICE_NOT_CLAIMED') {
      return false
    }
    clearStoredDeviceFingerprint()
    setDeviceFingerprint(null)
    setStatusSnapshot(null)
    setTodayStatus('NOT_STARTED')
    setPushRegistered(false)
    setPushNeedsResubscribe(false)
    setPushSecondChanceOpen(false)
    setPasskeyNotice(null)
    setRecoveryReady(false)
    setRecoveryCodeCount(0)
    setRecoveryExpiresAt(null)
    setRecoveryNotice(null)
    setRecoveryCodesPreview(null)
    setPushNotice(null)
    return true
  }, [])

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
    }, 1000)
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

    const syncInstallPromptFromWindow = () => {
      const deferredPrompt = getDeferredInstallPromptFromWindow()
      if (deferredPrompt) {
        setInstallPromptEvent(deferredPrompt)
        if (!isInstallBannerDismissed() && !isStandaloneDisplayMode()) {
          setInstallBannerVisible(true)
        }
      }
    }

    const handleDisplayModeChange = () => {
      setIsStandaloneApp(isStandaloneDisplayMode())
    }
    const handleBeforeInstallPrompt = (event: Event) => {
      const promptEvent = event as BeforeInstallPromptEvent
      promptEvent.preventDefault()
      setDeferredInstallPromptOnWindow(promptEvent)
      setInstallPromptEvent(promptEvent)
      if (!isInstallBannerDismissed() && !isStandaloneDisplayMode()) {
        setInstallBannerVisible(true)
      }
    }
    const handleAppInstalled = () => {
      setDeferredInstallPromptOnWindow(null)
      setInstallPromptEvent(null)
      setInstallBannerVisible(false)
      setIosInstallOnboardingOpen(false)
      setAndroidInstallOnboardingOpen(false)
      const nextDismissUntil = Date.now() + INSTALL_BANNER_DISMISS_MS
      setIosInstallOnboardingDismissUntilState(nextDismissUntil)
      setIosInstallOnboardingDismissUntil(nextDismissUntil)
      trackInstallFunnel('app_installed')
      setInstallNotice('Uygulama ana ekrana eklendi.')
      setIsStandaloneApp(true)
    }
    const handleInstallPromptReady = () => {
      syncInstallPromptFromWindow()
    }
    const handleFocus = () => {
      syncInstallPromptFromWindow()
    }

    const displayModeMedia = window.matchMedia('(display-mode: standalone)')
    syncInstallPromptFromWindow()
    handleDisplayModeChange()

    if (typeof displayModeMedia.addEventListener === 'function') {
      displayModeMedia.addEventListener('change', handleDisplayModeChange)
    } else {
      displayModeMedia.addListener(handleDisplayModeChange)
    }
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt as EventListener)
    window.addEventListener('appinstalled', handleAppInstalled)
    window.addEventListener('pf:installprompt-ready', handleInstallPromptReady as EventListener)
    window.addEventListener('focus', handleFocus)

    return () => {
      if (typeof displayModeMedia.removeEventListener === 'function') {
        displayModeMedia.removeEventListener('change', handleDisplayModeChange)
      } else {
        displayModeMedia.removeListener(handleDisplayModeChange)
      }
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt as EventListener)
      window.removeEventListener('appinstalled', handleAppInstalled)
      window.removeEventListener('pf:installprompt-ready', handleInstallPromptReady as EventListener)
      window.removeEventListener('focus', handleFocus)
    }
  }, [trackInstallFunnel])

  useEffect(() => {
    if (isStandaloneApp) {
      setInstallBannerVisible(false)
      setIosInstallOnboardingOpen(false)
      setAndroidInstallOnboardingOpen(false)
      const nextDismissUntil = Date.now() + INSTALL_BANNER_DISMISS_MS
      setIosInstallOnboardingDismissUntilState(nextDismissUntil)
      setIosInstallOnboardingDismissUntil(nextDismissUntil)
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
    const shouldAutoOpen =
      !iosInstallOnboardingDismissed &&
      (hasAttendanceActivity || iosInAppBrowserBlocked)
    if (shouldAutoOpen) {
      setIosInstallOnboardingOpen(true)
    }
  }, [
    hasAttendanceActivity,
    iosInAppBrowserBlocked,
    iosInstallOnboardingDismissed,
    isStandaloneApp,
  ])

  useEffect(() => {
    if (!iosInAppBrowserBlocked || iosInAppBrowserLoggedRef.current) {
      return
    }
    iosInAppBrowserLoggedRef.current = true
    trackInstallFunnel('ios_inapp_browser_detected')
  }, [iosInAppBrowserBlocked, trackInstallFunnel])

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
          handleDeviceNotClaimed(parsed)
        }
      }
    }

    void loadStatus()
    return () => {
      cancelled = true
    }
  }, [deviceFingerprint, handleDeviceNotClaimed, lastAction?.response.event_id])

  useEffect(() => {
    if (!deviceFingerprint) {
      setRecoveryReady(false)
      setRecoveryCodeCount(0)
      setRecoveryExpiresAt(null)
      return
    }

    let cancelled = false
    const loadRecoveryStatus = async () => {
      try {
        const statusData = await getRecoveryCodeStatus(deviceFingerprint)
        if (cancelled) {
          return
        }
        setRecoveryReady(Boolean(statusData.recovery_ready))
        setRecoveryCodeCount(Number(statusData.active_code_count || 0))
        setRecoveryExpiresAt(statusData.expires_at ?? null)
      } catch (error) {
        const parsed = parseApiError(error, 'Recovery code durumu alinamadi.')
        if (!cancelled) {
          handleDeviceNotClaimed(parsed)
        }
      }
    }
    void loadRecoveryStatus()
    return () => {
      cancelled = true
    }
  }, [deviceFingerprint, handleDeviceNotClaimed, lastAction?.response.event_id])

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
    if (!gateRequired) {
      setPushGateDismissed(false)
      setPushGateRequestedByQr(false)
    }
  }, [deviceFingerprint, pushEnabled, pushRegistered])

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
  const recoveryStatusLabel = recoveryReady ? `Hazir (${recoveryCodeCount})` : 'Kurulu Degil'

  const pushGateRequired =
    Boolean(deviceFingerprint) && pushEnabled && !pushRegistered
  const pushGateCanBeDismissedForInstall =
    pushGateRequired && pushRequiresStandalone && !isStandaloneApp
  const showPushGateModal =
    pushGateRequired &&
    pushGateRequestedByQr &&
    (!pushGateCanBeDismissedForInstall || !pushGateDismissed)
  const canQrScan = Boolean(deviceFingerprint) && !isSubmitting
  const canCheckout = Boolean(deviceFingerprint) && !isSubmitting && hasOpenShift

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
    const nextDismissUntil = Date.now() + INSTALL_BANNER_DISMISS_MS
    setIosInstallOnboardingDismissUntilState(nextDismissUntil)
    setIosInstallOnboardingDismissUntil(nextDismissUntil)
  }, [])

  const dismissAndroidInstallOnboarding = useCallback(() => {
    setAndroidInstallOnboardingOpen(false)
  }, [])

  const openIosInstallOnboarding = useCallback(() => {
    setInstallNotice(null)
    setPushGateDismissed(true)
    setIosInstallOnboardingOpen(true)
  }, [])

  const openAndroidInstallOnboarding = useCallback(() => {
    setInstallNotice(null)
    setAndroidInstallOnboardingOpen(true)
  }, [])

  const copyPortalLinkForSafari = useCallback(async () => {
    if (typeof window === 'undefined') {
      return
    }
    const portalUrl = window.location.href
    let copied = false
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(portalUrl)
        copied = true
      }
    } catch {
      copied = false
    }

    if (!copied && typeof document !== 'undefined') {
      const textarea = document.createElement('textarea')
      textarea.value = portalUrl
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      textarea.style.pointerEvents = 'none'
      document.body.appendChild(textarea)
      textarea.focus()
      textarea.select()
      copied = document.execCommand('copy')
      document.body.removeChild(textarea)
    }

    if (copied) {
      setInstallNotice('Link kopyalandi. Safari acip adres cubuguna yapistirin.')
      trackInstallFunnel('install_link_copied')
      return
    }
    setInstallNotice('Link kopyalanamadi. Safari acip bu adresi manuel girin.')
  }, [trackInstallFunnel])

  const runInstallPrompt = useCallback(async () => {
    setInstallNotice(null)
    trackInstallFunnel('install_cta_clicked')
    const activePrompt = installPromptEvent ?? getDeferredInstallPromptFromWindow()

    if (iosInAppBrowserBlocked) {
      setInstallNotice(
        'iPhone kurulumu icin baglantiyi Safari ile acin. Uygulama ici tarayicida Ana Ekrana Ekle calismaz.',
      )
      openIosInstallOnboarding()
      return
    }
    if (isIosFamilyDevice() && !activePrompt) {
      setInstallNotice('Kurulum için Safari paylaş menüsünden "Ana Ekrana Ekle" adımını kullanın.')
      openIosInstallOnboarding()
      return
    }
    if (!activePrompt) {
      if (isAndroidDevice()) {
        setInstallNotice(
          'Android kurulum penceresi henuz hazir degil. Chrome menusu uzerinden "Ana ekrana ekle" adimini kullanin.',
        )
        openAndroidInstallOnboarding()
      } else {
        setInstallNotice('Bu tarayıcı otomatik kurulum penceresi sunmuyor.')
      }
      return
    }

    setInstallPromptEvent(activePrompt)
    setIsInstallPromptBusy(true)
    trackInstallFunnel('install_prompt_opened')
    try {
      await activePrompt.prompt()
      const choice = await activePrompt.userChoice
      if (choice.outcome === 'accepted') {
        trackInstallFunnel('install_prompt_accepted')
        setInstallBannerVisible(false)
        setAndroidInstallOnboardingOpen(false)
        const nextDismissUntil = Date.now() + INSTALL_BANNER_DISMISS_MS
        setIosInstallOnboardingDismissUntilState(nextDismissUntil)
        setIosInstallOnboardingDismissUntil(nextDismissUntil)
      } else {
        trackInstallFunnel('install_prompt_dismissed')
      }
    } catch {
      setInstallNotice('Kurulum penceresi açılamadı. Tarayıcı menüsünden Ana Ekrana Ekle deneyin.')
    } finally {
      setDeferredInstallPromptOnWindow(null)
      setInstallPromptEvent(null)
      setIsInstallPromptBusy(false)
    }
  }, [
    installPromptEvent,
    iosInAppBrowserBlocked,
    openAndroidInstallOnboarding,
    openIosInstallOnboarding,
    trackInstallFunnel,
  ])

  const runDownloadInstallAction = useCallback(async () => {
    setInstallNotice(null)
    const activePrompt = installPromptEvent ?? getDeferredInstallPromptFromWindow()

    if (isStandaloneApp) {
      setInstallNotice('Uygulama bu cihazda zaten kurulu.')
      return
    }
    if (isIosFamilyDevice() && !activePrompt) {
      openIosInstallOnboarding()
      return
    }
    if (!activePrompt) {
      if (isAndroidDevice()) {
        openAndroidInstallOnboarding()
        return
      }
      setInstallNotice(
        'Bu tarayıcı otomatik kurulum penceresi sunmuyor. Tarayıcı menüsünden "Ana Ekrana Ekle" adımını kullanın.',
      )
      return
    }
    await runInstallPrompt()
  }, [installPromptEvent, isStandaloneApp, openAndroidInstallOnboarding, openIosInstallOnboarding, runInstallPrompt])

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
  const showAndroidInstallOnboarding =
    androidInstallOnboardingOpen &&
    isAndroidDevice() &&
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
    isIosFamilyDevice() && !installPromptEvent
      ? 'Ana Ekrana Ekle'
      : installPromptEvent && isAndroidDevice()
        ? 'Tek Dokunuşla Ekle'
        : isAndroidDevice()
          ? 'Kurulum Adimlarini Gor'
        : 'Uygulamayı Yükle'
  const installBannerHint =
    iosInAppBrowserBlocked
      ? 'Kurulum icin bu sayfayi Safari ile acin. Uygulama ici tarayicilar iOS kurulumunu engeller.'
      : isIosFamilyDevice() && !installPromptEvent
        ? 'Safari alt menüden Paylaş > Ana Ekrana Ekle adımıyla kurulumu tamamlayın.'
      : installPromptEvent && isAndroidDevice()
        ? 'Android cihazlarda tek dokunuşla kurulum penceresi açılır.'
        : isAndroidDevice()
          ? 'Android kurulum penceresi hazır değilse Chrome menüsünden Ana ekrana ekle adımını kullanın.'
          : 'Uygulamayı ana ekrana ekleyerek daha stabil ve hızlı kullanın.'
  const showInstallPromotions = !isStandaloneApp
  const installRailPrimaryLabel = useMemo(() => {
    if (isStandaloneApp) return 'Uygulama Kurulu'
    if (isInstallPromptBusy) return 'Hazırlanıyor...'
    if (isIosFamilyDevice() && !installPromptEvent) return 'Ana Ekrana Ekle'
    if (isAndroidDevice() && !installPromptEvent) return 'Kurulum Adimlari'
    if (!installPromptEvent) return 'Ana Ekrana Ekle'
    if (isAndroidDevice()) return 'Tek Dokunuşla Ekle'
    return 'Uygulamayı İndir'
  }, [installPromptEvent, isInstallPromptBusy, isStandaloneApp])

  const installFunnelSteps = useMemo(() => {
    const browserStepDone = !iosBrowserContext.isIos || iosBrowserContext.isSafari || isStandaloneApp
    const onboardingStepDone =
      installFunnelSnapshot.installPromptOpenCount > 0 ||
      installFunnelSnapshot.iosOnboardingOpenCount > 0 ||
      installFunnelSnapshot.androidOnboardingOpenCount > 0
    const installedStepDone = isStandaloneApp || installFunnelSnapshot.appInstalledCount > 0

    const steps = [
      {
        id: 'browser',
        label: iosBrowserContext.isIos ? 'Safari veya destekli tarayici' : 'Tarayici uygun',
        done: browserStepDone,
      },
      {
        id: 'onboarding',
        label: 'Kurulum adimi acildi',
        done: onboardingStepDone,
      },
      {
        id: 'installed',
        label: 'Ana ekrana eklendi',
        done: installedStepDone,
      },
    ]

    return {
      steps,
      completed: steps.filter((step) => step.done).length,
      total: steps.length,
    }
  }, [installFunnelSnapshot, iosBrowserContext.isIos, iosBrowserContext.isSafari, isStandaloneApp])

  const installHealthHint = useMemo(() => {
    if (iosInAppBrowserBlocked) {
      return 'Su an uygulama ici tarayicidasiniz. Kurulum ve push icin Safari acmaniz gerekiyor.'
    }
    if (isAndroidDevice() && !installPromptEvent && !isStandaloneApp) {
      return 'Android kurulum penceresi hazir degilse menuden "Ana ekrana ekle" adimini kullanin.'
    }
    if (installPromptEvent && isAndroidDevice()) {
      return 'Android kurulum penceresi hazir. Butona basinca tek adimda kurabilirsiniz.'
    }
    return 'Kurulumu tamamladiginizda QR ve push akisi daha stabil olur.'
  }, [installPromptEvent, iosInAppBrowserBlocked, isStandaloneApp])

  const installLastAttemptLabel = useMemo(() => {
    if (!installFunnelSnapshot.lastAttemptAt) {
      return 'Henüz kurulum denemesi yok.'
    }
    return new Date(installFunnelSnapshot.lastAttemptAt).toLocaleString('tr-TR', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
    })
  }, [installFunnelSnapshot.lastAttemptAt])

  const showIosBrowserWarning =
    iosInAppBrowserBlocked && !scannerActive && !isHelpOpen && !showPushGateModal

  useEffect(() => {
    if (showInstallBanner && !installBannerVisiblePrevRef.current) {
      trackInstallFunnel('banner_shown')
    }
    installBannerVisiblePrevRef.current = showInstallBanner
  }, [showInstallBanner, trackInstallFunnel])

  useEffect(() => {
    if (showIosInstallOnboarding && !iosOnboardingVisiblePrevRef.current) {
      trackInstallFunnel('ios_onboarding_opened')
    }
    iosOnboardingVisiblePrevRef.current = showIosInstallOnboarding
  }, [showIosInstallOnboarding, trackInstallFunnel])

  useEffect(() => {
    if (showAndroidInstallOnboarding && !androidOnboardingVisiblePrevRef.current) {
      trackInstallFunnel('android_onboarding_opened')
    }
    androidOnboardingVisiblePrevRef.current = showAndroidInstallOnboarding
  }, [showAndroidInstallOnboarding, trackInstallFunnel])

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
    if (
      scannerActive ||
      isHelpOpen ||
      showPushGateModal ||
      showIosInstallOnboarding ||
      showAndroidInstallOnboarding
    ) {
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
  }, [isHelpOpen, scannerActive, showAndroidInstallOnboarding, showIosInstallOnboarding, showPushGateModal])

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
      const { startRegistration } = await import('@simplewebauthn/browser')
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
      handleDeviceNotClaimed(parsed)
      setErrorMessage(parsed.message)
      setRequestId(parsed.requestId ?? null)
    } finally {
      setIsPasskeyBusy(false)
    }
  }

  const runRecoveryCodeIssue = async () => {
    if (!deviceFingerprint) {
      setErrorMessage('Cihaz bagli degil. Davet linkine tiklayin.')
      return
    }

    const pinInput = window.prompt('Recovery PIN belirleyin (6-12 hane, sadece rakam):', '')
    if (pinInput === null) {
      return
    }
    const pinConfirm = window.prompt('Recovery PIN tekrar:', '')
    if (pinConfirm === null) {
      return
    }

    const normalizedPin = pinInput.trim()
    if (normalizedPin.length < 6 || normalizedPin.length > 12 || !/^\d+$/.test(normalizedPin)) {
      setErrorMessage('Recovery PIN 6-12 hane olmali ve sadece rakam icermeli.')
      return
    }
    if (normalizedPin !== pinConfirm.trim()) {
      setErrorMessage('Recovery PIN dogrulamasi eslesmedi.')
      return
    }

    setIsRecoveryBusy(true)
    setRecoveryNotice(null)
    setRecoveryCodesPreview(null)
    setErrorMessage(null)
    setRequestId(null)

    try {
      const result = await issueRecoveryCodes({
        device_fingerprint: deviceFingerprint,
        recovery_pin: normalizedPin,
      })
      setRecoveryReady(true)
      setRecoveryCodeCount(result.code_count)
      setRecoveryExpiresAt(result.expires_at)
      setRecoveryCodesPreview(result.recovery_codes)
      setRecoveryNotice('Recovery kodlari olusturuldu. Kodlari guvenli bir yere kaydet.')
    } catch (error) {
      const parsed = parseApiError(error, 'Recovery kodlari olusturulamadi.')
      handleDeviceNotClaimed(parsed)
      setErrorMessage(parsed.message)
      setRequestId(parsed.requestId ?? null)
    } finally {
      setIsRecoveryBusy(false)
    }
  }

  const runPushSubscription = async (isSecondAttempt = false) => {
    if (!deviceFingerprint) {
      setErrorMessage('Cihaz bağlı değil. Davet linkine tıklayın.')
      return
    }
    if (pushRequiresStandalone) {
      setErrorMessage('iPhone/iPad için bildirim sadece Ana Ekran uygulamasında çalışır. Portalı ana ekran ikonundan açın.')
      return
    }

    if (!pushEnabled) {
      setErrorMessage('Bildirim servisi şu anda aktif değil. İK yöneticisiyle iletişime geçin.')
      return
    }
    if (!pushRuntimeSupported) {
      setErrorMessage('Bu tarayıcı bildirim altyapısını desteklemiyor veya güvenli bağlantı (HTTPS) yok.')
      return
    }
    if (
      typeof window === 'undefined' ||
      !isSecurePushContext() ||
      !('serviceWorker' in navigator) ||
      !('PushManager' in window)
    ) {
      setErrorMessage('Bu tarayıcı bildirim aboneliğini desteklemiyor.')
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
          setPushNotice('Bildirimler zorunlu. Devam etmek için bir kez daha izin istemeniz gerekiyor.')
          setErrorMessage('Bildirim izni verilmedi. "Tekrar Sor (2/2)" butonu ile ikinci kez izin isteyin.')
          return
        }

        setPushSecondChanceOpen(false)
        throw new Error('Bildirim izni ikinci kez de verilmedi. Bildirim açılmadan sistem kullanılamaz.')
      }

      setPushSecondChanceOpen(false)

      const config = await getEmployeePushConfig()
      if (!config.enabled || !config.vapid_public_key) {
        throw new Error('Bildirim servisi şu anda aktif değil.')
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

      // iOS dahil bazı tarayıcılarda showNotification istemci tarafında hata verebilir.
      // Bu adımı non-fatal tutuyoruz; asıl doğrulama sunucu push testidir.
      try {
        await registration.showNotification('Puantaj Bildirimleri Açıldı', {
          body: 'Bildirim kanalı aktif. Artık sistem uyarılarını alacaksınız.',
          icon: '/employee/icons/icon-192.png',
          badge: '/employee/icons/icon-192.png',
        })
      } catch {
        // no-op
      }

      window.localStorage.setItem(PUSH_VAPID_KEY_STORAGE, vapidPublicKey)
      setPushRegistered(true)
      setPushNeedsResubscribe(false)
      setPushNotice('Bildirimler bu cihazda etkinleştirildi.')
      setPushSecondChanceOpen(false)
      await syncPushState(true)
    } catch (error) {
      const parsed = parseApiError(error, 'Bildirim aboneliği oluşturulamadı.')
      handleDeviceNotClaimed(parsed)
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
    if (pushGateRequired) {
      setPushGateDismissed(false)
      setPushGateRequestedByQr(true)
      setPushSecondChanceOpen(false)
      setErrorMessage(
        pushRequiresStandalone
          ? 'QR baslatmadan once iPhone kurulumunu tamamlayip bildirimleri acin.'
          : 'QR baslatmadan once bildirimleri acin.',
      )
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
      triggerScanSuccessFx()
    } catch (error) {
      const parsed = parseApiError(error, 'QR işlemi tamamlanamadı.')
      handleDeviceNotClaimed(parsed)
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
      triggerScanSuccessFx()
    } catch (error) {
      const parsed = parseApiError(error, 'Mesai bitiş kaydı oluşturulamadı.')
      handleDeviceNotClaimed(parsed)
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
      return 'iPhone/iPad icin once Safari ile acip Paylas > Ana Ekrana Ekle yapin. Ardindan ana ekran ikonundan acip "Bildirimleri Ac" adimini tamamlayin.'
    }
    if (!pushRuntimeSupported) {
      return 'Bu tarayıcı bildirim altyapısını desteklemiyor veya bağlantı güvenli değil. Linki HTTPS altında Safari (iOS) veya Chrome (Android) ile açın.'
    }
    if (pushNeedsResubscribe) {
      return 'Bildirim anahtarı güncellendi. Devam etmek için "Bildirimleri Aç" ile aboneliği yenileyin.'
    }
    if (!pushEnabled) {
      return 'Bildirim servisi sunucuda aktif değil. İK yöneticisi ortam ayarlarını tamamlamalıdır.'
    }
    if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
      return 'Tarayıcı bildirim iznini reddetti. Tarayıcı ayarlarından izin verip tekrar deneyin.'
    }
    return 'Bu portalda devam etmek için bildirimleri açmanız zorunludur.'
  }, [pushEnabled, pushNeedsResubscribe, pushRequiresStandalone, pushRuntimeSupported])

  const todayStatusClass = useMemo(() => {
    if (todayStatus === 'FINISHED') return 'state-ok'
    if (todayStatus === 'IN_PROGRESS') return 'state-warn'
    return 'state-err'
  }, [todayStatus])

  return (
    <main className="phone-shell employee-shell">
      <div className="employee-layout">
        {showInstallPromotions ? (
          <aside className="promo-rail promo-rail-left" aria-label="Uygulama indirme paneli">
            <p className="promo-rail-kicker">YABUJIN EMPLOYEE APP</p>
            <h2 className="promo-rail-title">Cepte kur, mesaiyi tek dokunuşla yönet.</h2>
            <p className="promo-rail-text">
              Kurulumdan sonra QR, bildirim ve güvenlik adımları daha stabil ve hızlı çalışır.
            </p>
            <ul className="promo-rail-list">
              <li>QR tarama ve işlem akışı daha akıcı</li>
              <li>Push bildirim gecikmeleri azaltılır</li>
              <li>Passkey kurtarma daha kısa sürer</li>
            </ul>
            <button
              type="button"
              className="btn btn-primary promo-rail-btn"
              disabled={isInstallPromptBusy || isStandaloneApp}
              onClick={() => void runDownloadInstallAction()}
            >
              {installRailPrimaryLabel}
            </button>
            <p className="promo-rail-note">Desteklenen cihazlarda buton kurulum penceresini direkt açar.</p>
          </aside>
        ) : null}

        <section className="phone-card employee-home-card">
        <div className="card-topbar">
          <div>
            <p className="chip">Çalışan Portalı</p>
            <h1>Puantaj İşlemleri</h1>
          </div>
          <Link className="topbar-link" to="/recover">
            Kurtarma
          </Link>
        </div>

        {showInstallBanner ? (
          <section className="install-banner" role="region" aria-label="Uygulama kurulumu">
            <div className="install-banner-copy">
              <p className="install-banner-kicker">YABUJIN APP</p>
              <p className="install-banner-title">Ana ekrana ekleyip uygulama gibi kullanın</p>
              <p className="install-banner-subtitle">{installBannerHint}</p>
            </div>
            <div className="install-banner-actions">
              <button
                type="button"
                className="btn btn-primary install-banner-btn"
                disabled={isInstallPromptBusy}
                onClick={() => void runInstallPrompt()}
              >
                {isInstallPromptBusy ? 'Açılıyor...' : installPrimaryLabel}
              </button>
              <button type="button" className="btn btn-ghost install-banner-dismiss" onClick={dismissInstallBanner}>
                Daha Sonra
              </button>
            </div>
          </section>
        ) : null}

        {showIosBrowserWarning ? (
          <div className="warn-box install-browser-warning">
            <p>
              <span className="banner-icon" aria-hidden="true">
                !
              </span>
              iPhone kurulumu icin Safari zorunlu. Simdi {iosBrowserContext.browserLabel} uzerindesiniz.
            </p>
            <div className="install-browser-warning-actions">
              <button type="button" className="btn btn-soft" onClick={openIosInstallOnboarding}>
                Safari Adimlarini Ac
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => void copyPortalLinkForSafari()}>
                Linki Kopyala
              </button>
            </div>
          </div>
        ) : null}

        {showInstallPromotions ? (
          <section className="install-health" role="region" aria-label="Kurulum durumu">
            <div className="install-health-head">
              <p className="install-health-kicker">KURULUM DURUMU</p>
              <span className="status-pill state-warn">
                {installFunnelSteps.completed}/{installFunnelSteps.total}
              </span>
            </div>
            <p className="install-health-text">{installHealthHint}</p>
            <ul className="install-health-list">
              {installFunnelSteps.steps.map((step) => (
                <li key={step.id} className={`install-health-step ${step.done ? 'done' : 'pending'}`}>
                  <span className="install-health-step-icon" aria-hidden="true">
                    {step.done ? '✓' : '•'}
                  </span>
                  <span>{step.label}</span>
                </li>
              ))}
            </ul>
            <p className="install-health-meta">
              Son deneme: <strong>{installLastAttemptLabel}</strong>
            </p>
          </section>
        ) : null}

        {showIosInstallDock ? (
          <div className="ios-install-dock" role="region" aria-label="Ana ekrana ekleme kisayolu">
            <div>
              <p className="ios-install-dock-title">Ana Ekrana Ekle</p>
              <p className="ios-install-dock-subtitle">
                {iosInAppBrowserBlocked
                  ? 'Once Safari ile acin, sonra Paylas > Ana Ekrana Ekle adimini tamamlayin.'
                  : 'Uygulama gibi kullanmak icin kurulumu tamamlayin.'}
              </p>
            </div>
            <div className="ios-install-dock-actions">
              <button type="button" className="btn btn-soft ios-install-dock-btn" onClick={openIosInstallOnboarding}>
                Ana Ekrana Ekle
              </button>
              <button type="button" className="btn btn-ghost ios-install-dock-btn" onClick={() => void copyPortalLinkForSafari()}>
                Linki Kopyala
              </button>
            </div>
          </div>
        ) : null}

        <div className="employee-workbench">
          <section className="employee-command-surface">
            <div className="employee-hero">
              <div className="employee-hero-copy">
                <p className="employee-hero-kicker">Günlük Çalışma Ekranı</p>
                <h2 className="employee-hero-title">{todayStatusLabel(todayStatus)}</h2>
                <p className="employee-hero-subtitle">{todayStatusHint(todayStatus)}</p>
              </div>
              <span className={`employee-hero-indicator ${todayStatusClass}`}>Canlı</span>
            </div>

            <div className="status-grid">
              <article className="status-card">
                <p className="small-title">Bugünkü Durum</p>
                <span className={`status-pill ${todayStatusClass}`}>{todayStatusLabel(todayStatus)}</span>
              </article>

              <article className="status-card">
                <p className="small-title">Passkey Durumu</p>
                <span className={`status-pill ${passkeyRegistered ? 'state-ok' : 'state-warn'}`}>
                  {passkeyRegistered ? 'Kurulu' : 'Kurulu Değil'}
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
                    ? 'Açık'
                    : !pushRuntimeSupported
                      ? 'Destek Yok'
                      : pushEnabled
                        ? 'Kapalı'
                        : 'Servis Kapalı'}
                </span>
              </article>

              <article className="status-card">
                <p className="small-title">Recovery Code</p>
                <span className={`status-pill ${recoveryReady ? 'state-ok' : 'state-warn'}`}>
                  {recoveryStatusLabel}
                </span>
              </article>
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

            {!passkeyRegistered ? (
              <section className="passkey-brief passkey-brief-setup" aria-live="polite">
                <p className="passkey-brief-kicker">GÜVENLİK ADIMI</p>
                <h3 className="passkey-brief-title">Passkey kurulumunu tamamlayın</h3>
                <p className="passkey-brief-text">
                  Cihaz verisi silinse bile hesabınızı geri yükleyip QR ile mesaiye kesintisiz devam edebilirsiniz.
                </p>
                <ul className="passkey-brief-list">
                  <li>Tarayıcı verisi silinirse hesabınızı geri kazanırsınız.</li>
                  <li>Şifre ezberlemeden biyometrik doğrulama kullanırsınız.</li>
                  <li>Yeni cihazda kurtarma süresi ciddi şekilde kısalır.</li>
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
                    Kurtarma ekranını gör
                  </Link>
                </div>
              </section>
            ) : (
              <section className="passkey-brief passkey-brief-ready">
                <p className="passkey-brief-kicker">PASSKEY AKTİF</p>
                <p className="passkey-brief-text">
                  Cihaz verisi silinirse <strong>/recover</strong> ekranı ile kimliğini geri yükleyebilirsin.
                </p>
              </section>
            )}

            <section className={`passkey-brief ${recoveryReady ? 'passkey-brief-ready' : 'passkey-brief-setup'}`}>
              <p className="passkey-brief-kicker">RECOVERY FALLBACK</p>
              <h3 className="passkey-brief-title">Passkey zorunlu degil, Recovery Code kullan</h3>
              <p className="passkey-brief-text">
                iPhone dahil tum cihazlarda recovery code + PIN ile cihaz kimligini geri yukleyebilirsin.
              </p>
              {recoveryExpiresAt ? (
                <p className="small-text">
                  Son gecerlilik: <strong>{formatTs(recoveryExpiresAt)}</strong>
                </p>
              ) : null}
              <div className="passkey-brief-actions">
                <button
                  type="button"
                  className="btn btn-primary passkey-brief-btn"
                  disabled={!deviceFingerprint || isRecoveryBusy || isSubmitting}
                  onClick={() => void runRecoveryCodeIssue()}
                >
                  {isRecoveryBusy
                    ? 'Recovery kodlari uretiliyor...'
                    : recoveryReady
                      ? 'Recovery Kodlarini Yenile'
                      : 'Recovery Kodu Olustur'}
                </button>
                <Link className="inline-link passkey-brief-link" to="/recover">
                  Kurtarma ekranina git
                </Link>
              </div>
              {recoveryNotice ? <p className="small-text mt-2">{recoveryNotice}</p> : null}
              {recoveryCodesPreview && recoveryCodesPreview.length > 0 ? (
                <div className="notice-box notice-box-warning mt-2">
                  <p className="small-text">
                    Kodlari bir kez goruyorsun. Guvenli yere kaydet:
                  </p>
                  <p className="small-text">
                    <strong>{recoveryCodesPreview.join(' | ')}</strong>
                  </p>
                </div>
              ) : null}
            </section>

            <div className="status-cta-row status-cta-row-compact">
              <button type="button" className="btn btn-ghost" onClick={() => setIsHelpOpen(true)}>
                Nasıl çalışır?
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
                  ? 'Bildirim açılıyor...'
                  : pushRegistered
                    ? 'Bildirimler Açık'
                    : pushRequiresStandalone
                      ? 'Ana Ekrana Ekle'
                      : 'Bildirimleri Aç'}
              </button>
            </div>
          </section>

          <section className="employee-action-surface">
            <section className="action-panel" ref={actionPanelRef}>
              <div className="action-panel-head">
                <p className="small-title">Komut Merkezi</p>
                <span className="action-panel-kicker">Hızlı İşlemler</span>
              </div>
              <div className="stack">
                <button
                  type="button"
                  className="btn btn-primary btn-lg"
                  disabled={!canQrScan}
                  onClick={() => {
                    if (!canQrScan) {
                      setErrorMessage(todayStatusHint(todayStatus))
                      return
                    }
                    if (pushGateRequired) {
                      setPushGateDismissed(false)
                      setPushGateRequestedByQr(true)
                      setPushSecondChanceOpen(false)
                      setErrorMessage(
                        pushRequiresStandalone
                          ? 'QR baslatmak icin once iPhone kurulumunu tamamlayip bildirimleri acin.'
                          : 'QR baslatmak icin once bildirimleri acin.',
                      )
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
                    'QR ile İşlem Başlat'
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
                    'Mesaiyi Güvenli Bitir'
                  )}
                </button>
              </div>

              <ol className="action-flow">
                <li>QR okutun ve işlemi başlatın.</li>
                <li>Mesai sonunda güvenli bitiş yapın.</li>
                <li>Durum kartlarından anlık takibi doğrulayın.</li>
              </ol>

              <p className="muted small-text employee-flow-hint">
                {pushGateRequired
                  ? 'QR islemi baslatirken bildirim adimi zorunlu olarak acilir.'
                  : 'QR ile işlem başlatabilir veya açık vardiyayı güvenli şekilde kapatabilirsiniz.'}
              </p>
            </section>

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
                <p className="muted small-text mt-2">Daha once kurulum yaptiysan passkey veya recovery code ile kurtarma kullan.</p>
                <Link className="inline-link" to="/recover">
                  /recover ekranına git
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
              Hatırlatma: Mesaiyi bitirmeyi unutmayın.
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
                <p className="scanner-modal-kicker">Hızlı QR Tarama</p>
                <button
                  type="button"
                  className="scanner-modal-close"
                  aria-label="QR tarama penceresini kapat"
                  onClick={() => setScannerActive(false)}
                >
                  ×
                </button>
              </div>
              <p className="scanner-title">QR kodu kameraya tutun</p>
              <p className="scanner-subtitle">
                Kod algılandığı anda puantaj işlemi otomatik başlatılır.
              </p>
              <Suspense fallback={<div className="scanner-overlay scanner-loading">Kamera modülü yükleniyor...</div>}>
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
                  Kamerayı Kapat
                </button>
              </div>
            </section>
          </div>
        ) : null}

        {scanSuccessFxOpen ? (
          <div className="scan-success-overlay" role="status" aria-live="polite" aria-label="QR onaylandı">
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

        {showIosInstallOnboarding ? (
          <div className="modal-backdrop install-onboarding-backdrop" role="dialog" aria-modal="true">
            <div className="help-modal install-onboarding-modal">
              <p className="install-onboarding-kicker">IPHONE KURULUM</p>
              <h2>Ana Ekrana Ekle</h2>
              <p>
                Bu portali uygulama gibi kullanmak icin Safari uzerinden tek seferlik kurulum yapin.
                {iosInAppBrowserBlocked ? ' Once Safari ile acmaniz gerekiyor.' : ''}
              </p>
              <ol className="install-onboarding-list">
                <li>Safari alt menuden Paylas ikonuna dokunun.</li>
                <li>Ana Ekrana Ekle secenegini secin.</li>
                <li>Ekleye dokunup YABUJIN kisayolunu acin.</li>
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
                {iosInAppBrowserBlocked ? (
                  <button
                    type="button"
                    className="btn btn-soft"
                    onClick={() => void copyPortalLinkForSafari()}
                  >
                    Linki Kopyala
                  </button>
                ) : null}
                <button type="button" className="btn btn-soft" onClick={dismissIosInstallOnboarding}>
                  24 Saat Sonra Hatirlat
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {showAndroidInstallOnboarding ? (
          <div className="modal-backdrop install-onboarding-backdrop" role="dialog" aria-modal="true">
            <div className="help-modal install-onboarding-modal">
              <p className="install-onboarding-kicker">ANDROID KURULUM</p>
              <h2>Tek Seferde Ana Ekrana Ekle</h2>
              <p>
                {installPromptEvent
                  ? 'Kurulum penceresi hazir, tek butonla tamamlayabilirsiniz.'
                  : 'Kurulum penceresi hazir degilse Chrome menüsünden hızlıca tamamlayın.'}
              </p>
              <ol className="install-onboarding-list">
                <li>Chrome sağ üstten 3 nokta menüsünü açın.</li>
                <li>"Ana ekrana ekle" veya "Install app" seçeneğini seçin.</li>
                <li>"Ekle / Install" ile kurulumu bitirin.</li>
              </ol>
              <div className="stack">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={isInstallPromptBusy}
                  onClick={() => void runInstallPrompt()}
                >
                  {isInstallPromptBusy ? 'Aciliyor...' : installPromptEvent ? 'Tek Dokunusla Kur' : 'Tekrar Dene'}
                </button>
                <button type="button" className="btn btn-soft" onClick={dismissAndroidInstallOnboarding}>
                  Simdilik Kapat
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {isHelpOpen ? (
          <div className="modal-backdrop" role="dialog" aria-modal="true">
            <div className="help-modal">
              <h2>Mesai Bitiş Bilgilendirmesi</h2>
              <p>Gün içinde girişten sonra çıkışı mutlaka "Mesaiyi Bitir" ile tamamlayın.</p>
              <button type="button" className="btn btn-primary" onClick={() => setIsHelpOpen(false)}>
                Anladım
              </button>
            </div>
          </div>
        ) : null}

        {showPushGateModal ? (
          <div className="modal-backdrop" role="dialog" aria-modal="true">
            <div className="help-modal">
              <h2>Bildirim İzni Zorunlu</h2>
              <p>
                {pushSecondChanceOpen
                  ? 'Bildirim izni ilk denemede verilmedi. Bu özellik sistemin zorunlu bir parçası. Lütfen son kez izin verin.'
                  : pushGateMessage}
              </p>
              <div className="stack">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={isPushBusy || !pushEnabled || !pushRuntimeSupported}
                  onClick={() => {
                    if (pushRequiresStandalone) {
                      setPushGateRequestedByQr(false)
                      openIosInstallOnboarding()
                      return
                    }
                    void runPushSubscription(pushSecondChanceOpen)
                  }}
                >
                  {isPushBusy
                    ? 'Bildirim açılıyor...'
                    : pushRequiresStandalone
                      ? 'Ana Ekrana Ekle'
                    : pushSecondChanceOpen
                      ? 'Tekrar Sor (2/2)'
                      : 'Bildirimleri Aç'}
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

        {showInstallPromotions ? (
          <aside className="promo-rail promo-rail-right" aria-label="Kurumsal tanitim paneli">
            <p className="promo-rail-kicker">KURUMSAL VERİMLİLİK</p>
            <h2 className="promo-rail-title">Sahada hız, merkezde kontrol.</h2>
            <p className="promo-rail-text">
              Çalışan uygulamasını indirerek tek ekran üzerinden puantaj, güvenlik ve bildirim akışını yönetin.
            </p>
            <div className="promo-rail-badges">
              <span className={`promo-rail-badge ${todayStatusClass}`}>{todayStatusLabel(todayStatus)}</span>
              <span className={`promo-rail-badge ${passkeyRegistered ? 'state-ok' : 'state-warn'}`}>
                {passkeyRegistered ? 'Passkey Hazır' : 'Passkey Bekliyor'}
              </span>
              <span className={`promo-rail-badge ${pushRegistered ? 'state-ok' : 'state-warn'}`}>
                {pushRegistered ? 'Push Açık' : 'Push Bekliyor'}
              </span>
            </div>
            <button
              type="button"
              className="btn btn-primary promo-rail-btn"
              disabled={isInstallPromptBusy || isStandaloneApp}
              onClick={() => void runDownloadInstallAction()}
            >
              {installRailPrimaryLabel}
            </button>
            <p className="promo-rail-note">Butona basıp uygulamayı indirerek daha kurumsal bir kullanım deneyimi alın.</p>
          </aside>
        ) : null}
      </div>

      {showInstallPromotions ? (
        <div className="promo-mobile-dock" role="region" aria-label="Hizli uygulama indirme">
          <p className="promo-mobile-text">Uygulamayı indir, portalı daha hızlı ve stabil kullan.</p>
          <button
            type="button"
            className="btn btn-primary promo-mobile-btn"
            disabled={isInstallPromptBusy || isStandaloneApp}
            onClick={() => void runDownloadInstallAction()}
          >
            {installRailPrimaryLabel}
          </button>
        </div>
      ) : null}
    </main>
  )
}

