import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import QRCode from 'qrcode'

import {
  assignQrCodePoints,
  createQrCode,
  createQrPoint,
  deactivateQrPoint,
  getQrCodes,
  getQrPoints,
  unassignQrCodePoint,
  updateQrCode,
  updateQrPoint,
} from '../api/admin'
import { parseApiError } from '../api/error'
import { LoadingBlock } from '../components/LoadingBlock'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'
import { QrPointMapPicker } from '../components/QrPointMapPicker'
import { TableSearchInput } from '../components/TableSearchInput'
import { useToast } from '../hooks/useToast'
import type { QrCode, QrCodeType, QrPoint } from '../types/api'

type CodeFormState = {
  name: string
  codeValue: string
  codeType: QrCodeType
  isActive: boolean
}

type CodeTemplateState = {
  regionCode: string
  locationCode: string
  serialNo: string
}

type PointFormState = {
  name: string
  lat: string
  lon: string
  radiusM: string
  isActive: boolean
}

const defaultCodeForm: CodeFormState = {
  name: '',
  codeValue: '',
  codeType: 'BOTH',
  isActive: true,
}

const defaultPointForm: PointFormState = {
  name: '',
  lat: '',
  lon: '',
  radiusM: '75',
  isActive: true,
}

const defaultCodeTemplate: CodeTemplateState = {
  regionCode: 'IST',
  locationCode: 'MERKEZ',
  serialNo: '1',
}

function formatCodeType(value: QrCodeType): string {
  if (value === 'CHECKIN') return 'CHECKIN (Giris)'
  if (value === 'CHECKOUT') return 'CHECKOUT (Cikis)'
  return 'BOTH (Duruma gore)'
}

function normalizeCodePart(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || fallback
}

function codeTypeKey(value: QrCodeType): 'IN' | 'OUT' | 'BOTH' {
  if (value === 'CHECKIN') return 'IN'
  if (value === 'CHECKOUT') return 'OUT'
  return 'BOTH'
}

