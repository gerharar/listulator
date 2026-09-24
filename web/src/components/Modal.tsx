import { useId } from 'react'
import type { ReactNode } from 'react'
import { useOverlayRegistration } from './quantum/overlay/OverlayManagerContext.js'

export interface ModalProps {
  onClose: () => void
  children: ReactNode
}

/**
 * A dimmed overlay with a centered box — Escape or a click outside closes
 * it. Registers with the shared OverlayManager (task 10.9) rather than its
 * own `document` keydown listener: hosted inside a layer, an unregistered
 * listener would fire *alongside* the Esc ladder, closing this modal and
 * popping a layer on the same keypress.
 */
export function Modal({ onClose, children }: ModalProps) {
  const id = useId()
  useOverlayRegistration('popover', id, true, onClose)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
