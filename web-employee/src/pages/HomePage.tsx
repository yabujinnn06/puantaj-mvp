import { type ReactNode, type RefObject, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation } from 'react-router-dom'

import {
  checkout,
  createEmployeeConversation,
  createEmployeeConversationMessage,
  downloadEmployeeLeaveAttachment,
  getEmployeeConversationThread,
  getEmployeeConversations,
  getEmployeeDemoHistory,
  getEmployeeLeaveThread,
  getEmployeeLeaves,
  getEmployeePushConfig,
  getRecoveryCodeStatus,
  getEmployeeStatus,
  getPasskeyRegisterOptions,
  issueRecoveryCodes,
  postEmployeeAppPresencePing,
  postEmployeeInstallFunnelEvent,
  parseApiError,
  revealRecoveryCodes,
  scanEmployeeQr,
  submitEmployeeLeaveRequest,
  subscribeEmployeePush,
  verifyPasskeyRegistration,
  type ParsedApiError,
} from '../api/attendance'
import { BrandSignature } from '../components/BrandSignature'
import {
  EmployeeCriticalAlerts,
  EmployeeHeader,
  EmployeeLastActionSummary,
  EmployeeMainActionCard,
  SecondaryFeaturesSection,
} from '../components/EmployeeHomeSections'
import { UI_BRANDING } from '../config/ui'
import { useToast } from '../hooks/useToast'
import type {
  AttendanceActionResponse,
  EmployeeConversationCategory,
  EmployeeConversationRecord,
  EmployeeConversationThreadRecord,
  EmployeeDemoDayResponse,
  EmployeeLeaveRecord,
  EmployeeLeaveThreadRecord,
  EmployeeStatusResponse,
  LeaveStatus,
  LeaveType,
} from '../types/api'
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

const demoTimeFormatter = new Intl.DateTimeFormat('tr-TR', {
  hour: '2-digit',
  minute: '2-digit',
})

const leaveDateFormatter = new Intl.DateTimeFormat('tr-TR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

const leaveTypeLabels: Record<LeaveType, string> = {
  ANNUAL: 'Yillik izin',
  SICK: 'Rapor / hastalik',
  UNPAID: 'Ucretsiz izin',
  EXCUSE: 'Mazeret izni',
  PUBLIC_HOLIDAY: 'Resmi tatil',
}

const leaveStatusLabels: Record<LeaveStatus, string> = {
  APPROVED: 'Onaylandi',
  PENDING: 'Beklemede',
  REJECTED: 'Reddedildi',
}

const conversationCategoryLabels: Record<EmployeeConversationCategory, string> = {
  ATTENDANCE: 'Puantaj',
  SHIFT: 'Vardiya',
  DEVICE: 'Cihaz',
  DOCUMENT: 'Belge',
  OTHER: 'Genel',
}

const communicationTemplates: Array<{
  label: string
  category: EmployeeConversationCategory
  subject: string
  message: string
}> = [
  {
    label: 'Puantaj desteği',
    category: 'ATTENDANCE',
    subject: 'Puantaj kaydım için destek talebi',
    message: 'Puantaj kaydımla ilgili güncel durumu ve gerekirse yapılması gereken adımı paylaşabilir misiniz?',
  },
  {
    label: 'Vardiya desteği',
    category: 'SHIFT',
    subject: 'Vardiya planım için destek talebi',
    message: 'Vardiya planımla ilgili güncel bilgiyi ve varsa dikkat etmem gereken değişikliği paylaşabilir misiniz?',
  },
  {
    label: 'Belge desteği',
    category: 'DOCUMENT',
    subject: 'Belge süreci için destek talebi',
    message: 'Belge sürecim için ek işlem veya ek belge gerekip gerekmediğini öğrenmek istiyorum.',
  },
]

const communicationReplyStarters = [
  'Talebimin güncel durumu hakkında bilgi rica ediyorum.',
  'Bir sonraki adımı paylaşabilir misiniz?',
  'Gerekliyse ek belge veya işlem adımını iletebilir misiniz?',
]

const LEAVE_ATTACHMENT_ACCEPT = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
].join(',')

function formatAttachmentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 KB'
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.URL.revokeObjectURL(url)
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

function formatDemoTime(value: string | null | undefined): string {
  if (!value) {
    return '--:--'
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return '--:--'
  }
  return demoTimeFormatter.format(parsed)
}

function formatLeaveDate(value: string | null | undefined): string {
  if (!value) {
    return '--'
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }
  return leaveDateFormatter.format(parsed)
}

function formatLeaveRange(startDate: string, endDate: string): string {
  if (startDate === endDate) {
    return formatLeaveDate(startDate)
  }
  return `${formatLeaveDate(startDate)} - ${formatLeaveDate(endDate)}`
}

function conversationStatusLabel(status: 'OPEN' | 'CLOSED'): string {
  return status === 'CLOSED' ? 'Kapalı' : 'Açık'
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

function sanitizeEmployeeActionMessage(parsed: ParsedApiError, fallback: string): string {
  if (parsed.code === 'QR_POINT_OUT_OF_RANGE' || parsed.code === 'QR_CODE_HAS_NO_ACTIVE_POINTS') {
    return 'Bu QR adımı şu anda kullanıma uygun değil. Lütfen ilgili noktada tekrar deneyin.'
  }

  const normalized = parsed.message.toLocaleLowerCase('tr-TR')
  if (
    normalized.includes('konum')
    || normalized.includes('location')
    || normalized.includes('home_location')
    || normalized.includes('qr point')
  ) {
    return fallback
  }

  return parsed.message
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

function playCheckoutPromptTone() {
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
    const firstOscillator = audioContext.createOscillator()
    const secondOscillator = audioContext.createOscillator()
    const gainNode = audioContext.createGain()
    const startAt = audioContext.currentTime

    firstOscillator.type = 'triangle'
    firstOscillator.frequency.setValueAtTime(980, startAt)
    firstOscillator.frequency.exponentialRampToValueAtTime(1420, startAt + 0.16)

    secondOscillator.type = 'triangle'
    secondOscillator.frequency.setValueAtTime(1180, startAt + 0.2)
    secondOscillator.frequency.exponentialRampToValueAtTime(1640, startAt + 0.36)

    gainNode.gain.setValueAtTime(0.0001, startAt)
    gainNode.gain.exponentialRampToValueAtTime(0.34, startAt + 0.025)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.18)
    gainNode.gain.setValueAtTime(0.0001, startAt + 0.19)
    gainNode.gain.exponentialRampToValueAtTime(0.38, startAt + 0.23)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.42)

    firstOscillator.connect(gainNode)
    secondOscillator.connect(gainNode)
    gainNode.connect(audioContext.destination)

    firstOscillator.start(startAt)
    firstOscillator.stop(startAt + 0.18)
    secondOscillator.start(startAt + 0.2)
    secondOscillator.stop(startAt + 0.42)
    secondOscillator.onended = () => {
      void audioContext.close()
    }
  } catch {
    // Sessiz fallback: ses desteği yoksa işlem normal devam eder.
  }
}

function playDemoPromptTone() {
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
    const firstOscillator = audioContext.createOscillator()
    const secondOscillator = audioContext.createOscillator()
    const gainNode = audioContext.createGain()
    const startAt = audioContext.currentTime

    firstOscillator.type = 'square'
    firstOscillator.frequency.setValueAtTime(1560, startAt)
    firstOscillator.frequency.exponentialRampToValueAtTime(1820, startAt + 0.08)

    secondOscillator.type = 'square'
    secondOscillator.frequency.setValueAtTime(1620, startAt + 0.13)
    secondOscillator.frequency.exponentialRampToValueAtTime(1910, startAt + 0.22)

    gainNode.gain.setValueAtTime(0.0001, startAt)
    gainNode.gain.exponentialRampToValueAtTime(0.18, startAt + 0.01)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.1)
    gainNode.gain.setValueAtTime(0.0001, startAt + 0.12)
    gainNode.gain.exponentialRampToValueAtTime(0.2, startAt + 0.14)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.24)

    firstOscillator.connect(gainNode)
    secondOscillator.connect(gainNode)
    gainNode.connect(audioContext.destination)

    firstOscillator.start(startAt)
    firstOscillator.stop(startAt + 0.1)
    secondOscillator.start(startAt + 0.13)
    secondOscillator.stop(startAt + 0.24)
    secondOscillator.onended = () => {
      void audioContext.close()
    }
  } catch {
    // no-op
  }
}

interface EmployeeFocusModalProps {
  title: string
  titleId: string
  children: ReactNode
  kicker?: string
  descriptionId?: string
  onClose?: () => void
  panelClassName?: string
}

function EmployeeFocusModal({
  title,
  titleId,
  children,
  kicker,
  descriptionId,
  onClose,
  panelClassName,
}: EmployeeFocusModalProps) {
  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div
      className="modal-backdrop checkout-confirm-backdrop employee-focus-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onClick={onClose}
    >
      <div className="checkout-confirm-lights" aria-hidden="true">
        <span className="checkout-confirm-light checkout-confirm-light-left" />
        <span className="checkout-confirm-light checkout-confirm-light-center" />
        <span className="checkout-confirm-light checkout-confirm-light-right" />
      </div>
      <div
        className={`help-modal checkout-confirm-modal employee-focus-modal ${panelClassName ?? ''}`.trim()}
        onClick={(event) => event.stopPropagation()}
      >
        {kicker ? <p className="checkout-confirm-kicker">{kicker}</p> : null}
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>,
    document.body,
  )
}

interface EmployeeHeaderSectionProps {
  employeeDisplayName: string
  contextLine: string
  todayStatusClass: string
  todayStatusLabel: string
  chips: string[]
}

