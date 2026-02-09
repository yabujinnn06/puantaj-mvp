import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { z } from 'zod'

import { parseApiError, type ParsedApiError } from '../api/error'
import { UI_BRANDING } from '../config/ui'
import { useAuth } from '../hooks/useAuth'

const loginSchema = z.object({
  username: z.string().min(1, 'Kullanıcı adı gerekli.'),
  password: z.string().min(1, 'Şifre gerekli.'),
})

function getErrorTitle(error: ParsedApiError): string {
  if (error.code === 'INVALID_CREDENTIALS') {
    return 'Giriş bilgileri hatalı'
  }

  if (error.code === 'TOO_MANY_ATTEMPTS') {
    return 'Çok fazla deneme'
  }

  if (error.code === 'INTERNAL_ERROR') {
    return 'Sunucu hatası'
  }

  return 'Giriş başarısız'
}

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login } = useAuth()

  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<ParsedApiError | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const target = useMemo(() => {
    const stateTarget = (location.state as { from?: string } | undefined)?.from
    const searchTarget = new URLSearchParams(location.search).get('redirect')
    return stateTarget ?? searchTarget ?? '/dashboard'
  }, [location.search, location.state])

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)

    const parsed = loginSchema.safeParse({ username, password })
    if (!parsed.success) {
      setError({ message: parsed.error.issues[0]?.message ?? 'Form alanlarını kontrol et.' })
      return
    }

    setIsSubmitting(true)
    try {
      await login(parsed.data.username, parsed.data.password)
      navigate(target, { replace: true })
    } catch (submitError) {
      setError(parseApiError(submitError, 'Giriş başarısız.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="admin-auth-screen flex min-h-screen items-center justify-center px-4">
      <div className="admin-auth-card w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-panel">
        <h1 className="text-2xl font-bold text-slate-900">Admin Giriş</h1>
        <p className="mt-2 text-sm text-slate-600">Puantaj yönetim paneline giriş yap.</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Kullanıcı Adı</span>
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-200 focus:border-brand-500 focus:ring"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Şifre</span>
            <input
              type="password"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-200 focus:border-brand-500 focus:ring"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          {error ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-700">
              <p className="font-semibold">{getErrorTitle(error)}</p>
              <p className="mt-1">{error.message}</p>
              {error.requestId ? (
                <p className="mt-2 font-mono text-xs text-rose-800">request_id: {error.requestId}</p>
              ) : null}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="btn-animated w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? (
              <>
                <span className="inline-spinner" aria-hidden="true" />
                Giriş yapılıyor...
              </>
            ) : (
              'Giriş Yap'
            )}
          </button>
        </form>
        {UI_BRANDING.showSignature ? (
          <p className="mt-5 text-center text-xs tracking-wide text-slate-500">
            {UI_BRANDING.signatureText} • Build: {UI_BRANDING.buildVersion}
          </p>
        ) : null}
      </div>
    </div>
  )
}
