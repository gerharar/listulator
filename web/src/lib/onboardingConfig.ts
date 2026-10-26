import type { LibraryEntry } from '../../../server/src/ingestion/customLists.js'
import onboarding from '../../../config/onboarding.json'

/**
 * The first-run sample list (H-018, "Try A Sample List"): which list the button adds is named in `config/onboarding.json`, git-tracked like
 * `config/strategies/*.json` and bundled into the app, so a change takes a rebuild. `sampleList` is a path in the library (the extended MCU list
 * by default; owner, 2026-10-24) or `"random"`. A file that is wrong never becomes an error on the first screen: a bad value means the default,
 * and a path the library does not have means a random list.
 */
export const DEFAULT_SAMPLE_PATH = 'lists/mega/mcu-extended.yaml'

export type SampleSetting = { kind: 'path'; path: string } | { kind: 'random' }

export function readSampleSetting(value: unknown): SampleSetting {
  const named = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>)['sampleList'] : undefined
  const text = typeof named === 'string' ? named.trim() : ''
  if (text === 'random') return { kind: 'random' }

  return { kind: 'path', path: text === '' ? DEFAULT_SAMPLE_PATH : text }
}

/** The setting this build was made with. */
export const sampleSetting: SampleSetting = readSampleSetting(onboarding)

/**
 * Whether the first-run TMDB key callout shows (`tmdbCallout` in `config/onboarding.json`). Hidden since the owner's usability test of 2026-10-26:
 * testers read "One free TMDB key" as a key that unlocks everything, and it crowded the screen. The code, its styles and its strings stay behind
 * this flag. Only a boolean `true` turns it on; a missing or malformed value means off, never an error.
 */
export function readTmdbCallout(value: unknown): boolean {
  const named = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>)['tmdbCallout'] : undefined

  return named === true
}

/** The callout setting this build was made with. */
export const tmdbCalloutSetting: boolean = readTmdbCallout(onboarding)

/** The library entry the setting names, a random one when it names none that exists, nothing from an empty library. */
export function pickSample(setting: SampleSetting, entries: readonly LibraryEntry[], random: () => number): LibraryEntry | null {
  if (entries.length === 0) return null
  if (setting.kind === 'path') {
    const named = entries.find((entry) => entry.externalRef === `canonical:${setting.path}`)
    if (named) return named
  }

  return entries[Math.floor(random() * entries.length)] ?? null
}
