import { createContext, useCallback, useMemo, useState, type ReactNode } from 'react'

export type ToastVariant = 'success' | 'error' | 'warning' | 'info'

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

function createToastId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
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
      const id = createToastId()
      const nextToast: ToastItem = {
        id,
        title: toast.title,
        description: toast.description,
        durationMs: toast.durationMs ?? 4200,
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
      <div className="employee-toast-viewport" aria-live="polite" aria-atomic="true">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`employee-toast employee-toast--${toast.variant} ${toast.isClosing ? 'is-leaving' : ''}`}
            role="status"
          >
            <div className="employee-toast__head">
              <div className="employee-toast__copy">
                <p className="employee-toast__title">{toast.title}</p>
                {toast.description ? (
                  <p className="employee-toast__description">{toast.description}</p>
                ) : null}
              </div>
              <button
                type="button"
                className="employee-toast__close"
                onClick={() => removeToast(toast.id)}
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
