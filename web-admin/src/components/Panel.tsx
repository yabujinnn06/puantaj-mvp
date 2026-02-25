import type { ReactNode } from 'react'

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`admin-panel min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>{children}</section>
}

