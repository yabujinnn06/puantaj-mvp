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

self.addEventListener('push', (event) => {
  const payload = parsePushPayload(event)
  const options: NotificationOptions = {
    body: payload.body,
    icon: '/employee/icons/icon-192.png',
    badge: '/employee/icons/icon-192.png',
    data: payload.data,
    requireInteraction: false,
  }

  event.waitUntil(self.registration.showNotification(payload.title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

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
