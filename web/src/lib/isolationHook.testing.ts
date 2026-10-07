import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Loads the desktop app's isolation hook the way the isolation frame does: the file is a plain script that sets
 * `window.__TAURI_ISOLATION_HOOK__`, so it is run here against a stand-in `window` (security review, Phase 19,
 * 19.12.3; `apps/desktop/isolation/hook.js`).
 */
export interface IpcMessage {
  cmd: string
  callback: number
  error: number
  payload: unknown
  options?: unknown
}

export type IsolationHook = (message: IpcMessage) => IpcMessage

export const HOOK_FILE = fileURLToPath(new URL('../../../apps/desktop/isolation/hook.js', import.meta.url))

export function loadIsolationHook(source: string = readFileSync(HOOK_FILE, 'utf8')): { hook: IsolationHook; warnings: string[] } {
  const warnings: string[] = []
  const fakeWindow: { __TAURI_ISOLATION_HOOK__?: IsolationHook } = {}
  const fakeConsole = { warn: (...parts: unknown[]) => void warnings.push(parts.join(' ')), log: () => undefined }
  new Function('window', 'console', source)(fakeWindow, fakeConsole)
  const hook = fakeWindow.__TAURI_ISOLATION_HOOK__
  if (typeof hook !== 'function') throw new Error('the hook file did not set window.__TAURI_ISOLATION_HOOK__')

  return { hook, warnings }
}

const DATABASE = 'sqlite:listulator.sqlite'

/**
 * For tests that replace the SQL plugin with a real SQLite: every statement the app sends goes through the hook first, as
 * it does in the built app, and a refusal fails the test. Thousands of the app's real statements are the evidence that
 * the hook refuses nothing the app needs.
 */
export function sqlThroughHook(): (command: 'select' | 'execute', query: string, values: unknown[]) => void {
  const { hook } = loadIsolationHook()

  return (command, query, values) => {
    const sent: IpcMessage = { cmd: `plugin:sql|${command}`, callback: 1, error: 2, payload: { db: DATABASE, query, values } }
    if (hook(sent) !== sent) throw new Error(`the isolation hook refused the app's own statement: ${query}`)
  }
}
