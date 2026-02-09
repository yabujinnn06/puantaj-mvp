import { Fragment, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { getEmployeeDeviceOverview, getEmployees, getRegions, updateDeviceActive } from '../api/admin'
import { parseApiError } from '../api/error'
import { EmployeeAutocompleteField } from '../components/EmployeeAutocompleteField'
import { ErrorBlock } from '../components/ErrorBlock'
import { LoadingBlock } from '../components/LoadingBlock'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'
import { StatusBadge } from '../components/StatusBadge'
import { useToast } from '../hooks/useToast'

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-'
  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function DevicesPage() {
  const queryClient = useQueryClient()
  const { pushToast } = useToast()

  const [selectedEmployeeId, setSelectedEmployeeId] = useState('')
  const [regionFilterId, setRegionFilterId] = useState('')
  const [includeInactiveEmployees, setIncludeInactiveEmployees] = useState(true)
  const [searchText, setSearchText] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [expandedEmployeeId, setExpandedEmployeeId] = useState<number | null>(null)

  const employeeId = selectedEmployeeId ? Number(selectedEmployeeId) : undefined
  const offset = employeeId ? 0 : (page - 1) * pageSize

  const summaryQuery = useQuery({
    queryKey: [
      'employee-device-overview-summary',
      employeeId ?? null,
      regionFilterId,
      includeInactiveEmployees,
      searchText,
      page,
      pageSize,
    ],
    queryFn: () =>
      getEmployeeDeviceOverview({
        employee_id: employeeId,
        region_id: regionFilterId ? Number(regionFilterId) : undefined,
        include_inactive: includeInactiveEmployees,
        q: searchText.trim() || undefined,
        offset,
        limit: employeeId ? 1 : pageSize,
        device_limit: 1,
      }),
  })

  const detailQuery = useQuery({
    queryKey: ['employee-device-overview-detail', expandedEmployeeId],
    enabled: expandedEmployeeId !== null,
    queryFn: () =>
      getEmployeeDeviceOverview({
        employee_id: expandedEmployeeId ?? undefined,
        include_inactive: true,
        offset: 0,
        limit: 1,
        device_limit: 100,
      }),
  })

  const employeesQuery = useQuery({
    queryKey: ['employees', 'all-for-devices'],
    queryFn: () => getEmployees({ include_inactive: true, status: 'all' }),
  })
  const regionsQuery = useQuery({
    queryKey: ['regions', 'devices-page'],
    queryFn: () => getRegions({ include_inactive: true }),
  })

  const toggleDeviceMutation = useMutation({
    mutationFn: ({ deviceId, isActive }: { deviceId: number; isActive: boolean }) =>
      updateDeviceActive(deviceId, { is_active: isActive }),
    onSuccess: (updatedDevice) => {
      pushToast({
        variant: 'success',
        title: updatedDevice.is_active ? 'Cihaz aktif edildi' : 'Cihaz pasife alındı',
        description: `Cihaz #${updatedDevice.id} durumu güncellendi.`,
      })
      void queryClient.invalidateQueries({ queryKey: ['employee-device-overview-summary'] })
      void queryClient.invalidateQueries({ queryKey: ['employee-device-overview-detail'] })
    },
    onError: (error) => {
      pushToast({
        variant: 'error',
        title: 'Cihaz durumu güncellenemedi',
        description: parseApiError(error, 'İşlem başarısız.').message,
      })
    },
  })

  const employees = employeesQuery.data ?? []
  const regions = regionsQuery.data ?? []
  const summaryRows = summaryQuery.data ?? []
  const detailRow = detailQuery.data?.[0]

  const canGoNext = !employeeId && summaryRows.length === pageSize
  const canGoPrev = !employeeId && page > 1

  if (summaryQuery.isLoading || employeesQuery.isLoading || regionsQuery.isLoading) {
    return <LoadingBlock />
  }

  if (summaryQuery.isError) {
    return <ErrorBlock message={parseApiError(summaryQuery.error, 'Cihaz verisi alınamadı.').message} />
  }

  if (employeesQuery.isError) {
    return <ErrorBlock message={parseApiError(employeesQuery.error, 'Çalışan listesi alınamadı.').message} />
  }
  if (regionsQuery.isError) {
    return <ErrorBlock message={parseApiError(regionsQuery.error, 'Bolge listesi alinamadi.').message} />
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Cihazlar ve Token Takibi"
        description="Yoğun kullanım için optimize edilmiş liste görünümü. Satırdan detay açıp cihazları yönetin."
      />

      <Panel>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5 md:items-end">
          <EmployeeAutocompleteField
            label="Çalışan filtresi"
            employees={employees}
            value={selectedEmployeeId}
            onChange={(value) => {
              setSelectedEmployeeId(value)
              setPage(1)
              setExpandedEmployeeId(null)
            }}
            emptyLabel="Tümü"
            helperText="Ad-soyad veya ID ile filtreleyin."
          />
          <label className="text-sm text-slate-700">
            Özet arama
            <input
              type="text"
              value={searchText}
              onChange={(event) => {
                setSearchText(event.target.value)
                setPage(1)
                setExpandedEmployeeId(null)
              }}
              placeholder="Çalışan adı veya ID"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="text-sm text-slate-700">
            Sayfa boyutu
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value))
                setPage(1)
                setExpandedEmployeeId(null)
              }}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </label>
          <label className="text-sm text-slate-700">
            Bolge filtresi
            <select
              value={regionFilterId}
              onChange={(event) => {
                setRegionFilterId(event.target.value)
                setPage(1)
                setExpandedEmployeeId(null)
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
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={includeInactiveEmployees}
              onChange={(event) => {
                setIncludeInactiveEmployees(event.target.checked)
                setPage(1)
                setExpandedEmployeeId(null)
              }}
            />
            Pasif çalışanları göster
          </label>
        </div>

        {!employeeId ? (
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={!canGoPrev}
              onClick={() => {
                setPage((prev) => Math.max(1, prev - 1))
                setExpandedEmployeeId(null)
              }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Önceki
            </button>
            <span className="text-xs text-slate-500">Sayfa {page}</span>
            <button
              type="button"
              disabled={!canGoNext}
              onClick={() => {
                setPage((prev) => prev + 1)
                setExpandedEmployeeId(null)
              }}
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Sonraki
            </button>
          </div>
        ) : null}
      </Panel>

      <Panel>
        <div className="max-h-[68vh] overflow-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="sticky top-0 z-10 bg-white text-xs uppercase text-slate-500">
              <tr>
                <th className="px-2 py-2">Çalışan</th>
                <th className="px-2 py-2">Departman</th>
                <th className="px-2 py-2">Durum</th>
                <th className="px-2 py-2">Cihaz</th>
                <th className="px-2 py-2">Token</th>
                <th className="px-2 py-2 text-right">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {summaryRows.map((row) => {
                const isExpanded = expandedEmployeeId === row.employee_id
                return (
                  <Fragment key={row.employee_id}>
                    <tr className="border-t border-slate-100 align-top hover:bg-slate-50/60">
                      <td className="px-2 py-2">
                        <div className="font-medium text-slate-900">#{row.employee_id} - {row.employee_name}</div>
                      </td>
                      <td className="px-2 py-2 text-xs text-slate-600">
                        {row.department_name ?? row.department_id ?? '-'}
                      </td>
                      <td className="px-2 py-2">
                        <StatusBadge value={row.is_employee_active ? 'Aktif' : 'Pasif'} />
                      </td>
                      <td className="px-2 py-2 text-xs text-slate-700">
                        <span className="font-semibold">{row.active_devices}</span> aktif / {row.total_devices} toplam
                      </td>
                      <td className="px-2 py-2 text-xs text-slate-700">
                        K:{row.token_used} B:{row.token_pending} D:{row.token_expired} T:{row.token_total}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setExpandedEmployeeId((prev) => (prev === row.employee_id ? null : row.employee_id))
                          }}
                          className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          {isExpanded ? 'Kapat' : 'Cihazları Yönet'}
                        </button>
                      </td>
                    </tr>

                    {isExpanded ? (
                      <tr className="border-t border-slate-100 bg-slate-50/70">
                        <td colSpan={6} className="px-2 py-3">
                          {detailQuery.isLoading ? (
                            <p className="text-xs text-slate-500">Cihaz listesi yükleniyor...</p>
                          ) : detailQuery.isError ? (
                            <p className="text-xs text-rose-700">Cihaz detayları alınamadı.</p>
                          ) : detailRow ? (
                            <div className="overflow-x-auto">
                              <table className="min-w-full text-left text-xs">
                                <thead className="uppercase text-slate-500">
                                  <tr>
                                    <th className="py-2">Cihaz ID</th>
                                    <th className="py-2">Durum</th>
                                    <th className="py-2">Fingerprint</th>
                                    <th className="py-2">Oluşturulma</th>
                                    <th className="py-2 text-right">İşlem</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {detailRow.devices.map((device) => (
                                    <tr key={device.id} className="border-t border-slate-100">
                                      <td className="py-2">{device.id}</td>
                                      <td className="py-2">
                                        <StatusBadge value={device.is_active ? 'Aktif' : 'Pasif'} />
                                      </td>
                                      <td className="py-2 font-mono">{device.device_fingerprint}</td>
                                      <td className="py-2">{formatDateTime(device.created_at)}</td>
                                      <td className="py-2 text-right">
                                        <button
                                          type="button"
                                          disabled={toggleDeviceMutation.isPending}
                                          onClick={() =>
                                            toggleDeviceMutation.mutate({
                                              deviceId: device.id,
                                              isActive: !device.is_active,
                                            })
                                          }
                                          className={`rounded-lg px-2 py-1 text-[11px] font-semibold text-white ${
                                            device.is_active
                                              ? 'bg-rose-600 hover:bg-rose-700'
                                              : 'bg-emerald-600 hover:bg-emerald-700'
                                          } disabled:cursor-not-allowed disabled:opacity-60`}
                                        >
                                          {device.is_active ? 'Pasife Al' : 'Aktif Et'}
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              {detailRow.has_more_devices ? (
                                <p className="mt-2 text-xs text-slate-500">
                                  Bu çalışan için daha fazla cihaz var. İlk 100 cihaz gösteriliyor.
                                </p>
                              ) : null}
                              {detailRow.devices.length === 0 ? (
                                <p className="mt-2 text-xs text-slate-500">Bu çalışana bağlı cihaz yok.</p>
                              ) : null}
                            </div>
                          ) : (
                            <p className="text-xs text-slate-500">Cihaz detayı bulunamadı.</p>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>

        {summaryRows.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Seçilen filtreye uygun çalışan veya cihaz kaydı yok.</p>
        ) : null}
      </Panel>
    </div>
  )
}
