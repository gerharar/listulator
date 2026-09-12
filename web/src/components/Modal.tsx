import { useEffect } from 'react'
import type { ReactNode } from 'react'

export interface ModalProps {
  onClose: () => void
  children: ReactNode
}

/** A dimmed overlay with a centered box — Escape or a click outside closes it. */
export function Modal({ onClose, children }: ModalProps) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}
