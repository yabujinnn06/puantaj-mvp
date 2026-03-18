import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { z } from 'zod'

import {
  createEmployee,
  deleteEmployee,
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
  full_name: z.string().min(2, 'Ad soyad en az 2 karakter olmalı.'),
  region_id: z.union([z.coerce.number().int().positive(), z.null()]),
  department_id: z.union([z.coerce.number().int().positive(), z.null()]),
  is_active: z.boolean(),
})

const EMPLOYEE_LIST_PAGE_SIZES = [20, 35, 50, 100]

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
  const [employeeListPageSize, setEmployeeListPageSize] = useState(35)
  const [employeeListPage, setEmployeeListPage] = useState(1)
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
        title: 'Çalışan oluşturuldu',
        description: `${employee.full_name} başarıyla eklendi.`,
      })
      void queryClient.invalidateQueries({ queryKey: ['employees'] })
    },
    onError: (mutationError) => {
      const message = parseApiError(mutationError, 'Çalışan oluşturulamadı.').message
      setError(message)
      pushToast({
        variant: 'error',
        title: 'Çalışan oluşturulamadı',
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
        title: employee.is_active ? 'Çalışan arşivden çıkarıldı' : 'Çalışan arşivlendi',
        description: `${employee.full_name} için durum güncellendi.`,
      })
      void queryClient.invalidateQueries({ queryKey: ['employees'] })
    },
    onError: (mutationError) => {
      const message = parseApiError(mutationError, 'Çalışan durumu güncellenemedi.').message
      pushToast({
        variant: 'error',
        title: 'İşlem başarısız',
        description: message,
      })
    },
  })

  const deleteEmployeeMutation = useMutation({
    mutationFn: (employeeId: number) => deleteEmployee(employeeId),
    onSuccess: () => {
      pushToast({
        variant: 'success',
        title: 'Çalışan kalıcı olarak silindi',
        description: 'Arşivli çalışan kaydı sistemden kaldırıldı.',
      })
      void queryClient.invalidateQueries({ queryKey: ['employees'] })
    },
    onError: (mutationError) => {
      const message = parseApiError(mutationError, 'Çalışan silinemedi.').message
      pushToast({
        variant: 'error',
        title: 'Kalıcı silme başarısız',
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
      const message = parsed.error.issues[0]?.message ?? 'Çalışan formunu kontrol edin.'
      setError(message)
      pushToast({
        variant: 'error',
        title: 'Form hatası',
        description: message,
      })
      return
    }

    createMutation.mutate(parsed.data)
  }

  const employees = useMemo(() => employeesQuery.data ?? [], [employeesQuery.data])
  const departments = useMemo(() => departmentsQuery.data ?? [], [departmentsQuery.data])
  const regions = useMemo(() => regionsQuery.data ?? [], [regionsQuery.data])
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

  const employeeListTotalPages = Math.max(1, Math.ceil(filteredEmployees.length / employeeListPageSize))
  const safeEmployeeListPage = Math.min(employeeListPage, employeeListTotalPages)
  const employeeListStartIndex = (safeEmployeeListPage - 1) * employeeListPageSize
  const pagedEmployees = useMemo(
    () => filteredEmployees.slice(employeeListStartIndex, employeeListStartIndex + employeeListPageSize),
    [filteredEmployees, employeeListStartIndex, employeeListPageSize],
  )
  const employeeListRangeStart = filteredEmployees.length === 0 ? 0 : employeeListStartIndex + 1
  const employeeListRangeEnd = filteredEmployees.length === 0
    ? 0
    : Math.min(employeeListStartIndex + employeeListPageSize, filteredEmployees.length)
  const activeEmployeeCount = employees.filter((employee) => employee.is_active).length
  const archivedEmployeeCount = employees.length - activeEmployeeCount
  const filteredActiveCount = filteredEmployees.filter((employee) => employee.is_active).length
  const filteredArchivedCount = filteredEmployees.length - filteredActiveCount
  const coverageRegionCount = new Set(employees.filter((employee) => employee.region_id).map((employee) => employee.region_id)).size
  const coverageDepartmentCount = new Set(
    employees.filter((employee) => employee.department_id).map((employee) => employee.department_id),
  ).size
  const missingRegionCount = employees.filter((employee) => !employee.region_id).length
  const missingDepartmentCount = employees.filter((employee) => !employee.department_id).length

  const resetEmployeePagination = () => setEmployeeListPage(1)

  if (employeesQuery.isLoading || departmentsQuery.isLoading || regionsQuery.isLoading) {
    return <LoadingBlock />
  }

  if (employeesQuery.isError || departmentsQuery.isError || regionsQuery.isError) {
    return <ErrorBlock message="Çalışan verileri alınamadı." />
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Çalışanlar"
        description="Çalışan kadrosunu tek ekranda filtreleyin, eksik atamaları görün ve profil akışını hızla yönetin."
        action={
          <button
            type="button"
            onClick={() => setIsCreateOpen((prev) => !prev)}
            className="btn-primary rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            {isCreateOpen ? 'Formu Kapat' : 'Yeni Çalışan'}
          </button>
        }
      />

      <Panel className="border-slate-200/90 bg-[radial-gradient(circle_at_top_left,_rgba(15,118,110,0.10),_transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.96))]">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Toplam kadro</p>
            <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{employees.length}</p>
            <p className="mt-1 text-sm text-slate-600">{activeEmployeeCount} aktif, {archivedEmployeeCount} arşiv</p>
          </div>
          <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Filtre görünümü</p>
            <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{filteredEmployees.length}</p>
            <p className="mt-1 text-sm text-slate-600">{filteredActiveCount} aktif, {filteredArchivedCount} arşiv satırı</p>
          </div>
          <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Kapsam</p>
            <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{coverageRegionCount}</p>
            <p className="mt-1 text-sm text-slate-600">{coverageDepartmentCount} departman aktif görünüyor</p>
          </div>
          <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Atama açığı</p>
            <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{missingDepartmentCount}</p>
            <p className="mt-1 text-sm text-slate-600">{missingRegionCount} çalışanda bölge ataması eksik</p>
          </div>
        </div>
      </Panel>

      {isCreateOpen ? (
        <Panel>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 className="text-base font-semibold text-slate-900">Yeni çalışan oluştur</h4>
              <p className="mt-1 text-xs text-slate-500">
                Listeyi terk etmeden yeni kayıt açın; bölge ve departman seçimiyle daha temiz bir başlangıç yapın.
              </p>
            </div>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
              Hızlı kayıt
            </span>
          </div>
          <form onSubmit={onSubmit} className="mt-4 grid gap-3 md:grid-cols-5">
            <label className="text-sm text-slate-700 md:col-span-2">
              Ad Soyad
              <input
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5"
                placeholder="Ada Lovelace"
              />
            </label>

            <label className="text-sm text-slate-700">
              Bölge
              <select
                value={regionId}
                onChange={(event) => {
                  setRegionId(event.target.value)
                  setDepartmentId('')
                }}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5"
              >
                <option value="">Atanmamış</option>
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
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5"
              >
                <option value="">Atanmamış</option>
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
                Vazgeç
              </button>
            </div>
          </form>
          {error ? <div className="form-validation">{error}</div> : null}
        </Panel>
      ) : null}

      <Panel>
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="text-base font-semibold text-slate-900">Liste görünümü</h4>
            <p className="mt-1 text-xs text-slate-500">
              Filtreler, eksik atamalar ve arşiv görünümü tek akışta toplandı.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-slate-600">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">Sayfa {safeEmployeeListPage} / {employeeListTotalPages}</span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">{filteredEmployees.length} sonuç</span>
          </div>
        </div>

        <div className="mb-4 grid gap-3 md:grid-cols-5">
          <TableSearchInput
            value={searchTerm}
            onChange={(value) => {
              setSearchTerm(value)
              resetEmployeePagination()
            }}
            placeholder="Çalışan adına göre ara..."
          />
          <label className="text-sm text-slate-700">
            Bölge filtresi
            <select
              value={regionFilterId}
              onChange={(event) => {
                setRegionFilterId(event.target.value)
                setDepartmentFilterId('')
                resetEmployeePagination()
              }}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="">Tüm bölgeler</option>
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
              onChange={(event) => {
                setDepartmentFilterId(event.target.value)
                resetEmployeePagination()
              }}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="">Tüm departmanlar</option>
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
              onChange={(event) => {
                setShowInactive(event.target.checked)
                resetEmployeePagination()
              }}
            />
            Arşivdekileri göster
          </label>
        </div>

        <div className="mb-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Gösterim</p>
            <p className="mt-2 text-sm text-slate-700">
              Satır aralığı: {employeeListRangeStart}-{employeeListRangeEnd} / {filteredEmployees.length}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Atama açığı</p>
            <p className="mt-2 text-sm text-slate-700">
              {missingDepartmentCount} departman eksik, {missingRegionCount} bölge eksik
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              Sayfa başı
              <select
                value={employeeListPageSize}
                onChange={(event) => {
                  setEmployeeListPageSize(Number(event.target.value))
                  resetEmployeePagination()
                }}
                className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-800"
              >
                {EMPLOYEE_LIST_PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
          <p>
            Görünen aktif kayıt: {filteredActiveCount}
          </p>
          <p>Arşiv görünümü: {showInactive ? 'Açık' : 'Kapalı'}</p>
        </div>

        <div className="list-scroll-area w-full max-w-full overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2">Çalışan</th>
                <th className="py-2">Kapsam</th>
                <th className="py-2">Durum</th>
                <th className="py-2">Not</th>
                <th className="py-2">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {pagedEmployees.map((employee) => (
                <tr key={employee.id} className="border-t border-slate-100">
                  <td className="py-2">
                    <div className="min-w-[220px]">
                      <p className="font-semibold text-slate-900">{employee.full_name}</p>
                      <p className="text-xs text-slate-500">ID #{employee.id}</p>
                    </div>
                  </td>
                  <td className="py-2">
                    <div className="space-y-1 text-sm text-slate-600">
                      <p>Bölge: {employee.region_name ?? (employee.region_id ? regionById.get(employee.region_id) : '-') ?? 'Atanmamış'}</p>
                      <p>Departman: {employee.department_id ? departmentById.get(employee.department_id) : 'Atanmamış'}</p>
                    </div>
                  </td>
                  <td className="py-2">
                    <div className="space-y-2">
                      <StatusBadge value={employee.is_active ? 'Aktif' : 'Pasif'} />
                      <p className="text-xs text-slate-500">
                        {employee.region_id && employee.department_id ? 'Atama tamam' : 'Atama gözden geçirilmeli'}
                      </p>
                    </div>
                  </td>
                  <td className="py-2">
                    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${
                      employee.region_id && employee.department_id
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-amber-200 bg-amber-50 text-amber-700'
                    }`}>
                      {employee.region_id && employee.department_id ? 'Düzenli profil' : 'Eksik profil'}
                    </span>
                  </td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-2">
                      <Link
                        to={`/employees/${employee.id}`}
                        className="employee-action-btn employee-action-edit"
                      >
                        Düzenle
                      </Link>
                      <button
                        type="button"
                        disabled={toggleActiveMutation.isPending}
                        onClick={() => {
                          const nextStatus = !employee.is_active
                          const confirmed = window.confirm(
                            nextStatus
                              ? `${employee.full_name} arşivden çıkarılsın mı?`
                              : `${employee.full_name} arşivlensin mi?`,
                          )
                          if (!confirmed) {
                            return
                          }
                          toggleActiveMutation.mutate({
                            employeeId: employee.id,
                            nextStatus,
                          })
                        }}
                        className={`employee-action-btn ${
                          employee.is_active
                            ? 'employee-action-archive'
                            : 'employee-action-restore'
                        }`}
                      >
                        {employee.is_active ? 'Arşivle' : 'Arşivden Çıkar'}
                      </button>
                      {!employee.is_active ? (
                        <button
                          type="button"
                          disabled={deleteEmployeeMutation.isPending}
                          onClick={() => {
                            const confirmed = window.confirm(
                              `${employee.full_name} kalıcı olarak silinsin mi? Bu işlem bağlı cihaz ve eski kayıtları da veritabanından kaldırabilir.`,
                            )
                            if (!confirmed) {
                              return
                            }
                            deleteEmployeeMutation.mutate(employee.id)
                          }}
                          className="employee-action-btn employee-action-delete"
                        >
                          Kalıcı Sil
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs text-slate-500">
            Sayfa {safeEmployeeListPage} / {employeeListTotalPages}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setEmployeeListPage((prev) => Math.max(1, prev - 1))}
              disabled={safeEmployeeListPage <= 1}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              Önceki
            </button>
            <button
              type="button"
              onClick={() => setEmployeeListPage((prev) => Math.min(employeeListTotalPages, prev + 1))}
              disabled={safeEmployeeListPage >= employeeListTotalPages}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              Sonraki
            </button>
          </div>
        </div>

        {filteredEmployees.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Arama kriterine uygun çalışan bulunamadı.</p>
        ) : null}
      </Panel>
    </div>
  )
}
