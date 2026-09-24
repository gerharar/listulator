/**
 * True inside the Tauri desktop shell, where the app talks to its own local
 * database and keys live in Settings; false in a plain browser talking to a
 * server. The same check `api.ts` and the preferences store already use to
 * pick their implementation.
 */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}
