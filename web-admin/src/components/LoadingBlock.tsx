export function LoadingBlock({ label = 'Yükleniyor...' }: { label?: string }) {
  return (
    <div className="loading-block admin-panel rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600 shadow-sm">
      <span className="loading-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}
