import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

export function QrCodeCard({
  title,
  payload,
  fileName,
}: {
  title: string
  payload: string
  fileName: string
}) {
  const [imageUrl, setImageUrl] = useState<string>('')
  const [qrError, setQrError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const generate = async () => {
      try {
        const dataUrl = await QRCode.toDataURL(payload, {
          errorCorrectionLevel: 'M',
          margin: 2,
          width: 320,
          color: {
            dark: '#0f172a',
            light: '#ffffff',
          },
        })
        if (!cancelled) {
          setImageUrl(dataUrl)
          setQrError(null)
        }
      } catch {
        if (!cancelled) {
          setImageUrl('')
          setQrError('QR kodu oluşturulamadi.')
        }
      }
    }

    void generate()
    return () => {
      cancelled = true
    }
  }, [payload])

  const downloadPng = () => {
    if (!imageUrl) {
      return
    }
    const anchor = document.createElement('a')
    anchor.href = imageUrl
    anchor.download = `${fileName}.png`
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
  }

  const printAsPdf = () => {
    if (!imageUrl) {
      return
    }
    const escapeHtml = (value: string) =>
      value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;')

    const safeTitle = escapeHtml(title)
    const safePayload = escapeHtml(payload)
    const popup = window.open('', '_blank', 'width=600,height=800')
    if (!popup) {
      return
    }
    popup.document.write(`
      <html>
        <head>
          <title>${safeTitle}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; text-align: center; }
            h1 { font-size: 22px; margin-bottom: 16px; }
            .payload { font-size: 14px; margin-top: 16px; color: #334155; }
            img { width: 320px; height: 320px; }
          </style>
        </head>
        <body>
          <h1>${safeTitle}</h1>
          <img src="${imageUrl}" alt="${safePayload}" />
          <p class="payload">${safePayload}</p>
        </body>
      </html>
    `)
    popup.document.close()
    popup.focus()
    popup.print()
  }

  return (
    <div className="admin-panel rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h4 className="text-lg font-semibold text-slate-900">{title}</h4>
      <p className="mt-1 text-xs text-slate-500">Payload: {payload}</p>

      <div className="mt-3 flex min-h-[340px] items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50">
        {qrError ? (
          <p className="text-sm text-rose-700">{qrError}</p>
        ) : imageUrl ? (
          <img src={imageUrl} alt={payload} className="h-80 w-80 max-w-full object-contain" />
        ) : (
          <p className="text-sm text-slate-500">QR oluşturuluyor...</p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={downloadPng}
          className="btn-animated rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          PNG Indir
        </button>
        <button
          type="button"
          onClick={printAsPdf}
          className="btn-animated rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          PDF Yazdir
        </button>
      </div>
    </div>
  )
}
