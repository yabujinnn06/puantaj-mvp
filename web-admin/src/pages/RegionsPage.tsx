import axios from 'axios'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import { createRegion, getRegions, updateRegion } from '../api/admin'
import { parseApiError } from '../api/error'
import { ErrorBlock } from '../components/ErrorBlock'
import { LoadingBlock } from '../components/LoadingBlock'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'
import { StatusBadge } from '../components/StatusBadge'
import { TableSearchInput } from '../components/TableSearchInput'
import { useToast } from '../hooks/useToast'

const regionSchema = z.object({
  name: z.string().min(2, 'Bolge adi en az 2 karakter olmali.').max(255),
  is_active: z.boolean(),
})

function buildRegionErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error) && error.response?.status === 409) {
    return 'Bu bolge adi zaten mevcut. Farkli bir ad girin.'
  }
  return parseApiError(error, 'Bolge islemi basarisiz.').message
}

export function RegionsPage() {
  const queryClient = useQueryClient()
  const { pushToast } = useToast()

  const [name, setName] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [showInactive, setShowInactive] = useState(true)
  const [editingRegionId, setEditingRegionId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')
  const [editingIsActive, setEditingIsActive] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const regionsQuery = useQuery({
    queryKey: ['regions', showInactive],
    queryFn: () => getRegions({ include_inactive: showInactive }),
  })

  const createMutation = useMutation({
    mutationFn: createRegion,
    onSuccess: (region) => {
      setName('')
      setIsActive(true)
      setError(null)
      pushToast({
        variant: 'success',
        title: 'Bolge olusturuldu',
        description: `${region.name} basariyla eklendi.`,
      })
      void queryClient.invalidateQueries({ queryKey: ['regions'] })
    },
    onError: (mutationError) => {
      const message = buildRegionErrorMessage(mutationError)
      setError(message)
      pushToast({ variant: 'error', title: 'Bolge olusturulamadi', description: message })
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({
      regionId,
      payload,
    }: {
      regionId: number
      payload: { name: string; is_active: boolean }
    }) => updateRegion(regionId, payload),
    onSuccess: (region) => {
      setError(null)
      setEditingRegionId(null)
      setEditingName('')
      setEditingIsActive(true)
      pushToast({
        variant: 'success',
        title: 'Bolge guncellendi',
        description: `${region.name} guncellendi.`,
      })
      void queryClient.invalidateQueries({ queryKey: ['regions'] })
    },
    onError: (mutationError) => {
      const message = buildRegionErrorMessage(mutationError)
      setError(message)
      pushToast({ variant: 'error', title: 'Bolge guncellenemedi', description: message })
    },
  })

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    const parsed = regionSchema.safeParse({ name, is_active: isActive })
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'Bolge formunu kontrol edin.'
      setError(message)
      return
    }
    createMutation.mutate(parsed.data)
  }

  const onEditSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    if (!editingRegionId) {
      return
    }
    const parsed = regionSchema.safeParse({ name: editingName, is_active: editingIsActive })
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'Bolge formunu kontrol edin.'
      setError(message)
      return
    }
    updateMutation.mutate({ regionId: editingRegionId, payload: parsed.data })
  }

  const rows = useMemo(() => {
    const source = regionsQuery.data ?? []
    const normalized = searchTerm.trim().toLowerCase()
    if (!normalized) {
      return source
    }
    return source.filter((item) => item.name.toLowerCase().includes(normalized))
  }, [regionsQuery.data, searchTerm])

  return (
    <div className="space-y-4">
      <PageHeader
        title="Bolgeler"
        description="Sube/sehir bazli yonetim icin bolge kayitlarini yonetin."
      />

      <Panel>
        <form onSubmit={onSubmit} className="grid gap-3 md:grid-cols-4">
          <label className="text-sm text-slate-700 md:col-span-2">
            Bolge adi
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              placeholder="Orn: Istanbul Avrupa"
            />
          </label>
          <label className="inline-flex items-center gap-2 pt-8 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
            />
            Aktif
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {createMutation.isPending ? 'Kaydediliyor...' : 'Bolge Ekle'}
            </button>
          </div>
        </form>
        {error ? <p className="form-validation mt-2">{error}</p> : null}
      </Panel>

      {editingRegionId ? (
        <Panel>
          <form onSubmit={onEditSubmit} className="grid gap-3 md:grid-cols-4">
            <label className="text-sm text-slate-700 md:col-span-2">
              Bolge adi
              <input
                value={editingName}
                onChange={(event) => setEditingName(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="inline-flex items-center gap-2 pt-8 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={editingIsActive}
                onChange={(event) => setEditingIsActive(event.target.checked)}
              />
              Aktif
            </label>
            <div className="flex items-end gap-2">
              <button
                type="submit"
                disabled={updateMutation.isPending}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {updateMutation.isPending ? 'Guncelleniyor...' : 'Kaydet'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingRegionId(null)
                  setEditingName('')
                  setEditingIsActive(true)
                  setError(null)
                }}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Vazgec
              </button>
            </div>
          </form>
          {error ? <p className="form-validation mt-2">{error}</p> : null}
        </Panel>
      ) : null}

      {regionsQuery.isLoading ? <LoadingBlock /> : null}
      {regionsQuery.isError ? <ErrorBlock message="Bolge listesi alinamadi." /> : null}

      {!regionsQuery.isLoading && !regionsQuery.isError ? (
        <Panel>
          <div className="mb-4 grid gap-3 md:grid-cols-3 md:items-end">
            <TableSearchInput value={searchTerm} onChange={setSearchTerm} placeholder="Bolge adina gore ara..." />
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(event) => setShowInactive(event.target.checked)}
              />
              Pasif bolgeleri goster
            </label>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2">Bolge ID</th>
                  <th className="py-2">Bolge Adi</th>
                  <th className="py-2">Durum</th>
                  <th className="py-2">Islem</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((region) => (
                  <tr key={region.id} className="border-t border-slate-100">
                    <td className="py-2">{region.id}</td>
                    <td className="py-2">{region.name}</td>
                    <td className="py-2">
                      <StatusBadge value={region.is_active ? 'Aktif' : 'Pasif'} />
                    </td>
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingRegionId(region.id)
                          setEditingName(region.name)
                          setEditingIsActive(region.is_active)
                          setError(null)
                        }}
                        className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Duzenle
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">Arama kriterine uygun bolge bulunamadi.</p>
          ) : null}
        </Panel>
      ) : null}
    </div>
  )
}
