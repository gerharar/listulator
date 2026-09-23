import { load, type Store } from '@tauri-apps/plugin-store'

/**
 * Client-side preferences (D5) — skin, motion, reduced motion, language,
 * rail visibility, plus per-list keys (namespaced by list id: group
 * collapse state, last-focused row). No server-side preferences table:
 * both app-wide and per-list keys live here, just with different key
 * shapes — see `listPreferenceKey`.
 *
 * Async because the desktop backend genuinely is (Tauri's plugin-store).
 */
export interface PreferencesStore {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
}

/**
 * `localStorage`-backed, for the web build. Storage can throw in a
 * private window or with site data blocked (same as `theme.ts`'s
 * precedent) — a failure just means "no preference saved/remembered",
 * not a broken page.
 */
function createWebPreferencesStore(): PreferencesStore {
  return {
    async get(key) {
      try {
        return localStorage.getItem(key) ?? undefined
      } catch {
        return undefined
      }
    },
    async set(key, value) {
      try {
        localStorage.setItem(key, value)
      } catch {
        // Not being able to remember the choice is not worth breaking anything for.
      }
    },
  }
}

let desktopStore: Store | undefined

async function getDesktopStore(): Promise<Store> {
  // autoSave persists on every set() — preference changes are rare, not a
  // hot path. A separate store file from `config/localConfig.ts`'s
  // settings.json, so preferences and API-key secrets never share one.
  desktopStore ??= await load('preferences.json', { autoSave: true })
  return desktopStore
}

function createDesktopPreferencesStore(): PreferencesStore {
  return {
    async get(key) {
      const store = await getDesktopStore()
      return await store.get<string>(key)
    },
    async set(key, value) {
      const store = await getDesktopStore()
      await store.set(key, value)
    },
  }
}

let sharedStore: PreferencesStore | undefined

/** Runtime selection, the same check `api.ts` already uses and has proven. */
export function getPreferencesStore(): PreferencesStore {
  sharedStore ??=
    typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
      ? createDesktopPreferencesStore()
      : createWebPreferencesStore()

  return sharedStore
}

/** Namespaces a per-list key so two lists' collapse state/focus can never collide. */
export function listPreferenceKey(listId: string, key: string): string {
  return `list:${listId}:${key}`
}
