import { useEffect, useMemo, useState, type ReactNode, type RefObject } from 'react'
import type { ListItem } from '../../lib/api.js'
import { ITEM_HEIGHT, windowSlices, type RowModel, type ShownUnit, type Viewport } from './rowModel.js'

/**
 * What the screen assumes of its scroller until it has measured it: a tall window, never "the whole list" (a 50,000-row list drawn
 * whole for one frame is the nine seconds this exists to remove). Measured right after the first render (an effect).
 */
const DEFAULT_VIEWPORT: Viewport = { scrollTop: 0, height: 900 }
/** At least this much is drawn beyond the viewport on each side, so a fast scroll does not show a blank band. */
const MIN_OVERSCAN = 400

/**
 * The scroller's position and height, kept in state so the rows follow it. Scroll events are coalesced to one update a frame, and the
 * position is rounded down to a whole row: the overscan covers the difference, and a slow scroll then re-renders once a row, not once
 * a frame. Off, it does nothing at all (a short list draws every row and has no use for it).
 */
function useViewport(scroller: RefObject<HTMLElement | null>, enabled: boolean): Viewport {
  const [viewport, setViewport] = useState<Viewport>(DEFAULT_VIEWPORT)

  // An effect, not a layout effect: a parent's ref is attached after its children's layout effects have run, and the scroller is the parent.
  useEffect(() => {
    const element = scroller.current
    if (!element || !enabled) return undefined

    let frame = 0
    const read = () => {
      frame = 0
      const next: Viewport = {
        scrollTop: Math.floor(element.scrollTop / ITEM_HEIGHT) * ITEM_HEIGHT,
        height: element.clientHeight || DEFAULT_VIEWPORT.height,
      }
      setViewport((current) => (current.scrollTop === next.scrollTop && current.height === next.height ? current : next))
    }
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(read)
    }

    read()
    element.addEventListener('scroll', schedule, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    observer?.observe(element)

    return () => {
      element.removeEventListener('scroll', schedule)
      observer?.disconnect()
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [scroller, enabled])

  return viewport
}

export interface WindowedRowsProps {
  shown: readonly ShownUnit[]
  model: RowModel
  /** False draws every row (a list under the threshold, or virtualization switched off). */
  enabled: boolean
  /** Rows that stay drawn wherever they are scrolled (by id). */
  pinned: ReadonlySet<string>
  /** The element that scrolls, for the window's position. */
  scroller: RefObject<HTMLElement | null>
  renderItem: (item: ListItem, grouped: boolean) => ReactNode
  /** A group's block: its header and the `rows` (members and spacers) to put after it. */
  renderGroup: (shown: ShownUnit, rows: ReactNode[]) => ReactNode
}

const spacer = (key: string, height: number) => <div key={key} className="q-list-spacer" style={{ height }} aria-hidden="true" />

/**
 * The list's rows as a window (Phase 25): the units near the viewport, each group as its own block with its header, and spacers of
 * the exact height for what is not drawn, so the scroll bar and the sticky group headers behave as with every row drawn. With
 * `enabled` false it draws everything and no spacer, the markup the screen has always had. Only this component follows the scroll,
 * so the rest of the screen is not drawn again for it.
 */
export function WindowedRows({ shown, model, enabled, pinned, scroller, renderItem, renderGroup }: WindowedRowsProps) {
  const viewport = useViewport(scroller, enabled)
  const slices = useMemo(
    () => windowSlices(model, viewport, { enabled, overscan: Math.max(MIN_OVERSCAN, viewport.height), pinned }),
    [model, viewport, enabled, pinned],
  )

  return (
    <>
      {slices.map((slice, index) => {
        if (slice.kind === 'spacer') return spacer(`s${index}`, slice.height)
        const entry = shown[slice.unitIndex]!
        if (slice.kind === 'item') return entry.unit.kind === 'item' ? renderItem(entry.unit.item, false) : null

        const rows: ReactNode[] = []
        slice.parts.forEach((part, partIndex) => {
          if (part.kind === 'spacer') rows.push(spacer(`p${partIndex}`, part.height))
          else for (const member of entry.members.slice(part.from, part.to)) rows.push(renderItem(member, true))
        })

        return renderGroup(entry, rows)
      })}
    </>
  )
}
