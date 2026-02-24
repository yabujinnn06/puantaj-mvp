/// <reference lib="webworker" />

import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{
    revision: string | null
    url: string
  }>
}

self.skipWaiting()
clientsClaim()
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

function parsePushPayload(event: PushEvent): {
  title: string
  body: string
  data: Record<string, unknown>
} {
  const fallback = {
    title: 'Puantaj Bildirimi',
    body: 'Yeni bir puantaj bildirimi var.',
    data: {} as Record<string, unknown>,
  }

  if (!event.data) {
    return fallback
  }

  try {
    const parsed = event.data.json() as {
      title?: string
      body?: string
      data?: Record<string, unknown>
    }
    return {
      title: parsed.title?.trim() || fallback.title,
      body: parsed.body?.trim() || fallback.body,
      data: parsed.data ?? {},
    }
  } catch {
    try {
      const textBody = event.data.text().trim()
      return {
        title: fallback.title,
        body: textBody || fallback.body,
        data: {},
      }
    } catch {
      return fallback
    }
  }
}

function coerceBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'evet') {
      return true
    }
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'hayir') {
      return false
    }
  }
  return fallback
}

function parseVibratePattern(value: unknown): number[] | undefined {
  if (Array.isArray(value)) {
    const parsed = value
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item) && item >= 0)
      .slice(0, 8)
      .map((item) => Math.trunc(item))
    return parsed.length > 0 ? parsed : undefined
  }
  if (typeof value === 'string') {
    const parsed = value
      .split(',')
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isFinite(item) && item >= 0)
      .slice(0, 8)
      .map((item) => Math.trunc(item))
    return parsed.length > 0 ? parsed : undefined
  }
  return undefined
}

function buildNotificationOptions(payload: {
  title: string
  body: string
  data: Record<string, unknown>
}): NotificationOptions {
  const now = Date.now()
  const rawTag = typeof payload.data.tag === 'string' ? payload.data.tag.trim() : ''
  const vibrate = parseVibratePattern(payload.data.vibrate) ?? [240, 120, 240, 120, 320]

  return {
    body: payload.body,
    icon: '/employee/icons/icon-192.png',
    badge: '/employee/icons/icon-192.png',
    data: payload.data,
    requireInteraction: coerceBoolean(payload.data.requireInteraction, true),
    tag: rawTag || `employee-push-${now}`,
    vibrate,
    silent: false,
    timestamp: now,
    actions: [
      { action: 'open', title: 'Ac' },
      { action: 'dismiss', title: 'Kapat' },
    ],
  } as NotificationOptions
}

self.addEventListener('push', (event) => {
  const payload = parsePushPayload(event)
  const options = buildNotificationOptions(payload)

  event.waitUntil(self.registration.showNotification(payload.title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  if (event.action === 'dismiss') {
    return
  }

  const rawUrl = event.notification.data?.url
  const targetUrl =
    typeof rawUrl === 'string' && rawUrl.trim() ? rawUrl.trim() : '/employee/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        const windowClient = client as WindowClient
        if (windowClient.url.includes('/employee/')) {
          return windowClient.focus()
        }
      }
      return self.clients.openWindow(targetUrl)
    }),
  )
})
