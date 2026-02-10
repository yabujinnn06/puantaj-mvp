import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

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
import { TableSearchInput } from '../components/TableSearchInput'
import { useToast } from '../hooks/useToast'
import type { QrCode, QrCodeType, QrPoint } from '../types/api'

type CodeFormState = {
  name: string
  codeValue: string
  codeType: QrCodeType
  isActive: boolean
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

function formatCodeType(value: QrCodeType): string {
  if (value === 'CHECKIN') return 'CHECKIN (Giris)'
  if (value === 'CHECKOUT') return 'CHECKOUT (Cikis)'
  return 'BOTH (Duruma gore)'
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
  const [pointForm, setPointForm] = useState<PointFormState>(defaultPointForm)
  const [assignSelectedPointIds, setAssignSelectedPointIds] = useState<number[]>([])

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
    <div className="space-y-4">
      <PageHeader
        title="QR Kod Yonetimi"
        description="QR kodlari olusturun, nokta listesi yonetin ve bir QR koda birden fazla konum noktasi baglayin."
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <h4 className="text-base font-semibold text-slate-900">
            {editingCodeId === null ? 'Yeni QR Kod' : `QR Kod Duzenle (#${editingCodeId})`}
          </h4>
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

        <Panel>
          <h4 className="text-base font-semibold text-slate-900">QR Kod Listesi</h4>
          <div className="mt-3">
            <TableSearchInput value={codeSearch} onChange={setCodeSearch} placeholder="Kod adi / degeri / ID ara" />
          </div>
          <div className="mt-3 max-h-80 overflow-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">Kod</th>
                  <th className="px-3 py-2">Tip</th>
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
                      <div className="text-xs text-slate-500">{code.code_value}</div>
                    </td>
                    <td className="px-3 py-2">{code.code_type}</td>
                    <td className="px-3 py-2">{code.point_ids.length}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => startEditCode(code)}
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Duzenle
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <h4 className="text-base font-semibold text-slate-900">
            {selectedCode ? `QR Kod Detay (#${selectedCode.id})` : 'QR Kod Detay'}
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

        <Panel>
          <h4 className="text-base font-semibold text-slate-900">Nokta Ata (Coklu Secim)</h4>
          <p className="mt-1 text-xs text-slate-500">
            Arama ile nokta secip tek islemde birden fazla noktayi QR koda baglayabilirsiniz.
          </p>

          <div className="mt-3">
            <TableSearchInput value={assignSearch} onChange={setAssignSearch} placeholder="Nokta adi / ID ara" />
          </div>

          <div className="mt-3 max-h-56 overflow-auto rounded-lg border border-slate-200 p-2">
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

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <h4 className="text-base font-semibold text-slate-900">
            {editingPointId === null ? 'Yeni QR Nokta' : `QR Nokta Duzenle (#${editingPointId})`}
          </h4>
          <form className="mt-3 space-y-3" onSubmit={handlePointSubmit}>
            <label className="block text-sm text-slate-700">
              Nokta adi
              <input
                value={pointForm.name}
                onChange={(event) => setPointForm((prev) => ({ ...prev, name: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                placeholder="Orn: Merkez Ofis Kapi"
              />
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

            <label className="block text-sm text-slate-700">
              Radius (m)
              <input
                type="number"
                min={1}
                value={pointForm.radiusM}
                onChange={(event) => setPointForm((prev) => ({ ...prev, radiusM: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
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

        <Panel>
          <h4 className="text-base font-semibold text-slate-900">QR Nokta Listesi</h4>
          <div className="mt-3">
            <TableSearchInput value={pointSearch} onChange={setPointSearch} placeholder="Nokta adi / ID ara" />
          </div>
          <div className="mt-3 max-h-96 overflow-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-left text-sm">
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
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  )
}

