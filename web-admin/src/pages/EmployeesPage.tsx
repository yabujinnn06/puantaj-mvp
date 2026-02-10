import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { z } from 'zod'

import {
  createEmployee,
  getDepartments,
  getEmployees,
  getRegions,
  updateEmployeeActive,
} from '../api/admin'
import { parseApiError } from '../api/error'
import { ErrorBlock } from '../components/ErrorBlock'
import { LoadingBlock } from '../components/LoadingBlock'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'
import { StatusBadge } from '../components/StatusBadge'
import { TableSearchInput } from '../components/TableSearchInput'
import { useToast } from '../hooks/useToast'

const employeeSchema = z.object({
  full_name: z.string().min(2, 'Ad soyad en az 2 karakter olmali.'),
  region_id: z.union([z.coerce.number().int().positive(), z.null()]),
  department_id: z.union([z.coerce.number().int().positive(), z.null()]),
  is_active: z.boolean(),
})

export function EmployeesPage() {
  const queryClient = useQueryClient()
  const { pushToast } = useToast()

  const [fullName, setFullName] = useState('')
  const [regionId, setRegionId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [showInactive, setShowInactive] = useState(false)
  const [regionFilterId, setRegionFilterId] = useState('')
  const [departmentFilterId, setDepartmentFilterId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const employeesQuery = useQuery({
    queryKey: ['employees', showInactive, regionFilterId, departmentFilterId],
    queryFn: () =>
      getEmployees({
        ...(showInactive ? { include_inactive: true } : {}),
        ...(regionFilterId ? { region_id: Number(regionFilterId) } : {}),
        ...(departmentFilterId ? { department_id: Number(departmentFilterId) } : {}),
      }),
  })
  const departmentsQuery = useQuery({ queryKey: ['departments'], queryFn: getDepartments })
  const regionsQuery = useQuery({
    queryKey: ['regions', 'employees-page'],
    queryFn: () => getRegions({ include_inactive: true }),
  })

  const createMutation = useMutation({
    mutationFn: createEmployee,
    onSuccess: (employee) => {
      setFullName('')
      setRegionId('')
      setDepartmentId('')
      setIsActive(true)
      setError(null)
      setIsCreateOpen(false)
      pushToast({
        variant: 'success',
        title: 'Calisan olusturuldu',
        description: `${employee.full_name} basariyla eklendi.`,
      })
      void queryClient.invalidateQueries({ queryKey: ['employees'] })
    },
    onError: (mutationError) => {
      const message = parseApiError(mutationError, 'Calisan olusturulamadi.').message
      setError(message)
      pushToast({
        variant: 'error',
        title: 'Calisan olusturulamadi',
        description: message,
      })
    },
  })

  const toggleActiveMutation = useMutation({
    mutationFn: ({ employeeId, nextStatus }: { employeeId: number; nextStatus: boolean }) =>
      updateEmployeeActive(employeeId, { is_active: nextStatus }),
    onSuccess: (employee) => {
      pushToast({
        variant: 'success',
        title: employee.is_active ? 'Calisan arsivden cikarildi' : 'Calisan arsivlendi',
        description: `${employee.full_name} icin durum guncellendi.`,
      })
      void queryClient.invalidateQueries({ queryKey: ['employees'] })
    },
    onError: (mutationError) => {
      const message = parseApiError(mutationError, 'Calisan durumu guncellenemedi.').message
      pushToast({
        variant: 'error',
        title: 'Islem basarisiz',
        description: message,
      })
    },
  })

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)

    const rawRegionId = regionId.trim() === '' ? null : Number(regionId)
    const rawDepartmentId = departmentId.trim() === '' ? null : Number(departmentId)
    const parsed = employeeSchema.safeParse({
      full_name: fullName,
      region_id: rawRegionId,
      department_id: rawDepartmentId,
      is_active: isActive,
    })

    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'Calisan formunu kontrol edin.'
      setError(message)
      pushToast({
        variant: 'error',
        title: 'Form hatasi',
        description: message,
      })
      return
    }

    createMutation.mutate(parsed.data)
  }

  const employees = employeesQuery.data ?? []
  const departments = departmentsQuery.data ?? []
  const regions = regionsQuery.data ?? []
  const departmentById = new Map(departments.map((department) => [department.id, department.name]))
  const regionById = new Map(regions.map((region) => [region.id, region.name]))

  const selectableDepartments = useMemo(() => {
    const selectedRegion = regionId ? Number(regionId) : null
    if (!selectedRegion) {
      return departments
    }
    return departments.filter((department) => department.region_id === selectedRegion)
  }, [departments, regionId])

  const filterDepartments = useMemo(() => {
    const selectedRegion = regionFilterId ? Number(regionFilterId) : null
    if (!selectedRegion) {
      return departments
    }
    return departments.filter((department) => department.region_id === selectedRegion)
  }, [departments, regionFilterId])

  const filteredEmployees = useMemo(() => {
    const normalized = searchTerm.trim().toLowerCase()
    if (!normalized) {
      return employees
    }
    return employees.filter((employee) => employee.full_name.toLowerCase().includes(normalized))
  }, [employees, searchTerm])

  if (employeesQuery.isLoading || departmentsQuery.isLoading || regionsQuery.isLoading) {
    return <LoadingBlock />
  }

  if (employeesQuery.isError || departmentsQuery.isError || regionsQuery.isError) {
    return <ErrorBlock message="Calisan verileri alinamadi." />
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Calisanlar"
        description="Calisan kayitlarini bolge ve departman bazli yonetin."
        action={
          <button
            type="button"
            onClick={() => setIsCreateOpen((prev) => !prev)}
            className="btn-primary rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Yeni Calisan
          </button>
        }
      />

      {isCreateOpen ? (
        <Panel>
          <form onSubmit={onSubmit} className="grid gap-3 md:grid-cols-5">
            <label className="text-sm text-slate-700 md:col-span-2">
              Ad Soyad
              <input
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                placeholder="Ada Lovelace"
              />
            </label>

            <label className="text-sm text-slate-700">
              Bolge
              <select
                value={regionId}
                onChange={(event) => {
                  setRegionId(event.target.value)
                  setDepartmentId('')
                }}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                <option value="">Atanmamis</option>
                {regions.map((region) => (
                  <option key={region.id} value={region.id}>
                    {region.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm text-slate-700">
              Departman
              <select
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                <option value="">Atanmamis</option>
                {selectableDepartments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-2 pt-7 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(event) => setIsActive(event.target.checked)}
              />
              Aktif
            </label>

            <div className="flex gap-2 md:col-span-5">
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

      <Panel>
        <div className="mb-4 grid gap-3 md:grid-cols-5">
          <TableSearchInput
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Calisan adina gore ara..."
          />
          <label className="text-sm text-slate-700">
            Bolge filtresi
            <select
              value={regionFilterId}
              onChange={(event) => {
                setRegionFilterId(event.target.value)
                setDepartmentFilterId('')
              }}
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
          <label className="text-sm text-slate-700">
            Departman filtresi
            <select
              value={departmentFilterId}
              onChange={(event) => setDepartmentFilterId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="">Tum departmanlar</option>
              {filterDepartments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-flex items-center gap-2 pt-8 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(event) => setShowInactive(event.target.checked)}
            />
            Arsivdekileri goster
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2">Calisan ID</th>
                <th className="py-2">Ad Soyad</th>
                <th className="py-2">Bolge</th>
                <th className="py-2">Departman</th>
                <th className="py-2">Durum</th>
                <th className="py-2">Islem</th>
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.map((employee) => (
                <tr key={employee.id} className="border-t border-slate-100">
                  <td className="py-2">{employee.id}</td>
                  <td className="py-2">{employee.full_name}</td>
                  <td className="py-2">
                    {employee.region_name ?? (employee.region_id ? regionById.get(employee.region_id) : '-') ?? '-'}
                  </td>
                  <td className="py-2">
                    {employee.department_id ? departmentById.get(employee.department_id) : '-'}
                  </td>
                  <td className="py-2">
                    <StatusBadge value={employee.is_active ? 'Aktif' : 'Pasif'} />
                  </td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-2">
                      <Link
                        to={`/employees/${employee.id}`}
                        onClick={() => {
                          sessionStorage.setItem('employee-detail-origin', 'employees')
                          sessionStorage.setItem('employee-detail-id', String(employee.id))
                        }}
                        className="btn-secondary inline-flex rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Duzenle
                      </Link>
                      <button
                        type="button"
                        disabled={toggleActiveMutation.isPending}
                        onClick={() => {
                          const nextStatus = !employee.is_active
                          const confirmed = window.confirm(
                            nextStatus
                              ? `${employee.full_name} arsivden cikarilsin mi?`
                              : `${employee.full_name} arsivlensin mi?`,
                          )
                          if (!confirmed) {
                            return
                          }
                          toggleActiveMutation.mutate({
                            employeeId: employee.id,
                            nextStatus,
                          })
                        }}
                        className={`inline-flex rounded-lg px-3 py-1 text-xs font-medium text-white ${
                          employee.is_active
                            ? 'btn-danger bg-rose-600 hover:bg-rose-700'
                            : 'bg-emerald-600 hover:bg-emerald-700'
                        }`}
                      >
                        {employee.is_active ? 'Arsivle' : 'Arsivden Cikar'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredEmployees.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Arama kriterine uygun calisan bulunamadi.</p>
        ) : null}
      </Panel>
    </div>
  )
}
