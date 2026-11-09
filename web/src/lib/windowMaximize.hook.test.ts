import { afterEach, describe, expect, it } from 'vitest'
import { loadIsolationHook, type IpcMessage } from './isolationHook.testing.js'
import { maximizeWindow } from './windowMaximize.js'

/**
 * The permission is half of what lets the page maximise the window: the desktop app\u2019s isolation hook sees every message first and refuses any command it does not know
 * (\u201ccommand not allowed\u201d), so a permission with no entry in the hook is granted and still unreachable. That is what happened in 49.11: Embiggen did nothing on the Mac and the
 * helper swallowed the refusal. This runs the helper\u2019s real call (the real Tauri window API, its IPC stubbed) through the real hook, as the SQL tests do with theirs.
 * A node test: the hook file is located by a file URL, which a jsdom test does not have.
 */
const globals = globalThis as unknown as { window?: unknown }

afterEach(() => {
  delete globals.window
})

describe('what maximizeWindow sends, through the isolation hook', () => {
  it('is a message the hook lets through untouched, so the native side receives it', async () => {
    const sent: IpcMessage[] = []
    globals.window = {
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
        invoke: async (cmd: string, payload: unknown) => {
          sent.push({ cmd, callback: 1, error: 2, payload, options: {} })
        },
      },
    }

    expect(await maximizeWindow()).toBe(true)

    expect(sent.map((message) => message.cmd)).toEqual(['plugin:window|maximize'])
    const { hook, warnings } = loadIsolationHook()
    const out = hook(sent[0]!)
    expect(out.cmd, warnings.join('; ')).toBe('plugin:window|maximize')
    expect(out.payload).toBe(sent[0]!.payload)
  })
})
