import type { ReactNode } from 'react'

export function Modal({
  open,
  title,
  onClose,
  children,
  placement = 'center',
  maxWidthClass = 'max-w-xl',
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  placement?: 'center' | 'right'
  maxWidthClass?: string
}) {
  if (!open) {
    return null
  }

  const isRightPlacement = placement === 'right'

  return (
    <div
      className={`fixed inset-0 z-50 flex bg-slate-900/45 ${
        isRightPlacement ? 'items-stretch justify-end p-0 sm:p-3' : 'items-center justify-center px-4'
      }`}
    >
      <div
        className={`admin-panel page-enter w-full border border-slate-200 bg-white p-5 shadow-2xl ${
          isRightPlacement
            ? `${maxWidthClass} h-full overflow-y-auto rounded-none sm:rounded-l-2xl`
            : `${maxWidthClass} rounded-xl`
        }`}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h4 className="text-base font-semibold text-slate-900">{title}</h4>
          <button
            type="button"
            onClick={onClose}
            className="btn-animated rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Kapat
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
