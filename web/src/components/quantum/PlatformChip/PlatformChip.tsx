import './PlatformChip.css'
import type { CSSProperties } from 'react'
import { copy } from '../../../locale/index.js'

import {
  PLATFORMS,
  PLATFORM_ORDER,
  platformCode,
  platformKey,
  platformName,
} from '../../../../../server/src/catalog/platforms.js'

export { PLATFORMS, PLATFORM_ORDER }

/** The full name for a tag, matched case-insensitively and through old codes (PC is Windows). Null for an unrecognised code. */
export function platformFullName(tag: string): string | null {
  return platformName(tag)
}

/** An item's platform tags as the codes shown, one per platform: an old and a new spelling count once. */
export function platformCodes(tags: readonly string[]): string[] {
  const codes = new Map<string, string>()
  for (const tag of tags) {
    if (tag.trim()) codes.set(platformKey(tag), platformCode(tag))
  }
  return [...codes.values()]
}

/**
 * `[PS3]` → `PS3`; `[PS3, X360, PC]` → `MULTI`: more than one platform
 * collapses to one label, and the card names them all. An empty list of
 * tags → null, meaning an empty slot, not a chip.
 */
export function platformChipLabel(tags: readonly string[]): string | null {
  const codes = platformCodes(tags)
  if (codes.length === 0) return null
  if (codes.length === 1) return codes[0]!
  return copy.quantum.list.filter.optionLabels['MULTI'] ?? 'MULTI'
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
