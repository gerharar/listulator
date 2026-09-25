import './PlatformChip.css'
import type { CSSProperties } from 'react'
import { copy } from '../../../locale/index.js'

import { PLATFORMS, PLATFORM_ORDER } from '../../../../../server/src/catalog/platforms.js'

export { PLATFORMS, PLATFORM_ORDER }

/** The full name for a code, matched case-insensitively. Null for an unrecognised code. */
export function platformFullName(code: string): string | null {
  return PLATFORMS[code.toLowerCase()] ?? null
}

/**
 * `[PS3]` → `PS3`. `[PS3, X360, PC]` and `[multi]` both → `MULTI` (one
 * named platform still gets its own code shown; more than one collapses to
 * the claim that it's everywhere, same as the literal `multi` tag).
 * An empty list of tags → null, meaning an empty slot, not a chip.
 */
export function platformChipLabel(tags: readonly string[]): string | null {
  if (tags.length === 0) return null
  if (tags.length === 1) return tags[0]!.toUpperCase()
  return 'MULTI'
}

export interface PlatformChipProps {
  tags: readonly string[]
  /** Character width of the widest label among this row's chips, for column alignment. */
  widthCh?: number
  /** The row's title, for the button's accessible name. */
  itemTitle: string
  /** Click opens the platform popover, anchored to the chip. It never reaches the row. */
  onOpen: (anchor: HTMLElement) => void
}

/**
 * A caps shortcode in an item's tag column, and the button that opens the
 * popover listing full names. Untagged items keep an empty slot of the same
 * width so titles stay aligned.
 */
export function PlatformChip({ tags, widthCh, itemTitle, onOpen }: PlatformChipProps) {
  const label = platformChipLabel(tags)
  const style = widthCh ? ({ '--plat-ch': widthCh } as CSSProperties) : undefined

  if (label === null) {
    return <span className="q-plat-gap" style={style} aria-hidden="true" />
  }

  return (
    <button
      type="button"
      className="q-plat"
      style={style}
      aria-label={copy.quantum.platformCard.chipLabel(itemTitle)}
      onClick={(event) => {
        event.stopPropagation()
        onOpen(event.currentTarget)
      }}
    >
      {label}
    </button>
  )
}
