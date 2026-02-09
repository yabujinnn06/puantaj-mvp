export function TableSearchInput({
  value,
  onChange,
  placeholder = 'Isme gore ara...',
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <label className="block text-sm text-slate-700">
      Ara
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-200 focus:border-brand-500 focus:ring"
      />
    </label>
  )
}
