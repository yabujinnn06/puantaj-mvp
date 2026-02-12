import { useMemo, useState } from 'react'
import { z } from 'zod'
import { useSearchParams } from 'react-router-dom'

import { downloadDailyReportArchiveWithPassword } from '../api/admin'
import { parseApiError, type ParsedApiError } from '../api/error'
import { UI_BRANDING } from '../config/ui'

const formSchema = z.object({
  username: z.string().min(1, 'Kullanici adi gerekli.'),
  password: z.string().min(1, 'Sifre gerekli.'),
})

function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
}

function getErrorTitle(error: ParsedApiError): string {
  if (error.code === 'INVALID_CREDENTIALS') {
    return 'Sifre dogrulanamadi'
  }
  if (error.code === 'TOO_MANY_ATTEMPTS') {
    return 'Cok fazla deneme'
  }
  if (error.code === 'INTERNAL_ERROR') {
    return 'Sunucu hatasi'
  }
  return 'Indirme basarisiz'
}

export function ArchivePasswordDownloadPage() {
  const [searchParams] = useSearchParams()
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<ParsedApiError | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const archiveId = useMemo(() => {
    const rawValue = searchParams.get('archive_id')
    if (!rawValue) {
      return null
    }
    const parsed = Number(rawValue)
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return null
    }
    return parsed
  }, [searchParams])

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setSuccessMessage(null)

    if (!archiveId) {
      setError({ message: 'Gecerli bir arsiv kimligi bulunamadi.' })
      return
    }

    const parsed = formSchema.safeParse({ username, password })
    if (!parsed.success) {
      setError({ message: parsed.error.issues[0]?.message ?? 'Form alanlarini kontrol edin.' })
      return
    }

    setIsSubmitting(true)
    try {
      const result = await downloadDailyReportArchiveWithPassword(archiveId, parsed.data)
      const fileName = result.file_name ?? `arsiv-${archiveId}.xlsx`
      triggerBlobDownload(result.blob, fileName)
      setSuccessMessage('Indirme baslatildi. Dosya cihaziniza kaydedildi.')
      setPassword('')
    } catch (submitError) {
      setError(parseApiError(submitError, 'Excel dosyasi indirilemedi.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="admin-auth-screen flex min-h-screen items-center justify-center px-4">
      <div className="admin-auth-card w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-panel">
        <h1 className="text-2xl font-bold text-slate-900">Excel Arsiv Indirme</h1>
        <p className="mt-2 text-sm text-slate-600">
          Admin sifreni dogrula, gunluk puantaj Excel dosyasi panel acmadan indirilsin.
        </p>
        <p className="mt-2 text-xs text-slate-500">Arsiv ID: {archiveId ?? '-'}</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Kullanici Adi</span>
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-200 focus:border-brand-500 focus:ring"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Sifre</span>
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

          {successMessage ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-700">
              {successMessage}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting || !archiveId}
            className="btn-animated w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? (
              <>
                <span className="inline-spinner" aria-hidden="true" />
                Dogrulaniyor...
              </>
            ) : (
              'Sifreyi dogrula ve indir'
            )}
          </button>
        </form>

        {UI_BRANDING.showSignature ? (
          <p className="admin-auth-signature mt-5 text-center text-xs tracking-wide text-slate-500">
            {UI_BRANDING.signatureText} | BUILD: {UI_BRANDING.buildVersion}
          </p>
        ) : null}
      </div>
    </div>
  )
}
