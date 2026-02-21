import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'

interface DeferredInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

declare global {
  interface Window {
    __pfDeferredInstallPrompt?: DeferredInstallPromptEvent | null
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    const promptEvent = event as DeferredInstallPromptEvent
    promptEvent.preventDefault()
    window.__pfDeferredInstallPrompt = promptEvent
    window.dispatchEvent(new CustomEvent('pf:installprompt-ready'))
  })
  window.addEventListener('appinstalled', () => {
    window.__pfDeferredInstallPrompt = null
  })
}

registerSW({ immediate: true })
const basePath =
  import.meta.env.BASE_URL === '/'
    ? '/'
    : import.meta.env.BASE_URL.replace(/\/$/, '')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={basePath}>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
