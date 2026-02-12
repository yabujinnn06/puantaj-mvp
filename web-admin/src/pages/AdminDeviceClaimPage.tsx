import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { claimAdminDevice, getAdminPushConfig } from '../api/admin'
import { parseApiError } from '../api/error'
import { useAuth } from '../hooks/useAuth'
import { urlBase64ToUint8Array } from '../utils/push'

const PUSH_VAPID_KEY_STORAGE = 'pf_admin_push_vapid_public_key'

export function AdminDeviceClaimPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { login } = useAuth()

  const token = useMemo(() => searchParams.get('token')?.trim() ?? '', [searchParams])

  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [requestId, setRequestId] = useState<string | null>(null)

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrorMessage(null)
    setRequestId(null)
    setSuccessMessage(null)

    if (!token) {
      setErrorMessage('Davet token bulunamadı. Lütfen yeni bağlantı isteyin.')
      return
    }

    const trimmedUsername = username.trim()
    const trimmedPassword = password.trim()
    if (!trimmedUsername || !trimmedPassword) {
      setErrorMessage('Admin kullanıcı adı ve şifre zorunludur.')
      return
    }

    try {
      setIsSubmitting(true)
      await login(trimmedUsername, trimmedPassword)

      const pushConfig = await getAdminPushConfig()
      if (!pushConfig.enabled || !pushConfig.vapid_public_key) {
        setErrorMessage('Push bildirim servisi yapılandırılmamış.')
        return
      }

      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setErrorMessage('Bu tarayıcı push bildirimlerini desteklemiyor.')
        return
      }

      const permission =
        Notification.permission === 'granted'
          ? 'granted'
          : await Notification.requestPermission()
      if (permission !== 'granted') {
        setErrorMessage('Bildirim izni verilmedi. Cihaz bağlama tamamlanamadı.')
        return
      }

      const swUrl = `${import.meta.env.BASE_URL}admin-sw.js`
      const registration = await navigator.serviceWorker.register(swUrl, {
        scope: import.meta.env.BASE_URL,
      })

      let subscription = await registration.pushManager.getSubscription()
      const savedVapidKey = window.localStorage.getItem(PUSH_VAPID_KEY_STORAGE)
      if (subscription && savedVapidKey && savedVapidKey !== pushConfig.vapid_public_key) {
        try {
          await subscription.unsubscribe()
        } catch {
          // best effort unsubscribe
        }
        subscription = null
      }

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(pushConfig.vapid_public_key) as unknown as BufferSource,
        })
      }

      await claimAdminDevice({
        token,
        subscription: subscription.toJSON() as Record<string, unknown>,
      })
      window.localStorage.setItem(PUSH_VAPID_KEY_STORAGE, pushConfig.vapid_public_key)

      setSuccessMessage('Admin cihazı başarıyla bağlandı. Bildirimler bu cihaza gönderilecek.')
      window.setTimeout(() => {
        navigate('/notifications', { replace: true })
      }, 1000)
    } catch (error) {
      const parsed = parseApiError(error, 'Cihaz bağlama işlemi başarısız oldu.')
      setErrorMessage(parsed.message)
      setRequestId(parsed.requestId ?? null)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="mx-auto mt-10 w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-slate-900">Admin Cihaz Bağlama</h1>
      <p className="mt-1 text-sm text-slate-600">
        Bu cihazı admin bildirimleri için kaydetmek adına hesabınızla giriş yapın.
      </p>

      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        Token: {token || 'Bulunamadı'}
      </div>

      <form className="mt-4 space-y-3" onSubmit={onSubmit}>
        <label className="block text-sm text-slate-700">
          Kullanıcı adı
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            autoComplete="username"
          />
        </label>
        <label className="block text-sm text-slate-700">
          Şifre
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            autoComplete="current-password"
          />
        </label>

        {errorMessage ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            <p>{errorMessage}</p>
            {requestId ? <p className="mt-1 text-xs">request_id: {requestId}</p> : null}
          </div>
        ) : null}

        {successMessage ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {successMessage}
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {isSubmitting ? 'Bağlanıyor...' : 'Cihazı Bağla'}
          </button>
          <Link
            to="/login"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Login ekranı
          </Link>
        </div>
      </form>
    </div>
  )
}
