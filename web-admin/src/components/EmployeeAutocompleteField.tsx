import { useEffect, useMemo, useState } from 'react'

import type { Employee } from '../types/api'

interface EmployeeAutocompleteFieldProps {
  label: string
  employees: Employee[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  emptyLabel?: string
  helperText?: string
  disabled?: boolean
  className?: string
}

function employeeLabel(employee: Employee): string {
  return `#${employee.id} - ${employee.full_name}`
}

export function EmployeeAutocompleteField({
  label,
  employees,
  value,
  onChange,
  placeholder = 'Çalışan adı veya ID yazın...',
  emptyLabel = 'Seçiniz',
  helperText,
  disabled = false,
  className = '',
}: EmployeeAutocompleteFieldProps) {
  const selectedEmployee = useMemo(
    () => employees.find((item) => String(item.id) === value),
    [employees, value],
  )
  const [query, setQuery] = useState(selectedEmployee ? employeeLabel(selectedEmployee) : '')
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    if (selectedEmployee) {
      setQuery(employeeLabel(selectedEmployee))
      return
    }
    if (!value) {
      setQuery('')
    }
  }, [selectedEmployee, value])

  const filteredEmployees = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    const rows = normalized
      ? employees.filter((item) => {
          const byName = item.full_name.toLowerCase().includes(normalized)
          const byId = String(item.id).includes(normalized.replace('#', ''))
          return byName || byId
        })
      : employees
    return rows.slice(0, 60)
  }, [employees, query])

  const handlePick = (employee: Employee) => {
    onChange(String(employee.id))
    setQuery(employeeLabel(employee))
    setIsOpen(false)
  }

  return (
    <div className={className}>
      <label className="text-sm text-slate-700">
        {label}
        <div className="relative mt-1">
          <input
            type="text"
            value={query}
            disabled={disabled}
            onFocus={() => setIsOpen(true)}
            onChange={(event) => {
              const next = event.target.value
              setQuery(next)
              setIsOpen(true)
              if (!next.trim()) {
                onChange('')
              }
            }}
            onBlur={() => {
              // Delay close so option click can complete.
              window.setTimeout(() => setIsOpen(false), 120)
            }}
            placeholder={placeholder}
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onChange('')
              setQuery('')
              setIsOpen(false)
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1 text-xs text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Temizle
          </button>

          {isOpen ? (
            <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange('')
                  setQuery('')
                  setIsOpen(false)
                }}
                className="flex w-full items-center justify-between border-b border-slate-100 px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-50"
              >
                <span>{emptyLabel}</span>
              </button>
              {filteredEmployees.map((employee) => (
                <button
                  key={employee.id}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => handlePick(employee)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
                >
                  <span>{employeeLabel(employee)}</span>
                  {!employee.is_active ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                      Pasif
                    </span>
                  ) : null}
                </button>
              ))}
              {filteredEmployees.length === 0 ? (
                <div className="px-3 py-2 text-sm text-slate-500">Sonuç bulunamadı.</div>
              ) : null}
            </div>
          ) : null}
        </div>
      </label>
      {helperText ? <p className="mt-1 text-xs text-slate-500">{helperText}</p> : null}
    </div>
  )
}
