import { EmployeeAutocompleteField } from '../EmployeeAutocompleteField'
import type { Department, Employee, Region } from '../../types/api'
import type { FilterFormState, SortField } from './types'
import { LIMIT_OPTIONS, SORT_OPTIONS } from './types'

export function ManagementConsoleFilters({
  filterForm,
  employees,
  regions,
  departments,
  activeFilterEntries,
  onChange,
  onApply,
  onReset,
}: {
  filterForm: FilterFormState
  employees: Employee[]
  regions: Region[]
  departments: Department[]
  activeFilterEntries: string[]
  onChange: (next: FilterFormState) => void
  onApply: () => void
  onReset: () => void
}) {
  return (
    <section className="mc-panel mc-panel--filters mc-panel--form-first">
      <div className="mc-panel__head mc-panel__head--tight">
        <div>
          <p className="mc-kicker">FILTRE MERKEZI</p>
          <h3 className="mc-panel__title">Analiz kapsami ve gorunum davranisi</h3>
        </div>
        <div className="mc-meta">
          <span>{activeFilterEntries.length} aktif filtre</span>
          <span>Form oncelikli gorunum</span>
        </div>
      </div>

      <div className="mc-filter-stack">
        <div className="mc-filter-grid mc-filter-grid--primary">
          <EmployeeAutocompleteField
            className="mc-field"
            label="Personel sec"
            employees={employees}
            value={filterForm.employee_id}
            onChange={(value) =>
              onChange({
                ...filterForm,
                employee_id: value,
                q: value ? '' : filterForm.q,
              })
            }
            placeholder="Ad soyad veya #ID ile sec"
            emptyLabel="Tum personeller"
            helperText="Secili personel overview sorgusunu ID bazli daraltir."
            labelClassName="grid gap-[0.45rem] text-sm text-[var(--mc-text)]"
            labelTextClassName="text-[0.78rem] font-bold uppercase tracking-[0.08em] text-[var(--mc-text-soft)]"
            inputClassName="w-full rounded-[14px] border border-[var(--mc-border-strong)] bg-white px-3 py-2.5 text-sm text-[var(--mc-text)]"
            clearButtonClassName="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            menuClassName="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-lg"
            optionClassName="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
            emptyOptionClassName="flex w-full items-center justify-between border-b border-slate-100 px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-50"
            helperTextClassName="text-xs text-slate-500"
          />
          <label className="mc-field">
            <span>Arama / ID</span>
            <input
              value={filterForm.q}
              onChange={(event) =>
                onChange({
                  ...filterForm,
                  q: event.target.value,
                  employee_id: event.target.value.trim() ? '' : filterForm.employee_id,
                })
              }
              placeholder="Ad, soyad veya serbest arama"
            />
          </label>
          <label className="mc-field">
            <span>Bolge</span>
            <select
              value={filterForm.region_id}
              onChange={(event) => onChange({ ...filterForm, region_id: event.target.value })}
            >
              <option value="">Tum bolgeler</option>
              {regions.map((region) => (
                <option key={region.id} value={region.id}>
                  {region.name}
                </option>
              ))}
            </select>
          </label>
          <label className="mc-field">
            <span>Departman</span>
            <select
              value={filterForm.department_id}
              onChange={(event) => onChange({ ...filterForm, department_id: event.target.value })}
            >
              <option value="">Tum departmanlar</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>
          <label className="mc-field">
            <span>Baslangic</span>
            <input
              type="date"
              value={filterForm.start_date}
              onChange={(event) => onChange({ ...filterForm, start_date: event.target.value })}
            />
          </label>
          <label className="mc-field">
            <span>Bitis</span>
            <input
              type="date"
              value={filterForm.end_date}
              min={filterForm.start_date || undefined}
              onChange={(event) => onChange({ ...filterForm, end_date: event.target.value })}
            />
          </label>
        </div>

        <div className="mc-filter-grid mc-filter-grid--secondary">
          <label className="mc-field">
            <span>Risk alt sinir</span>
            <input
              type="number"
              min={0}
              max={100}
              value={filterForm.risk_min}
              onChange={(event) => onChange({ ...filterForm, risk_min: event.target.value })}
              placeholder="0"
            />
          </label>
          <label className="mc-field">
            <span>Risk ust sinir</span>
            <input
              type="number"
              min={0}
              max={100}
              value={filterForm.risk_max}
              onChange={(event) => onChange({ ...filterForm, risk_max: event.target.value })}
              placeholder="100"
            />
          </label>
          <label className="mc-field">
            <span>Risk seviyesi</span>
            <select
              value={filterForm.risk_status}
              onChange={(event) =>
                onChange({
                  ...filterForm,
                  risk_status: event.target.value as FilterFormState['risk_status'],
                })
              }
            >
              <option value="">Tum seviyeler</option>
              <option value="NORMAL">Normal</option>
              <option value="WATCH">Izlemeli</option>
              <option value="CRITICAL">Kritik</option>
            </select>
          </label>
          <label className="mc-field">
            <span>Siralama</span>
            <select
              value={filterForm.sort_by}
              onChange={(event) => onChange({ ...filterForm, sort_by: event.target.value as SortField })}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="mc-field">
            <span>Yon</span>
            <select
              value={filterForm.sort_dir}
              onChange={(event) =>
                onChange({
                  ...filterForm,
                  sort_dir: event.target.value as FilterFormState['sort_dir'],
                })
              }
            >
              <option value="desc">Azalan</option>
              <option value="asc">Artan</option>
            </select>
          </label>
          <label className="mc-field">
            <span>Sayfa limiti</span>
            <select
              value={filterForm.limit}
              onChange={(event) => onChange({ ...filterForm, limit: Number(event.target.value) })}
            >
              {LIMIT_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="mc-filter-footer">
        <label className="mc-check">
          <input
            type="checkbox"
            checked={filterForm.include_inactive}
            onChange={(event) => onChange({ ...filterForm, include_inactive: event.target.checked })}
          />
          <span>Pasif personeli dahil et</span>
        </label>
        <div className="mc-filter-footer__actions">
          <button type="button" className="mc-button mc-button--ghost" onClick={onReset}>
            Sifirla
          </button>
          <button type="button" className="mc-button mc-button--primary" onClick={onApply}>
            Uygula
          </button>
        </div>
      </div>

      {activeFilterEntries.length ? (
        <div className="mc-chip-row" aria-label="Aktif filtreler">
          {activeFilterEntries.map((entry) => (
            <span key={entry} className="mc-chip">
              {entry}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  )
}
