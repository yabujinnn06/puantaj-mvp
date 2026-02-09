export function CopyField({
  label,
  value,
  onCopy,
}: {
  label: string
  value: string
  onCopy: (value: string) => void
}) {
  return (
    <label className="block text-sm text-slate-700">
      {label}
      <div className="mt-1 flex items-stretch gap-2">
        <input
          readOnly
          value={value}
          className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700"
        />
        <button
          type="button"
          onClick={() => onCopy(value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          Kopyala
        </button>
      </div>
    </label>
  )
}
