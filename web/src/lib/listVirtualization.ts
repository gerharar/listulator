import { combineVirtualization, parseVirtualization, type VirtualizationMode } from '../../../server/src/catalog/listVirtualization.js'
import type { PreferencesStore } from './preferences/store.js'

/**
 * Whether a long list draws only the rows in view (Phase 25.7, BACKLOG BL-074): a safety net, so there is no Settings screen for it. Two
 * places can turn it off, and `off` from either wins:
 *  - the app's own preference `listVirtualization` (`"off"` in the desktop's `preferences.json`, or the same key in the browser's
 *    `localStorage`), written by hand and documented in `guides/long-lists.md`;
 *  - the server's `LIST_VIRTUALIZATION` variable, for a self-hoster, learned from `GET /api/server-settings` (the desktop has no server).
 * Anything unreadable (a value nobody understands, a server that cannot be asked, storage that throws) counts as `auto` for that source:
 * the switch must never be the thing that breaks a list.
 */
export const LIST_VIRTUALIZATION_KEY = 'listVirtualization'

/** A read that may throw, fail or answer nothing (storage blocked, no server, a stub): `undefined` then, never an exception. */
async function attempt<T>(read: () => Promise<T> | T): Promise<T | undefined> {
  try {
    return await read()
  } catch {
    return undefined
  }
}

export async function loadVirtualization(
  store: PreferencesStore,
  serverSettings: () => Promise<{ listVirtualization?: unknown }>,
): Promise<VirtualizationMode> {
  const preference = parseVirtualization(await attempt(() => store.get(LIST_VIRTUALIZATION_KEY))) ?? 'auto'
  const server = parseVirtualization((await attempt(serverSettings))?.listVirtualization) ?? 'auto'

  return combineVirtualization(preference, server)
}
