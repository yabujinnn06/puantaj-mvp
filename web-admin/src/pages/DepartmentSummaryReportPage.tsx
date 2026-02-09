import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import {
  downloadAllMonthlyExport,
  downloadDepartmentMonthlyExport,
  getDepartmentSummary,
  getDepartments,
} from '../api/admin'
import { parseApiError } from '../api/error'
import { ErrorBlock } from '../components/ErrorBlock'
import { LoadingBlock } from '../components/LoadingBlock'
import { MinuteDisplay } from '../components/MinuteDisplay'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'
import { useToast } from '../hooks/useToast'

interface SummaryFilters {
  year: string
  month: string
  departmentId: string
  includeInactive: boolean
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = window.URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.URL.revokeObjectURL(url)
}

export function DepartmentSummaryReportPage() {
  const now = new Date()
  const { pushToast } = useToast()

  const defaultFilters: SummaryFilters = {
    year: String(now.getFullYear()),
    month: String(now.getMonth() + 1),
    departmentId: '',
    includeInactive: false,
  }

  const [draftFilters, setDraftFilters] = useState<SummaryFilters>(defaultFilters)
  const [appliedFilters, setAppliedFilters] = useState<SummaryFilters>(defaultFilters)
  const [isDownloading, setIsDownloading] = useState(false)

  const departmentsQuery = useQuery({ queryKey: ['departments'], queryFn: getDepartments })

  const parsedYear = Number(appliedFilters.year)
  const parsedMonth = Number(appliedFilters.month)
  const parsedDepartmentId = Number(appliedFilters.departmentId)

  const queryEnabled =
    Number.isFinite(parsedYear) &&
    parsedYear > 0 &&
    Number.isFinite(parsedMonth) &&
    parsedMonth >= 1 &&
    parsedMonth <= 12

  const summaryQuery = useQuery({
    queryKey: [
      'department-summary',
      parsedYear,
      parsedMonth,
      appliedFilters.departmentId || 'all',
      appliedFilters.includeInactive ? 'with-inactive' : 'active-only',
    ],
    queryFn: () =>
      getDepartmentSummary({
        year: parsedYear,
        month: parsedMonth,
        department_id:
          Number.isFinite(parsedDepartmentId) && parsedDepartmentId > 0 ? parsedDepartmentId : undefined,
        include_inactive: appliedFilters.includeInactive,
      }),
    enabled: queryEnabled,
  })

  const summaryRows = summaryQuery.data ?? []
  const totals = useMemo(() => {
    return summaryRows.reduce(
      (acc, item) => {
        acc.worked += item.worked_minutes
        acc.overtime += item.overtime_minutes
        acc.employeeCount += item.employee_count
        return acc
      },
      { worked: 0, overtime: 0, employeeCount: 0 },
    )
  }, [summaryRows])

  const activeFilterLabels = useMemo(() => {
    const labels = [`Yıl: ${appliedFilters.year}`, `Ay: ${appliedFilters.month}`]
    if (appliedFilters.departmentId) {
      const department = departmentsQuery.data?.find(
        (item) => item.id === Number(appliedFilters.departmentId),
      )
      labels.push(`Departman: ${department?.name ?? appliedFilters.departmentId}`)
    }
    if (appliedFilters.includeInactive) {
      labels.push('Arşivdekiler dahil')
    }
    return labels
  }, [appliedFilters, departmentsQuery.data])

  const applyFilters = () => setAppliedFilters({ ...draftFilters })
  const clearFilters = () => {
    setDraftFilters(defaultFilters)
    setAppliedFilters(defaultFilters)
  }

  const handleDownloadExcel = async () => {
    if (!queryEnabled) {
      pushToast({
        variant: 'error',
        title: 'Filtre hatası',
        description: 'Excel indirmek için geçerli yıl ve ay seçin.',
      })
      return
    }

    try {
      setIsDownloading(true)
      const blob =
        Number.isFinite(parsedDepartmentId) && parsedDepartmentId > 0
          ? await downloadDepartmentMonthlyExport({
              department_id: parsedDepartmentId,
              year: parsedYear,
              month: parsedMonth,
              include_inactive: appliedFilters.includeInactive,
            })
          : await downloadAllMonthlyExport({
              year: parsedYear,
              month: parsedMonth,
              include_inactive: appliedFilters.includeInactive,
            })

      const suffix =
        Number.isFinite(parsedDepartmentId) && parsedDepartmentId > 0
          ? `department-${parsedDepartmentId}`
          : 'all'
      downloadBlob(
        blob,
        `puantaj-${suffix}-${parsedYear}-${String(parsedMonth).padStart(2, '0')}.xlsx`,
      )
    } catch (error) {
      pushToast({
        variant: 'error',
        title: 'Excel indirilemedi',
        description: parseApiError(error, 'Dosya oluşturulamadı.').message,
      })
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Departman Aylık Özeti"
        description="Departman bazında aylık toplam çalışma ve fazla mesai değerlerini karşılaştırın."
        action={
          <button
            type="button"
            onClick={() => void handleDownloadExcel()}
            disabled={isDownloading}
            className="btn-secondary rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            {isDownloading ? (
              <>
                <span className="inline-spinner inline-spinner-dark" aria-hidden="true" />
                Hazırlanıyor...
              </>
            ) : (
              'Excel İndir'
            )}
          </button>
        }
      />

      <Panel>
        <h4 className="text-base font-semibold text-slate-900">Filtreler</h4>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <label className="text-sm text-slate-700">
            Yıl
            <input
              type="number"
              value={draftFilters.year}
              onChange={(event) =>
                setDraftFilters((prev) => ({ ...prev, year: event.target.value }))
              }
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="text-sm text-slate-700">
            Ay
            <input
              type="number"
              value={draftFilters.month}
              onChange={(event) =>
                setDraftFilters((prev) => ({ ...prev, month: event.target.value }))
              }
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="text-sm text-slate-700 md:col-span-2">
            Departman
            <select
              value={draftFilters.departmentId}
              onChange={(event) =>
                setDraftFilters((prev) => ({ ...prev, departmentId: event.target.value }))
              }
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              disabled={departmentsQuery.isLoading}
            >
              <option value="">Tümü</option>
              {(departmentsQuery.data ?? []).map((department) => (
                <option key={department.id} value={department.id}>
                  #{department.id} - {department.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="mt-3 inline-flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={draftFilters.includeInactive}
            onChange={(event) =>
              setDraftFilters((prev) => ({ ...prev, includeInactive: event.target.checked }))
            }
          />
          Arşivdeki çalışanları dahil et
        </label>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={applyFilters}
            className="btn-primary rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Uygula
          </button>
          <button
            type="button"
            onClick={clearFilters}
            className="btn-secondary rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Temizle
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {activeFilterLabels.map((label) => (
            <span
              key={label}
              className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700"
            >
              {label}
            </span>
          ))}
        </div>
      </Panel>

      {!queryEnabled ? <ErrorBlock message="Yıl ve ay değerleri geçersiz." /> : null}
      {summaryQuery.isLoading ? <LoadingBlock /> : null}
      {summaryQuery.isError ? (
        <ErrorBlock message={parseApiError(summaryQuery.error, 'Departman özeti alınamadı.').message} />
      ) : null}

      {!summaryQuery.isLoading && !summaryQuery.isError ? (
        <>
          <Panel>
            <h4 className="text-base font-semibold text-slate-900">Toplamlar</h4>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs text-slate-500">Toplam Çalışma</p>
                <p className="text-lg font-semibold">
                  <MinuteDisplay minutes={totals.worked} />
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs text-slate-500">Toplam Fazla Mesai</p>
                <p className="text-lg font-semibold">
                  <MinuteDisplay minutes={totals.overtime} />
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs text-slate-500">Toplam Çalışan Sayısı</p>
                <p className="text-lg font-semibold">{totals.employeeCount}</p>
              </div>
            </div>
          </Panel>

          {summaryRows.length === 0 ? (
            <Panel>
              <p className="text-sm text-slate-600">Seçilen filtrede departman özeti bulunamadı.</p>
            </Panel>
          ) : (
            <Panel>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs uppercase text-slate-500">
                    <tr>
                      <th className="py-2">Departman</th>
                      <th className="py-2">Çalışan Sayısı</th>
                      <th className="py-2">Toplam Çalışma</th>
                      <th className="py-2">Toplam Fazla Mesai</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summaryRows.map((item) => (
                      <tr key={item.department_id} className="border-t border-slate-100">
                        <td className="py-2">
                          #{item.department_id} - {item.department_name}
                        </td>
                        <td className="py-2">{item.employee_count}</td>
                        <td className="py-2">
                          <MinuteDisplay minutes={item.worked_minutes} />
                        </td>
                        <td className="py-2">
                          <MinuteDisplay minutes={item.overtime_minutes} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </>
      ) : null}
    </div>
  )
}
