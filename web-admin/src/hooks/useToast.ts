import { useContext } from 'react'

import { ToastContext } from '../components/ToastProvider'

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    return {
      pushToast: () => {
        // no-op fallback to avoid runtime page crash if provider is not mounted
      },
      removeToast: () => {
        // no-op fallback to avoid runtime page crash if provider is not mounted
      },
    }
  }
  return context
}
