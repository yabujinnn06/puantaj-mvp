self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

function getAdminBasePath() {
  try {
    const scopeUrl = new URL(self.registration.scope)
    return scopeUrl.pathname.endsWith('/') ? scopeUrl.pathname : `${scopeUrl.pathname}/`
  } catch {
    return '/admin-panel/'
  }
}

function normalizeAdminTargetUrl(rawUrl) {
  const origin = self.location.origin
  const adminBasePath = getAdminBasePath()
  const fallbackUrl = new URL(`${adminBasePath}notifications`, origin).href

  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return fallbackUrl
  }

  const candidate = rawUrl.trim()
  try {
    if (candidate.startsWith('https://') || candidate.startsWith('http://')) {
      const absoluteUrl = new URL(candidate)
      if (absoluteUrl.origin !== origin) {
        return fallbackUrl
      }
      return absoluteUrl.href
    }

    if (candidate.startsWith('/')) {
      return new URL(candidate, origin).href
    }

    return new URL(`${adminBasePath}${candidate.replace(/^\/+/, '')}`, origin).href
  } catch {
    return fallbackUrl
  }
}

async function focusOrOpenAdminTarget(targetUrl) {
  const adminBasePath = getAdminBasePath()
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })

  for (const client of clients) {
    let clientPath = ''
    try {
      clientPath = new URL(client.url).pathname
    } catch {
      continue
    }

    if (!clientPath.startsWith(adminBasePath)) {
      continue
    }

    try {
      await client.focus()
      if ('navigate' in client) {
        const navigatedClient = await client.navigate(targetUrl)
        if (navigatedClient) {
          await navigatedClient.focus()
          return navigatedClient
        }
      }
    } catch {
      // best effort; try in-app message bridge below
    }

    if (typeof client.postMessage === 'function') {
      client.postMessage({ type: 'ADMIN_OPEN_URL', url: targetUrl })
    }
    return client
  }

  return self.clients.openWindow(targetUrl)
}

function parsePayload(event) {
  const fallback = {
    title: 'Puantaj Bildirimi',
    body: 'Yeni bir yonetici bildirimi var.',
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

function isSilentPayload(payload) {
  const data = payload?.data
  if (!data || typeof data !== 'object') {
    return false
  }
  if (data.silent === true) {
    return true
  }
  if (typeof data.silent === 'string' && data.silent.trim().toLowerCase() === 'true') {
    return true
  }
  return false
}

function asBoolean(value, fallback = false) {
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

function parseVibrate(value) {
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

function buildNotificationOptions(payload) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : {}
  const now = Date.now()
  const rawTag = typeof data.tag === 'string' ? data.tag.trim() : ''
  const vibrate = parseVibrate(data.vibrate) || [240, 120, 240, 120, 320]

  return {
    body: payload.body,
    data,
    icon: '/admin-panel/admin-logo.svg',
    badge: '/admin-panel/admin-logo.svg',
    tag: rawTag || `admin-push-${now}`,
    renotify: true,
    requireInteraction: asBoolean(data.requireInteraction, true),
    vibrate,
    silent: false,
    timestamp: now,
    actions: [
      { action: 'open', title: 'Ac' },
      { action: 'dismiss', title: 'Kapat' },
    ],
  }
}

self.addEventListener('push', (event) => {
  const payload = parsePayload(event)
  if (isSilentPayload(payload)) {
    event.waitUntil(Promise.resolve())
    return
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, buildNotificationOptions(payload)),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  if (event.action === 'dismiss') {
    return
  }
  const rawUrl = event.notification?.data?.url
  const targetUrl = normalizeAdminTargetUrl(rawUrl)

  event.waitUntil(focusOrOpenAdminTarget(targetUrl))
})
