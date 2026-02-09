import axios from 'axios'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import {
  createDepartment,
  getDepartmentsFiltered,
  getRegions,
  updateDepartment,
} from '../api/admin'
import { parseApiError } from '../api/error'
import { ErrorBlock } from '../components/ErrorBlock'
import { LoadingBlock } from '../components/LoadingBlock'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'
import { TableSearchInput } from '../components/TableSearchInput'
import { useToast } from '../hooks/useToast'

const createDepartmentSchema = z.object({
  name: z.string().min(2, 'Departman adi en az 2 karakter olmali.').max(255),
  region_id: z.union([z.coerce.number().int().positive(), z.null()]),
})

function buildDepartmentErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error) && error.response?.status === 409) {
    return 'Bu departman adi zaten mevcut. Lutfen farkli bir ad girin.'
  }

  const parsed = parseApiError(error, 'Departman olusturulamadi.')
  if (parsed.message.toLowerCase().includes('department name already exists')) {
    return 'Bu departman adi zaten mevcut. Lutfen farkli bir ad girin.'
  }

  return parsed.message
}

export function DepartmentsPage() {
  const queryClient = useQueryClient()
  const { pushToast } = useToast()

  const [name, setName] = useState('')
  const [regionId, setRegionId] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [regionFilterId, setRegionFilterId] = useState('')

  const [editingDepartmentId, setEditingDepartmentId] = useState<number | null>(null)
  const [editingDepartmentName, setEditingDepartmentName] = useState('')
  const [editingDepartmentRegionId, setEditingDepartmentRegionId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const departmentsQuery = useQuery({
    queryKey: ['departments', regionFilterId],
    queryFn: () =>
      getDepartmentsFiltered(regionFilterId ? { region_id: Number(regionFilterId) } : undefined),
  })
  const regionsQuery = useQuery({
    queryKey: ['regions', 'departments-page'],
    queryFn: () => getRegions({ include_inactive: true }),
  })

  const createMutation = useMutation({
    mutationFn: createDepartment,
    onSuccess: (department) => {
      setName('')
      setRegionId('')
      setError(null)
      setIsCreateOpen(false)
      pushToast({
        variant: 'success',
        title: 'Departman olusturuldu',
        description: `${department.name} basariyla eklendi.`,
      })
      void queryClient.invalidateQueries({ queryKey: ['departments'] })
    },
    onError: (mutationError) => {
      const message = buildDepartmentErrorMessage(mutationError)
      setError(message)
      pushToast({
        variant: 'error',
        title: 'Departman olusturulamadi',
        description: message,
      })
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ departmentId, name, regionIdValue }: { departmentId: number; name: string; regionIdValue: number | null }) =>
      updateDepartment(departmentId, { name, region_id: regionIdValue }),
    onSuccess: (department) => {
      setError(null)
      setEditingDepartmentId(null)
      setEditingDepartmentName('')
      setEditingDepartmentRegionId('')
      pushToast({
        variant: 'success',
        title: 'Departman guncellendi',
        description: `${department.name} basariyla guncellendi.`,
      })
      void queryClient.invalidateQueries({ queryKey: ['departments'] })
    },
    onError: (mutationError) => {
      const message = buildDepartmentErrorMessage(mutationError)
      setError(message)
      pushToast({
        variant: 'error',
        title: 'Departman guncellenemedi',
        description: message,
      })
    },
  })

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)

    const rawRegionId = regionId.trim() === '' ? null : Number(regionId)
    const parsed = createDepartmentSchema.safeParse({ name, region_id: rawRegionId })
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'Departman alanlarini kontrol edin.'
      setError(message)
      pushToast({
        variant: 'error',
        title: 'Form hatasi',
        description: message,
      })
      return
    }

    createMutation.mutate({
      name: parsed.data.name,
      region_id: parsed.data.region_id,
    })
  }

  const onUpdateSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)

    if (!editingDepartmentId) {
      return
    }
    const rawRegionId = editingDepartmentRegionId.trim() === '' ? null : Number(editingDepartmentRegionId)
    const parsed = createDepartmentSchema.safeParse({
      name: editingDepartmentName,
      region_id: rawRegionId,
    })
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'Departman alanlarini kontrol edin.'
      setError(message)
      pushToast({
        variant: 'error',
        title: 'Form hatasi',
        description: message,
      })
      return
    }

    updateMutation.mutate({
      departmentId: editingDepartmentId,
      name: parsed.data.name,
      regionIdValue: parsed.data.region_id,
    })
  }

  const departments = departmentsQuery.data ?? []
  const regions = regionsQuery.data ?? []
  const regionNameById = useMemo(
    () => new Map(regions.map((region) => [region.id, region.name])),
    [regions],
  )

  const filteredDepartments = useMemo(() => {
    const normalized = searchTerm.trim().toLowerCase()
    if (!normalized) {
      return departments
    }
    return departments.filter((department) => department.name.toLowerCase().includes(normalized))
  }, [departments, searchTerm])

  return (
    <div className="space-y-4">
      <PageHeader
        title="Departmanlar"
        description="Departman kayitlarini bolge bazli olarak yonetin."
        action={
          <button
            type="button"
            onClick={() => setIsCreateOpen((prev) => !prev)}
            className="btn-primary rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Yeni Departman
          </button>
        }
      />

      {isCreateOpen ? (
        <Panel>
          <form onSubmit={onSubmit} className="grid gap-3 md:grid-cols-3 md:items-end">
            <label className="text-sm text-slate-700 md:col-span-2">
              Departman adi
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                placeholder="Insan Kaynaklari"
              />
            </label>
            <label className="text-sm text-slate-700">
              Bolge
              <select
                value={regionId}
                onChange={(event) => setRegionId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                <option value="">Bolge yok</option>
                {regions.map((region) => (
                  <option key={region.id} value={region.id}>
                    {region.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-2 md:col-span-3">
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="btn-primary rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {createMutation.isPending ? 'Kaydediliyor...' : 'Kaydet'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsCreateOpen(false)
                  setError(null)
                }}
                className="btn-secondary rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Vazgec
              </button>
            </div>
          </form>
          {error ? <div className="form-validation">{error}</div> : null}
        </Panel>
      ) : null}

      {editingDepartmentId ? (
        <Panel>
          <form onSubmit={onUpdateSubmit} className="grid gap-3 md:grid-cols-3 md:items-end">
            <label className="text-sm text-slate-700 md:col-span-2">
              Departman adi
              <input
                value={editingDepartmentName}
                onChange={(event) => setEditingDepartmentName(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="text-sm text-slate-700">
              Bolge
              <select
                value={editingDepartmentRegionId}
                onChange={(event) => setEditingDepartmentRegionId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                <option value="">Bolge yok</option>
                {regions.map((region) => (
                  <option key={region.id} value={region.id}>
                    {region.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-2 md:col-span-3">
              <button
                type="submit"
                disabled={updateMutation.isPending}
                className="btn-primary rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {updateMutation.isPending ? 'Guncelleniyor...' : 'Guncelle'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingDepartmentId(null)
                  setEditingDepartmentName('')
                  setEditingDepartmentRegionId('')
                  setError(null)
                }}
                className="btn-secondary rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Vazgec
              </button>
            </div>
          </form>
          {error ? <div className="form-validation">{error}</div> : null}
        </Panel>
      ) : null}

      {departmentsQuery.isLoading || regionsQuery.isLoading ? <LoadingBlock /> : null}
      {departmentsQuery.isError || regionsQuery.isError ? (
        <ErrorBlock message="Departman verileri alinamadi." />
      ) : null}

      {!departmentsQuery.isLoading && !departmentsQuery.isError && !regionsQuery.isLoading && !regionsQuery.isError ? (
        <Panel>
          <div className="mb-4 grid gap-3 md:grid-cols-3">
            <TableSearchInput
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder="Departman adina gore ara..."
            />
            <label className="text-sm text-slate-700">
              Bolge filtresi
              <select
                value={regionFilterId}
                onChange={(event) => setRegionFilterId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                <option value="">Tum bolgeler</option>
                {regions.map((region) => (
                  <option key={region.id} value={region.id}>
                    {region.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2">Departman ID</th>
                  <th className="py-2">Departman Adi</th>
                  <th className="py-2">Bolge</th>
                  <th className="py-2">Islem</th>
                </tr>
              </thead>
              <tbody>
                {filteredDepartments.map((department) => (
                  <tr key={department.id} className="border-t border-slate-100">
                    <td className="py-2">{department.id}</td>
                    <td className="py-2">{department.name}</td>
                    <td className="py-2">
                      {department.region_name ?? (department.region_id ? regionNameById.get(department.region_id) : '-') ?? '-'}
                    </td>
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingDepartmentId(department.id)
                          setEditingDepartmentName(department.name)
                          setEditingDepartmentRegionId(department.region_id ? String(department.region_id) : '')
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
          {filteredDepartments.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">Arama kriterine uygun departman bulunamadi.</p>
          ) : null}
        </Panel>
      ) : null}
    </div>
  )
}
