import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Modal({
  open,
  title,
  onClose,
  children,
  placement = 'center',
  maxWidthClass = 'max-w-xl',
  panelClassName = '',
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  placement?: 'center' | 'right'
  maxWidthClass?: string
  panelClassName?: string
}) {
  const titleId = useId()
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    const previousOverflow = document.body.style.overflow
    const previousPaddingRight = document.body.style.paddingRight
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth

    document.body.style.overflow = 'hidden'
    document.body.classList.add('mc-modal-open')
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`
    }

    closeButtonRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }

      if (event.key !== 'Tab' || !panelRef.current) {
        return
      }

      const focusableElements = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
        (element) => !element.hasAttribute('hidden') && element.offsetParent !== null,
      )

      if (!focusableElements.length) {
        event.preventDefault()
        return
      }

      const first = focusableElements[0]
      const last = focusableElements[focusableElements.length - 1]
      const active = document.activeElement

      if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
        return
      }

      if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.body.style.paddingRight = previousPaddingRight
      document.body.classList.remove('mc-modal-open')
      window.removeEventListener('keydown', handleKeyDown)
      previousActiveElement?.focus()
    }
  }, [onClose, open])

  if (!open || typeof document === 'undefined') {
    return null
  }

  const isRightPlacement = placement === 'right'

  return createPortal(
    <div className={`mc-modal ${isRightPlacement ? 'is-right' : 'is-center'}`} role="presentation">
      <button type="button" className="mc-modal__backdrop" aria-label="Kapat" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`mc-modal__panel ${maxWidthClass} ${panelClassName} ${isRightPlacement ? 'is-right' : 'is-center'} page-enter`}
      >
        <div className="mc-modal__header">
          <div>
            <h4 id={titleId}>{title}</h4>
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
    </div>,
    document.body,
  )
}
