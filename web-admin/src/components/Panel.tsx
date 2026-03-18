import type { ReactNode } from 'react'

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`admin-panel relative min-w-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 p-5 shadow-[0_16px_42px_rgba(15,44,61,0.08)] backdrop-blur-sm ${className}`}
    >
      <span className="admin-panel__accent" aria-hidden="true" />
      <div className="admin-panel__content">{children}</div>
    </section>
  )
}

