import type { ControlRoomQuickFilter } from './utils'
import { QUICK_FILTER_OPTIONS } from './utils'

export function ControlRoomQuickFilters({
  activeFilters,
  onToggle,
}: {
  activeFilters: ControlRoomQuickFilter[]
  onToggle: (value: ControlRoomQuickFilter) => void
}) {
  return (
    <div className="cr-ops-quick-filters" aria-label="Hizli filtreler">
      {QUICK_FILTER_OPTIONS.map((filter) => {
        const active = activeFilters.includes(filter.key)
        return (
          <button
            key={filter.key}
            type="button"
            onClick={() => onToggle(filter.key)}
            className={`cr-ops-chip ${active ? 'is-active' : ''}`}
            title={filter.description}
            aria-pressed={active}
          >
            {filter.label}
          </button>
        )
      })}
    </div>
  )
}
