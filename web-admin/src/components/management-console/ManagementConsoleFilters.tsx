import type { Department, Region } from '../../types/api'
import type { FilterFormState, SortField } from './types'
import { LIMIT_OPTIONS, SORT_OPTIONS } from './types'

export function ManagementConsoleFilters({
  filterForm,
  regions,
  departments,
  activeFilterEntries,
  onChange,
  onApply,
  onReset,
}: {
  filterForm: FilterFormState
  regions: Region[]
  departments: Department[]
  activeFilterEntries: string[]
  onChange: (next: FilterFormState) => void
  onApply: () => void
  onReset: () => void
}) {
  return (
    <section className="mc-panel">
      <div className="mc-panel__head">
        <div>
          <p className="mc-kicker">FİLTRE VE KAPSAM</p>
          <h3 className="mc-panel__title">Analiz alanını ve görünüm davranışını yönetin</h3>
        </div>
      </div>

      <div className="mc-filter-grid">
        <label className="mc-field">
          <span>Personel / ID</span>
          <input
            value={filterForm.q}
            onChange={(event) => onChange({ ...filterForm, q: event.target.value })}
            placeholder="Ad, soyad veya #ID"
          />
        </label>
        <label className="mc-field">
          <span>Bölge</span>
          <select
            value={filterForm.region_id}
            onChange={(event) => onChange({ ...filterForm, region_id: event.target.value })}
          >
            <option value="">Tüm bölgeler</option>
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
            <option value="">Tüm departmanlar</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>
        <label className="mc-field">
          <span>Başlangıç tarihi</span>
          <input
            type="date"
            value={filterForm.start_date}
            onChange={(event) => onChange({ ...filterForm, start_date: event.target.value })}
          />
        </label>
        <label className="mc-field">
          <span>Bitiş tarihi</span>
          <input
            type="date"
            value={filterForm.end_date}
            min={filterForm.start_date || undefined}
            onChange={(event) => onChange({ ...filterForm, end_date: event.target.value })}
          />
        </label>
        <label className="mc-field">
          <span>Harita günü</span>
          <input
            type="date"
            value={filterForm.map_date}
            onChange={(event) => onChange({ ...filterForm, map_date: event.target.value })}
          />
        </label>
        <label className="mc-field">
          <span>Risk alt sınır</span>
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
          <span>Risk üst sınır</span>
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
            <option value="">Tüm seviyeler</option>
            <option value="NORMAL">Normal</option>
            <option value="WATCH">İzlemeli</option>
            <option value="CRITICAL">Kritik</option>
          </select>
        </label>
        <label className="mc-field">
          <span>Sıralama</span>
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
          <span>Yön</span>
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
            Sıfırla
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
