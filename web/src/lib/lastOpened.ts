import type { PreferencesStore } from './preferences/store.js'

/**
 * The list the reader opened most recently, per device (D5). It is what I'm
 * Tired, Boss offers as "the list you are tired of" until you pick another
 * (design: the sheet opens on it). A storage failure just means there is
 * nothing to offer.
 */
const KEY = 'lastOpenedList'

export async function loadLastOpened(store: PreferencesStore): Promise<string | undefined> {
  try {
    return await store.get(KEY)
  } catch {
    return undefined
  }
}

export async function saveLastOpened(store: PreferencesStore, listId: string): Promise<void> {
  try {
    await store.set(KEY, listId)
  } catch {
    // Not remembering it is not worth breaking a list for.
  }
}
