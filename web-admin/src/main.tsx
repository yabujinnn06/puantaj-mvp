import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'

import './zod-config'

import App from './App'
import { AuthProvider } from './auth/AuthContext'
import { ToastProvider } from './components/ToastProvider'
import './index.css'

type WindowWithAdminBridgeFlag = Window & {
  __adminPushClickBridgeInstalled?: boolean
}

function installAdminPushClickBridge(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return
  }

  const flaggedWindow = window as WindowWithAdminBridgeFlag
  if (flaggedWindow.__adminPushClickBridgeInstalled) {
    return
  }
  flaggedWindow.__adminPushClickBridgeInstalled = true

  navigator.serviceWorker.addEventListener('message', (event) => {
    const payload = event.data as { type?: string; url?: string } | null
    if (!payload || payload.type !== 'ADMIN_OPEN_URL' || typeof payload.url !== 'string') {
      return
    }

    const rawUrl = payload.url.trim()
    if (!rawUrl) {
      return
    }

    let targetUrl: URL
    try {
      targetUrl = new URL(rawUrl, window.location.origin)
    } catch {
      return
    }

    if (targetUrl.origin !== window.location.origin) {
      return
    }

    const nextPath = `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`
    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`
    if (nextPath === currentPath) {
      return
    }

    window.location.assign(nextPath)
  })
}

installAdminPushClickBridge()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const swUrl = `${import.meta.env.BASE_URL}admin-sw.js`
    void navigator.serviceWorker
      .register(swUrl, {
        scope: import.meta.env.BASE_URL,
      })
      .catch(() => {
        // best-effort registration for push notifications
      })
  })
}

