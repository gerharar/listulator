import { APP_VERSION } from './appVersion.js'
import { getPreferencesStore, type PreferencesStore } from './preferences/store.js'

/**
 * Which version the app ran at its last start, read once per start and then replaced by this one (canvas H-017's "Updated to" toast, and
 * the update trace, BL-092). One function does the reading and the writing so the two readers cannot disagree: whoever wrote the key first
 * would hide the change from the other. It stays when the trace goes (BL-093); the key is `lastRunVersion` in `preferences.json`.
 */
const LAST_RUN_KEY = 'lastRunVersion'

/** The version the last start recorded (`undefined` when none did), after recording `version` as this start's. Throws when the store does. */
export async function noteRunVersion(store: PreferencesStore, version: string): Promise<string | undefined> {
  const last = await store.get(LAST_RUN_KEY)
  if (last !== version) await store.set(LAST_RUN_KEY, version)

  return last
}

let thisStart: Promise<string | undefined> | undefined

/** `noteRunVersion` for this start of the app, made once however many readers ask. Rejects when the store fails: a reader catches. */
export function previousRunVersion(): Promise<string | undefined> {
  thisStart ??= noteRunVersion(getPreferencesStore(), APP_VERSION)

  return thisStart
}

/** Semantic Versioning 2.0.0 with an optional prerelease and no build metadata: the same pattern as `RELEASE_VERSION` in `server/src/tools/versionSources.ts`. */
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?$/
const NUMERIC = /^\d+$/

/**
 * Whether `a` is a later version than `b`, by Semantic Versioning precedence (section 11): the numbers first, then a prerelease ("1.0.0-rc.2")
 * is earlier than its release, and prerelease identifiers go one by one (numbers as numbers and before text, text as ASCII, a longer list after
 * its own start). The release tooling's `compareVersions` (`server/src/tools/updateManifest.ts`) follows the same rules; the two cannot share
 * code, so both test files hold the specification's cases. Anything that is not a version is not newer.
 */
export function isNewerVersion(a: string, b: string): boolean {
  const left = VERSION.exec(a)
  const right = VERSION.exec(b)
  if (!left || !right) return false
  for (let i = 1; i <= 3; i += 1) {
    const difference = BigInt(left[i]!) - BigInt(right[i]!)
    if (difference !== 0n) return difference > 0n
  }
  const leftTag = left[4]?.split('.')
  const rightTag = right[4]?.split('.')
  if (leftTag === undefined || rightTag === undefined) return leftTag === undefined && rightTag !== undefined
  for (let i = 0; i < Math.max(leftTag.length, rightTag.length); i += 1) {
    const x = leftTag[i]
    const y = rightTag[i]
    if (x === undefined) return false
    if (y === undefined) return true
    const numericX = NUMERIC.test(x)
    const numericY = NUMERIC.test(y)
    if (numericX && numericY) {
      if (BigInt(x) !== BigInt(y)) return BigInt(x) > BigInt(y)
    } else if (numericX !== numericY) {
      return numericY
    } else if (x !== y) {
      return x > y
    }
  }

  return false
}