export function QrCodesPage() {
  const queryClient = useQueryClient()
  const { pushToast } = useToast()

  const [selectedCodeId, setSelectedCodeId] = useState<number | null>(null)
  const [editingCodeId, setEditingCodeId] = useState<number | null>(null)
  const [editingPointId, setEditingPointId] = useState<number | null>(null)

  const [codeSearch, setCodeSearch] = useState('')
  const [pointSearch, setPointSearch] = useState('')
  const [assignSearch, setAssignSearch] = useState('')

  const [codeForm, setCodeForm] = useState<CodeFormState>(defaultCodeForm)
  const [codeTemplate, setCodeTemplate] = useState<CodeTemplateState>(defaultCodeTemplate)
  const [pointForm, setPointForm] = useState<PointFormState>(defaultPointForm)
  const [assignSelectedPointIds, setAssignSelectedPointIds] = useState<number[]>([])
  const [selectedCodeQrDataUrl, setSelectedCodeQrDataUrl] = useState<string | null>(null)

  const qrCodesQuery = useQuery({
    queryKey: ['qr-codes'],
    queryFn: () => getQrCodes(),
  })
  const qrPointsQuery = useQuery({
    queryKey: ['qr-points'],
    queryFn: () => getQrPoints(),
  })

  const createCodeMutation = useMutation({
    mutationFn: createQrCode,
    onSuccess: (createdCode) => {
      pushToast({
        variant: 'success',
        title: 'QR kod olusturuldu',
        description: `Kod ID: ${createdCode.id}`,
      })
      setCodeForm(defaultCodeForm)
      setSelectedCodeId(createdCode.id)
      void queryClient.invalidateQueries({ queryKey: ['qr-codes'] })
    },
    onError: (error) => {
      pushToast({
        variant: 'error',
        title: 'QR kod olusturulamadi',
        description: parseApiError(error, 'Islem basarisiz.').message,
      })
    },
  })

  const updateCodeMutation = useMutation({
    mutationFn: ({ codeId, payload }: { codeId: number; payload: Parameters<typeof updateQrCode>[1] }) =>
      updateQrCode(codeId, payload),
    onSuccess: (updatedCode) => {
      pushToast({
        variant: 'success',
        title: 'QR kod guncellendi',
        description: `Kod ID: ${updatedCode.id}`,
      })
      setEditingCodeId(null)
      setCodeForm(defaultCodeForm)
      void queryClient.invalidateQueries({ queryKey: ['qr-codes'] })
    },
    onError: (error) => {
      pushToast({
        variant: 'error',
        title: 'QR kod guncellenemedi',
        description: parseApiError(error, 'Islem basarisiz.').message,
      })
    },
  })

  const assignPointsMutation = useMutation({
    mutationFn: ({ codeId, pointIds }: { codeId: number; pointIds: number[] }) =>
      assignQrCodePoints(codeId, { point_ids: pointIds }),
    onSuccess: () => {
      pushToast({
        variant: 'success',
        title: 'Nokta atamasi guncellendi',
        description: 'Secili noktalari QR koda baglandi.',
      })
      setAssignSelectedPointIds([])
      void queryClient.invalidateQueries({ queryKey: ['qr-codes'] })
      void queryClient.invalidateQueries({ queryKey: ['qr-points'] })
    },
    onError: (error) => {
      pushToast({
        variant: 'error',
        title: 'Atama basarisiz',
        description: parseApiError(error, 'Nokta atamasi yapilamadi.').message,
      })
    },
  })

  const unassignPointMutation = useMutation({
    mutationFn: ({ codeId, pointId }: { codeId: number; pointId: number }) =>
      unassignQrCodePoint(codeId, pointId),
    onSuccess: () => {
      pushToast({
        variant: 'success',
        title: 'Nokta baglantisi kaldirildi',
        description: 'Secili nokta bu QR koddan ayrildi.',
      })
      void queryClient.invalidateQueries({ queryKey: ['qr-codes'] })
      void queryClient.invalidateQueries({ queryKey: ['qr-points'] })
    },
    onError: (error) => {
      pushToast({
        variant: 'error',
        title: 'Islem basarisiz',
        description: parseApiError(error, 'Nokta kaldirilamadi.').message,
      })
    },
  })

  const createPointMutation = useMutation({
    mutationFn: createQrPoint,
    onSuccess: (createdPoint) => {
      pushToast({
        variant: 'success',
        title: 'QR nokta olusturuldu',
        description: `Nokta ID: ${createdPoint.id}`,
      })
      setPointForm(defaultPointForm)
      void queryClient.invalidateQueries({ queryKey: ['qr-points'] })
    },
    onError: (error) => {
      pushToast({
        variant: 'error',
        title: 'QR nokta olusturulamadi',
        description: parseApiError(error, 'Islem basarisiz.').message,
      })
    },
  })

  const updatePointMutation = useMutation({
    mutationFn: ({ pointId, payload }: { pointId: number; payload: Parameters<typeof updateQrPoint>[1] }) =>
      updateQrPoint(pointId, payload),
    onSuccess: () => {
      pushToast({
        variant: 'success',
        title: 'QR nokta guncellendi',
        description: 'Nokta bilgileri kaydedildi.',
      })
      setEditingPointId(null)
      setPointForm(defaultPointForm)
      void queryClient.invalidateQueries({ queryKey: ['qr-points'] })
    },
    onError: (error) => {
      pushToast({
        variant: 'error',
        title: 'QR nokta guncellenemedi',
        description: parseApiError(error, 'Islem basarisiz.').message,
      })
    },
  })

  const deactivatePointMutation = useMutation({
    mutationFn: deactivateQrPoint,
    onSuccess: () => {
      pushToast({
        variant: 'success',
        title: 'QR nokta pasife alindi',
        description: 'Nokta aktif listeden cikarildi.',
      })
      void queryClient.invalidateQueries({ queryKey: ['qr-points'] })
      void queryClient.invalidateQueries({ queryKey: ['qr-codes'] })
    },
    onError: (error) => {
      pushToast({
        variant: 'error',
        title: 'Islem basarisiz',
        description: parseApiError(error, 'Nokta pasife alinamadi.').message,
      })
    },
  })

  const qrCodes = qrCodesQuery.data ?? []
  const qrPoints = qrPointsQuery.data ?? []

  useEffect(() => {
    if (selectedCodeId === null && qrCodes.length > 0) {
      setSelectedCodeId(qrCodes[0].id)
    }
    if (selectedCodeId !== null && !qrCodes.some((code) => code.id === selectedCodeId)) {
      setSelectedCodeId(qrCodes.length > 0 ? qrCodes[0].id : null)
    }
  }, [qrCodes, selectedCodeId])

  const selectedCode = useMemo(
    () => qrCodes.find((item) => item.id === selectedCodeId) ?? null,
    [qrCodes, selectedCodeId],
  )

  useEffect(() => {
    if (!selectedCode) {
      setSelectedCodeQrDataUrl(null)
      return
    }

    let cancelled = false
    void QRCode.toDataURL(selectedCode.code_value, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 360,
    })
      .then((dataUrl) => {
        if (!cancelled) {
          setSelectedCodeQrDataUrl(dataUrl)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedCodeQrDataUrl(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [selectedCode?.id, selectedCode?.code_value])

  const pointsById = useMemo(() => {
    const map = new Map<number, QrPoint>()
    for (const point of qrPoints) {
      map.set(point.id, point)
    }
    return map
  }, [qrPoints])

  const assignedPoints = useMemo(() => {
    if (!selectedCode) return []
    return selectedCode.point_ids
      .map((pointId) => pointsById.get(pointId) ?? null)
      .filter((item): item is QrPoint => item !== null)
  }, [selectedCode, pointsById])

  const filteredCodes = useMemo(() => {
    const needle = codeSearch.trim().toLowerCase()
    if (!needle) return qrCodes
    return qrCodes.filter((code) => {
      return (
        String(code.id).includes(needle) ||
        (code.name ?? '').toLowerCase().includes(needle) ||
        code.code_value.toLowerCase().includes(needle)
      )
    })
  }, [qrCodes, codeSearch])

  const filteredPoints = useMemo(() => {
    const needle = pointSearch.trim().toLowerCase()
    if (!needle) return qrPoints
    return qrPoints.filter((point) => {
      return (
        String(point.id).includes(needle) ||
        point.name.toLowerCase().includes(needle) ||
        String(point.department_id ?? '').includes(needle) ||
        String(point.region_id ?? '').includes(needle)
      )
    })
  }, [qrPoints, pointSearch])

  const assignablePoints = useMemo(() => {
    const activePoints = qrPoints.filter((point) => point.is_active)
    const needle = assignSearch.trim().toLowerCase()
    if (!needle) return activePoints
    return activePoints.filter((point) => {
      return (
        String(point.id).includes(needle) ||
        point.name.toLowerCase().includes(needle) ||
        String(point.department_id ?? '').includes(needle) ||
        String(point.region_id ?? '').includes(needle)
      )
    })
  }, [qrPoints, assignSearch])

  const summary = useMemo(() => {
    const activeCodes = qrCodes.filter((item) => item.is_active).length
    const activePoints = qrPoints.filter((item) => item.is_active).length
    const codesWithoutPoint = qrCodes.filter((item) => item.point_ids.length === 0).length
    return {
      codeCount: qrCodes.length,
      activeCodes,
      pointCount: qrPoints.length,
      activePoints,
      codesWithoutPoint,
    }
  }, [qrCodes, qrPoints])

  const mapPointLat = useMemo(() => {
    const value = Number(pointForm.lat)
    return Number.isFinite(value) ? value : null
  }, [pointForm.lat])

  const mapPointLon = useMemo(() => {
    const value = Number(pointForm.lon)
    return Number.isFinite(value) ? value : null
  }, [pointForm.lon])

  const mapPointRadius = useMemo(() => {
    const value = Number(pointForm.radiusM)
    return Number.isFinite(value) && value > 0 ? value : 75
  }, [pointForm.radiusM])

  const toggleAssignPoint = (pointId: number) => {
    setAssignSelectedPointIds((current) => {
      if (current.includes(pointId)) {
        return current.filter((id) => id !== pointId)
      }
      return [...current, pointId]
    })
  }

  const startEditCode = (code: QrCode) => {
    setEditingCodeId(code.id)
    setCodeForm({
      name: code.name ?? '',
      codeValue: code.code_value,
      codeType: code.code_type,
      isActive: code.is_active,
    })
  }

  const resetCodeForm = () => {
    setEditingCodeId(null)
    setCodeForm(defaultCodeForm)
  }

  const applyMeaningfulCodeValue = () => {
    const regionCode = normalizeCodePart(codeTemplate.regionCode, 'GEN')
    const locationCode = normalizeCodePart(codeTemplate.locationCode, 'LOKASYON')
    const serialRaw = Number(codeTemplate.serialNo)
    const serialSafe = Number.isFinite(serialRaw) && serialRaw > 0 ? Math.floor(serialRaw) : 1
    const typeToken = codeTypeKey(codeForm.codeType)
    const nextValue = `PF-${regionCode}-${locationCode}-${typeToken}-${String(serialSafe).padStart(6, '0')}`
    setCodeForm((prev) => ({ ...prev, codeValue: nextValue }))
  }

  const startEditPoint = (point: QrPoint) => {
    setEditingPointId(point.id)
    setPointForm({
      name: point.name,
      lat: String(point.lat),
      lon: String(point.lon),
      radiusM: String(point.radius_m),
      isActive: point.is_active,
    })
  }

  const resetPointForm = () => {
    setEditingPointId(null)
    setPointForm(defaultPointForm)
  }

  const handleCodeSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedValue = codeForm.codeValue.trim()
    if (!normalizedValue) {
      pushToast({
        variant: 'error',
        title: 'Kod degeri zorunlu',
        description: 'QR kod degerini bos birakamazsiniz.',
      })
      return
    }

    const payload = {
      name: codeForm.name.trim() || null,
      code_value: normalizedValue,
      code_type: codeForm.codeType,
      is_active: codeForm.isActive,
    }

    if (editingCodeId === null) {
      createCodeMutation.mutate(payload)
      return
    }

    updateCodeMutation.mutate({ codeId: editingCodeId, payload })
  }

  const handlePointSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedName = pointForm.name.trim()
    const lat = Number(pointForm.lat)
    const lon = Number(pointForm.lon)
    const radiusM = Number(pointForm.radiusM)

    if (!normalizedName) {
      pushToast({
        variant: 'error',
        title: 'Nokta adi zorunlu',
        description: 'Lutfen bir nokta adi girin.',
      })
      return
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(radiusM) || radiusM <= 0) {
      pushToast({
        variant: 'error',
        title: 'Gecersiz konum',
        description: 'Lat/Lon/radius alanlarini kontrol edin.',
      })
      return
    }

    const payload = {
      name: normalizedName,
      lat,
      lon,
      radius_m: radiusM,
      is_active: pointForm.isActive,
    }

    if (editingPointId === null) {
      createPointMutation.mutate(payload)
      return
    }
    updatePointMutation.mutate({ pointId: editingPointId, payload })
  }

  const handleAssignPoints = () => {
    if (!selectedCode) {
      pushToast({
        variant: 'error',
        title: 'QR kod seciniz',
        description: 'Nokta atamak icin once bir QR kod secin.',
      })
      return
    }
    if (assignSelectedPointIds.length === 0) {
      pushToast({
        variant: 'error',
        title: 'Nokta seciniz',
        description: 'Atama icin en az bir nokta secin.',
      })
      return
    }
    assignPointsMutation.mutate({ codeId: selectedCode.id, pointIds: assignSelectedPointIds })
  }

  const copyCodeValue = async (codeValue: string) => {
    try {
      await navigator.clipboard.writeText(codeValue)
      pushToast({
        variant: 'success',
        title: 'Kopyalandi',
        description: 'QR kod degeri panoya kopyalandi.',
      })
    } catch {
      pushToast({
        variant: 'error',
        title: 'Kopyalama basarisiz',
        description: 'Lutfen manuel olarak kopyalayin.',
      })
    }
  }

  const downloadQrPng = async (code: QrCode) => {
    try {
      const dataUrl = await QRCode.toDataURL(code.code_value, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 900,
      })
      const link = document.createElement('a')
      link.href = dataUrl
      link.download = `qr-kod-${code.id}.png`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      pushToast({
        variant: 'success',
        title: 'PNG indirildi',
        description: `QR kod #${code.id} dosyasi indirildi.`,
      })
    } catch {
      pushToast({
        variant: 'error',
        title: 'Indirme basarisiz',
        description: 'QR kod PNG olusturulamadi.',
      })
    }
  }

  if (qrCodesQuery.isLoading || qrPointsQuery.isLoading) {
    return <LoadingBlock />
  }

  if (qrCodesQuery.isError || qrPointsQuery.isError) {
    return (
      <Panel>
        <p className="text-sm text-rose-700">QR kod veya nokta listesi yuklenemedi.</p>
      </Panel>
    )
  }

  return (
    <div className="mx-auto w-full max-w-[1320px] space-y-4">
      <PageHeader
        title="QR Kod Yonetimi"
        description="Konuma bagli giris/cikis icin QR kod ve QR nokta yonetimi. Sirayla nokta olustur, kod olustur, nokta ata, sonra indir."
      />

      <Panel className="min-w-0">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(260px,0.95fr)]">
          <div>
            <h4 className="text-base font-semibold text-slate-900">Nasil Calisir?</h4>
            <ol className="mt-2 space-y-1 text-sm text-slate-700">
              <li>1) Once QR nokta olustur (ad + lat/lon + radius).</li>
              <li>2) Sonra QR kod olustur (benzersiz code_value + tip).</li>
              <li>3) QR koda bir veya birden fazla aktif nokta ata.</li>
              <li>4) Calisan sadece atanmis nokta icindeyse okutma basarili olur.</li>
            </ol>
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              Onemli: Noktasi olmayan QR kod okutulamaz. Pasif nokta ya da pasif QR kod da kullanilamaz.
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Toplam Kod</p>
              <p className="text-lg font-semibold text-slate-900">{summary.codeCount}</p>
              <p className="text-xs text-emerald-700">Aktif: {summary.activeCodes}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Toplam Nokta</p>
              <p className="text-lg font-semibold text-slate-900">{summary.pointCount}</p>
              <p className="text-xs text-emerald-700">Aktif: {summary.activePoints}</p>
            </div>
            <div className="col-span-2 rounded-lg border border-rose-200 bg-rose-50 p-3">
              <p className="text-xs text-rose-700">Noktasi Atanmamis Kod</p>
              <p className="text-lg font-semibold text-rose-800">{summary.codesWithoutPoint}</p>
              <p className="text-xs text-rose-700">Bu kodlar okutuldugunda sistem izin vermez.</p>
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel className="min-w-0">
          <h4 className="text-base font-semibold text-slate-900">
            {editingCodeId === null ? '2) QR Kod Olustur' : `2) QR Kod Duzenle (#${editingCodeId})`}
          </h4>
          <p className="mt-1 text-xs text-slate-500">
            Code value benzersiz olmalidir. Asagidaki anlamli format yardimcisini kullanabilirsiniz.
          </p>
          <form className="mt-3 space-y-3" onSubmit={handleCodeSubmit}>
            <label className="block text-sm text-slate-700">
              Kod adi (opsiyonel)
              <input
                value={codeForm.name}
                onChange={(event) => setCodeForm((prev) => ({ ...prev, name: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                placeholder="Orn: Merkez Giris"
              />
            </label>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Anlamli Format Yardimcisi</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <input
                  value={codeTemplate.regionCode}
                  onChange={(event) =>
                    setCodeTemplate((prev) => ({
                      ...prev,
                      regionCode: event.target.value,
                    }))
                  }
                  className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
                  placeholder="Bolge (IST)"
                />
                <input
                  value={codeTemplate.locationCode}
                  onChange={(event) =>
                    setCodeTemplate((prev) => ({
                      ...prev,
                      locationCode: event.target.value,
                    }))
                  }
                  className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
                  placeholder="Lokasyon (MERKEZ)"
                />
                <input
                  type="number"
                  min={1}
                  value={codeTemplate.serialNo}
                  onChange={(event) =>
                    setCodeTemplate((prev) => ({
                      ...prev,
                      serialNo: event.target.value,
                    }))
                  }
                  className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
                  placeholder="Seri No"
                />
                <button
                  type="button"
                  onClick={applyMeaningfulCodeValue}
                  className="rounded-lg border border-brand-300 bg-white px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50"
                >
                  Deger Uret
                </button>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Ornek: PF-IST-MERKEZ-IN-000001 / PF-ANK-SUBE1-BOTH-000014
              </p>
            </div>

            <label className="block text-sm text-slate-700">
              code_value
              <input
                value={codeForm.codeValue}
                onChange={(event) => setCodeForm((prev) => ({ ...prev, codeValue: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                placeholder="Orn: IN|HQ-1"
              />
            </label>

            <label className="block text-sm text-slate-700">
              Kod tipi
              <select
                value={codeForm.codeType}
                onChange={(event) =>
                  setCodeForm((prev) => ({
                    ...prev,
                    codeType: event.target.value as QrCodeType,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                <option value="CHECKIN">CHECKIN</option>
                <option value="CHECKOUT">CHECKOUT</option>
                <option value="BOTH">BOTH</option>
              </select>
              <p className="mt-1 text-xs text-slate-500">
                CHECKIN: sadece giris, CHECKOUT: sadece cikis, BOTH: sistem bugunku duruma gore secer.
              </p>
            </label>

            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={codeForm.isActive}
                onChange={(event) => setCodeForm((prev) => ({ ...prev, isActive: event.target.checked }))}
              />
              Aktif
            </label>

            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={createCodeMutation.isPending || updateCodeMutation.isPending}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {editingCodeId === null ? 'Olustur' : 'Guncelle'}
              </button>
              {editingCodeId !== null ? (
                <button
                  type="button"
                  onClick={resetCodeForm}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Iptal
                </button>
              ) : null}
            </div>
          </form>
        </Panel>

        <Panel className="min-w-0">
          <h4 className="text-base font-semibold text-slate-900">QR Kod Listesi</h4>
          <p className="mt-1 text-xs text-slate-500">
            Detay ve nokta atama islemleri icin bir QR kod secin.
          </p>
          <div className="mt-3">
            <TableSearchInput value={codeSearch} onChange={setCodeSearch} placeholder="Kod adi / degeri / ID ara" />
          </div>
          <div className="mt-3 max-h-80 overflow-auto overscroll-contain rounded-lg border border-slate-200">
            <table className="min-w-[980px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">Kod</th>
                  <th className="px-3 py-2">Tip</th>
                  <th className="px-3 py-2">Durum</th>
                  <th className="px-3 py-2">Nokta</th>
                  <th className="px-3 py-2">Aksiyon</th>
                </tr>
              </thead>
              <tbody>
                {filteredCodes.map((code) => (
                  <tr
                    key={code.id}
                    className={`border-t border-slate-100 ${selectedCodeId === code.id ? 'bg-brand-50/60' : ''}`}
                  >
                    <td className="px-3 py-2">{code.id}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setSelectedCodeId(code.id)}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {code.name || '-'}
                      </button>
                      <div className="max-w-[340px] break-all text-xs text-slate-500">{code.code_value}</div>
                    </td>
                    <td className="px-3 py-2">{formatCodeType(code.code_type)}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                          code.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {code.is_active ? 'Aktif' : 'Pasif'}
                      </span>
                    </td>
                    <td className="px-3 py-2">{code.point_ids.length}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          onClick={() => startEditCode(code)}
                          className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Duzenle
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void downloadQrPng(code)
                          }}
                          className="rounded-md border border-brand-300 px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50"
                        >
                          PNG
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredCodes.length === 0 ? (
                  <tr>
                    <td className="px-3 py-4 text-sm text-slate-500" colSpan={6}>
                      Arama kriterine uygun QR kod bulunamadi.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel className="min-w-0">
          <h4 className="text-base font-semibold text-slate-900">
            {selectedCode ? `3) QR Kod Detay (#${selectedCode.id})` : '3) QR Kod Detay'}
          </h4>
          {!selectedCode ? (
            <p className="mt-2 text-sm text-slate-600">Detay gormek icin listeden bir QR kod secin.</p>
          ) : (
            <div className="mt-3 space-y-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <p>
                  <span className="font-semibold">Ad:</span> {selectedCode.name || '-'}
                </p>
                <p>
                  <span className="font-semibold">Kod degeri:</span> {selectedCode.code_value}
                </p>
                <p>
                  <span className="font-semibold">Tip:</span> {formatCodeType(selectedCode.code_type)}
                </p>
                <p>
                  <span className="font-semibold">Durum:</span> {selectedCode.is_active ? 'Aktif' : 'Pasif'}
                </p>
                <p>
                  <span className="font-semibold">Atanan nokta sayisi:</span> {selectedCode.point_ids.length}
                </p>
              </div>

              {selectedCode.point_ids.length === 0 ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
                  Bu QR kodda nokta atamasi yok. Okutma yapildiginda sistem izin vermez.
                </div>
              ) : null}

              <div className="rounded-lg border border-brand-200 bg-brand-50/60 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">QR Onizleme</p>
                <p className="mt-1 break-all text-xs text-slate-700">{selectedCode.code_value}</p>
                {selectedCodeQrDataUrl ? (
                  <div className="mt-3 flex flex-col items-start gap-3">
                    <img
                      src={selectedCodeQrDataUrl}
                      alt={`QR Kod ${selectedCode.id}`}
                      className="h-52 w-52 rounded-lg border border-brand-200 bg-white p-2"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          void downloadQrPng(selectedCode)
                        }}
                        className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
                      >
                        PNG Indir
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void copyCodeValue(selectedCode.code_value)
                        }}
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-white"
                      >
                        Kodu Kopyala
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-rose-700">QR onizleme olusturulamadi.</p>
                )}
              </div>

              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                Bu QR kod, sadece bu koda atanmis aktif konum noktalarinin radius alaninda okutuldugunda
                gecerli olur. Diger konumlarda sistem isleme izin vermez.
              </div>

              <h5 className="text-sm font-semibold text-slate-900">Atanmis Noktalar</h5>
              {assignedPoints.length === 0 ? (
                <p className="text-sm text-slate-600">Bu QR kod icin henuz nokta atanmis degil.</p>
              ) : (
                <div className="space-y-2">
                  {assignedPoints.map((point) => (
                    <div
                      key={point.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    >
                      <div>
                        <p className="font-medium text-slate-800">
                          #{point.id} - {point.name}
                        </p>
                        <p className="text-xs text-slate-500">
                          lat/lon: {point.lat}, {point.lon} | radius: {point.radius_m}m
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          unassignPointMutation.mutate({
                            codeId: selectedCode.id,
                            pointId: point.id,
                          })
                        }
                        className="rounded-md border border-rose-300 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                      >
                        Kaldir
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Panel>

        <Panel className="min-w-0">
          <h4 className="text-base font-semibold text-slate-900">4) Nokta Ata (Coklu Secim)</h4>
          <p className="mt-1 text-xs text-slate-500">
            Arama ile nokta secip tek islemde birden fazla noktayi QR koda baglayabilirsiniz.
          </p>

          <div className="mt-3">
            <TableSearchInput value={assignSearch} onChange={setAssignSearch} placeholder="Nokta adi / ID ara" />
          </div>

          <div className="mt-3 max-h-56 overflow-auto overscroll-contain rounded-lg border border-slate-200 p-2">
            {assignablePoints.length === 0 ? (
              <p className="px-2 py-1 text-sm text-slate-600">Aktif nokta bulunamadi.</p>
            ) : (
              <div className="space-y-1">
                {assignablePoints.map((point) => (
                  <label
                    key={point.id}
                    className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={assignSelectedPointIds.includes(point.id)}
                      onChange={() => toggleAssignPoint(point.id)}
                    />
                    <span>
                      #{point.id} - {point.name} ({point.radius_m}m)
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-sm text-slate-600">Secilen nokta: {assignSelectedPointIds.length}</p>
            <button
              type="button"
              onClick={handleAssignPoints}
              disabled={assignPointsMutation.isPending || selectedCode === null}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              Secilenleri Ata
            </button>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel className="min-w-0">
          <h4 className="text-base font-semibold text-slate-900">
            {editingPointId === null ? '1) QR Nokta Olustur' : `1) QR Nokta Duzenle (#${editingPointId})`}
          </h4>
          <p className="mt-1 text-xs text-slate-500">
            QR noktasi okutmanin izinli oldugu fiziksel konumu temsil eder.
          </p>
          <form className="mt-3 space-y-3" onSubmit={handlePointSubmit}>
            <label className="block text-sm text-slate-700">
              Nokta adi
              <input
                value={pointForm.name}
                onChange={(event) => setPointForm((prev) => ({ ...prev, name: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                placeholder="Orn: Merkez Ofis Kapi"
              />
              <p className="mt-1 text-xs text-slate-500">
                Ornek: Istanbul Merkez Kapi, Ankara Sube Giris.
              </p>
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="block text-sm text-slate-700">
                Lat
                <input
                  type="number"
                  step="any"
                  value={pointForm.lat}
                  onChange={(event) => setPointForm((prev) => ({ ...prev, lat: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="block text-sm text-slate-700">
                Lon
                <input
                  type="number"
                  step="any"
                  value={pointForm.lon}
                  onChange={(event) => setPointForm((prev) => ({ ...prev, lon: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
            </div>

            <QrPointMapPicker
              lat={mapPointLat}
              lon={mapPointLon}
              radiusM={mapPointRadius}
              onSelect={(nextLat, nextLon) =>
                setPointForm((prev) => ({
                  ...prev,
                  lat: String(nextLat),
                  lon: String(nextLon),
                }))
              }
            />

            <label className="block text-sm text-slate-700">
              Radius (m)
              <input
                type="number"
                min={1}
                value={pointForm.radiusM}
                onChange={(event) => setPointForm((prev) => ({ ...prev, radiusM: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
              <p className="mt-1 text-xs text-slate-500">
                Oneri: bina ici 50-80m, acik alan 80-150m.
              </p>
            </label>

            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={pointForm.isActive}
                onChange={(event) => setPointForm((prev) => ({ ...prev, isActive: event.target.checked }))}
              />
              Aktif
            </label>

            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={createPointMutation.isPending || updatePointMutation.isPending}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {editingPointId === null ? 'Olustur' : 'Guncelle'}
              </button>
              {editingPointId !== null ? (
                <button
                  type="button"
                  onClick={resetPointForm}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Iptal
                </button>
              ) : null}
            </div>
          </form>
        </Panel>

        <Panel className="min-w-0">
          <h4 className="text-base font-semibold text-slate-900">5) QR Nokta Listesi</h4>
          <div className="mt-3">
            <TableSearchInput value={pointSearch} onChange={setPointSearch} placeholder="Nokta adi / ID ara" />
          </div>
          <div className="mt-3 max-h-96 overflow-auto overscroll-contain rounded-lg border border-slate-200">
            <table className="min-w-[920px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">Nokta</th>
                  <th className="px-3 py-2">Konum</th>
                  <th className="px-3 py-2">Durum</th>
                  <th className="px-3 py-2">Aksiyon</th>
                </tr>
              </thead>
              <tbody>
                {filteredPoints.map((point) => (
                  <tr key={point.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{point.id}</td>
                    <td className="px-3 py-2">
                      <p className="font-medium text-slate-800">{point.name}</p>
                      <p className="text-xs text-slate-500">radius: {point.radius_m}m</p>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {point.lat}, {point.lon}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                          point.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {point.is_active ? 'Aktif' : 'Pasif'}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          onClick={() => startEditPoint(point)}
                          className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Duzenle
                        </button>
                        {point.is_active ? (
                          <button
                            type="button"
                            onClick={() => deactivatePointMutation.mutate(point.id)}
                            className="rounded-md border border-rose-300 px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50"
                          >
                            Pasife Al
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredPoints.length === 0 ? (
                  <tr>
                    <td className="px-3 py-4 text-sm text-slate-500" colSpan={5}>
                      Arama kriterine uygun nokta bulunamadi.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  )
}
