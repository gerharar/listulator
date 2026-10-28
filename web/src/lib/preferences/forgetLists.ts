import type { PreferencesStore } from './store.js'

/** `list:<id>:<key>`: what `listPreferenceKey` writes. A key that is not exactly this shape is never touched. */
const LIST_KEY = /^list:([^:]+):.+$/

/**
 * BL-150: the app remembers a handful of things per list (which groups are shut, the last row, the rail, Hide Completed, the add
 * band's tags), and nothing used to take them out when the list was deleted, so `preferences.json` (and the browser's quota) only grew.
 * This removes the keys of every list that is not in `liveIds`, and returns how many it removed.
 *
 * Careful by design: an empty `liveIds` sweeps nothing (the one shape a bad read could produce; a person with no lists keeps a few
 * stale keys until the next start), only `list:<id>:…` keys are looked at, a key that will not go does not stop the others, and a
 * store that cannot list or delete keys, or that fails, is a quiet no-op: tidying is never worth breaking the first screen for.
 */
export async function forgetDeletedLists(store: PreferencesStore, liveIds: readonly string[]): Promise<number> {
  if (liveIds.length === 0 || !store.keys || !store.delete) return 0

  const live = new Set(liveIds)
  let removed = 0
  try {
    for (const key of await store.keys()) {
      const id = LIST_KEY.exec(key)?.[1]
      if (id === undefined || live.has(id)) continue
      try {
        await store.delete(key)
        removed += 1
      } catch {
        // This one stays; the next start tries again.
      }
    }
  } catch {
    // The store could not be read: nothing to tidy this time.
  }

  return removed
}

let swept = false

/**
 * The sweep, once per start, on the first successful read of the lists (Home). Not on later reads: deleting a list offers Undo, which
 * puts the list back under the same id, and its shut groups and last row should still be there when it does.
 */
export async function forgetDeletedListsOnce(store: PreferencesStore, liveIds: readonly string[]): Promise<void> {
  if (swept || liveIds.length === 0) return
  swept = true
  await forgetDeletedLists(store, liveIds)
}

/** For tests: a fresh start. */
export function resetForgetDeletedListsOnce(): void {
  swept = false
}
