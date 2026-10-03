import type { ExpandOptions, ListExpansion } from './mediaTypes.js'

/**
 * A short-lived memory of what a source expanded to (task 10.15).
 *
 * A result's count, its Preview and Add list all expand the same source, and
 * on Mega or MusicBrainz that is dozens of upstream requests each time. This
 * lets the three share one. It is in-process memory only: it dies with the
 * server or the desktop app, so nothing has to clear it on close.
 *
 * - **Time-limited**, because upstream changes; a Preview left open for an
 *   hour must not make Add list import stale data.
 * - **Bounded**, least recently used out, so browsing many results cannot
 *   grow it without limit.
 * - **Concurrent asks share one load**, so a count and a Preview for the same
 *   result made together cost one fetch.
 * - **Failures are not kept.**
 * - **Evicted after a successful Add list**, so a second add of the same
 *   source starts from what upstream says now.
 *
 * Refresh and check-for-updates never come through here: they exist to see
 * upstream as it is *now*.
 */
export interface ExpansionCache {
  get(key: string, load: () => Promise<ListExpansion>): Promise<ListExpansion>
  evict(key: string): void
}

export interface ExpansionCacheOptions {
  ttlMs?: number
  maxEntries?: number
  now?: () => number
}

interface Entry {
  promise: Promise<ListExpansion>
  expiresAt: number
}

export function createExpansionCache({
  ttlMs = 5 * 60_000,
  maxEntries = 50,
  now = Date.now,
}: ExpansionCacheOptions = {}): ExpansionCache {
  const entries = new Map<string, Entry>()

  return {
    get(key, load) {
      const existing = entries.get(key)
      if (existing && existing.expiresAt > now()) {
        // Re-inserted so the Map's order is least → most recently used.
        entries.delete(key)
        entries.set(key, existing)
        return existing.promise
      }

      const promise = load()
      const entry: Entry = { promise, expiresAt: now() + ttlMs }
      entries.delete(key)
      entries.set(key, entry)
      promise.catch(() => {
        if (entries.get(key) === entry) entries.delete(key)
      })

      while (entries.size > maxEntries) {
        entries.delete(entries.keys().next().value as string)
      }

      return promise
    },

    evict(key) {
      entries.delete(key)
    },
  }
}

/**
 * The key an adapter expansion is remembered under: the category, the exact ref an import stores, and
 * whether per-item lookups were skipped (task 15.5). A listing without lengths and a full expansion of
 * one source are different answers and must not be handed to each other.
 */
export const expansionCacheKey = (
  mediaTypeKey: string,
  adapterRef: string,
  options?: ExpandOptions,
): string => `${mediaTypeKey}|${adapterRef}${options?.runtimes === 'skip' ? '|skip' : ''}`
