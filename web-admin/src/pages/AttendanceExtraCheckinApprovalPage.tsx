import { useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import { useSearchParams } from 'react-router-dom'

import {
  approveAttendanceExtraCheckinApproval,
  getAttendanceExtraCheckinApproval,
} from '../api/admin'
import { parseApiError, type ParsedApiError } from '../api/error'
import type { AttendanceExtraCheckinApproval } from '../types/api'
import { UI_BRANDING } from '../config/ui'

const approvalFormSchema = z.object({
  username: z.string().min(1, 'Kullanici adi gerekli.'),
  password: z.string().min(1, 'Sifre gerekli.'),
})

function formatDateTime(value: string | null): string {
  if (!value) {
    return '-'
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(parsed)
}

function statusText(status: AttendanceExtraCheckinApproval['status']): string {
  if (status === 'PENDING') return 'Onay Bekliyor'
  if (status === 'APPROVED') return 'Onaylandi'
  if (status === 'CONSUMED') return 'Kullanildi'
  return 'Suresi Doldu'
}

function statusClass(status: AttendanceExtraCheckinApproval['status']): string {
  if (status === 'PENDING') return 'bg-amber-100 text-amber-800 border-amber-200'
  if (status === 'APPROVED') return 'bg-emerald-100 text-emerald-800 border-emerald-200'
  if (status === 'CONSUMED') return 'bg-cyan-100 text-cyan-800 border-cyan-200'
  return 'bg-rose-100 text-rose-800 border-rose-200'
}

function getErrorTitle(error: ParsedApiError): string {
  if (error.code === 'INVALID_CREDENTIALS') return 'Sifre dogrulanamadi'
  if (error.code === 'TOO_MANY_ATTEMPTS') return 'Cok fazla deneme'
  if (error.code === 'EXTRA_CHECKIN_APPROVAL_EXPIRED') return 'Talep suresi dolmus'
  if (error.code === 'EXTRA_CHECKIN_APPROVAL_NOT_FOUND') return 'Talep bulunamadi'
  return 'Onay islemi basarisiz'
}

export function AttendanceExtraCheckinApprovalPage() {
  const [searchParams] = useSearchParams()
  const token = useMemo(() => searchParams.get('token')?.trim() ?? '', [searchParams])

  const [approval, setApproval] = useState<AttendanceExtraCheckinApproval | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState<ParsedApiError | null>(null)
  const [submitError, setSubmitError] = useState<ParsedApiError | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!token) {
      setLoadError({ message: 'Onay tokeni bulunamadi.' })
      setApproval(null)
      return
    }
    let cancelled = false
    const loadApproval = async () => {
      setIsLoading(true)
      setLoadError(null)
      try {
        const result = await getAttendanceExtraCheckinApproval(token)
        if (!cancelled) {
          setApproval(result)
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(parseApiError(error, 'Onay talebi yuklenemedi.'))
          setApproval(null)
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadApproval()
    return () => {
      cancelled = true
    }
  }, [token])

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitError(null)
    setSuccessMessage(null)

    if (!approval || approval.status !== 'PENDING') {
      return
    }

    const parsed = approvalFormSchema.safeParse({ username, password })
    if (!parsed.success) {
      setSubmitError({ message: parsed.error.issues[0]?.message ?? 'Form alanlarini kontrol edin.' })
      return
    }

    setIsSubmitting(true)
    try {
      const result = await approveAttendanceExtraCheckinApproval({
        token,
        username: parsed.data.username,
        password: parsed.data.password,
      })
      setApproval(result.approval)
      setPassword('')
      setSuccessMessage(
        result.already_processed
          ? 'Talep daha once islenmis. Calisan tekrar giris deneyebilir.'
          : 'Onay verildi. Calisan ikinci giris islemini tekrar deneyebilir.',
      )
    } catch (error) {
      setSubmitError(parseApiError(error, 'Onay islemi tamamlanamadi.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="admin-auth-screen flex min-h-screen items-center justify-center px-4">
      <div className="admin-auth-card w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-8 shadow-panel">
        <h1 className="text-2xl font-bold text-slate-900">Ek Giris Admin Onayi</h1>
        <p className="mt-2 text-sm text-slate-600">
          Gunluk mesai tamamlama sonrasi ikinci giris denemesi icin sifre dogrulayarak onay verin.
        </p>

        {!token ? (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-700">
            Gecerli bir token olmadan onay islemi baslatilamaz.
          </div>
        ) : null}

        {isLoading ? (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
            Talep yukleniyor...
          </div>
        ) : null}

        {loadError ? (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-700">
            <p className="font-semibold">{getErrorTitle(loadError)}</p>
            <p className="mt-1">{loadError.message}</p>
            {loadError.requestId ? (
              <p className="mt-2 font-mono text-xs text-rose-800">request_id: {loadError.requestId}</p>
            ) : null}
          </div>
        ) : null}

        {approval ? (
          <section className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-900">
                #{approval.employee_id} - {approval.employee_name}
              </p>
              <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${statusClass(approval.status)}`}>
                {statusText(approval.status)}
              </span>
            </div>

            <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
              <p>Mesai gunu: {approval.local_day}</p>
              <p>Istenen cihaz ID: {approval.device_id ?? '-'}</p>
              <p>Talep zamani: {formatDateTime(approval.requested_at)}</p>
              <p>Son gecerlilik: {formatDateTime(approval.expires_at)}</p>
              <p>Onaylayan: {approval.approved_by_username ?? '-'}</p>
              <p>Kullanilma zamani: {formatDateTime(approval.consumed_at)}</p>
            </div>

            <div className="mt-2 text-xs text-slate-500">
              Push dagitimi: hedef {approval.push_total_targets} | gonderilen {approval.push_sent} | hata {approval.push_failed}
            </div>
          </section>
        ) : null}

        {successMessage ? (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-700">
            {successMessage}
          </div>
        ) : null}

        {approval?.status === 'PENDING' ? (
          <form onSubmit={onSubmit} className="mt-5 space-y-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Kullanici Adi</span>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-200 focus:border-brand-500 focus:ring"
                autoComplete="username"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Sifre (MFA gerektirmez)</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-200 focus:border-brand-500 focus:ring"
                autoComplete="current-password"
              />
            </label>

            {submitError ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-700">
                <p className="font-semibold">{getErrorTitle(submitError)}</p>
                <p className="mt-1">{submitError.message}</p>
                {submitError.requestId ? (
                  <p className="mt-2 font-mono text-xs text-rose-800">request_id: {submitError.requestId}</p>
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
                  Onay veriliyor...
                </>
              ) : (
                'Evet, 2. Girisi Onayla'
              )}
            </button>
          </form>
        ) : null}

        {UI_BRANDING.showSignature ? (
          <p className="admin-auth-signature mt-5 text-center text-xs tracking-wide text-slate-500">
            {UI_BRANDING.signatureText} | BUILD: {UI_BRANDING.buildVersion}
          </p>
        ) : null}
      </div>
    </div>
  )
}
