/**
 * Platform shortcodes as they appear in a list item's `tags`, in filter
 * order. Shared (browser-safe, no Node builtins) so the facet derivation in
 * `facets.ts` and the platform chip read one table. `multi` is a claim, not a platform: same content
 * everywhere,
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
