import { useSyncExternalStore } from 'react'
import { getPreferencesStore, type PreferencesStore } from './preferences/store.js'

/** What an explicit check found for one list: how many new items, and when it looked. */
export interface PendingUpdate {
  count: number
  checkedAt: string
}

export type PendingMap = Readonly<Record<string, PendingUpdate>>

const KEY = 'updates:pending'

/** Reads what was stored, keeping the entries it can and dropping the rest — junk must never break Home. */
function parse(text: string | undefined): PendingMap {
  if (!text) return {}

  try {
    const raw: unknown = JSON.parse(text)
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}

    const kept: Record<string, PendingUpdate> = {}
    for (const [listId, entry] of Object.entries(raw)) {
      const value = entry as Partial<PendingUpdate> | null
      if (
        value &&
        typeof value.count === 'number' &&
        Number.isInteger(value.count) &&
        value.count > 0 &&
        typeof value.checkedAt === 'string'
      ) {
        kept[listId] = { count: value.count, checkedAt: value.checkedAt }
      }
    }

    return kept
  } catch {
    return {}
  }
}

/**
 * The updates an explicit check has found and the reader has neither applied
 * nor dismissed (owner rulings, 10.22c). Kept in the preferences store so they
 * survive a restart — per device, not shared between devices. A dismissal is
 * just the entry going away; the next explicit check brings it back. Also says
 * whether a check is running, so Home's spinner and a list's survive leaving
 * the screen that started it.
 */
export function createPendingUpdates(store: PreferencesStore) {
  let pending: PendingMap = {}
  let checking = false
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach((listener) => listener())

  async function commit(next: PendingMap) {
    pending = next
    notify()
    await store.set(KEY, JSON.stringify(next))
  }

  return {
    async load() {
      pending = parse(await store.get(KEY))
      notify()
    },
    /** A new object after every change, so a view can tell. */
    get: (): PendingMap => pending,
    async set(listId: string, count: number) {
      if (count <= 0) return await this.remove(listId)
      await commit({ ...pending, [listId]: { count, checkedAt: new Date().toISOString() } })
    },
    async remove(listId: string) {
      if (!(listId in pending)) return
      const { [listId]: _gone, ...rest } = pending
      await commit(rest)
    },
    /** Forgets lists that no longer exist. */
    async prune(existingIds: readonly string[]) {
      const known = new Set(existingIds)
      const kept = Object.fromEntries(Object.entries(pending).filter(([id]) => known.has(id)))
      if (Object.keys(kept).length !== Object.keys(pending).length) await commit(kept)
    },
    /** The first `max` pending lists, in the order the lists are shown. */
    visible(orderedListIds: readonly string[], max: number): string[] {
      return orderedListIds.filter((id) => id in pending).slice(0, max)
    },
    isChecking: () => checking,
    setChecking(value: boolean) {
      if (checking === value) return
      checking = value
      notify()
    },
    subscribe(listener: () => void) {
      listeners.add(listener)

      return () => void listeners.delete(listener)
    },
  }
}

export type PendingUpdates = ReturnType<typeof createPendingUpdates>

let shared: PendingUpdates | undefined
let loaded: Promise<void> | undefined

/** The app's one store, loaded from preferences the first time it is asked for. */
export function getPendingUpdates(): PendingUpdates {
  if (!shared) {
    shared = createPendingUpdates(getPreferencesStore())
    loaded = shared.load()
    void loaded.catch(() => {})
  }

  return shared
}

/** For a view: the pending map, re-rendering when it changes. */
export function usePendingMap(): PendingMap {
  const pending = getPendingUpdates()

  return useSyncExternalStore(pending.subscribe, pending.get)
}

export function useChecking(): boolean {
  const pending = getPendingUpdates()

  return useSyncExternalStore(pending.subscribe, pending.isChecking)
}
