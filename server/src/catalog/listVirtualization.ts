/**
 * The switch for drawing only the rows in view on a long list (Phase 25, BACKLOG BL-074), as one small piece of logic that the server's
 * `LIST_VIRTUALIZATION` variable and the app's `listVirtualization` preference both use, so the two can never disagree about what
 * `off` looks like when someone writes it by hand. Pure: no Node, no DOM (the web app imports it too).
 *
 * `auto` (the default) draws a window of the rows from a few hundred rows on; `off` draws every row of every list, as before Phase 25.
 * It is a safety net, not a setting a reader is meant to change, so there is no Settings screen for it.
 */
export type VirtualizationMode = 'auto' | 'off'

/** The ways `off` is written in a file or an environment variable. */
const OFF_WORDS = new Set(['off', 'false', '0', 'no'])

/**
 * What a value means: `off` for off, false, 0 or no (any case, spaces around), `auto` for `auto`, nothing at all or an empty value, and
 * `undefined` for anything else, so the caller decides (the server refuses it at start, the app ignores it). A JSON file may hold a
 * boolean or a number: `false` and `0` are off.
 */
export function parseVirtualization(value: unknown): VirtualizationMode | undefined {
  if (value === undefined || value === null) return 'auto'
  const word = String(value).trim().toLowerCase()
  if (word === '' || word === 'auto') return 'auto'

  return OFF_WORDS.has(word) ? 'off' : undefined
}

/** `off` if any source says off: a safety net that one source could force back on would not be one. */
export function combineVirtualization(...modes: VirtualizationMode[]): VirtualizationMode {
  return modes.includes('off') ? 'off' : 'auto'
}
