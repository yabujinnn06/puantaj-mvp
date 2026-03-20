import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function ControlRoomMobileSheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, open])

  if (!open || typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div className="cr-mobile-sheet" role="presentation">
      <button
        type="button"
        className="cr-mobile-sheet__backdrop"
        aria-label="Kapat"
        onClick={onClose}
      />
      <section
        className="cr-mobile-sheet__panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="cr-mobile-sheet__header">
          <div>
            <p className="cr-mobile-sheet__eyebrow">Filtre merkezi</p>
            <h3>{title}</h3>
          </div>
          <button
            type="button"
            className="cr-mobile-sheet__close"
            onClick={onClose}
          >
            Kapat
          </button>
        </header>
        <div className="cr-mobile-sheet__body">{children}</div>
      </section>
    </div>,
    document.body,
  )
}
