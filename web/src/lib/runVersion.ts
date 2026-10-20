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

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

/** Whether `a` is a later version than `b`: numbers first, and a prerelease ("1.0.0-rc.2") is earlier than its release. Anything that is not a version is not newer. */
export function isNewerVersion(a: string, b: string): boolean {
  const left = VERSION.exec(a)
  const right = VERSION.exec(b)
  if (!left || !right) return false
  for (let i = 1; i <= 3; i += 1) {
    const difference = Number(left[i]) - Number(right[i])
    if (difference !== 0) return difference > 0
  }
  const [leftTag, rightTag] = [left[4], right[4]]
  if (leftTag === rightTag) return false
  if (leftTag === undefined) return true
  if (rightTag === undefined) return false

  return leftTag.localeCompare(rightTag, 'en', { numeric: true }) > 0
}
