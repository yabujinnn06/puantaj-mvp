import { Link } from 'react-router-dom'

import { UI_BRANDING } from '../config/ui'

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-4xl font-bold text-slate-900">404</p>
        <p className="mt-2 text-sm text-slate-600">Sayfa bulunamadi.</p>
        <Link
          to="/management-console"
          className="mt-5 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700"
        >
          Ana Panel'e dön
        </Link>
        {UI_BRANDING.showSignature ? (
          <p className="mt-5 text-center text-xs tracking-wide text-slate-500">{UI_BRANDING.signatureText}</p>
        ) : null}
      </div>
    </div>
  )
}
