import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'

import {
  downloadPuantajExport,
  downloadPuantajRangeExport,
  getDepartments,
  getEmployees,
  getRegions,
  type PuantajExportParams,
  type PuantajRangeExportParams,
} from '../api/admin'
import { parseApiError } from '../api/error'
import { EmployeeAutocompleteField } from '../components/EmployeeAutocompleteField'
import { ErrorBlock } from '../components/ErrorBlock'
import { LoadingBlock } from '../components/LoadingBlock'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'
import { useToast } from '../hooks/useToast'

type ExportMode = 'employee' | 'department' | 'all' | 'date_range'
type RangeMode = 'consolidated' | 'employee_sheets' | 'department_sheets'

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function PuantajExportPage() {
  const { pushToast } = useToast()
  const now = new Date()

  const [mode, setMode] = useState<ExportMode>('employee')
  const [employeeId, setEmployeeId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [regionId, setRegionId] = useState('')
  const [year, setYear] = useState(String(now.getFullYear()))
  const [month, setMonth] = useState(String(now.getMonth() + 1))
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [includeDailySheet, setIncludeDailySheet] = useState(true)
  const [includeInactive, setIncludeInactive] = useState(false)

  const [rangeStartDate, setRangeStartDate] = useState('')
  const [rangeEndDate, setRangeEndDate] = useState('')
  const [rangeMode, setRangeMode] = useState<RangeMode>('consolidated')
  const [rangeDepartmentId, setRangeDepartmentId] = useState('')
  const [rangeRegionId, setRangeRegionId] = useState('')
  const [rangeEmployeeId, setRangeEmployeeId] = useState('')

  const employeesQuery = useQuery({
    queryKey: ['employees', 'all'],
    queryFn: () => getEmployees({ status: 'all', include_inactive: true }),
  })
  const departmentsQuery = useQuery({ queryKey: ['departments'], queryFn: getDepartments })
  const regionsQuery = useQuery({
    queryKey: ['regions', 'all', 'for-export'],
    queryFn: () => getRegions({ include_inactive: true }),
  })

  const exportMutation = useMutation({
    mutationFn: downloadPuantajExport,
    onSuccess: (blob) => {
      downloadBlob(blob, `puantaj-${mode}-${Date.now()}.xlsx`)
      pushToast({
        variant: 'success',
        title: 'Excel indirildi',
        description: 'Puantaj Excel dosyası başarıyla indirildi.',
      })
    },
    onError: (error) => {
      pushToast({
        variant: 'error',
        title: 'Dışa aktarma başarısız',
        description: parseApiError(error, 'Excel dosyası üretilemedi.').message,
      })
    },
  })

  const rangeExportMutation = useMutation({
    mutationFn: downloadPuantajRangeExport,
    onSuccess: (blob) => {
      downloadBlob(blob, `puantaj-range-${rangeMode}-${Date.now()}.xlsx`)
      pushToast({
        variant: 'success',
        title: 'Aralıklı Excel indirildi',
        description: 'Tarih aralığı dışa aktarma dosyası indirildi.',
      })
    },
    onError: (error) => {
      pushToast({
        variant: 'error',
        title: 'Tarih aralığı dışa aktarma başarısız',
        description: parseApiError(error, 'Excel dosyası üretilemedi.').message,
      })
    },
  })

  const filters = useMemo<PuantajExportParams | null>(() => {
    const parsedYear = Number(year)
    const parsedMonth = Number(month)
    const parsedEmployeeId = Number(employeeId)
    const parsedDepartmentId = Number(departmentId)
    const parsedRegionId = Number(regionId)

    if (mode === 'employee') {
      if (!parsedEmployeeId || !parsedYear || !parsedMonth) return null
      return {
        mode,
        employee_id: parsedEmployeeId,
        year: parsedYear,
        month: parsedMonth,
      }
    }

    if (mode === 'department') {
      if (!parsedDepartmentId || !parsedYear || !parsedMonth) return null
      return {
        mode,
        department_id: parsedDepartmentId,
        year: parsedYear,
        month: parsedMonth,
        include_daily_sheet: includeDailySheet,
        include_inactive: includeInactive,
      }
    }

    if (mode === 'all') {
      if (!parsedYear || !parsedMonth) return null
      return {
        mode,
        year: parsedYear,
        month: parsedMonth,
        region_id: parsedRegionId || undefined,
        include_daily_sheet: includeDailySheet,
        include_inactive: includeInactive,
      }
    }

    if (!startDate || !endDate) return null
    return {
      mode,
      start_date: startDate,
      end_date: endDate,
      employee_id: parsedEmployeeId || undefined,
      department_id: parsedDepartmentId || undefined,
      region_id: parsedRegionId || undefined,
      include_inactive: includeInactive,
    }
  }, [
    mode,
    employeeId,
    departmentId,
    regionId,
    year,
    month,
    startDate,
    endDate,
    includeDailySheet,
    includeInactive,
  ])

  const rangeFilters = useMemo<PuantajRangeExportParams | null>(() => {
    const parsedEmployeeId = Number(rangeEmployeeId)
    const parsedDepartmentId = Number(rangeDepartmentId)
    const parsedRegionId = Number(rangeRegionId)
    if (!rangeStartDate || !rangeEndDate) return null
    return {
      start_date: rangeStartDate,
      end_date: rangeEndDate,
      mode: rangeMode,
      employee_id: parsedEmployeeId > 0 ? parsedEmployeeId : undefined,
      department_id: parsedDepartmentId > 0 ? parsedDepartmentId : undefined,
      region_id: parsedRegionId > 0 ? parsedRegionId : undefined,
    }
  }, [rangeStartDate, rangeEndDate, rangeMode, rangeEmployeeId, rangeDepartmentId, rangeRegionId])

  const onDownload = () => {
    if (!filters) {
      pushToast({
        variant: 'error',
        title: 'Eksik filtre',
        description: 'Seçtiğiniz dışa aktarma tipine göre gerekli alanları doldurun.',
      })
      return
    }
    exportMutation.mutate(filters)
  }

  const onRangeDownload = () => {
    if (!rangeFilters) {
      pushToast({
        variant: 'error',
        title: 'Eksik tarih aralığı filtresi',
        description: 'Başlangıç, bitiş ve gerekli filtreleri doldurun.',
      })
      return
    }
    rangeExportMutation.mutate(rangeFilters)
  }

  if (employeesQuery.isLoading || departmentsQuery.isLoading || regionsQuery.isLoading) {
    return <LoadingBlock />
  }

  if (employeesQuery.isError || departmentsQuery.isError || regionsQuery.isError) {
    return <ErrorBlock message="Çalışan/departman/bölge bilgileri alınamadı." />
  }

  const employees = employeesQuery.data ?? []
  const departments = departmentsQuery.data ?? []
  const regions = regionsQuery.data ?? []
  const activeRegionId = regionId ? Number(regionId) : null
  const activeRangeRegionId = rangeRegionId ? Number(rangeRegionId) : null
  const filteredDepartments =
    activeRegionId && Number.isFinite(activeRegionId)
      ? departments.filter((department) => department.region_id === activeRegionId)
      : departments
  const filteredRangeDepartments =
    activeRangeRegionId && Number.isFinite(activeRangeRegionId)
      ? departments.filter((department) => department.region_id === activeRangeRegionId)
      : departments

  return (
    <div className="space-y-4">
      <PageHeader
        title="Puantaj Excel Dışa Aktar"
        description="Mevcut endpoint veya tarih aralığı endpointi ile Excel dışa aktarımı yapın."
      />

      <Panel>
        <h4 className="text-base font-semibold text-slate-900">Mevcut Export Endpointi</h4>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <label className="text-sm text-slate-700">
            Dışa aktarma tipi
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as ExportMode)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="employee">Çalışan Bazlı</option>
              <option value="department">Departman Bazlı</option>
              <option value="all">Tüm Çalışanlar (Aylık)</option>
              <option value="date_range">Tarih Aralığı (Mevcut)</option>
            </select>
          </label>

          {(mode === 'employee' || mode === 'date_range') && (
            <EmployeeAutocompleteField
              label="Çalışan"
              employees={employees}
              value={employeeId}
              onChange={setEmployeeId}
              emptyLabel="Seçiniz"
              helperText="Ad-soyad veya ID ile arayın."
            />
          )}

          {(mode === 'department' || mode === 'date_range') && (
            <label className="text-sm text-slate-700">
              Departman
              <select
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                <option value="">Seçiniz</option>
                {filteredDepartments.map((department) => (
                  <option key={department.id} value={department.id}>
                    #{department.id} - {department.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {(mode === 'all' || mode === 'date_range') && (
            <label className="text-sm text-slate-700">
              Bölge (opsiyonel)
              <select
                value={regionId}
                onChange={(e) => {
                  setRegionId(e.target.value)
                  setDepartmentId('')
                }}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                <option value="">Tümü</option>
                {regions.map((region) => (
                  <option key={region.id} value={region.id}>
                    #{region.id} - {region.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {(mode === 'employee' || mode === 'department' || mode === 'all') && (
            <>
              <label className="text-sm text-slate-700">
                Yıl
                <input
                  type="number"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="text-sm text-slate-700">
                Ay
                <input
                  type="number"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
            </>
          )}

          {mode === 'date_range' && (
            <>
              <label className="text-sm text-slate-700">
                Başlangıç Tarihi
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="text-sm text-slate-700">
                Bitiş Tarihi
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
            </>
          )}
        </div>

        {(mode === 'department' || mode === 'all') && (
          <label className="mt-3 inline-flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={includeDailySheet}
              onChange={(e) => setIncludeDailySheet(e.target.checked)}
            />
            Günlük sheetleri de ekle
          </label>
        )}

        <label className="mt-3 inline-flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(event) => setIncludeInactive(event.target.checked)}
          />
          Arşivdeki çalışanları dahil et
        </label>

        <div className="mt-4">
          <button
            type="button"
            onClick={onDownload}
            disabled={exportMutation.isPending}
            className="btn-primary rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {exportMutation.isPending ? (
              <>
                <span className="inline-spinner" aria-hidden="true" />
                Hazırlanıyor...
              </>
            ) : (
              'Excel İndir'
            )}
          </button>
        </div>
      </Panel>

      <Panel>
        <h4 className="text-base font-semibold text-slate-900">Tarih Aralığı (Yeni Endpoint)</h4>
        <p className="mt-1 text-xs text-slate-500">
          Endpoint: <code>/api/admin/export/puantaj-range.xlsx</code>
        </p>

        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <label className="text-sm text-slate-700">
            Başlangıç Tarihi
            <input
              type="date"
              value={rangeStartDate}
              onChange={(e) => setRangeStartDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="text-sm text-slate-700">
            Bitiş Tarihi
            <input
              type="date"
              value={rangeEndDate}
              onChange={(e) => setRangeEndDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="text-sm text-slate-700">
            Sheet modu
            <select
              value={rangeMode}
              onChange={(e) => setRangeMode(e.target.value as RangeMode)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="consolidated">Tek Konsolide Sheet</option>
              <option value="employee_sheets">Çalışan Bazlı Sheet</option>
              <option value="department_sheets">Departman Bazlı Sheet</option>
            </select>
          </label>

          <label className="text-sm text-slate-700">
            Departman (opsiyonel)
            <select
              value={rangeDepartmentId}
              onChange={(e) => setRangeDepartmentId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="">Tümü</option>
              {filteredRangeDepartments.map((department) => (
                <option key={department.id} value={department.id}>
                  #{department.id} - {department.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm text-slate-700">
            Bölge (opsiyonel)
            <select
              value={rangeRegionId}
              onChange={(e) => {
                setRangeRegionId(e.target.value)
                setRangeDepartmentId('')
              }}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="">Tümü</option>
              {regions.map((region) => (
                <option key={region.id} value={region.id}>
                  #{region.id} - {region.name}
                </option>
              ))}
            </select>
          </label>

          <EmployeeAutocompleteField
            label="Çalışan (opsiyonel)"
            employees={employees}
            value={rangeEmployeeId}
            onChange={setRangeEmployeeId}
            emptyLabel="Tümü"
            helperText="İsteğe bağlı çalışan filtresi."
            className="md:col-span-2"
          />
        </div>

        <div className="mt-4">
          <button
            type="button"
            onClick={onRangeDownload}
            disabled={rangeExportMutation.isPending}
            className="btn-primary rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {rangeExportMutation.isPending ? (
              <>
                <span className="inline-spinner" aria-hidden="true" />
                Hazırlanıyor...
              </>
            ) : (
              'Tarih Aralığı Excel İndir'
            )}
          </button>
        </div>
      </Panel>
    </div>
  )
}
