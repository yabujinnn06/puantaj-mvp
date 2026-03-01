import { useEffect, useRef, type ReactNode } from 'react'

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
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleEscape)
    }
  }, [onClose, open])

  if (!open) {
    return null
  }

  const isRightPlacement = placement === 'right'

  return (
    <div className={`mc-modal ${isRightPlacement ? 'is-right' : 'is-center'}`} role="presentation">
      <button type="button" className="mc-modal__backdrop" aria-label="Kapat" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`mc-modal__panel ${maxWidthClass} ${isRightPlacement ? 'is-right' : 'is-center'} page-enter`}
      >
        <div className="mc-modal__header">
          <div>
            <h4>{title}</h4>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="mc-button mc-button--ghost"
          >
            Kapat
          </button>
        </div>
        <div className="mc-modal__body">{children}</div>
      </div>
    </div>
  )
}
