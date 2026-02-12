self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

function parsePayload(event) {
  const fallback = {
    title: 'Puantaj Bildirimi',
    body: 'Yeni bir yönetici bildirimi var.',
    data: {},
  }

  if (!event.data) {
    return fallback
  }

  try {
    const parsed = event.data.json()
    return {
      title: typeof parsed?.title === 'string' && parsed.title.trim() ? parsed.title.trim() : fallback.title,
      body: typeof parsed?.body === 'string' && parsed.body.trim() ? parsed.body.trim() : fallback.body,
      data: typeof parsed?.data === 'object' && parsed.data !== null ? parsed.data : {},
    }
  } catch {
    try {
      const text = event.data.text()
      return {
        title: fallback.title,
        body: text && text.trim() ? text.trim() : fallback.body,
        data: {},
      }
    } catch {
      return fallback
    }
  }
}

self.addEventListener('push', (event) => {
  const payload = parsePayload(event)
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      data: payload.data,
      requireInteraction: false,
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const rawUrl = event.notification?.data?.url
  const targetUrl = typeof rawUrl === 'string' && rawUrl.trim() ? rawUrl.trim() : '/admin-panel/notifications'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes('/admin-panel/')) {
          client.focus()
          if ('navigate' in client) {
            return client.navigate(targetUrl)
          }
          return client
        }
      }
      return self.clients.openWindow(targetUrl)
    }),
  )
})
