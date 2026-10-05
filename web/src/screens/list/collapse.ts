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

const RAIL = 'rail'

/** Whether the reader folded the jump rail away for this list (remembered per list, D5). Shown unless said otherwise. */
export async function loadRailHidden(store: PreferencesStore, listId: string): Promise<boolean> {
  try {
    return (await store.get(listPreferenceKey(listId, RAIL))) === 'hidden'
  } catch {
    return false
  }
}

export async function saveRailHidden(store: PreferencesStore, listId: string, hidden: boolean): Promise<void> {
  try {
    await store.set(listPreferenceKey(listId, RAIL), hidden ? 'hidden' : 'shown')
  } catch {
    // As above.
  }
}

const RAIL_WIDTH = 'railWidth'
export const RAIL_WIDTH_DEFAULT = 200
export const RAIL_WIDTH_MIN = 160
export const RAIL_WIDTH_MAX = 480

export function clampRailWidth(width: number): number {
  return Math.round(Math.min(RAIL_WIDTH_MAX, Math.max(RAIL_WIDTH_MIN, width)))
}

/** How wide the reader dragged the jump rail on this list (F12). The design's 200px unless said otherwise. */
export async function loadRailWidth(store: PreferencesStore, listId: string): Promise<number> {
  try {
    const stored = Number(await store.get(listPreferenceKey(listId, RAIL_WIDTH)))
    return Number.isFinite(stored) && stored > 0 ? clampRailWidth(stored) : RAIL_WIDTH_DEFAULT
  } catch {
    return RAIL_WIDTH_DEFAULT
  }
}

export async function saveRailWidth(store: PreferencesStore, listId: string, width: number): Promise<void> {
  try {
    await store.set(listPreferenceKey(listId, RAIL_WIDTH), String(width))
  } catch {
    // As above.
  }
}

const HIDE_DONE = 'hideDone'

/**
 * Whether Hide Completed is on for this list (task 18.2; owner, 2026-10-05): remembered per list, so a long list you
 * work through opens at what is left. Off unless said otherwise, and for a missing or damaged value.
 */
export async function loadHideDone(store: PreferencesStore, listId: string): Promise<boolean> {
  try {
    return (await store.get(listPreferenceKey(listId, HIDE_DONE))) === 'on'
  } catch {
    return false
  }
}

export async function saveHideDone(store: PreferencesStore, listId: string, on: boolean): Promise<void> {
  try {
    await store.set(listPreferenceKey(listId, HIDE_DONE), on ? 'on' : 'off')
  } catch {
    // As above.
  }
}

const ADD_TAGS = 'addTags'

/**
 * The tags the add row starts with on this list (U5, docs/chips §4): whatever
 * the last item added here used, so a run of PS2 games is one pick. Nothing for
 * a missing or damaged value.
 */
export async function loadAddTags(store: PreferencesStore, listId: string): Promise<string[]> {
  try {
    const parsed: unknown = JSON.parse((await store.get(listPreferenceKey(listId, ADD_TAGS))) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === 'string') : []
  } catch {
    return []
  }
}

export async function saveAddTags(store: PreferencesStore, listId: string, tags: readonly string[]): Promise<void> {
  try {
    await store.set(listPreferenceKey(listId, ADD_TAGS), JSON.stringify(tags))
  } catch {
    // As above.
  }
}
