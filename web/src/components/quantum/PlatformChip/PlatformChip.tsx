import './PlatformChip.css'
import type { CSSProperties } from 'react'

/**
 * Platform shortcodes as they appear in a list item's `tags`, in filter
 * order. `multi` is a claim, not a platform: same content everywhere,
 * platforms unnamed (design-system/components/PlatformChip, ported from
 * the reference engine's `PLATFORMS` table).
 */
export const PLATFORMS: Record<string, string> = {
  ps1: 'PlayStation',
  ps2: 'PlayStation 2',
  ps3: 'PlayStation 3',
  ps4: 'PlayStation 4',
  ps5: 'PlayStation 5',
  psp: 'PlayStation Portable',
  vita: 'PlayStation Vita',
  xbox: 'Xbox',
  x360: 'Xbox 360',
  xone: 'Xbox One',
  xsx: 'Xbox Series X|S',
  nes: 'NES',
  snes: 'Super NES',
  n64: 'Nintendo 64',
  gc: 'GameCube',
  wii: 'Wii',
  wiiu: 'Wii U',
  switch: 'Nintendo Switch',
  gb: 'Game Boy',
  gba: 'Game Boy Advance',
  nds: 'Nintendo DS',
  '3ds': 'Nintendo 3DS',
  pc: 'PC',
  mac: 'macOS',
  linux: 'Linux',
  ios: 'iOS',
  android: 'Android',
  multi: 'Multi-platform',
}

/** The shortcode table's own filter order — an unknown code sorts after all of these. */
export const PLATFORM_ORDER: readonly string[] = Object.keys(PLATFORMS)

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
}

/**
 * A caps shortcode in an item's tag column (visual only for 10.6 — the
 * popover listing full names lands with the overlay work in 10.7+).
 */
export function PlatformChip({ tags, widthCh }: PlatformChipProps) {
  const label = platformChipLabel(tags)
  const style = widthCh ? ({ '--plat-ch': widthCh } as CSSProperties) : undefined

  if (label === null) {
    return <span className="q-plat-gap" style={style} aria-hidden="true" />
  }

  return (
    <span className="q-plat" style={style}>
      {label}
    </span>
  )
}
