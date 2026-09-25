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
  /** A full-width row between the head and the body (I'm Tired, Boss's list picker, 10.26). */
  bar?: ReactNode
  /** The pick/alternates body of each helper — this frame just hosts whatever it's given. */
  children?: ReactNode
}

/**
 * A helper panel over Home, **frame only** for 10.7 — the head (wash plate,
 * title, explain, close) and the body slot, with no scrim: a click
 * anywhere outside it closes it (design-system/components/Sheet).
 */
export function Sheet({ open, onClose, title, explain, plateSeed = 0, bar, children }: SheetProps) {
  const id = useId()
  const sheetRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useOverlayRegistration('sheet', id, open, onClose)

  useEffect(() => {
    if (!open) return undefined

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Element
      // A popover opened from inside the sheet (a list picker) and its click-away
      // layer are portalled outside it, but they belong to it.
      if (target.closest?.('.q-pop, .q-catcher')) return
      if (sheetRef.current && !sheetRef.current.contains(target)) {
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
      {bar && <div className="q-sheet-bar">{bar}</div>}
      <div className="q-sheet-body">{children}</div>
    </div>
  )
}
