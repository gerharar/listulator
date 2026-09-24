import { listPreferenceKey, type PreferencesStore } from '../../lib/preferences/store.js'

/**
 * Which groups of a list are collapsed, and which row was last focused,
 * remembered **per list id** in the client preferences store (D5). Nothing
 * collapses itself — with one exception (C3): a Mega list's season groups
 * arrive collapsed, decided once, the first time the list is opened.
 *
 * A storage failure (a private window, blocked site data) just means nothing
 * is remembered; it never breaks the screen.
 */
const COLLAPSED = 'collapsed'
const FOCUS = 'focus'

/** Every group of a Mega list; none of any other category's. */
export function defaultCollapsed(mediaTypeKey: string, groupNames: readonly string[]): Set<string> {
  return mediaTypeKey === 'mega' ? new Set(groupNames) : new Set()
}

function parseNames(raw: string | undefined): Set<string> | undefined {
  if (raw === undefined) return undefined

  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string')
      ? new Set(parsed)
      : undefined
  } catch {
    return undefined
  }
}

/**
 * The stored set, or — the first time this list is opened — the default,
 * written straight back so it is the list's own from then on (an empty
 * stored set means "opened them all", which must not be seeded again).
 */
export async function loadCollapsed(
  store: PreferencesStore,
  listId: string,
  seed: () => Set<string>,
): Promise<Set<string>> {
  const key = listPreferenceKey(listId, COLLAPSED)

  try {
    const stored = parseNames(await store.get(key))
    if (stored) return stored
  } catch {
    return seed()
  }

  const initial = seed()
  await saveCollapsed(store, listId, initial)

  return initial
}

export async function saveCollapsed(
  store: PreferencesStore,
  listId: string,
  collapsed: ReadonlySet<string>,
): Promise<void> {
  try {
    await store.set(listPreferenceKey(listId, COLLAPSED), JSON.stringify([...collapsed]))
  } catch {
    // Not remembering the choice is not worth breaking the list for.
  }
}

export async function loadFocus(store: PreferencesStore, listId: string): Promise<string | undefined> {
  try {
    return await store.get(listPreferenceKey(listId, FOCUS))
  } catch {
    return undefined
  }
}

export async function saveFocus(
  store: PreferencesStore,
  listId: string,
  rowId: string,
): Promise<void> {
  try {
    await store.set(listPreferenceKey(listId, FOCUS), rowId)
  } catch {
    // As above.
  }
}
