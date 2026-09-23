import './Sheet.css'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { IconButton } from '../Button/Button.js'
import { HeaderPlate } from '../HeaderPlate/HeaderPlate.js'
import { useOverlayRegistration } from '../overlay/OverlayManagerContext.js'

export interface SheetProps {
  open: boolean
  /** Fired by the close button, an outside click, or the Esc ladder — a Sheet has no commit/discard distinction. */
  onClose: () => void
  title: string
  explain: string
  /** The header wash's per-screen seed — task 10.8 supplies the actual pattern; this just carries the value through as `--sd`. */
  plateSeed?: number
  /** The real pick/alternates body lands with the Suggestions tasks (10.26+) — this frame just hosts whatever it's given. */
  children?: ReactNode
}

/**
 * A helper panel over Home, **frame only** for 10.7 — the head (wash plate,
 * title, explain, close) and the body slot, with no scrim: a click
 * anywhere outside it closes it (design-system/components/Sheet).
 */
export function Sheet({ open, onClose, title, explain, plateSeed = 0, children }: SheetProps) {
  const id = useId()
  const sheetRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useOverlayRegistration('sheet', id, open, onClose)

  useEffect(() => {
    if (!open) return undefined

    function onPointerDown(event: PointerEvent) {
      if (sheetRef.current && !sheetRef.current.contains(event.target as Node)) {
        onCloseRef.current()
      }
    }

    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  if (!open) return null

  return (
    <div className="q-sheet" ref={sheetRef}>
      <div className="q-sheet-head">
        <HeaderPlate side="left" seed={plateSeed} wash />
        <div>
          <div className="q-sheet-title">{title}</div>
          <div className="q-sheet-explain">{explain}</div>
        </div>
        <IconButton size="sq" label="Close" onClick={onClose}>
          ✕
        </IconButton>
      </div>
      <div className="q-sheet-body">{children}</div>
    </div>
  )
}