function EmployeeHeaderSection({
  employeeDisplayName,
  contextLine,
  todayStatusClass,
  todayStatusLabel,
  chips,
}: EmployeeHeaderSectionProps) {
  return (
    <section className="employee-home-header" aria-label="Calisan ozeti">
      <div className="employee-home-header-top">
        <div className="employee-home-header-copy">
          <p className="employee-home-kicker">CALISAN</p>
          <h2 className="employee-home-title">{employeeDisplayName}</h2>
          <p className="employee-home-subtitle">{contextLine}</p>
        </div>
        <span className={`status-pill ${todayStatusClass} employee-home-status`}>{todayStatusLabel}</span>
      </div>
      {chips.length > 0 ? (
        <div className="employee-home-chip-row">
          {chips.map((chip) => (
            <span key={chip} className="employee-home-chip">
              {chip}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  )
}

interface MainActionCardProps {
  panelRef: RefObject<HTMLElement | null>
  todayStatusClass: string
  todayStatusLabel: string
  todayStatusHintText: string
  shiftSummary: string
  activityMeta: string
  focusText: string
  canQrScan: boolean
  canCheckout: boolean
  isSubmitting: boolean
  pendingAction: 'checkin' | 'checkout' | 'demo' | null
  pushGateRequired: boolean
  onOpenScanner: () => void
  onOpenCheckout: () => void
}

function MainActionCard({
  panelRef,
  todayStatusClass,
  todayStatusLabel,
  todayStatusHintText,
  shiftSummary,
  activityMeta,
  focusText,
  canQrScan,
  canCheckout,
  isSubmitting,
  pendingAction,
  pushGateRequired,
  onOpenScanner,
  onOpenCheckout,
}: MainActionCardProps) {
  return (
    <section className="action-panel employee-main-action-card" ref={panelRef}>
      <div className="employee-main-action-head">
        <div className="employee-main-action-copy">
          <p className="employee-home-kicker">ANA ISLEMLER</p>
          <h2 className="employee-main-action-title">Bugunku puantaj islemleri</h2>
          <p className="employee-main-action-text">{todayStatusHintText}</p>
        </div>
        <span className={`status-pill ${todayStatusClass}`}>{todayStatusLabel}</span>
      </div>

      <div className="employee-main-action-meta">
        <div className="employee-main-action-meta-item">
          <span className="employee-main-action-meta-label">Atanan vardiya</span>
          <strong className="employee-main-action-meta-value">{shiftSummary}</strong>
        </div>
        <div className="employee-main-action-meta-item">
          <span className="employee-main-action-meta-label">Bugunku durum</span>
          <strong className="employee-main-action-meta-value">{activityMeta}</strong>
        </div>
      </div>

      <div className="employee-main-action-buttons">
        <button
          type="button"
          className="btn btn-primary action-cta-btn"
          disabled={!canQrScan}
          onClick={onOpenScanner}
        >
          {isSubmitting && pendingAction === 'checkin' ? (
            <>
              <span className="inline-spinner" aria-hidden="true" />
              Islem yapiliyor...
            </>
          ) : (
            <span className="action-cta-copy">QR Kod Oku</span>
          )}
        </button>

        <button
          type="button"
          className="btn btn-outline action-cta-btn"
          disabled={!canCheckout}
          onClick={onOpenCheckout}
        >
          {isSubmitting && pendingAction === 'checkout' ? (
            <>
              <span className="inline-spinner inline-spinner-dark" aria-hidden="true" />
              Islem yapiliyor...
            </>
          ) : (
            <span className="action-cta-copy">Mesaiyi Guvenli Bitir</span>
          )}
        </button>
      </div>

      <p className="employee-main-action-note">
        {pushGateRequired
          ? 'QR islemi oncesinde bildirim adimi zorunlu olarak acilir.'
          : focusText}
      </p>
    </section>
  )
}

type LastActionSummaryTone = 'neutral' | 'success' | 'warning'

interface LastActionSummaryContent {
  title: string
  detail: string
  note: string
  tone: LastActionSummaryTone
}

interface LastActionSummarySectionProps {
  summary: LastActionSummaryContent | null
  lastAction: LastAction | null
  duplicateDetected: boolean
  manualCheckout: boolean
  visibleFlags: Array<[string, unknown]>
}

function LastActionSummarySection({
  summary,
  lastAction,
  duplicateDetected,
  manualCheckout,
  visibleFlags,
}: LastActionSummarySectionProps) {
  const toneClassName =
    summary?.tone === 'success'
      ? 'is-success'
      : summary?.tone === 'warning'
        ? 'is-warning'
        : 'is-neutral'

  return (
    <section className={`result-box employee-last-action-card ${toneClassName}`} aria-label="Son islem ozeti">
      <div className="employee-last-action-head">
        <div className="employee-last-action-copy">
          <p className="small-title">Son islem</p>
          <h2 className="employee-last-action-title">{summary?.title ?? 'Henuz bir islem gorunmuyor'}</h2>
        </div>
        {summary ? <p className="employee-last-action-time">{summary.detail}</p> : null}
      </div>

      <p className="employee-last-action-note">
        {summary?.note ?? 'Ilk QR okuma veya guvenli cikis sonrasinda ozet burada gorunur.'}
      </p>

      {duplicateDetected || manualCheckout ? (
        <div className="chips">
          {duplicateDetected ? <span className="status-pill state-warn">Mukerrer kayit</span> : null}
          {manualCheckout ? <span className="manual-badge">Manuel cikis yapildi</span> : null}
        </div>
      ) : null}

      {lastAction ? (
        <details className="employee-last-action-details">
          <summary>Teknik detaylari goster</summary>
          <div className="employee-last-action-technical">
            <ul className="employee-technical-list">
              <li>
                <span>Islem turu</span>
                <strong>{eventTypeLabel(lastAction.response.event_type)}</strong>
              </li>
              <li>
                <span>Kayit zamani</span>
                <strong>{formatTs(lastAction.response.ts_utc)}</strong>
              </li>
              {lastAction.codeValue ? (
                <li>
                  <span>Okutulan kod</span>
                  <strong>{lastAction.codeValue}</strong>
                </li>
              ) : null}
            </ul>

            {visibleFlags.length > 0 ? (
              <div className="stack-tight">
                <p className="small-title">Sistem notlari</p>
                <ul className="flag-list">
                  {visibleFlags.map(([key, value]) => (
                    <li key={key}>
                      <strong>{flagLabel(key, value)}</strong>: {prettyFlagValue(value)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
    </section>
  )
}

interface CriticalAlertsSectionProps {
  deviceFingerprint: string | null
  hasOpenShift: boolean
  openShiftCheckinTime: string | null
  locationWarning: string | null
  scannerError: string | null
  errorMessage: string | null
  requestId: string | null
}

function CriticalAlertsSection({
  deviceFingerprint,
  hasOpenShift,
  openShiftCheckinTime,
  locationWarning,
  scannerError,
  errorMessage,
  requestId,
}: CriticalAlertsSectionProps) {
  if (!deviceFingerprint && !hasOpenShift && !locationWarning && !scannerError && !errorMessage) {
    return null
  }

  return (
    <section className="employee-alerts" aria-label="Onemli uyarilar">
      <div className="employee-secondary-head">
        <p className="employee-home-kicker">ONEMLI UYARILAR</p>
        <h2 className="employee-secondary-title">Sadece hemen ilgilenmeniz gereken konular</h2>
      </div>

      {!deviceFingerprint ? (
        <div className="warn-box">
          <p>Cihaz bagli degil. Davet linki ile kurulumu tamamlayin veya kurtarma akisini kullanin.</p>
          <div className="employee-inline-links">
            <Link className="inline-link" to="/claim">
              /claim ekranina git
            </Link>
            <Link className="inline-link" to="/recover">
              /recover ekranina git
            </Link>
          </div>
        </div>
      ) : null}

      {hasOpenShift ? (
        <div className="notice-box notice-box-warning">
          <p>
            <span className="banner-icon" aria-hidden="true">
              !
            </span>
            Acik vardiya var, cikis kaydi bekleniyor.
          </p>
          {openShiftCheckinTime ? <p className="small-text">Son giris: {formatTs(openShiftCheckinTime)}</p> : null}
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
    </section>
  )
}

interface SecondaryDisclosureProps {
  title: string
  description: string
  badge?: string
  open?: boolean
  children: ReactNode
}

function SecondaryDisclosure({ title, description, badge, open, children }: SecondaryDisclosureProps) {
  return (
    <details className="employee-secondary-disclosure" open={open || undefined}>
      <summary>
        <div className="employee-secondary-disclosure-copy">
          <span className="employee-secondary-disclosure-title">{title}</span>
          <p className="employee-secondary-disclosure-text">{description}</p>
        </div>
        {badge ? <span className="employee-secondary-disclosure-badge">{badge}</span> : null}
      </summary>
      <div className="employee-secondary-disclosure-body">{children}</div>
    </details>
  )
}

export function HomePage() {
  const location = useLocation()
  const [deviceFingerprint, setDeviceFingerprint] = useState<string | null>(() =>
    getStoredDeviceFingerprint(),
  )
  const [scannerActive, setScannerActive] = useState(false)
  const [scanSuccessFxOpen, setScanSuccessFxOpen] = useState(false)
  const [scannerError, setScannerError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pendingAction, setPendingAction] = useState<'checkin' | 'checkout' | 'demo' | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [secondCheckinApprovalAlert, setSecondCheckinApprovalAlert] = useState<ParsedApiError | null>(null)
  const [locationWarning, setLocationWarning] = useState<string | null>(null)
  const [requestId, setRequestId] = useState<string | null>(null)
  const [lastAction, setLastAction] = useState<LastAction | null>(null)
  const [actionNotice, setActionNotice] = useState<{ tone: 'success' | 'warning'; text: string } | null>(null)
  const [todayStatus, setTodayStatus] = useState<TodayStatus>('NOT_STARTED')
  const [statusSnapshot, setStatusSnapshot] = useState<EmployeeStatusResponse | null>(null)
  const [demoHistory, setDemoHistory] = useState<EmployeeDemoDayResponse | null>(null)
  const [isDemoHistoryLoading, setIsDemoHistoryLoading] = useState(false)
  const [isDemoHistoryReady, setIsDemoHistoryReady] = useState(false)
  const [leaveHistory, setLeaveHistory] = useState<EmployeeLeaveRecord[]>([])
  const [isLeaveHistoryLoading, setIsLeaveHistoryLoading] = useState(false)
  const [isLeaveHistoryReady, setIsLeaveHistoryReady] = useState(false)
  const [leaveRefreshToken, setLeaveRefreshToken] = useState(0)
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false)
  const [isLeaveHistoryExpanded, setIsLeaveHistoryExpanded] = useState(false)
  const [isLeaveSubmitting, setIsLeaveSubmitting] = useState(false)
  const [leaveStartDate, setLeaveStartDate] = useState('')
  const [leaveEndDate, setLeaveEndDate] = useState('')
  const [leaveType, setLeaveType] = useState<LeaveType>('ANNUAL')
  const [leaveNote, setLeaveNote] = useState('')
  const [leaveAttachmentFile, setLeaveAttachmentFile] = useState<File | null>(null)
  const [leaveFormError, setLeaveFormError] = useState<string | null>(null)
  const [leaveThreadsById, setLeaveThreadsById] = useState<Record<number, EmployeeLeaveThreadRecord>>({})
  const [activeLeaveThreadId, setActiveLeaveThreadId] = useState<number | null>(null)
  const [leaveThreadLoadingId, setLeaveThreadLoadingId] = useState<number | null>(null)
  const [leaveThreadErrorById, setLeaveThreadErrorById] = useState<Record<number, string | null>>({})
  const [communicationList, setCommunicationList] = useState<EmployeeConversationRecord[]>([])
  const [isCommunicationLoading, setIsCommunicationLoading] = useState(false)
  const [isCommunicationReady, setIsCommunicationReady] = useState(false)
  const [communicationRefreshToken, setCommunicationRefreshToken] = useState(0)
  const [isCommunicationModalOpen, setIsCommunicationModalOpen] = useState(false)
  const [communicationCategory, setCommunicationCategory] = useState<EmployeeConversationCategory>('ATTENDANCE')
  const [communicationSubject, setCommunicationSubject] = useState('')
  const [communicationMessage, setCommunicationMessage] = useState('')
  const [communicationFormError, setCommunicationFormError] = useState<string | null>(null)
  const [isCommunicationSubmitting, setIsCommunicationSubmitting] = useState(false)
  const [communicationThreadsById, setCommunicationThreadsById] = useState<Record<number, EmployeeConversationThreadRecord>>({})
  const [activeCommunicationId, setActiveCommunicationId] = useState<number | null>(null)
  const [communicationThreadLoadingId, setCommunicationThreadLoadingId] = useState<number | null>(null)
  const [communicationThreadErrorById, setCommunicationThreadErrorById] = useState<Record<number, string | null>>({})
  const [communicationReplyDrafts, setCommunicationReplyDrafts] = useState<Record<number, string>>({})
  const [communicationReplyBusyId, setCommunicationReplyBusyId] = useState<number | null>(null)
  const [isHelpOpen, setIsHelpOpen] = useState(false)
  const [isCheckoutConfirmOpen, setIsCheckoutConfirmOpen] = useState(false)
  const [isDemoConfirmOpen, setIsDemoConfirmOpen] = useState(false)
  const [isDemoLocationPromptOpen, setIsDemoLocationPromptOpen] = useState(false)

  const [isPasskeyBusy, setIsPasskeyBusy] = useState(false)
  const [passkeyNotice, setPasskeyNotice] = useState<string | null>(null)
  const [isRecoveryBusy, setIsRecoveryBusy] = useState(false)
  const [recoveryReady, setRecoveryReady] = useState(false)
  const [recoveryCodeCount, setRecoveryCodeCount] = useState(0)
  const [recoveryExpiresAt, setRecoveryExpiresAt] = useState<string | null>(null)
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null)
  const [recoveryCodesPreview, setRecoveryCodesPreview] = useState<string[] | null>(null)
  const [recoveryRevealPin, setRecoveryRevealPin] = useState('')
  const [isRecoveryRevealBusy, setIsRecoveryRevealBusy] = useState(false)

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
  const { pushToast } = useToast()
  const scanSuccessFxTimerRef = useRef<number | null>(null)
  const actionPanelRef = useRef<HTMLElement | null>(null)
  const qrPanelAutoFocusDoneRef = useRef(false)
  const installBannerVisiblePrevRef = useRef(false)
  const iosOnboardingVisiblePrevRef = useRef(false)
  const androidOnboardingVisiblePrevRef = useRef(false)
  const iosInAppBrowserLoggedRef = useRef(false)
  const iosBrowserContext = useMemo(() => detectIosBrowserContext(), [])
  const installFunnelLastSentRef = useRef<Record<string, number>>({})
  const toastDedupRef = useRef<Record<string, string | null>>({})

  const emitToast = useCallback(
    (
      scope: string,
      key: string | null,
      toast:
        | {
            title: string
            description?: string
            variant?: 'success' | 'error' | 'warning' | 'info'
            durationMs?: number
          }
        | null,
    ) => {
      if (!key || !toast) {
        toastDedupRef.current[scope] = null
        return
      }
      if (toastDedupRef.current[scope] === key) {
        return
      }
      toastDedupRef.current[scope] = key
      pushToast(toast)
    },
    [pushToast],
  )

  useEffect(() => {
    if (!errorMessage) {
      emitToast('error', null, null)
      return
    }
    emitToast('error', errorMessage, {
      title: 'Islem uyarisi',
      description: errorMessage,
      variant: 'error',
      durationMs: 5200,
    })
  }, [emitToast, errorMessage])

  useEffect(() => {
    if (!scannerError) {
      emitToast('scannerError', null, null)
      return
    }
    emitToast('scannerError', scannerError, {
      title: 'Kamera uyarisi',
      description: scannerError,
      variant: 'warning',
      durationMs: 5200,
    })
  }, [emitToast, scannerError])

  useEffect(() => {
    if (!locationWarning) {
      emitToast('locationWarning', null, null)
      return
    }
    emitToast('locationWarning', locationWarning, {
      title: 'Konum uyarisi',
      description: locationWarning,
      variant: 'warning',
    })
  }, [emitToast, locationWarning])

  useEffect(() => {
    if (!passkeyNotice) {
      emitToast('passkeyNotice', null, null)
      return
    }
    emitToast('passkeyNotice', passkeyNotice, {
      title: 'Passkey',
      description: passkeyNotice,
      variant: 'success',
    })
  }, [emitToast, passkeyNotice])

  useEffect(() => {
    if (!recoveryNotice) {
      emitToast('recoveryNotice', null, null)
      return
    }
    emitToast('recoveryNotice', recoveryNotice, {
      title: 'Recovery Code',
      description: recoveryNotice,
      variant: 'info',
      durationMs: 5000,
    })
  }, [emitToast, recoveryNotice])

  useEffect(() => {
    if (!leaveFormError) {
      emitToast('leaveFormError', null, null)
      return
    }
    emitToast('leaveFormError', leaveFormError, {
      title: 'Izin talebi',
      description: leaveFormError,
      variant: 'warning',
      durationMs: 5200,
    })
  }, [emitToast, leaveFormError])

  useEffect(() => {
    if (!pushNotice) {
      emitToast('pushNotice', null, null)
      return
    }
    emitToast('pushNotice', pushNotice, {
      title: 'Bildirimler',
      description: pushNotice,
      variant: 'success',
    })
  }, [emitToast, pushNotice])

  useEffect(() => {
    if (!installNotice) {
      emitToast('installNotice', null, null)
      return
    }
    emitToast('installNotice', installNotice, {
      title: 'Kurulum',
      description: installNotice,
      variant: 'info',
    })
  }, [emitToast, installNotice])

  useEffect(() => {
    if (!actionNotice) {
      emitToast('actionNotice', null, null)
      return
    }
    emitToast('actionNotice', `${actionNotice.tone}:${actionNotice.text}`, {
      title: actionNotice.tone === 'success' ? 'Islem kaydedildi' : 'Islem uyarisi',
      description: actionNotice.text,
      variant: actionNotice.tone === 'success' ? 'success' : 'warning',
    })
  }, [actionNotice, emitToast])

  useEffect(() => {
    if (!secondCheckinApprovalAlert) {
      emitToast('secondCheckinApproval', null, null)
      return
    }
    emitToast(
      'secondCheckinApproval',
      `${secondCheckinApprovalAlert.code ?? 'SECOND_CHECKIN_APPROVAL_REQUIRED'}:${secondCheckinApprovalAlert.message}`,
      {
        title: 'Admin onayi gerekli',
        description: secondCheckinApprovalAlert.message,
        variant: 'warning',
        durationMs: 6000,
      },
    )
  }, [emitToast, secondCheckinApprovalAlert])

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
      setDemoHistory(null)
      setIsDemoHistoryReady(false)
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
    setRecoveryRevealPin('')
    setPushNotice(null)
    setActionNotice(null)
    setSecondCheckinApprovalAlert(null)
    return true
  }, [])

  const clearScanSuccessFxTimer = useCallback(() => {
    if (scanSuccessFxTimerRef.current !== null) {
      window.clearTimeout(scanSuccessFxTimerRef.current)
      scanSuccessFxTimerRef.current = null
    }
  }, [])

  const triggerScanSuccessFx = useCallback((tone: 'default' | 'confirm' = 'default') => {
    clearScanSuccessFxTimer()
    setScanSuccessFxOpen(true)
    if (tone === 'confirm') {
      playCheckoutPromptTone()
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate?.([160, 70, 220])
      }
    } else {
      playQrSuccessTone()
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate?.([30, 20, 45])
      }
    }
    scanSuccessFxTimerRef.current = window.setTimeout(() => {
      setScanSuccessFxOpen(false)
      scanSuccessFxTimerRef.current = null
    }, 1000)
  }, [clearScanSuccessFxTimer])

  const triggerCheckoutPromptFx = useCallback(() => {
    playCheckoutPromptTone()
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate?.([160, 70, 220])
    }
  }, [])

  const triggerDemoPromptFx = useCallback(() => {
    playDemoPromptTone()
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate?.([90, 45, 90])
    }
  }, [])

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
      setDemoHistory(null)
      setIsDemoHistoryLoading(false)
      setIsDemoHistoryReady(false)
      setLeaveHistory([])
      setIsLeaveHistoryLoading(false)
      setIsLeaveHistoryReady(false)
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
      setDemoHistory(null)
      setIsDemoHistoryLoading(false)
      setIsDemoHistoryReady(false)
      return
    }

    let cancelled = false
    setIsDemoHistoryLoading(true)
    const loadDemoHistory = async () => {
      try {
        const historyData = await getEmployeeDemoHistory(deviceFingerprint)
        if (!cancelled) {
          setDemoHistory(historyData)
          setIsDemoHistoryReady(true)
        }
      } catch (error) {
        const parsed = parseApiError(error, 'Demo listesi alinamadi.')
        if (!cancelled) {
          if (!handleDeviceNotClaimed(parsed)) {
            setDemoHistory(null)
            setIsDemoHistoryReady(false)
          }
        }
      } finally {
        if (!cancelled) {
          setIsDemoHistoryLoading(false)
        }
      }
    }

    void loadDemoHistory()
    return () => {
      cancelled = true
    }
  }, [
    deviceFingerprint,
    handleDeviceNotClaimed,
    statusSnapshot?.last_demo_started_at_utc,
    statusSnapshot?.last_demo_ended_at_utc,
  ])

  useEffect(() => {
    if (!deviceFingerprint) {
      setLeaveHistory([])
      setIsLeaveHistoryLoading(false)
      setIsLeaveHistoryReady(false)
      return
    }

    let cancelled = false
    setIsLeaveHistoryLoading(true)
    const loadLeaveHistory = async () => {
      try {
        const leaveRows = await getEmployeeLeaves(deviceFingerprint)
        if (!cancelled) {
          const orderedRows = [...leaveRows].sort((left, right) => {
            const leftKey = left.created_at || left.start_date
            const rightKey = right.created_at || right.start_date
            return rightKey.localeCompare(leftKey)
          })
          setLeaveHistory(orderedRows)
          setIsLeaveHistoryReady(true)
        }
      } catch (error) {
        const parsed = parseApiError(error, 'Izin talepleri alinamadi.')
        if (!cancelled) {
          if (!handleDeviceNotClaimed(parsed)) {
            setLeaveHistory([])
            setIsLeaveHistoryReady(false)
          }
        }
      } finally {
        if (!cancelled) {
          setIsLeaveHistoryLoading(false)
        }
      }
    }

    void loadLeaveHistory()
    return () => {
      cancelled = true
    }
  }, [deviceFingerprint, handleDeviceNotClaimed, leaveRefreshToken])

  useEffect(() => {
    if (!deviceFingerprint) {
      setCommunicationList([])
      setIsCommunicationLoading(false)
      setIsCommunicationReady(false)
      return
    }

    let cancelled = false
    setIsCommunicationLoading(true)
    const loadCommunicationList = async () => {
      try {
        const rows = await getEmployeeConversations(deviceFingerprint)
        if (!cancelled) {
          setCommunicationList(rows)
          setIsCommunicationReady(true)
        }
      } catch (error) {
        const parsed = parseApiError(error, 'Canlı destek kayıtları alınamadı.')
        if (!cancelled) {
          if (!handleDeviceNotClaimed(parsed)) {
            setCommunicationList([])
            setIsCommunicationReady(false)
          }
        }
      } finally {
        if (!cancelled) {
          setIsCommunicationLoading(false)
        }
      }
    }

    void loadCommunicationList()
    return () => {
      cancelled = true
    }
  }, [communicationRefreshToken, deviceFingerprint, handleDeviceNotClaimed])

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
  const canDemoMark = Boolean(deviceFingerprint) && !isSubmitting
  const isDemoActive = Boolean(statusSnapshot?.demo_active)
  const demoButtonLabel = isDemoActive ? 'Demo Bitti' : 'Demo Başladı'
  const demoButtonHint = isDemoActive
    ? 'Gün içindeki demo kapanışını tek dokunuşla tamamlayın.'
    : 'Gün içindeki demo başlangıcını tek dokunuşla kaydedin.'
  const demoSessions = demoHistory?.sessions ?? []
  const visibleDemoSessions = demoSessions.slice(0, 4)
  const hiddenDemoSessionCount = Math.max(0, demoSessions.length - visibleDemoSessions.length)
  const demoHistorySummary = demoHistory ? `${demoHistory.session_count} kayit` : 'Bugun'
  const leaveRequests = leaveHistory
  const visibleLeaveRequests = leaveRequests.slice(0, 4)
  const hiddenLeaveRequestCount = Math.max(0, leaveRequests.length - visibleLeaveRequests.length)
  const hasLeaveHistory = leaveRequests.length > 0
  const pendingLeaveCount = leaveRequests.filter((item) => item.status === 'PENDING').length
  const approvedLeaveCount = leaveRequests.filter((item) => item.status === 'APPROVED').length
  const leaveHistorySummary = leaveRequests.length > 0 ? `${leaveRequests.length} kayit` : 'Henuz yok'
  const leaveActionHint =
    pendingLeaveCount > 0
      ? `${pendingLeaveCount} talep admin onayi bekliyor.`
      : approvedLeaveCount > 0
        ? `${approvedLeaveCount} izin kaydin gorunuyor.`
        : 'Tarih araligi ve gerekce girerek izin talebi olusturabilirsin.'
  const canOpenLeaveRequest = Boolean(deviceFingerprint) && !isLeaveSubmitting
  const visibleCommunications = communicationList.slice(0, 4)
  const hiddenCommunicationCount = Math.max(0, communicationList.length - visibleCommunications.length)
  const hasCommunicationHistory = communicationList.length > 0
  const openCommunicationCount = communicationList.filter((item) => item.status === 'OPEN').length
  const closedCommunicationCount = Math.max(0, communicationList.length - openCommunicationCount)
  const communicationSummary =
    communicationList.length > 0 ? `${communicationList.length} kayıt` : 'Henüz yok'
  const latestCommunicationAt = communicationList[0]?.last_message_at ?? null
  const requestedConversationId = useMemo(() => {
    const params = new URLSearchParams(location.search)
    if (params.get('communication') !== '1') {
      return null
    }
    const rawValue = params.get('conversation_id')
    const parsed = Number(rawValue)
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return null
    }
    return parsed
  }, [location.search])

  useEffect(() => {
    if (!leaveHistory.length) {
      setIsLeaveHistoryExpanded(false)
    }
  }, [leaveHistory.length])

  useEffect(() => {
    if (!communicationList.length) {
      setActiveCommunicationId(null)
    }
  }, [communicationList.length])

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

  const openLeaveRequestModal = useCallback(() => {
    setLeaveFormError(null)
    setIsLeaveModalOpen(true)
  }, [])

  const closeLeaveRequestModal = useCallback(() => {
    if (isLeaveSubmitting) {
      return
    }
    setIsLeaveModalOpen(false)
    setLeaveFormError(null)
    setLeaveAttachmentFile(null)
  }, [isLeaveSubmitting])

  const loadLeaveThread = useCallback(
    async (leaveId: number) => {
      if (!deviceFingerprint) {
        return
      }
      setLeaveThreadLoadingId(leaveId)
      setLeaveThreadErrorById((current) => ({ ...current, [leaveId]: null }))
      try {
        const thread = await getEmployeeLeaveThread(leaveId, deviceFingerprint)
        setLeaveThreadsById((current) => ({ ...current, [leaveId]: thread }))
      } catch (error) {
        const parsed = parseApiError(error, 'Yazışma akışı alınamadı.')
        setLeaveThreadErrorById((current) => ({ ...current, [leaveId]: parsed.message }))
      } finally {
        setLeaveThreadLoadingId((current) => (current === leaveId ? null : current))
      }
    },
    [deviceFingerprint],
  )

  useEffect(() => {
    if (!activeLeaveThreadId || !deviceFingerprint) {
      return
    }
    void loadLeaveThread(activeLeaveThreadId)
  }, [activeLeaveThreadId, deviceFingerprint, leaveRefreshToken, loadLeaveThread])

  const toggleLeaveThread = useCallback(
    (leaveId: number) => {
      setActiveLeaveThreadId((current) => {
        if (current === leaveId) {
          return null
        }
        return leaveId
      })
      if (!leaveThreadsById[leaveId] || leaveThreadErrorById[leaveId]) {
        void loadLeaveThread(leaveId)
      }
    },
    [leaveThreadErrorById, leaveThreadsById, loadLeaveThread],
  )

  const handleLeaveAttachmentDownload = useCallback(
    async (leaveId: number, attachmentId: number, fileName: string) => {
      if (!deviceFingerprint) {
        return
      }
      try {
        const result = await downloadEmployeeLeaveAttachment(leaveId, attachmentId, deviceFingerprint)
        triggerBlobDownload(result.blob, result.fileName || fileName || `leave-attachment-${attachmentId}`)
      } catch (error) {
        const parsed = parseApiError(error, 'Belge indirilemedi.')
        setLeaveThreadErrorById((current) => ({ ...current, [leaveId]: parsed.message }))
      }
    },
    [deviceFingerprint],
  )

  const openCommunicationModal = useCallback(() => {
    setCommunicationFormError(null)
    setIsCommunicationModalOpen(true)
  }, [])

  const openLeaveCommunicationModal = useCallback((leave?: EmployeeLeaveRecord) => {
    const leaveRange = leave ? formatLeaveRange(leave.start_date, leave.end_date) : null
    setCommunicationFormError(null)
    setCommunicationCategory('DOCUMENT')
    setCommunicationSubject(leaveRange ? `${leaveRange} izin talebi için destek` : 'İzin talebim için destek')
    setCommunicationMessage(
      leaveRange
        ? `${leaveRange} tarihli izin talebim hakkında destek rica ediyorum. Güncel durumu paylaşabilir misiniz?`
        : 'İzin talebim hakkında destek rica ediyorum. Güncel durumu paylaşabilir misiniz?',
    )
    setIsLeaveModalOpen(false)
    setIsCommunicationModalOpen(true)
  }, [])

  const closeCommunicationModal = useCallback(() => {
    if (isCommunicationSubmitting) {
      return
    }
    setIsCommunicationModalOpen(false)
    setCommunicationFormError(null)
    setCommunicationCategory('ATTENDANCE')
    setCommunicationSubject('')
    setCommunicationMessage('')
  }, [isCommunicationSubmitting])

  const loadCommunicationThread = useCallback(
    async (conversationId: number) => {
      if (!deviceFingerprint) {
        return
      }
      setCommunicationThreadLoadingId(conversationId)
      setCommunicationThreadErrorById((current) => ({ ...current, [conversationId]: null }))
      try {
        const thread = await getEmployeeConversationThread(conversationId, deviceFingerprint)
        setCommunicationThreadsById((current) => ({ ...current, [conversationId]: thread }))
      } catch (error) {
        const parsed = parseApiError(error, 'Destek görüşmesi yüklenemedi.')
        setCommunicationThreadErrorById((current) => ({ ...current, [conversationId]: parsed.message }))
      } finally {
        setCommunicationThreadLoadingId((current) => (current === conversationId ? null : current))
      }
    },
    [deviceFingerprint],
  )

  const toggleCommunicationThread = useCallback(
    (conversationId: number) => {
      setActiveCommunicationId((current) => {
        if (current === conversationId) {
          return null
        }
        return conversationId
      })
      if (!communicationThreadsById[conversationId] || communicationThreadErrorById[conversationId]) {
        void loadCommunicationThread(conversationId)
      }
    },
    [communicationThreadErrorById, communicationThreadsById, loadCommunicationThread],
  )

  const updateCommunicationReplyDraft = useCallback((conversationId: number, value: string) => {
    setCommunicationReplyDrafts((current) => ({
      ...current,
      [conversationId]: value,
    }))
  }, [])

  const applyCommunicationTemplate = useCallback(
    (template: (typeof communicationTemplates)[number]) => {
      setCommunicationCategory(template.category)
      setCommunicationSubject(template.subject)
      setCommunicationMessage(template.message)
    },
    [],
  )

  const applyCommunicationReplyStarter = useCallback((conversationId: number, starter: string) => {
    setCommunicationReplyDrafts((current) => {
      const existing = (current[conversationId] ?? '').trim()
      return {
        ...current,
        [conversationId]: existing ? `${existing}\n\n${starter}` : starter,
      }
    })
  }, [])

  const submitCommunicationReply = useCallback(
    async (conversationId: number) => {
      const message = (communicationReplyDrafts[conversationId] || '').trim()
      if (!deviceFingerprint) {
        pushToast({
          variant: 'error',
          title: 'Cihaz bağlı değil',
          description: 'Yazışma için önce cihaz kurulumunu tamamla.',
        })
        return
      }
      if (message.length < 12) {
        setCommunicationThreadErrorById((current) => ({
          ...current,
          [conversationId]: 'Mesajını kısa, net ve resmî biçimde en az 12 karakter olacak şekilde yaz.',
        }))
        return
      }
      setCommunicationReplyBusyId(conversationId)
      setCommunicationThreadErrorById((current) => ({ ...current, [conversationId]: null }))
      try {
        const thread = await createEmployeeConversationMessage(conversationId, {
          device_fingerprint: deviceFingerprint,
          message,
        })
        setCommunicationThreadsById((current) => ({ ...current, [conversationId]: thread }))
        setCommunicationReplyDrafts((current) => ({ ...current, [conversationId]: '' }))
        setCommunicationRefreshToken((current) => current + 1)
        pushToast({
          variant: 'success',
          title: 'Destek mesajı gönderildi',
          description: 'Mesajın destek hattına iletildi.',
        })
      } catch (error) {
        const parsed = parseApiError(error, 'Destek mesajı gönderilemedi.')
        setCommunicationThreadErrorById((current) => ({ ...current, [conversationId]: parsed.message }))
      } finally {
        setCommunicationReplyBusyId((current) => (current === conversationId ? null : current))
      }
    },
    [communicationReplyDrafts, deviceFingerprint, pushToast],
  )

  const submitCommunication = useCallback(async () => {
    const subject = communicationSubject.trim()
    const message = communicationMessage.trim()
    if (!deviceFingerprint) {
      setCommunicationFormError('Cihaz bağlı değil. Canlı destek için önce kurulumu tamamla.')
      return
    }
    if (subject.length < 6) {
      setCommunicationFormError('Başlık en az 6 karakter olmalı.')
      return
    }
    if (message.length < 12) {
      setCommunicationFormError('Mesajını kısa, net ve resmî biçimde en az 12 karakter olacak şekilde yaz.')
      return
    }

    setIsCommunicationSubmitting(true)
    setCommunicationFormError(null)
    try {
      const thread = await createEmployeeConversation({
        device_fingerprint: deviceFingerprint,
        category: communicationCategory,
        subject,
        message,
      })
      setCommunicationThreadsById((current) => ({ ...current, [thread.conversation.id]: thread }))
      setActiveCommunicationId(thread.conversation.id)
      setCommunicationRefreshToken((current) => current + 1)
      setIsCommunicationModalOpen(false)
      setCommunicationCategory('ATTENDANCE')
      setCommunicationSubject('')
      setCommunicationMessage('')
      pushToast({
        variant: 'success',
        title: 'Destek kaydı açıldı',
        description: 'Mesajın iletildi ve yeni destek görüşmesi oluşturuldu.',
      })
    } catch (error) {
      const parsed = parseApiError(error, 'Destek talebi oluşturulamadı.')
      setCommunicationFormError(parsed.message)
    } finally {
      setIsCommunicationSubmitting(false)
    }
  }, [
    communicationCategory,
    communicationMessage,
    communicationSubject,
    deviceFingerprint,
    pushToast,
  ])

  useEffect(() => {
    if (!activeCommunicationId || !deviceFingerprint) {
      return
    }
    void loadCommunicationThread(activeCommunicationId)
  }, [activeCommunicationId, communicationRefreshToken, deviceFingerprint, loadCommunicationThread])

  useEffect(() => {
    if (!requestedConversationId || !deviceFingerprint) {
      return
    }
    setActiveCommunicationId(requestedConversationId)
    void loadCommunicationThread(requestedConversationId)
  }, [deviceFingerprint, loadCommunicationThread, requestedConversationId])

  const submitLeaveRequest = useCallback(async () => {
    const startDate = leaveStartDate.trim()
    const endDate = leaveEndDate.trim()
    const note = leaveNote.trim()
    if (!deviceFingerprint) {
      setLeaveFormError('Cihaz bagli degil. Davet linki ile kurulumu tamamla.')
      return
    }
    if (!startDate || !endDate) {
      setLeaveFormError('Baslangic ve bitis tarihini gir.')
      return
    }
    if (endDate < startDate) {
      setLeaveFormError('Bitis tarihi baslangic tarihinden once olamaz.')
      return
    }
    if (note.length < 3) {
      setLeaveFormError('Izin gerekcesi en az 3 karakter olmali.')
      return
    }
    if (leaveAttachmentFile && leaveAttachmentFile.size > 8 * 1024 * 1024) {
      setLeaveFormError('Belge boyutu 8 MB sinirini asamaz.')
      return
    }

    setIsLeaveSubmitting(true)
    setLeaveFormError(null)
    try {
      const formData = new FormData()
      formData.append('device_fingerprint', deviceFingerprint)
      formData.append('start_date', startDate)
      formData.append('end_date', endDate)
      formData.append('type', leaveType)
      formData.append('note', note)
      if (leaveAttachmentFile) {
        formData.append('attachment', leaveAttachmentFile)
      }
      const leave = await submitEmployeeLeaveRequest(formData)
      setIsLeaveModalOpen(false)
      setLeaveStartDate('')
      setLeaveEndDate('')
      setLeaveType('ANNUAL')
      setLeaveNote('')
      setLeaveAttachmentFile(null)
      setActionNotice({
        tone: 'success',
        text: `Izin talebin gonderildi. Durum: ${leaveStatusLabels[leave.status]}.`,
      })
      setLeaveRefreshToken((current) => current + 1)
      pushToast({
        variant: 'success',
        title: 'Izin talebi gonderildi',
        description:
          leaveAttachmentFile ? 'Talebin ve eklediğin belge admin ekranına iletildi.' : 'Talebin admin onayına iletildi.',
      })
    } catch (error) {
      const parsed = parseApiError(error, 'Izin talebi gonderilemedi.')
      setLeaveFormError(parsed.message)
    } finally {
      setIsLeaveSubmitting(false)
    }
  }, [deviceFingerprint, leaveAttachmentFile, leaveEndDate, leaveNote, leaveStartDate, leaveType, pushToast])

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
    !isLeaveModalOpen &&
    !isHelpOpen &&
    !showPushGateModal
  const showAndroidInstallOnboarding =
    androidInstallOnboardingOpen &&
    isAndroidDevice() &&
    !isStandaloneApp &&
    !scannerActive &&
    !isLeaveModalOpen &&
    !isHelpOpen &&
    !showPushGateModal
  const showIosInstallDock =
    isIosFamilyDevice() &&
    !isStandaloneApp &&
    iosInstallOnboardingDismissed &&
    !iosInstallOnboardingOpen &&
    !scannerActive &&
    !isLeaveModalOpen &&
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
    iosInAppBrowserBlocked && !scannerActive && !isLeaveModalOpen && !isHelpOpen && !showPushGateModal

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
      isLeaveModalOpen ||
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
  }, [isHelpOpen, isLeaveModalOpen, scannerActive, showAndroidInstallOnboarding, showIosInstallOnboarding, showPushGateModal])

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

  const runRecoveryCodeReveal = async () => {
    if (!deviceFingerprint) {
      setErrorMessage('Cihaz bagli degil. Davet linkine tiklayin.')
      return
    }
    if (!recoveryReady) {
      setErrorMessage('Once aktif bir recovery seti olusturun.')
      return
    }

    const normalizedPin = recoveryRevealPin.trim()
    if (normalizedPin.length < 6 || normalizedPin.length > 12 || !/^\d+$/.test(normalizedPin)) {
      setErrorMessage('Recovery PIN 6-12 hane olmali ve sadece rakam icermeli.')
      return
    }

    setIsRecoveryRevealBusy(true)
    setRecoveryNotice(null)
    setErrorMessage(null)
    setRequestId(null)

    try {
      const result = await revealRecoveryCodes({
        device_fingerprint: deviceFingerprint,
        recovery_pin: normalizedPin,
      })
      setRecoveryCodeCount(result.active_code_count)
      setRecoveryExpiresAt(result.expires_at)
      setRecoveryCodesPreview(result.recovery_codes)
      setRecoveryRevealPin('')
      setRecoveryNotice(
        'Mevcut recovery kodlari acildi. Bu kodlar cihaz sifirlanirsa hesabi geri yuklemek icin gereklidir.',
      )
    } catch (error) {
      const parsed = parseApiError(error, 'Recovery kodlari acilamadi.')
      handleDeviceNotClaimed(parsed)
      setRecoveryCodesPreview(null)
      setErrorMessage(parsed.message)
      setRequestId(parsed.requestId ?? null)
    } finally {
      setIsRecoveryRevealBusy(false)
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
    setActionNotice(null)
    setErrorMessage(null)
    setSecondCheckinApprovalAlert(null)
    setLocationWarning(null)
    setRequestId(null)

    try {
      const locationResult = await getCurrentLocation()
      if (!locationResult.location) {
        setErrorMessage(
          locationResult.warning ??
            'QR işlemi için gerekli cihaz hazırlığı tamamlanamadı. Ayarları kontrol edip tekrar deneyin.',
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
      triggerScanSuccessFx(response.event_type === 'IN' ? 'confirm' : 'default')
    } catch (error) {
      const parsed = parseApiError(error, 'QR işlemi tamamlanamadı.')
      handleDeviceNotClaimed(parsed)
      if (parsed.code === 'SECOND_CHECKIN_APPROVAL_REQUIRED') {
        setSecondCheckinApprovalAlert({
          ...parsed,
          message:
            parsed.message.trim()
            || 'Bugünkü ikinci giriş için admin onayı gerekiyor. Admin onayından sonra tekrar QR okutun.',
        })
        setErrorMessage(null)
        setRequestId(null)
      } else {
        setErrorMessage(
          sanitizeEmployeeActionMessage(
            parsed,
            'QR işlemi için gerekli cihaz hazırlığı tamamlanamadı. Ayarları kontrol edip tekrar deneyin.',
          ),
        )
        setRequestId(parsed.requestId ?? null)
      }
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
    setActionNotice(null)
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
      setErrorMessage(
        sanitizeEmployeeActionMessage(
          parsed,
          'Mesai bitişi için gerekli cihaz hazırlığı tamamlanamadı. Ayarları kontrol edip tekrar deneyin.',
        ),
      )
      setRequestId(parsed.requestId ?? null)
    } finally {
      setIsSubmitting(false)
      setPendingAction(null)
    }
  }

  const openCheckoutConfirmModal = useCallback(() => {
    if (!canCheckout) {
      setErrorMessage(todayStatusHint(todayStatus))
      return
    }

    setScannerActive(false)
    setActionNotice(null)
    setIsCheckoutConfirmOpen(true)
    triggerCheckoutPromptFx()
  }, [canCheckout, todayStatus, triggerCheckoutPromptFx])

  const runDemoMark = async () => {
    if (!deviceFingerprint) {
      setErrorMessage('Cihaz bagli degil. Davet linkine tiklayin.')
      return
    }

    setIsSubmitting(true)
    setPendingAction('demo')
    setActionNotice(null)
    setErrorMessage(null)
    setLocationWarning(null)
    setRequestId(null)

    try {
      const locationResult = await getCurrentLocation()
      if (!locationResult.location) {
        setIsDemoLocationPromptOpen(true)
        setErrorMessage('Demo kaydi icin konumu acip tekrar deneyin.')
        return
      }

      const nextSource = isDemoActive ? 'DEMO_END' : 'DEMO_START'
      const loggedAt = new Date().toISOString()
      await postEmployeeAppPresencePing({
        device_fingerprint: deviceFingerprint,
        source: nextSource,
        lat: locationResult.location.lat,
        lon: locationResult.location.lon,
        accuracy_m: locationResult.location.accuracy_m,
      })

      setActionNotice({
        tone: 'success',
        text: isDemoActive ? 'Demo bitisi kaydedildi.' : 'Demo baslangici kaydedildi.',
      })
      setStatusSnapshot((prev) =>
        prev
          ? {
              ...prev,
              demo_active: !isDemoActive,
              last_demo_started_at_utc: isDemoActive
                ? (prev.last_demo_started_at_utc ?? null)
                : loggedAt,
              last_demo_ended_at_utc: isDemoActive
                ? loggedAt
                : (prev.last_demo_ended_at_utc ?? null),
            }
          : prev,
      )
      triggerScanSuccessFx()
    } catch (error) {
      const parsed = parseApiError(error, 'Demo kaydı alınamadı.')
      handleDeviceNotClaimed(parsed)
      setErrorMessage(
        sanitizeEmployeeActionMessage(
          parsed,
          'Demo kaydı için gerekli cihaz hazırlığı tamamlanamadı. Ayarları kontrol edip tekrar deneyin.',
        ),
      )
      setRequestId(parsed.requestId ?? null)
    } finally {
      setIsSubmitting(false)
      setPendingAction(null)
    }
  }

  const openDemoConfirmModal = useCallback(() => {
    if (!canDemoMark) {
      return
    }

    setScannerActive(false)
    setActionNotice(null)
    setErrorMessage(null)
    setRequestId(null)
    setIsDemoConfirmOpen(true)
    triggerDemoPromptFx()
  }, [canDemoMark, triggerDemoPromptFx])

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

  const employeeDisplayName = useMemo(() => {
    const normalized = statusSnapshot?.employee_name?.trim()
    if (normalized) {
      return normalized
    }
    if (statusSnapshot?.employee_id) {
      return `Çalışan #${statusSnapshot.employee_id}`
    }
    return 'Çalışan bilgisi bekleniyor'
  }, [statusSnapshot?.employee_id, statusSnapshot?.employee_name])

  const employeeShiftSummary = useMemo(() => {
    const shiftName = statusSnapshot?.shift_name?.trim()
    const shiftStart = statusSnapshot?.shift_start_local?.trim()
    const shiftEnd = statusSnapshot?.shift_end_local?.trim()
    if (shiftName && shiftStart && shiftEnd) {
      return `${shiftName} (${shiftStart}-${shiftEnd})`
    }
    if (shiftName) {
      return shiftName
    }
    if (shiftStart && shiftEnd) {
      return `${shiftStart}-${shiftEnd}`
    }
    return 'Atanmamış'
  }, [statusSnapshot?.shift_end_local, statusSnapshot?.shift_name, statusSnapshot?.shift_start_local])

  const employeeHeroMeta = useMemo(() => {
    if (!deviceFingerprint) {
      return 'Bu cihaz henüz hesaba bağlanmadı.'
    }
    if (hasOpenShift && openShiftCheckinTime) {
      return `Açık vardiya aktif · Son giriş ${formatTs(openShiftCheckinTime)}`
    }
    if (statusSnapshot?.last_out_ts) {
      return `Son çıkış ${formatTs(statusSnapshot.last_out_ts)}`
    }
    if (statusSnapshot?.last_in_ts) {
      return `Son giriş ${formatTs(statusSnapshot.last_in_ts)}`
    }
    return 'Bugünkü işlem durumunuz burada canlı görünür.'
  }, [deviceFingerprint, hasOpenShift, openShiftCheckinTime, statusSnapshot?.last_in_ts, statusSnapshot?.last_out_ts])

  const employeeHeroFocus = useMemo(() => {
    if (!deviceFingerprint) {
      return 'Önce cihaz bağlantısını tamamlayın.'
    }
    if (hasOpenShift) {
      return 'Sıradaki işlem: mesaiyi güvenli şekilde bitir.'
    }
    return 'Sıradaki işlem: QR ile bugünkü kaydı başlat.'
  }, [deviceFingerprint, hasOpenShift])

  const employeeSecuritySummary = useMemo(() => {
    if (passkeyRegistered) {
      return 'Passkey hazir'
    }
    if (recoveryReady) {
      return 'Recovery hazir'
    }
    if (pushRegistered) {
      return 'Bildirim acik'
    }
    return 'Kurulum gerekli'
  }, [passkeyRegistered, pushRegistered, recoveryReady])

  const employeeCompanyLabel = useMemo(() => {
    const brandParts = [UI_BRANDING.signatureText, UI_BRANDING.signatureTagline].filter(
      (value) => Boolean(value),
    )
    return brandParts.join(' · ') || 'Çalışan Portalı'
  }, [])

  const employeeHeaderSubtitle = useMemo(() => {
    const parts = [statusSnapshot?.department_name?.trim(), statusSnapshot?.region_name?.trim()].filter(
      (value) => Boolean(value),
    )
    if (parts.length > 0) {
      return parts.join(' · ')
    }
    return deviceFingerprint ? 'Günlük yoklama ve vardiya işlemleri' : 'Cihaz bağlantısı tamamlanmadı'
  }, [deviceFingerprint, statusSnapshot?.department_name, statusSnapshot?.region_name])

  const employeeHeaderMeta = useMemo(
    () => [
      { label: 'Bölge', value: statusSnapshot?.region_name ?? 'Atanmamış' },
      { label: 'Departman', value: statusSnapshot?.department_name ?? 'Atanmamış' },
      { label: 'Vardiya', value: employeeShiftSummary },
      { label: 'Güvenlik', value: employeeSecuritySummary },
    ],
    [employeeSecuritySummary, employeeShiftSummary, statusSnapshot?.department_name, statusSnapshot?.region_name],
  )

  const mainActionFooterNote = useMemo(() => {
    if (!deviceFingerprint) {
      return 'Bu ekranı kullanmadan önce cihaz bağlantısını tamamlayın.'
    }
    if (pushGateRequired) {
      return pushRequiresStandalone
        ? 'QR işlemi için önce Ana Ekrana Ekle kurulumu ve bildirim izni tamamlanmalı.'
        : 'QR işlemi öncesinde bildirim izni verilmelidir.'
    }
    if (hasOpenShift) {
      return 'Vardiyanız açık. QR ile yeni işlem başlatabilir veya mesaiyi güvenli şekilde bitirebilirsiniz.'
    }
    return 'İlk önce QR kodu okutun. İşiniz bittiğinde aynı ekrandan mesaiyi güvenli şekilde kapatın.'
  }, [deviceFingerprint, hasOpenShift, pushGateRequired, pushRequiresStandalone])

  const lastActionCard = useMemo(() => {
    if (lastAction) {
      const isCheckin = lastAction.response.event_type === 'IN'
      return {
        title: resultMessage?.text ?? (isCheckin ? 'Giriş kaydedildi' : 'Mesai bitişi kaydedildi'),
        summary: isCheckin
          ? 'En son QR işlemiyle bugünkü girişiniz başarıyla kaydedildi.'
          : 'En son işlem olarak bugünkü çıkışınız kaydedildi.',
        timestampLabel: formatTs(lastAction.response.ts_utc),
      }
    }

    if (statusSnapshot?.last_out_ts) {
      return {
        title: 'Son kayıt: Çıkış',
        summary: 'Sistemde görünen son hareket bugünkü çıkış kaydınızdır.',
        timestampLabel: formatTs(statusSnapshot.last_out_ts),
      }
    }

    if (statusSnapshot?.last_in_ts) {
      return {
        title: 'Son kayıt: Giriş',
        summary: 'Sistemde görünen son hareket bugünkü giriş kaydınızdır.',
        timestampLabel: formatTs(statusSnapshot.last_in_ts),
      }
    }

    return {
      title: 'Bugün henüz işlem yok',
      summary: 'QR ile işlem yaptığınızda son hareket özeti burada görünür.',
      timestampLabel: null,
    }
  }, [lastAction, resultMessage, statusSnapshot?.last_in_ts, statusSnapshot?.last_out_ts])

  const historySummaryLabel =
    demoSessions.length + leaveRequests.length > 0
      ? `${demoSessions.length + leaveRequests.length} kayıt`
      : 'Henüz yok'
  const isQrRadarReady = canQrScan && !isSubmitting && !scannerActive && !pushGateRequired

  const showActivitySectionOpen = Boolean(actionNotice || isDemoActive || pendingLeaveCount > 0 || hasLeaveHistory)
  const showSecuritySectionOpen = Boolean(
    passkeyNotice || pushNotice || !passkeyRegistered || !recoveryReady || pushGateRequired || !deviceFingerprint,
  )
  const showInstallSection = Boolean(
    showInstallBanner || showInstallPromotions || showIosInstallDock || installNotice || showIosBrowserWarning,
  )
  const showInstallSectionOpen = Boolean(installNotice || showInstallBanner || showIosBrowserWarning)
  const hasCriticalAlerts = Boolean(
    showIosBrowserWarning || shouldShowEveningReminder || locationWarning || scannerError || errorMessage,
  )

  return (
    <main className="phone-shell employee-shell">
      <div className="employee-layout">
        {resultMessage && false ? (
          <aside className="promo-rail promo-rail-left" aria-label="Uygulama indirme paneli">
            <p className="promo-rail-kicker">YABUJIN EMPLOYEE APP</p>
            <h2 className="promo-rail-title">Cepte kur, günü tek dokunuşla yönet.</h2>
            <p className="promo-rail-text">
              Kurulumdan sonra QR, bildirim ve güvenlik adımları daha stabil ve daha akıcı çalışır.
            </p>
            <ul className="promo-rail-list">
              <li>QR tarama ve işlem akışı daha akıcı olur</li>
              <li>Push bildirim gecikmeleri azalır</li>
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
            <p className="promo-rail-note">Desteklenen cihazlarda buton kurulum penceresini doğrudan açar.</p>
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

        <div className="employee-home-stack">
          <EmployeeHeader
            employeeName={employeeDisplayName}
            companyName={employeeCompanyLabel}
            statusClassName={todayStatusClass}
            statusLabel={todayStatusLabel(todayStatus)}
            subtitle={employeeHeaderSubtitle}
            metaItems={employeeHeaderMeta}
          />

          <EmployeeMainActionCard
            sectionRef={actionPanelRef}
            statusClassName={todayStatusClass}
            statusLabel={todayStatusLabel(todayStatus)}
            title={employeeHeroFocus}
            hint={todayStatusHint(todayStatus)}
            shiftSummary={employeeShiftSummary}
            contextLine={employeeHeroMeta}
            footerNote={mainActionFooterNote}
            isQrReady={isQrRadarReady}
            primaryAction={
              <button
                type="button"
                className={`btn btn-primary action-cta-btn employee-main-action-primary-btn ${
                  isQrRadarReady ? 'is-radar-ready' : ''
                }`}
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
                        ? 'QR başlatmak için önce iPhone kurulumunu tamamlayıp bildirimleri açın.'
                        : 'QR başlatmak için önce bildirimleri açın.',
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
                  <span className="employee-main-action-primary-shell">
                    <span className="employee-main-action-primary-glyph" aria-hidden="true">
                      <span className="employee-main-action-primary-glyph-ring employee-main-action-primary-glyph-ring-a" />
                      <span className="employee-main-action-primary-glyph-ring employee-main-action-primary-glyph-ring-b" />
                      <span className="employee-main-action-primary-glyph-core" />
                      <span className="employee-main-action-primary-glyph-scan" />
                    </span>
                    <span className="employee-main-action-primary-copy">
                      <span className="employee-main-action-primary-label">QR Kod Oku</span>
                      <span className="employee-main-action-primary-meta">GİRİŞ / ÇIKIŞ İÇİN TARA</span>
                    </span>
                    <span className="employee-main-action-primary-brackets" aria-hidden="true">
                      <span className="employee-main-action-primary-bracket employee-main-action-primary-bracket-tl" />
                      <span className="employee-main-action-primary-bracket employee-main-action-primary-bracket-tr" />
                      <span className="employee-main-action-primary-bracket employee-main-action-primary-bracket-bl" />
                      <span className="employee-main-action-primary-bracket employee-main-action-primary-bracket-br" />
                    </span>
                  </span>
                )}
              </button>
            }
            secondaryAction={
              <button
                type="button"
                className="btn btn-outline action-cta-btn employee-main-action-secondary-btn"
                disabled={!canCheckout}
                onClick={openCheckoutConfirmModal}
              >
                {isSubmitting && pendingAction === 'checkout' ? (
                  <>
                    <span className="inline-spinner inline-spinner-dark" aria-hidden="true" />
                    İşlem yapılıyor...
                  </>
                ) : (
                  <span className="action-cta-copy">Mesaiyi Güvenli Bitir</span>
                )}
              </button>
            }
          >
            {hasOpenShift ? (
              <div className="notice-box notice-box-warning employee-inline-notice">
                <p>
                  <span className="banner-icon" aria-hidden="true">
                    !
                  </span>
                  Açık vardiya var, çıkış kaydı bekleniyor.
                </p>
                {openShiftCheckinTime ? <p className="small-text">Son giriş: {formatTs(openShiftCheckinTime)}</p> : null}
              </div>
            ) : null}

            {!deviceFingerprint ? (
              <div className="warn-box employee-inline-warning">
                <p>Cihaz bağlı değil. Önce davet veya kurtarma akışını tamamlayın.</p>
                <div className="employee-inline-link-row">
                  <Link className="inline-link" to="/claim">
                    /claim ekranına git
                  </Link>
                  <Link className="inline-link" to="/recover">
                    /recover ekranına git
                  </Link>
                </div>
              </div>
            ) : null}
          </EmployeeMainActionCard>

          <EmployeeLastActionSummary
            title={lastActionCard.title}
            summary={lastActionCard.summary}
            timestampLabel={lastActionCard.timestampLabel}
            pulseKey={lastAction?.response.ts_utc ?? null}
            badges={
              lastAction ? (
                <>
                  {duplicateDetected ? <span className="status-pill state-warn">Mükerrer kayıt</span> : null}
                  {manualCheckout ? <span className="manual-badge">Manuel çıkış yapıldı</span> : null}
                </>
              ) : null
            }
            details={
              lastAction ? (
                <details className="employee-inline-details">
                  <summary>Teknik ayrıntılar</summary>
                  <div className="employee-technical-list">
                    <p>
                      İşlem tipi: <strong>{eventTypeLabel(lastAction.response.event_type)}</strong>
                    </p>
                    {lastAction.codeValue ? (
                      <p>
                        QR metni: <strong>{lastAction.codeValue}</strong>
                      </p>
                    ) : null}
                    <p>
                      Kayıt zamanı: <strong>{formatTs(lastAction.response.ts_utc)}</strong>
                    </p>
                    {visibleFlags.length === 0 ? (
                      <p className="muted">Ek bayrak yok.</p>
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
                </details>
              ) : null
            }
          />

          {hasCriticalAlerts ? (
            <EmployeeCriticalAlerts>
              {showIosBrowserWarning ? (
                <div className="warn-box install-browser-warning">
                  <p>
                    <span className="banner-icon" aria-hidden="true">
                      !
                    </span>
                    iPhone kurulumu için Safari zorunlu. Şimdi {iosBrowserContext.browserLabel} üzerindesiniz.
                  </p>
                  <div className="install-browser-warning-actions">
                    <button type="button" className="btn btn-soft" onClick={openIosInstallOnboarding}>
                      Safari adımlarını aç
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => void copyPortalLinkForSafari()}>
                      Linki kopyala
                    </button>
                  </div>
                </div>
              ) : null}

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

              {errorMessage ? (
                <div className="error-box banner-error">
                  <p>
                    <span className="banner-icon" aria-hidden="true">
                      !
                    </span>
                    {errorMessage}
                  </p>
                  {requestId ? (
                    <details className="employee-inline-details employee-inline-details-compact">
                      <summary>Teknik bilgi</summary>
                      <p className="request-id">request_id: {requestId}</p>
                    </details>
                  ) : null}
                </div>
              ) : null}
            </EmployeeCriticalAlerts>
          ) : null}

          <SecondaryFeaturesSection
            kicker="İKİNCİL ALANLAR"
            title="Ek özellikler, geçmiş ve kurulum"
            description="Ana yoklama aksiyonları yukarıda kalır; diğer alanlara ihtiyaç olduğunda buradan ulaşabilirsiniz."
            defaultOpen={showActivitySectionOpen || showSecuritySectionOpen || showInstallSectionOpen}
            badge={<span className="status-pill state-info">Daha fazla</span>}
          >

        {false ? (
          <>
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

        {lastAction && false ? (
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
                    {step.done ? '+' : '•'}
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
          </>
        ) : null}

        <div className="employee-workbench">
          <div className={`employee-home-focus-shell ${hasCriticalAlerts ? 'has-alerts' : ''}`}>
            {false ? (
              <>
            <EmployeeHeaderSection
              employeeDisplayName={employeeDisplayName}
              contextLine={`${employeeCompanyLabel} · ${employeeHeaderSubtitle}`}
              todayStatusClass={todayStatusClass}
              todayStatusLabel={todayStatusLabel(todayStatus)}
              chips={employeeHeaderMeta.map((item) => `${item.label}: ${item.value}`)}
            />

            {false ? (
              <MainActionCard
                panelRef={actionPanelRef}
                todayStatusClass={todayStatusClass}
                todayStatusLabel={todayStatusLabel(todayStatus)}
                todayStatusHintText={todayStatusHint(todayStatus)}
                shiftSummary={employeeShiftSummary}
                activityMeta={employeeHeroMeta}
                focusText={mainActionFooterNote}
                canQrScan={canQrScan}
                canCheckout={canCheckout}
                isSubmitting={isSubmitting}
                pendingAction={pendingAction}
                pushGateRequired={pushGateRequired}
                onOpenScanner={() => {
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
                onOpenCheckout={openCheckoutConfirmModal}
              />
            ) : null}

            <LastActionSummarySection
              summary={{
                title: lastActionCard.title,
                detail: lastActionCard.timestampLabel ?? 'Henuz kayit yok',
                note: actionNotice?.text ?? lastActionCard.summary,
                tone:
                  lastAction?.response.event_type === 'IN'
                    ? 'success'
                    : lastAction
                      ? 'warning'
                      : 'neutral',
              }}
              lastAction={lastAction}
              duplicateDetected={duplicateDetected}
              manualCheckout={manualCheckout}
              visibleFlags={visibleFlags}
            />

            {shouldShowEveningReminder ? (
              <div className="notice-box notice-box-warning">
                <p>
                  <span className="banner-icon" aria-hidden="true">
                    !
                  </span>
                  Hatirlatma: Mesaiyi bitirmeyi unutmayin.
                </p>
              </div>
            ) : null}

            <CriticalAlertsSection
              deviceFingerprint={deviceFingerprint}
              hasOpenShift={hasOpenShift}
              openShiftCheckinTime={openShiftCheckinTime}
              locationWarning={locationWarning}
              scannerError={scannerError}
              errorMessage={errorMessage}
              requestId={requestId}
            />
              </>
            ) : null}

            <section className="employee-secondary-stack" aria-label="İkincil özellikler">

              <SecondaryDisclosure
                title="Ek işlemler"
                description="Demo kaydı ve izin taleplerini buradan yönetin."
                badge={isDemoActive ? 'Demo aktif' : pendingLeaveCount > 0 ? `${pendingLeaveCount} bekleyen` : 'İsteğe bağlı'}
                open={showActivitySectionOpen}
              >
                <div className="employee-secondary-grid">
                  <section className={`demo-visit-card ${isDemoActive ? 'is-live' : 'is-idle'}`}>
                    <div className="demo-visit-head">
                      <div>
                        <p className="demo-visit-kicker">GÜN İÇİ DEMO</p>
                        <h3 className="demo-visit-title">{demoButtonLabel}</h3>
                      </div>
                      <span className={`demo-visit-state ${isDemoActive ? 'state-live' : 'state-ready'}`}>
                        {isDemoActive ? 'AKTİF' : 'HAZIR'}
                      </span>
                    </div>
                    <p className="demo-visit-copy">{demoButtonHint}</p>
                    <button
                      type="button"
                      className="btn btn-primary btn-lg demo-visit-btn"
                      disabled={!canDemoMark}
                      onClick={openDemoConfirmModal}
                    >
                      {isSubmitting && pendingAction === 'demo' ? (
                        <span className="demo-visit-btn-content">
                          <span className="inline-spinner" aria-hidden="true" />
                          Kayıt alınıyor...
                        </span>
                      ) : (
                        <span className="demo-visit-btn-content">{demoButtonLabel}</span>
                      )}
                    </button>
                  </section>

                  {deviceFingerprint ? (
                    <section className="leave-request-card" aria-labelledby="focus-leave-request-title">
                      <div className="leave-request-head">
                        <div>
                          <p className="leave-request-kicker">İZİN AKIŞI</p>
                          <h3 id="focus-leave-request-title" className="leave-request-title">
                            İzin Talebi
                          </h3>
                        </div>
                        <span className="leave-request-count">{leaveHistorySummary}</span>
                      </div>
                      <p className="leave-request-copy">{leaveActionHint}</p>
                      <div className="leave-request-stats">
                        <span className="leave-request-chip leave-request-chip-pending">Bekleyen: {pendingLeaveCount}</span>
                        <span className="leave-request-chip">Toplam: {leaveRequests.length}</span>
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary btn-lg demo-visit-btn leave-request-btn"
                        disabled={!canOpenLeaveRequest}
                        onClick={openLeaveRequestModal}
                      >
                        <span className="demo-visit-btn-content">
                          {isLeaveSubmitting ? 'Gönderiliyor...' : 'İzin Talebi Gönder'}
                        </span>
                      </button>
                    </section>
                  ) : (
                    <div className="warn-box">
                      <p>İzin talebi ve ek işlemler cihaz bağlantısı tamamlandığında açılır.</p>
                    </div>
                  )}
                </div>
              </SecondaryDisclosure>

              {showInstallSection ? (
                <SecondaryDisclosure
                  title="Uygulama kurulumu"
                  description="Kurulum ve tarayıcı yönlendirmelerini daha sakin bir alanda topladık."
                  badge={showInstallPromotions ? installRailPrimaryLabel : 'Kurulum'}
                  open={showInstallSectionOpen}
                >
                  <div className="employee-install-stack">
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
                          <button
                            type="button"
                            className="btn btn-ghost install-banner-dismiss"
                            onClick={dismissInstallBanner}
                          >
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
                          iPhone kurulumu için Safari zorunlu. Şimdi {iosBrowserContext.browserLabel} üzerindesiniz.
                        </p>
                        <div className="install-browser-warning-actions">
                          <button type="button" className="btn btn-soft" onClick={openIosInstallOnboarding}>
                            Safari Adımlarını Aç
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => void copyPortalLinkForSafari()}
                          >
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
                                {step.done ? '+' : '•'}
                              </span>
                              <span>{step.label}</span>
                            </li>
                          ))}
                        </ul>
                        <p className="install-health-meta">
                          Son deneme: <strong>{installLastAttemptLabel}</strong>
                        </p>
                        <button
                          type="button"
                          className="btn btn-primary install-banner-btn"
                          disabled={isInstallPromptBusy || isStandaloneApp}
                          onClick={() => void runDownloadInstallAction()}
                        >
                          {installRailPrimaryLabel}
                        </button>
                      </section>
                    ) : null}

                    {showIosInstallDock ? (
                      <div className="ios-install-dock" role="region" aria-label="Ana ekrana ekleme kisayolu">
                        <div>
                          <p className="ios-install-dock-title">Ana Ekrana Ekle</p>
                          <p className="ios-install-dock-subtitle">
                            {iosInAppBrowserBlocked
                                ? 'Önce Safari ile açın, sonra Paylaş > Ana Ekrana Ekle adımını tamamlayın.'
                                : 'Uygulama gibi kullanmak için kurulumu tamamlayın.'}
                          </p>
                        </div>
                        <div className="ios-install-dock-actions">
                          <button
                            type="button"
                            className="btn btn-soft ios-install-dock-btn"
                            onClick={openIosInstallOnboarding}
                          >
                            Ana Ekrana Ekle
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost ios-install-dock-btn"
                            onClick={() => void copyPortalLinkForSafari()}
                          >
                            Linki Kopyala
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {installNotice ? (
                      <div className="notice-box notice-box-warning">
                        <p>{installNotice}</p>
                      </div>
                    ) : null}
                  </div>
                </SecondaryDisclosure>
              ) : null}

              <SecondaryDisclosure
                title="Cihaz ve güvenlik"
                description="Bildirim, passkey, recovery ve teknik cihaz bilgileri bu alanda."
                badge={!deviceFingerprint ? 'Cihaz gerekli' : passkeyRegistered && recoveryReady && pushRegistered ? 'Hazır' : 'Kontrol et'}
                open={showSecuritySectionOpen}
              >
                {passkeyNotice ? (
                  <div className="notice-box notice-box-success">
                    <p>{passkeyNotice}</p>
                  </div>
                ) : null}

                {pushNotice ? (
                  <div className="notice-box notice-box-success">
                    <p>{pushNotice}</p>
                  </div>
                ) : null}

                <div className="status-grid employee-secondary-status-grid">
                  <article className="status-card">
                      <p className="small-title">Passkey</p>
                      <span className={`status-pill ${passkeyRegistered ? 'state-ok' : 'state-warn'}`}>
                        {passkeyRegistered ? 'Kurulu' : 'Kurulu değil'}
                      </span>
                  </article>

                  <article className="status-card">
                    <p className="small-title">Bildirim</p>
                    <span className={`status-pill ${pushRegistered ? 'state-ok' : pushEnabled && pushRuntimeSupported ? 'state-warn' : 'state-err'}`}>
                        {pushRegistered ? 'Açık' : !pushRuntimeSupported ? 'Destek yok' : pushEnabled ? 'Kapalı' : 'Servis kapalı'}
                    </span>
                  </article>

                  <article className="status-card">
                    <p className="small-title">Recovery</p>
                    <span className={`status-pill ${recoveryReady ? 'state-ok' : 'state-warn'}`}>
                      {recoveryStatusLabel}
                    </span>
                  </article>
                </div>

                {!passkeyRegistered ? (
                  <section className="passkey-brief passkey-brief-setup" aria-live="polite">
                    <p className="passkey-brief-kicker">GÜVENLİK ADIMI</p>
                    <h3 className="passkey-brief-title">Passkey kurulumunu tamamlayın</h3>
                    <p className="passkey-brief-text">
                      Cihaz verisi silinse bile hesabınızı geri yükleyip QR ile mesaiye kesintisiz devam edebilirsiniz.
                    </p>
                    <ul className="passkey-brief-list">
                      <li>Tarayici verisi silinirse hesabinizi geri kazanirsiniz.</li>
                      <li>Sifre ezberlemeden biyometrik dogrulama kullanirsiniz.</li>
                      <li>Yeni cihazda kurtarma suresi ciddi sekilde kisalir.</li>
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
                  <h3 className="passkey-brief-title">Passkey zorunlu değil, Recovery Code kullan</h3>
                  <p className="passkey-brief-text">
                    iPhone dahil tum cihazlarda recovery code + PIN ile cihaz kimligini geri yukleyebilirsin.
                  </p>
                  {recoveryExpiresAt ? (
                    <p className="small-text">
                      Son geçerlilik: <strong>{formatTs(recoveryExpiresAt)}</strong>
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
                        ? 'Recovery kodları üretiliyor...'
                        : recoveryReady
                          ? 'Recovery Kodlarını Yenile'
                          : 'Recovery Kodu Oluştur'}
                    </button>
                      <Link className="inline-link passkey-brief-link" to="/recover">
                        Kurtarma ekranına git
                      </Link>
                  </div>
                  {recoveryReady ? (
                    <div className="recovery-vault">
                      <p className="recovery-vault-title">Mevcut recovery tokenini aç</p>
                      <p className="recovery-vault-text">
                        Bu kodlar telefon değişirse, cihaz sıfırlanırsa veya tarayıcı verisi silinirse hesabı
                        kurtarmak için gereklidir. Görmek için daha önce belirlediğin recovery PIN&apos;ini gir.
                      </p>
                      <div className="recovery-vault-form">
                        <label className="field" htmlFor="focusRecoveryRevealPinInput">
                          <span>Recovery PIN</span>
                          <input
                            id="focusRecoveryRevealPinInput"
                            type="password"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            value={recoveryRevealPin}
                            onChange={(event) => setRecoveryRevealPin(event.target.value)}
                            placeholder="6-12 hane"
                            disabled={isRecoveryRevealBusy || isRecoveryBusy}
                          />
                        </label>
                        <button
                          type="button"
                          className="btn btn-soft recovery-vault-btn"
                          disabled={!deviceFingerprint || isRecoveryRevealBusy || isRecoveryBusy}
                          onClick={() => void runRecoveryCodeReveal()}
                        >
                          {isRecoveryRevealBusy ? 'Kodlar açılıyor...' : 'Tokeni Göster'}
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {recoveryNotice ? <p className="small-text mt-2">{recoveryNotice}</p> : null}
                  {recoveryCodesPreview && recoveryCodesPreview.length > 0 ? (
                    <div className="notice-box notice-box-warning mt-2">
                      <p className="small-text">
                        Aktif recovery kodları. Bunlar cihaz kurtarma için gereklidir, güvenli yerde saklayın:
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

                {deviceFingerprint ? (
                  <details className="employee-last-action-details">
                    <summary>Teknik cihaz bilgileri</summary>
                    <div className="employee-last-action-technical">
                      <ul className="employee-technical-list">
                        <li>
                          <span>Cihaz parmak izi</span>
                          <strong>{deviceFingerprint}</strong>
                        </li>
                      </ul>
                    </div>
                  </details>
                ) : null}
              </SecondaryDisclosure>

              {deviceFingerprint ? (
                <SecondaryDisclosure
                  title="Geçmiş ve talepler"
                  description="Demo oturumları ve önceki izin kayıtları bu bölümde."
                  badge={historySummaryLabel}
                >
                  <div className="employee-history-layout">
                    <section className="demo-history-card" aria-labelledby="focus-demo-history-title">
                      <div className="demo-history-head">
                        <div>
                          <p className="demo-history-kicker">GÜNLÜK ÖZET</p>
                          <h3 id="focus-demo-history-title" className="demo-history-title">
                            Bugünün Demoları
                          </h3>
                        </div>
                        <span className="demo-history-count">{demoHistorySummary}</span>
                      </div>

                      {isDemoHistoryLoading && !isDemoHistoryReady ? (
                        <p className="demo-history-empty">Liste hazirlaniyor...</p>
                      ) : visibleDemoSessions.length > 0 ? (
                        <>
                          <ol className="demo-history-list">
                            {visibleDemoSessions.map((session, index) => (
                              <li
                                key={`${session.started_at_utc}-${session.ended_at_utc ?? 'active'}-${index}-focus`}
                                className={`demo-history-item ${session.is_active ? 'is-active' : ''}`}
                              >
                                <div className="demo-history-range">
                                  <strong>{formatDemoTime(session.started_at_utc)}</strong>
                                  <span className="demo-history-separator">-</span>
                                  <strong>{session.ended_at_utc ? formatDemoTime(session.ended_at_utc) : 'Devam ediyor'}</strong>
                                </div>
                                <span className="demo-history-meta">
                                  {session.is_active ? 'AKTİF' : `${session.duration_minutes} dk`}
                                </span>
                              </li>
                            ))}
                          </ol>
                          {hiddenDemoSessionCount > 0 ? (
                            <p className="demo-history-footnote">+{hiddenDemoSessionCount} kayıt daha var.</p>
                          ) : null}
                        </>
                      ) : (
                        <p className="demo-history-empty">Bugün demo kaydı yok.</p>
                      )}
                    </section>

                    <section className="leave-history-card" aria-labelledby="focus-leave-history-title">
                      <div className="leave-history-head">
                        <div>
                          <p className="leave-history-kicker">İZİN GEÇMİŞİ</p>
                          <h3 id="focus-leave-history-title" className="leave-history-title">
                            Son Talepler
                          </h3>
                        </div>
                        <div className="leave-history-head-actions">
                          <span className="leave-history-count">{leaveHistorySummary}</span>
                          {hasLeaveHistory && !isLeaveHistoryLoading ? (
                            <button
                              type="button"
                              className="leave-history-toggle"
                              aria-expanded={isLeaveHistoryExpanded}
                              aria-controls="focus-leave-history-panel"
                              onClick={() => setIsLeaveHistoryExpanded((current) => !current)}
                            >
                              {isLeaveHistoryExpanded ? 'Gizle' : 'Göster'}
                            </button>
                          ) : null}
                        </div>
                      </div>

                      {isLeaveHistoryLoading && !isLeaveHistoryReady ? (
                        <p className="leave-history-empty">Liste hazırlanıyor...</p>
                      ) : hasLeaveHistory ? (
                        <div id="focus-leave-history-panel" className="leave-history-body">
                          {isLeaveHistoryExpanded ? (
                            <>
                              <ol className="leave-history-list">
                                {visibleLeaveRequests.map((leave) => (
                                  <li key={`${leave.id}-focus`} className={`leave-history-item leave-status-${leave.status.toLowerCase()}`}>
                                    <div className="leave-history-main">
                                      <div className="leave-history-row">
                                        <strong>{leaveTypeLabels[leave.type]}</strong>
                                        <span className={`leave-status-badge leave-status-badge-${leave.status.toLowerCase()}`}>
                                          {leaveStatusLabels[leave.status]}
                                        </span>
                                      </div>
                                      <p className="leave-history-range">{formatLeaveRange(leave.start_date, leave.end_date)}</p>
                                      <p className="leave-history-note">{leave.note || 'Gerekçe girilmedi.'}</p>
                                      {leave.latest_message_preview ? (
                                        <p className="leave-history-decision">Yönetici güncellemesi: {leave.latest_message_preview}</p>
                                      ) : null}
                                      {leave.decision_note ? (
                                        <p className="leave-history-decision">Karar notu: {leave.decision_note}</p>
                                      ) : null}
                                      <div className="leave-thread-summary-row">
                                        <div className="leave-thread-summary-chips">
                                          <span className="leave-request-chip">Belge: {leave.attachment_count ?? 0}</span>
                                          {(leave.message_count ?? 0) > 0 ? (
                                            <span className="leave-request-chip">Güncelleme: {leave.message_count}</span>
                                          ) : null}
                                        </div>
                                        <div className="leave-thread-summary-chips">
                                          <button
                                            type="button"
                                            className="btn btn-soft leave-thread-toggle-btn"
                                            onClick={() => toggleLeaveThread(leave.id)}
                                          >
                                            {activeLeaveThreadId === leave.id ? 'Detayı Gizle' : 'Detayı Gör'}
                                          </button>
                                          {deviceFingerprint ? (
                                            <button
                                              type="button"
                                              className="btn btn-ghost leave-thread-toggle-btn"
                                              onClick={() => openLeaveCommunicationModal(leave)}
                                            >
                                              Canlı Desteğe Yaz
                                            </button>
                                          ) : null}
                                        </div>
                                      </div>
                                      {activeLeaveThreadId === leave.id ? (
                                        <div className="leave-thread-panel">
                                          {leaveThreadLoadingId === leave.id && !leaveThreadsById[leave.id] ? (
                                            <p className="small-text">Talep detayı yükleniyor...</p>
                                          ) : null}
                                          {leaveThreadErrorById[leave.id] ? (
                                            <p className="small-text">{leaveThreadErrorById[leave.id]}</p>
                                          ) : null}
                                          {leaveThreadsById[leave.id] ? (
                                            <>
                                              {leaveThreadsById[leave.id].attachments.length > 0 ? (
                                                <div className="leave-thread-attachments">
                                                  <p className="small-title">Eklenen belgeler</p>
                                                  <div className="leave-thread-attachment-list">
                                                    {leaveThreadsById[leave.id].attachments.map((attachment) => (
                                                      <button
                                                        key={attachment.id}
                                                        type="button"
                                                        className="btn btn-ghost leave-thread-attachment-btn"
                                                        onClick={() =>
                                                          void handleLeaveAttachmentDownload(leave.id, attachment.id, attachment.file_name)
                                                        }
                                                      >
                                                        {attachment.file_name} · {formatAttachmentSize(attachment.file_size_bytes)}
                                                      </button>
                                                    ))}
                                                  </div>
                                                </div>
                                              ) : null}
                                              <div className="leave-thread-messages">
                                                <p className="small-title">Talep güncellemeleri</p>
                                                {leaveThreadsById[leave.id].messages.length > 0 ? (
                                                  <ol className="leave-thread-message-list">
                                                    {leaveThreadsById[leave.id].messages.map((messageRow) => (
                                                      <li
                                                        key={messageRow.id}
                                                        className={`leave-thread-message ${
                                                          messageRow.sender_actor === 'ADMIN' ? 'is-admin' : 'is-employee'
                                                        }`}
                                                      >
                                                        <div className="leave-thread-message-head">
                                                          <strong>{messageRow.sender_label}</strong>
                                                          <span>{formatTs(messageRow.created_at)}</span>
                                                        </div>
                                                        <p>{messageRow.message}</p>
                                                      </li>
                                                    ))}
                                                  </ol>
                                                ) : (
                                                  <p className="small-text">Henüz talebe eklenmiş bir yönetici güncellemesi yok.</p>
                                                )}
                                              </div>
                                            </>
                                          ) : null}
                                        </div>
                                      ) : null}
                                    </div>
                                  </li>
                                ))}
                              </ol>
                              {hiddenLeaveRequestCount > 0 ? (
                                <p className="leave-history-footnote">+{hiddenLeaveRequestCount} talep daha var.</p>
                              ) : null}
                            </>
                          ) : (
                            <p className="leave-history-collapsed">
                              {leaveRequests.length} izin kaydı gizli. Görmek için Göster butonuna dokun.
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="leave-history-empty">Henüz izin talebi yok.</p>
                      )}
                    </section>
                  </div>
                </SecondaryDisclosure>
              ) : null}

              <SecondaryDisclosure
                title="Canlı destek"
                description="Yönetim desteğine hızlıca yaz; görüşmen resmî kayıt altında tutulur."
                badge={openCommunicationCount > 0 ? `${openCommunicationCount} açık` : communicationSummary}
                open={Boolean(requestedConversationId)}
              >
                <section className="employee-communication-card" aria-labelledby="employee-communication-title">
                  <div className="employee-communication-hero">
                    <div className="employee-communication-head">
                      <div className="employee-communication-heading">
                        <p className="employee-communication-kicker">CANLI DESTEK</p>
                        <h3 id="employee-communication-title" className="employee-communication-title">
                          Destek masası ve yönetici hattı
                        </h3>
                        <p className="employee-communication-copy">
                          Puantaj, vardiya, izin veya belgeyle ilgili yardıma ihtiyacın olduğunda buradan yaz. Destek ekibi
                          ve yöneticiler aynı kayıt üzerinden sana döner.
                        </p>
                      </div>
                      <div className="employee-communication-presence">
                        <span className="employee-communication-presence-dot" aria-hidden="true" />
                        <span>Resmî destek kanalı</span>
                      </div>
                    </div>

                    <div className="employee-communication-guidance">
                      <span className="employee-communication-guidance-label">Nasıl kullanılır</span>
                      <span className="employee-communication-chip">Konu seç</span>
                      <span className="employee-communication-chip">Başlığı net yaz</span>
                      <span className="employee-communication-chip">Sorunu kısa anlat</span>
                    </div>

                    <div className="employee-communication-overview">
                      <article className="employee-communication-stat">
                        <span className="employee-communication-stat-label">Açık destek</span>
                        <strong className="employee-communication-stat-value">{openCommunicationCount}</strong>
                        <p className="employee-communication-stat-note">Yanıt bekleyen veya devam eden görüşmeler.</p>
                      </article>
                      <article className="employee-communication-stat">
                        <span className="employee-communication-stat-label">Kapanan görüşme</span>
                        <strong className="employee-communication-stat-value">{closedCommunicationCount}</strong>
                        <p className="employee-communication-stat-note">Tamamlanmış veya sonuçlanmış destek kayıtları.</p>
                      </article>
                      <article className="employee-communication-stat">
                        <span className="employee-communication-stat-label">Son yanıt</span>
                        <strong className="employee-communication-stat-value">
                          {latestCommunicationAt ? formatTs(latestCommunicationAt) : 'Henüz yok'}
                        </strong>
                        <p className="employee-communication-stat-note">Destek hattındaki en güncel hareket zamanı.</p>
                      </article>
                    </div>

                    {deviceFingerprint ? (
                      <div className="employee-communication-cta-card">
                        <div className="employee-communication-cta-copy-wrap">
                          <p className="employee-communication-cta-kicker">YENİ DESTEK KAYDI</p>
                          <p className="employee-communication-cta-copy">
                            Karışıklık yaşamadan konu seç, kısa başlık yaz ve destek talebini tek ekrandan ilet.
                          </p>
                        </div>
                        <div className="employee-communication-actions">
                          <button
                            type="button"
                            className="btn btn-primary employee-communication-open-btn"
                            onClick={openCommunicationModal}
                          >
                            Yeni Destek Talebi
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="warn-box">
                        <p>Canlı destek için önce cihaz bağlantısını tamamla.</p>
                      </div>
                    )}
                  </div>

                  {isCommunicationLoading && !isCommunicationReady ? (
                    <p className="leave-history-empty">Destek görüşmeleri hazırlanıyor...</p>
                  ) : hasCommunicationHistory ? (
                    <div className="employee-communication-list-shell">
                      <div className="employee-communication-list-head">
                        <div>
                          <p className="employee-communication-list-kicker">GÖRÜŞMELERİN</p>
                          <h4 className="employee-communication-list-title">Açık ve geçmiş destek kayıtların</h4>
                        </div>
                        <span className="employee-communication-list-count">{communicationSummary}</span>
                      </div>

                      <ol className="employee-communication-list">
                        {visibleCommunications.map((conversation) => (
                          <li
                            key={conversation.id}
                            className={`employee-communication-item ${
                              conversation.status === 'CLOSED' ? 'is-closed' : 'is-open'
                            }`}
                          >
                            <div className="employee-communication-item-top">
                              <div className="employee-communication-item-badges">
                                <span className="employee-communication-topic-chip">
                                  {conversationCategoryLabels[conversation.category]}
                                </span>
                                <span
                                  className={`employee-communication-status employee-communication-status-${conversation.status.toLowerCase()}`}
                                >
                                  {conversationStatusLabel(conversation.status)}
                                </span>
                              </div>
                              <span className="employee-communication-item-time">{formatTs(conversation.last_message_at)}</span>
                            </div>

                            <div className="employee-communication-item-body">
                              <h5 className="employee-communication-subject">{conversation.subject}</h5>
                              <p className="employee-communication-preview">
                                {conversation.latest_message_preview || 'Henüz mesaj ön izlemesi yok. Akışı açıp detayları görebilirsin.'}
                              </p>
                            </div>

                            <div className="employee-communication-item-footer">
                              <div className="employee-communication-metrics">
                                <span className="employee-communication-metric-pill">Mesaj: {conversation.message_count}</span>
                                <span className="employee-communication-metric-pill">
                                  Durum: {conversationStatusLabel(conversation.status)}
                                </span>
                              </div>
                              <button
                                type="button"
                                className="btn btn-soft employee-communication-toggle-btn"
                                onClick={() => toggleCommunicationThread(conversation.id)}
                              >
                                {activeCommunicationId === conversation.id ? 'Sohbeti Gizle' : 'Sohbeti Aç'}
                              </button>
                            </div>

                            {activeCommunicationId === conversation.id ? (
                              <div className="employee-communication-thread">
                                <div className="employee-communication-thread-head">
                                  <div>
                                    <p className="employee-communication-thread-kicker">DESTEK GÖRÜŞMESİ</p>
                                    <p className="employee-communication-thread-note">
                                      Bu kanal kayıt altındadır. Sorununu kısa, net ve resmî biçimde yaz.
                                    </p>
                                  </div>
                                  <span className="employee-communication-thread-status">
                                    {conversationStatusLabel(conversation.status)}
                                  </span>
                                </div>
                                {communicationThreadLoadingId === conversation.id && !communicationThreadsById[conversation.id] ? (
                                  <p className="small-text">Destek görüşmesi yükleniyor...</p>
                                ) : null}
                                {communicationThreadErrorById[conversation.id] ? (
                                  <p className="small-text">{communicationThreadErrorById[conversation.id]}</p>
                                ) : null}
                                {communicationThreadsById[conversation.id] ? (
                                  <>
                                    <ol className="employee-communication-message-list">
                                      {communicationThreadsById[conversation.id].messages.map((messageRow) => (
                                        <li
                                          key={messageRow.id}
                                          className={`employee-communication-bubble-row ${
                                            messageRow.sender_actor === 'ADMIN' ? 'is-admin' : 'is-employee'
                                          }`}
                                        >
                                          <div className="employee-communication-bubble-meta">
                                            <strong className="employee-communication-bubble-author">
                                              {messageRow.sender_actor === 'ADMIN' ? messageRow.sender_label : 'Siz'}
                                            </strong>
                                            <span>{formatTs(messageRow.created_at)}</span>
                                          </div>
                                          <div className="employee-communication-bubble">
                                            <p>{messageRow.message}</p>
                                          </div>
                                        </li>
                                      ))}
                                    </ol>

                                    {communicationThreadsById[conversation.id].conversation.status === 'OPEN' ? (
                                      <div className="leave-thread-reply-box employee-communication-reply-box">
                                        <label className="field">
                                          <span>Mesajını yaz</span>
                                          <textarea
                                            rows={3}
                                            value={communicationReplyDrafts[conversation.id] ?? ''}
                                            onChange={(event) => updateCommunicationReplyDraft(conversation.id, event.target.value)}
                                            placeholder="Örnek: Vardiya değişikliği talebimin güncel durumunu paylaşabilir misiniz?"
                                          />
                                        </label>
                                        <div className="employee-communication-starters">
                                          {communicationReplyStarters.map((starter) => (
                                            <button
                                              key={starter}
                                              type="button"
                                              className="employee-communication-starter-btn"
                                              onClick={() => applyCommunicationReplyStarter(conversation.id, starter)}
                                            >
                                              {starter}
                                            </button>
                                          ))}
                                        </div>
                                        <button
                                          type="button"
                                          className="btn btn-primary leave-thread-reply-btn"
                                          disabled={communicationReplyBusyId === conversation.id}
                                          onClick={() => void submitCommunicationReply(conversation.id)}
                                        >
                                          {communicationReplyBusyId === conversation.id ? 'Gönderiliyor...' : 'Mesajı Gönder'}
                                        </button>
                                      </div>
                                    ) : (
                                      <p className="small-text">
                                        Bu destek görüşmesi kapatıldı. Gerekirse yeni bir destek talebi açabilirsin.
                                      </p>
                                    )}
                                  </>
                                ) : null}
                              </div>
                            ) : null}
                          </li>
                        ))}
                      </ol>
                      {hiddenCommunicationCount > 0 ? (
                        <p className="leave-history-footnote">+{hiddenCommunicationCount} destek kaydı daha var.</p>
                      ) : null}
                    </div>
                  ) : (
                    <div className="employee-communication-empty">
                      <p className="employee-communication-empty-title">Henüz destek kaydın yok.</p>
                      <p className="employee-communication-empty-copy">
                        İzin, vardiya, puantaj veya belge süreciyle ilgili ilk destek talebini buradan açabilirsin.
                      </p>
                      {deviceFingerprint ? (
                        <button
                          type="button"
                          className="btn btn-primary employee-communication-open-btn"
                          onClick={openCommunicationModal}
                        >
                          İlk Destek Talebini Aç
                        </button>
                      ) : null}
                    </div>
                  )}
                </section>
              </SecondaryDisclosure>
            </section>
          </div>
          <section className="employee-command-surface">
            <div className="employee-hero">
              <div className="employee-hero-copy">
                <p className="employee-hero-kicker">{employeeDisplayName}</p>
                <h2 className="employee-hero-title">{todayStatusLabel(todayStatus)}</h2>
                <p className="employee-hero-subtitle">{todayStatusHint(todayStatus)}</p>
                <div className="employee-hero-meta">
                  <span className="employee-hero-meta-pill">{employeeShiftSummary}</span>
                  <span className="employee-hero-meta-text">{employeeHeroMeta}</span>
                </div>
                <p className="employee-hero-focus">{employeeHeroFocus}</p>
              </div>
              <span className={`employee-hero-indicator ${todayStatusClass}`}>{todayStatusLabel(todayStatus)}</span>
            </div>

            <section className="employee-profile-card" aria-label="Çalışan kimlik bilgileri">
              <div className="employee-profile-head">
                <p className="employee-profile-kicker">ÇALIŞAN KİMLİĞİ</p>
                <h3 className="employee-profile-name">{employeeDisplayName}</h3>
              </div>
              <dl className="employee-profile-grid">
                <div className="employee-profile-item">
                  <dt>Çalışan No</dt>
                  <dd>{statusSnapshot?.employee_id ? `#${statusSnapshot.employee_id}` : '-'}</dd>
                </div>
                <div className="employee-profile-item">
                  <dt>Bölge</dt>
                  <dd>{statusSnapshot?.region_name ?? 'Atanmamış'}</dd>
                </div>
                <div className="employee-profile-item">
                  <dt>Departman</dt>
                  <dd>{statusSnapshot?.department_name ?? 'Atanmamış'}</dd>
                </div>
                <div className="employee-profile-item">
                  <dt>Atanan Vardiya</dt>
                  <dd>{employeeShiftSummary}</dd>
                </div>
              </dl>
            </section>

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
              {recoveryReady ? (
                <div className="recovery-vault">
                  <p className="recovery-vault-title">Mevcut recovery tokenini ac</p>
                  <p className="recovery-vault-text">
                    Bu kodlar telefon degisirse, cihaz sifirlanirsa veya tarayici verisi silinirse hesabi
                    kurtarmak icin gereklidir. Gormek icin daha once belirledigin recovery PIN&apos;ini gir.
                  </p>
                  <div className="recovery-vault-form">
                    <label className="field" htmlFor="recoveryRevealPinInput">
                      <span>Recovery PIN</span>
                      <input
                        id="recoveryRevealPinInput"
                        type="password"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        value={recoveryRevealPin}
                        onChange={(event) => setRecoveryRevealPin(event.target.value)}
                        placeholder="6-12 hane"
                        disabled={isRecoveryRevealBusy || isRecoveryBusy}
                      />
                    </label>
                    <button
                      type="button"
                      className="btn btn-soft recovery-vault-btn"
                      disabled={!deviceFingerprint || isRecoveryRevealBusy || isRecoveryBusy}
                      onClick={() => void runRecoveryCodeReveal()}
                    >
                      {isRecoveryRevealBusy ? 'Kodlar aciliyor...' : 'Tokeni Goster'}
                    </button>
                  </div>
                </div>
              ) : null}
              {recoveryNotice ? <p className="small-text mt-2">{recoveryNotice}</p> : null}
              {recoveryCodesPreview && recoveryCodesPreview.length > 0 ? (
                <div className="notice-box notice-box-warning mt-2">
                  <p className="small-text">
                    Aktif recovery kodlari. Bunlar cihaz kurtarma icin gereklidir, guvenli yerde saklayin:
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

          <section className="employee-action-surface" aria-labelledby="employee-action-surface-title">
            <div className="employee-surface-head">
              <div>
                <p className="employee-surface-kicker">GUNLUK AKIS</p>
                <h2 id="employee-action-surface-title" className="employee-surface-title">
                  Bugunu daha net yonet
                </h2>
              </div>
              <p className="employee-surface-copy">
                Hemen gereken islemleri ustte tamamla, demo ve izin durumunu yan tarafta izle, gecmis kayitlara ise
                asagida ayri bir bolumden bak.
              </p>
            </div>

            <div className="employee-action-layout">
              {false ? (
                <div className="employee-action-primary">
                <section className="action-panel">
              <div className="action-panel-head">
                <p className="small-title">Komut Merkezi</p>
                <span className="action-panel-kicker">Hızlı İşlemler</span>
              </div>
              <div className="stack">
                <button
                  type="button"
                  className="btn btn-primary action-cta-btn"
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
                    <span className="action-cta-copy">QR ile İşlem Başlat</span>
                  )}
                </button>

                <button
                  type="button"
                  className="btn btn-outline action-cta-btn"
                  disabled={!canCheckout}
                  onClick={openCheckoutConfirmModal}
                >
                  {isSubmitting && pendingAction === 'checkout' ? (
                    <>
                      <span className="inline-spinner inline-spinner-dark" aria-hidden="true" />
                      İşlem yapılıyor...
                    </>
                  ) : (
                    <span className="action-cta-copy">Mesaiyi Güvenli Bitir</span>
                  )}
                </button>

              </div>

              <ol className="action-flow">
                <li>QR okutun ve işlemi başlatın.</li>
                <li>Mesai sonunda güvenli bitiş yapın.</li>
                <li>Demo ve izin durumunu yandaki kartlardan yonetin.</li>
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
                </div>
              ) : null}

              <div className="employee-live-grid">
                <section className={`demo-visit-card ${isDemoActive ? 'is-live' : 'is-idle'}`}>
              <div className="demo-visit-head">
                <div>
                  <p className="demo-visit-kicker">GÜN İÇİ DEMO</p>
                  <h3 className="demo-visit-title">{demoButtonLabel}</h3>
                </div>
                <span className={`demo-visit-state ${isDemoActive ? 'state-live' : 'state-ready'}`}>
                    {isDemoActive ? 'AKTİF' : 'HAZIR'}
                </span>
              </div>
              <p className="demo-visit-copy">{demoButtonHint}</p>
              <button
                type="button"
                className="btn btn-primary btn-lg demo-visit-btn"
                disabled={!canDemoMark}
                onClick={openDemoConfirmModal}
              >
                {isSubmitting && pendingAction === 'demo' ? (
                  <span className="demo-visit-btn-content">
                    <span className="inline-spinner" aria-hidden="true" />
                    Kayıt alınıyor...
                  </span>
                ) : (
                  <span className="demo-visit-btn-content">{demoButtonLabel}</span>
                )}
              </button>
            </section>

            {deviceFingerprint ? (
              <section className="leave-request-card" aria-labelledby="leave-request-title">
                <div className="leave-request-head">
                  <div>
                    <p className="leave-request-kicker">IZIN AKISI</p>
                    <h3 id="leave-request-title" className="leave-request-title">
                      Izin Talebi
                    </h3>
                  </div>
                  <span className="leave-request-count">{leaveHistorySummary}</span>
                </div>
                <p className="leave-request-copy">{leaveActionHint}</p>
                <div className="leave-request-stats">
                  <span className="leave-request-chip leave-request-chip-pending">Bekleyen: {pendingLeaveCount}</span>
                  <span className="leave-request-chip">Toplam: {leaveRequests.length}</span>
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-lg demo-visit-btn leave-request-btn"
                  disabled={!canOpenLeaveRequest}
                  onClick={openLeaveRequestModal}
                >
                  <span className="demo-visit-btn-content">
                    {isLeaveSubmitting ? 'Gönderiliyor...' : 'İzin Talebi Gönder'}
                  </span>
                </button>
              </section>
            ) : null}
              </div>
            </div>

            {deviceFingerprint ? (
              <div className="employee-history-layout">
                <section className="demo-history-card" aria-labelledby="demo-history-title">
                <div className="demo-history-head">
                  <div>
                    <p className="demo-history-kicker">GUNLUK OZET</p>
                    <h3 id="demo-history-title" className="demo-history-title">
                      Bugunun Demolari
                    </h3>
                  </div>
                  <span className="demo-history-count">{demoHistorySummary}</span>
                </div>

                {isDemoHistoryLoading && !isDemoHistoryReady ? (
                  <p className="demo-history-empty">Liste hazirlaniyor...</p>
                ) : visibleDemoSessions.length > 0 ? (
                  <>
                    <ol className="demo-history-list">
                      {visibleDemoSessions.map((session, index) => (
                        <li
                          key={`${session.started_at_utc}-${session.ended_at_utc ?? 'active'}-${index}`}
                          className={`demo-history-item ${session.is_active ? 'is-active' : ''}`}
                        >
                          <div className="demo-history-range">
                            <strong>{formatDemoTime(session.started_at_utc)}</strong>
                            <span className="demo-history-separator">-</span>
                            <strong>{session.ended_at_utc ? formatDemoTime(session.ended_at_utc) : 'Devam ediyor'}</strong>
                          </div>
                          <span className="demo-history-meta">
                            {session.is_active ? 'AKTIF' : `${session.duration_minutes} dk`}
                          </span>
                        </li>
                      ))}
                    </ol>
                    {hiddenDemoSessionCount > 0 ? (
                      <p className="demo-history-footnote">+{hiddenDemoSessionCount} kayit daha var.</p>
                    ) : null}
                  </>
                ) : (
                  <p className="demo-history-empty">Bugun demo kaydi yok.</p>
                )}
                </section>

                <section className="leave-history-card" aria-labelledby="leave-history-title">
                <div className="leave-history-head">
                  <div>
                    <p className="leave-history-kicker">IZIN GECMISI</p>
                    <h3 id="leave-history-title" className="leave-history-title">
                      Son Talepler
                    </h3>
                  </div>
                  <div className="leave-history-head-actions">
                    <span className="leave-history-count">{leaveHistorySummary}</span>
                    {hasLeaveHistory && !isLeaveHistoryLoading ? (
                      <button
                        type="button"
                        className="leave-history-toggle"
                        aria-expanded={isLeaveHistoryExpanded}
                        aria-controls="leave-history-panel"
                        onClick={() => setIsLeaveHistoryExpanded((current) => !current)}
                      >
                        {isLeaveHistoryExpanded ? 'Gizle' : 'Goster'}
                      </button>
                    ) : null}
                  </div>
                </div>

                {isLeaveHistoryLoading && !isLeaveHistoryReady ? (
                  <p className="leave-history-empty">Liste hazirlaniyor...</p>
                ) : hasLeaveHistory ? (
                  <div id="leave-history-panel" className="leave-history-body">
                    {isLeaveHistoryExpanded ? (
                      <>
                        <ol className="leave-history-list">
                          {visibleLeaveRequests.map((leave) => (
                            <li key={leave.id} className={`leave-history-item leave-status-${leave.status.toLowerCase()}`}>
                              <div className="leave-history-main">
                                <div className="leave-history-row">
                                  <strong>{leaveTypeLabels[leave.type]}</strong>
                                  <span className={`leave-status-badge leave-status-badge-${leave.status.toLowerCase()}`}>
                                    {leaveStatusLabels[leave.status]}
                                  </span>
                                </div>
                                <p className="leave-history-range">{formatLeaveRange(leave.start_date, leave.end_date)}</p>
                                <p className="leave-history-note">{leave.note || 'Gerekce girilmedi.'}</p>
                                {leave.decision_note ? (
                                  <p className="leave-history-decision">Karar notu: {leave.decision_note}</p>
                                ) : null}
                              </div>
                            </li>
                          ))}
                        </ol>
                        {hiddenLeaveRequestCount > 0 ? (
                          <p className="leave-history-footnote">+{hiddenLeaveRequestCount} talep daha var.</p>
                        ) : null}
                      </>
                    ) : (
                      <p className="leave-history-collapsed">
                        {leaveRequests.length} izin kaydi gizli. Gormek icin Goster butonuna dokun.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="leave-history-empty">Henuz izin talebi yok.</p>
                )}
                </section>
              </div>
            ) : null}
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

          </SecondaryFeaturesSection>
        </div>

        {scannerActive && typeof document !== 'undefined'
          ? createPortal(
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
              </div>,
              document.body,
            )
          : null}

        {scanSuccessFxOpen && typeof document !== 'undefined'
          ? createPortal(
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
              </div>,
              document.body,
            )
          : null}

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

        {actionNotice ? (
          <div className={`notice-box ${actionNotice.tone === 'success' ? 'notice-box-success' : 'notice-box-warning'} mt-3`}>
            <p>
              <span className="banner-icon" aria-hidden="true">
                {actionNotice.tone === 'success' ? '+' : '!'}
              </span>
              {actionNotice.text}
            </p>
          </div>
        ) : null}

        {secondCheckinApprovalAlert && typeof document !== 'undefined'
          ? createPortal(
              <div
                className="modal-backdrop checkout-confirm-backdrop"
                role="dialog"
                aria-modal="true"
                aria-labelledby="second-checkin-approval-title"
                aria-describedby="second-checkin-approval-description"
                onClick={() => setSecondCheckinApprovalAlert(null)}
              >
                <div className="checkout-confirm-lights" aria-hidden="true">
                  <span className="checkout-confirm-light checkout-confirm-light-left" />
                  <span className="checkout-confirm-light checkout-confirm-light-center" />
                  <span className="checkout-confirm-light checkout-confirm-light-right" />
                </div>
                <div className="help-modal checkout-confirm-modal" onClick={(event) => event.stopPropagation()}>
                  <p className="checkout-confirm-kicker">ADMIN ONAYI GEREKLI</p>
                  <h2 id="second-checkin-approval-title">Bugunku ikinci giris icin onay bekleniyor</h2>
                  <p id="second-checkin-approval-description">
                    {secondCheckinApprovalAlert.message}
                  </p>
                  <p className="muted">
                    Admin bildirimi onayladiktan sonra ayni QR kodu tekrar okutun.
                  </p>
                  {secondCheckinApprovalAlert.requestId ? (
                    <p className="request-id">request_id: {secondCheckinApprovalAlert.requestId}</p>
                  ) : null}
                  <div className="stack">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => setSecondCheckinApprovalAlert(null)}
                    >
                      Tamam
                    </button>
                  </div>
                </div>
              </div>,
              document.body,
            )
          : null}

        {false ? (
          <div className={`notice-box ${resultMessage!.tone === 'success' ? 'notice-box-success' : 'notice-box-warning'}`}>
            <p>
              <span className="banner-icon" aria-hidden="true">
                {resultMessage!.tone === 'success' ? '+' : '!'}
              </span>
              {resultMessage!.text}
            </p>
            <div className="chips">
              {duplicateDetected ? <span className="status-pill state-warn">Mükerrer kayıt</span> : null}
              {manualCheckout ? <span className="manual-badge">Manuel çıkış yapıldı</span> : null}
            </div>
          </div>
        ) : null}

        {false ? (
          <section className="result-box">
            <h2>Son İşlem</h2>
            <p>
              event_type: <strong>{lastAction!.response.event_type}</strong> ({eventTypeLabel(lastAction!.response.event_type)})
            </p>
            {lastAction!.codeValue ? (
              <p>
                code_value: <strong>{lastAction!.codeValue}</strong>
              </p>
            ) : null}
            <p>
              ts_utc: <strong>{formatTs(lastAction!.response.ts_utc)}</strong>
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
          <EmployeeFocusModal
            titleId="ios-install-onboarding-title"
            descriptionId="ios-install-onboarding-description"
            title="Ana Ekrana Ekle"
            kicker="IPHONE KURULUM"
            panelClassName="install-onboarding-modal employee-focus-modal--wide"
          >
            <p id="ios-install-onboarding-description">
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
          </EmployeeFocusModal>
        ) : null}

        {showAndroidInstallOnboarding ? (
          <EmployeeFocusModal
            titleId="android-install-onboarding-title"
            descriptionId="android-install-onboarding-description"
            title="Tek Seferde Ana Ekrana Ekle"
            kicker="ANDROID KURULUM"
            panelClassName="install-onboarding-modal employee-focus-modal--wide"
          >
            <p id="android-install-onboarding-description">
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
          </EmployeeFocusModal>
        ) : null}

        {isLeaveModalOpen ? (
          <EmployeeFocusModal
            titleId="leave-request-modal-title"
            descriptionId="leave-request-modal-description"
            title="İzin Talebi Oluştur"
            kicker="ÇALIŞAN İZİN TALEBİ"
            panelClassName="employee-focus-modal--wide"
            onClose={closeLeaveRequestModal}
          >
            <p id="leave-request-modal-description">
              İzin gerekçesini ve tarih aralığını gir. Belgen varsa ekle; yöneticiye soru sormak için ayrı canlı destek
              akışını kullan.
            </p>
            <div className="stack">
              <label className="field">
                <span>İzin tipi</span>
                <select value={leaveType} onChange={(event) => setLeaveType(event.target.value as LeaveType)}>
                  <option value="ANNUAL">Yıllık izin</option>
                  <option value="SICK">Rapor / hastalık</option>
                  <option value="UNPAID">Ücretsiz izin</option>
                  <option value="EXCUSE">Mazeret izni</option>
                  <option value="PUBLIC_HOLIDAY">Resmi tatil</option>
                </select>
              </label>
              <label className="field">
                <span>Başlangıç tarihi</span>
                <input type="date" value={leaveStartDate} onChange={(event) => setLeaveStartDate(event.target.value)} />
              </label>
              <label className="field">
                <span>Bitiş tarihi</span>
                <input type="date" value={leaveEndDate} onChange={(event) => setLeaveEndDate(event.target.value)} />
              </label>
              <label className="field">
                <span>İzin gerekçesi</span>
                <textarea
                  value={leaveNote}
                  onChange={(event) => setLeaveNote(event.target.value)}
                  rows={4}
                  placeholder="Örnek: Hastane randevusu, aile işi, resmi işlem..."
                />
              </label>
              <label className="field">
                <span>Belge ekle</span>
                <input
                  type="file"
                  accept={LEAVE_ATTACHMENT_ACCEPT}
                  onChange={(event) => setLeaveAttachmentFile(event.target.files?.[0] ?? null)}
                />
                <span className="small-text">
                  PDF, görsel veya Word belgesi yükleyebilirsin. Üst sınır: 8 MB.
                </span>
                {leaveAttachmentFile ? (
                  <span className="small-text">
                    Seçilen dosya: <strong>{leaveAttachmentFile.name}</strong> ({formatAttachmentSize(leaveAttachmentFile.size)})
                  </span>
                ) : null}
              </label>
              <div className="warn-box">
                <p>Yöneticiye soru veya ek açıklama göndermek için ayrı canlı destek alanını kullan.</p>
                {deviceFingerprint ? (
                  <button
                    type="button"
                    className="btn btn-soft"
                    disabled={isLeaveSubmitting}
                    onClick={() => openLeaveCommunicationModal()}
                  >
                    Canlı Desteği Aç
                  </button>
                ) : null}
              </div>
            </div>
            {leaveFormError ? <p className="small-text">{leaveFormError}</p> : null}
            <div className="stack">
              <button
                type="button"
                className="btn btn-primary"
                disabled={isLeaveSubmitting}
                onClick={() => void submitLeaveRequest()}
              >
                {isLeaveSubmitting ? 'Gönderiliyor...' : 'Talebi Gönder'}
              </button>
              <button type="button" className="btn btn-soft" disabled={isLeaveSubmitting} onClick={closeLeaveRequestModal}>
                Vazgeç
              </button>
            </div>
          </EmployeeFocusModal>
        ) : null}

        {isCommunicationModalOpen ? (
          <EmployeeFocusModal
            titleId="employee-communication-modal-title"
            descriptionId="employee-communication-modal-description"
            title="Canlı Destek Talebi"
            kicker="DESTEK MASASI"
            panelClassName="employee-focus-modal--wide"
            onClose={closeCommunicationModal}
          >
            <p id="employee-communication-modal-description">
              Yardıma ihtiyacını kısa ve anlaşılır biçimde yaz. Mesajın destek kaydı olarak yönetime iletilir.
            </p>
            <p className="employee-communication-modal-note">
              Hızlı başlamak istersen aşağıdaki şablonlardan birini seçip sonra metni kendi durumuna göre düzenleyebilirsin.
            </p>
            <div className="employee-communication-template-grid">
              {communicationTemplates.map((template) => (
                <button
                  key={template.label}
                  type="button"
                  className="employee-communication-template-btn"
                  onClick={() => applyCommunicationTemplate(template)}
                >
                  {template.label}
                </button>
              ))}
            </div>
            <div className="stack">
              <label className="field">
                <span>Destek kategorisi</span>
                <select
                  value={communicationCategory}
                  onChange={(event) => setCommunicationCategory(event.target.value as EmployeeConversationCategory)}
                >
                  <option value="ATTENDANCE">Puantaj</option>
                  <option value="SHIFT">Vardiya</option>
                  <option value="DEVICE">Cihaz</option>
                  <option value="DOCUMENT">Belge</option>
                  <option value="OTHER">Genel</option>
                </select>
              </label>
              <label className="field">
                <span>Kısa başlık</span>
                <input
                  value={communicationSubject}
                  onChange={(event) => setCommunicationSubject(event.target.value)}
                  placeholder="Örnek: 12 Nisan vardiya değişikliği desteği"
                />
              </label>
              <label className="field">
                <span>Mesajın</span>
                <textarea
                  value={communicationMessage}
                  onChange={(event) => setCommunicationMessage(event.target.value)}
                  rows={5}
                  placeholder="Örnek: 12 Nisan 2026 vardiya planım için desteğe ihtiyacım var. Güncel durumu paylaşabilir misiniz?"
                />
              </label>
            </div>
            {communicationFormError ? <p className="small-text">{communicationFormError}</p> : null}
            <div className="stack">
              <button
                type="button"
                className="btn btn-primary"
                disabled={isCommunicationSubmitting}
                onClick={() => void submitCommunication()}
              >
                {isCommunicationSubmitting ? 'Gönderiliyor...' : 'Destek Talebi Gönder'}
              </button>
              <button
                type="button"
                className="btn btn-soft"
                disabled={isCommunicationSubmitting}
                onClick={closeCommunicationModal}
              >
                Vazgeç
              </button>
            </div>
          </EmployeeFocusModal>
        ) : null}

        {isCheckoutConfirmOpen && typeof document !== 'undefined'
          ? createPortal(
              <div
                className="modal-backdrop checkout-confirm-backdrop"
                role="dialog"
                aria-modal="true"
                aria-labelledby="checkout-confirm-title"
                aria-describedby="checkout-confirm-description"
                onClick={() => setIsCheckoutConfirmOpen(false)}
              >
                <div className="checkout-confirm-lights" aria-hidden="true">
                  <span className="checkout-confirm-light checkout-confirm-light-left" />
                  <span className="checkout-confirm-light checkout-confirm-light-center" />
                  <span className="checkout-confirm-light checkout-confirm-light-right" />
                </div>
                <div className="help-modal checkout-confirm-modal" onClick={(event) => event.stopPropagation()}>
                  <p className="checkout-confirm-kicker">GUVENLI CIKIS ONAYI</p>
                  <h2 id="checkout-confirm-title">Mesaiyi bitirmek istediğinize emin misiniz?</h2>
                  <p id="checkout-confirm-description">
                    "Mesaiyi Güvenli Bitir" işlemi bugünkü çıkışı kaydeder. Devam etmek istiyor musunuz?
                  </p>
                  <div className="stack">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => {
                        setIsCheckoutConfirmOpen(false)
                        void runCheckout()
                      }}
                    >
                      Evet, mesaiyi bitir
                    </button>
                    <button
                      type="button"
                      className="btn btn-soft"
                      onClick={() => setIsCheckoutConfirmOpen(false)}
                    >
                      Hayır
                    </button>
                  </div>
                </div>
              </div>,
              document.body,
            )
          : null}

        {isDemoConfirmOpen && typeof document !== 'undefined'
          ? createPortal(
              <div
                className="modal-backdrop checkout-confirm-backdrop"
                role="dialog"
                aria-modal="true"
                aria-labelledby="demo-confirm-title"
                aria-describedby="demo-confirm-description"
                onClick={() => setIsDemoConfirmOpen(false)}
              >
                <div className="checkout-confirm-lights" aria-hidden="true">
                  <span className="checkout-confirm-light checkout-confirm-light-left" />
                  <span className="checkout-confirm-light checkout-confirm-light-center" />
                  <span className="checkout-confirm-light checkout-confirm-light-right" />
                </div>
                <div className="help-modal checkout-confirm-modal" onClick={(event) => event.stopPropagation()}>
                  <p className="checkout-confirm-kicker">DEMO KAYDI ONAYI</p>
                  <h2 id="demo-confirm-title">
                    {isDemoActive ? 'Demo bitisini kaydetmek istiyor musunuz?' : 'Demo baslangicini kaydetmek istiyor musunuz?'}
                  </h2>
                  <p id="demo-confirm-description">
                    {isDemoActive
                      ? 'Bu işlem aktif demo kaydını kapatır. Devam etmek istiyor musunuz?'
                      : 'Bu işlem gün içindeki demo başlangıç kaydını oluşturur. Devam etmek istiyor musunuz?'}
                  </p>
                  <div className="stack">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => {
                        setIsDemoConfirmOpen(false)
                        void runDemoMark()
                      }}
                    >
                      {isDemoActive ? 'Evet, demo bitti' : 'Evet, demo basladi'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-soft"
                      onClick={() => setIsDemoConfirmOpen(false)}
                    >
                      Hayir
                    </button>
                  </div>
                </div>
              </div>,
              document.body,
            )
          : null}

        {isDemoLocationPromptOpen ? (
          <EmployeeFocusModal
            titleId="demo-location-prompt-title"
            descriptionId="demo-location-prompt-description"
            title="Konumu Açın"
            kicker="DEMO KONUMU"
            onClose={() => setIsDemoLocationPromptOpen(false)}
          >
            <p id="demo-location-prompt-description">
              Demo kaydini tamamlamak icin cihazinizda konum acik olmali. Konumu actiktan sonra tekrar deneyin.
            </p>
            <div className="stack">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setIsDemoLocationPromptOpen(false)
                  void runDemoMark()
                }}
              >
                Tekrar dene
              </button>
              <button
                type="button"
                className="btn btn-soft"
                onClick={() => setIsDemoLocationPromptOpen(false)}
              >
                Kapat
              </button>
            </div>
          </EmployeeFocusModal>
        ) : null}

        {isHelpOpen ? (
          <EmployeeFocusModal
            titleId="checkout-help-title"
            descriptionId="checkout-help-description"
            title="Mesai Bitiş Bilgilendirmesi"
            kicker="MESAI HATIRLATMASI"
            onClose={() => setIsHelpOpen(false)}
          >
            <p id="checkout-help-description">
              Gun icinde giristen sonra cikisi mutlaka "Mesaiyi Bitir" ile tamamlayin.
            </p>
            <div className="stack">
              <button type="button" className="btn btn-primary" onClick={() => setIsHelpOpen(false)}>
                Anladım
              </button>
            </div>
          </EmployeeFocusModal>
        ) : null}

        {showPushGateModal ? (
          <EmployeeFocusModal
            titleId="push-gate-title"
            descriptionId="push-gate-description"
            title="Bildirim İzni Zorunlu"
            kicker="PUSH GATE"
          >
            <p id="push-gate-description">
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
          </EmployeeFocusModal>
        ) : null}

        <BrandSignature />
        </section>

        {showInstallPromotions ? (
          <aside className="promo-rail promo-rail-right" aria-label="Kurumsal tanitim paneli">
            <p className="promo-rail-kicker">KURUMSAL VERİMLİLİK</p>
            <h2 className="promo-rail-title">Hızlı kayıt, net takip.</h2>
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

      {false ? (
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


