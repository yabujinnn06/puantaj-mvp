import { createContext, useCallback, useMemo, useState, type ReactNode } from 'react'

export type ToastVariant = 'success' | 'error' | 'info'

export interface ToastInput {
  title: string
  description?: string
  variant?: ToastVariant
  durationMs?: number
}

interface ToastItem extends ToastInput {
  id: string
  variant: ToastVariant
  isClosing?: boolean
}

interface ToastContextValue {
  pushToast: (toast: ToastInput) => void
  removeToast: (id: string) => void
}

export const ToastContext = createContext<ToastContextValue | undefined>(undefined)

function variantStyles(variant: ToastVariant): string {
  if (variant === 'success') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-900'
  }
  if (variant === 'error') {
    return 'border-rose-200 bg-rose-50 text-rose-900'
  }
  return 'border-sky-200 bg-sky-50 text-sky-900'
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) =>
      prev.map((toast) => (toast.id === id ? { ...toast, isClosing: true } : toast)),
    )
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id))
    }, 170)
  }, [])

  const pushToast = useCallback(
    (toast: ToastInput) => {
      const id = crypto.randomUUID()
      const nextToast: ToastItem = {
        id,
        title: toast.title,
        description: toast.description,
        durationMs: toast.durationMs ?? 3500,
        variant: toast.variant ?? 'info',
      }

      setToasts((prev) => [...prev, nextToast])

      window.setTimeout(() => {
        removeToast(id)
      }, nextToast.durationMs)
    },
    [removeToast],
  )

  const contextValue = useMemo<ToastContextValue>(
    () => ({
      pushToast,
      removeToast,
    }),
    [pushToast, removeToast],
  )

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-full max-w-sm flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast-card pointer-events-auto rounded-lg border px-4 py-3 shadow-lg ${variantStyles(toast.variant)} ${
              toast.isClosing ? 'is-leaving' : ''
            }`}
            role="status"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">{toast.title}</p>
                {toast.description ? <p className="mt-1 text-xs">{toast.description}</p> : null}
              </div>
              <button
                type="button"
                onClick={() => removeToast(toast.id)}
                className="rounded px-2 py-1 text-xs font-medium opacity-80 hover:opacity-100"
              >
                Kapat
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
