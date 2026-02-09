import { useMemo, useState } from 'react'

import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'
import { QrCodeCard } from '../components/QrCodeCard'

export function QrCodesPage() {
  const [siteIdInput, setSiteIdInput] = useState('HQ')
  const [shiftIdInput, setShiftIdInput] = useState('')

  const siteId = useMemo(() => {
    const normalized = siteIdInput.trim().toUpperCase()
    return normalized || 'HQ'
  }, [siteIdInput])

  const shiftId = useMemo(() => {
    const raw = shiftIdInput.trim()
    if (!raw) return null
    const parsed = Number(raw)
    if (!Number.isInteger(parsed) || parsed <= 0) return null
    return parsed
  }, [shiftIdInput])

  const checkinPayload = useMemo(() => {
    if (shiftId) {
      return `site_id=${siteId}&type=IN&shift_id=${shiftId}`
    }
    return `IN|${siteId}`
  }, [siteId, shiftId])

  const checkoutPayload = `OUT|${siteId}`

  return (
    <div className="space-y-4">
      <PageHeader
        title="QR Kodlar"
        description="Calisan portalinin tarayacagi giris/cikis QR kodlarini olusturun."
      />

      <Panel>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm text-slate-700">
            Site ID
            <input
              value={siteIdInput}
              onChange={(event) => setSiteIdInput(event.target.value)}
              placeholder="HQ"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="block text-sm text-slate-700">
            Vardiya ID (opsiyonel)
            <input
              value={shiftIdInput}
              onChange={(event) => setShiftIdInput(event.target.value)}
              placeholder="Orn: 3"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Vardiya ID girerseniz GIRIS QR payload'i <strong>site_id=HQ&type=IN&shift_id=...</strong>{' '}
          formatina gecer ve check-in kaydinda vardiya otomatik islenir.
        </p>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <QrCodeCard title="GIRIS QR" payload={checkinPayload} fileName={`giris-${siteId}`} />
        <QrCodeCard title="CIKIS QR" payload={checkoutPayload} fileName={`cikis-${siteId}`} />
      </div>
    </div>
  )
}
