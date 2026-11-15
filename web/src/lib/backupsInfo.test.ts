import { afterEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))

import { getBackupsInfo } from './backupsInfo.js'

afterEach(() => {
  invoke.mockReset()
  vi.unstubAllGlobals()
})

function onDesktop(): void {
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} })
}

describe('getBackupsInfo (52.3)', () => {
  it('asks the app’s own command, which takes nothing, and passes on the folder and the count', async () => {
    onDesktop()
    invoke.mockResolvedValue({
      folder: '/Users/x/Library/Application Support/com.listulator.desktop/backups',
      count: 2,
    })

    expect(await getBackupsInfo()).toEqual({
      folder: '/Users/x/Library/Application Support/com.listulator.desktop/backups',
      count: 2,
    })
    expect(invoke).toHaveBeenCalledWith('backups_info')
  })

  it('is null when there is no copy to tell of', async () => {
    onDesktop()
    invoke.mockResolvedValue(null)

    expect(await getBackupsInfo()).toBeNull()
  })

  it('is null, and never throws, when the command cannot be reached: it only adds to a screen that already says something failed', async () => {
    onDesktop()
    invoke.mockRejectedValue(new Error('command backups_info not allowed'))

    expect(await getBackupsInfo()).toBeNull()
  })

  it('does not ask in a browser, where there is no app and no folder', async () => {
    vi.stubGlobal('window', {})

    expect(await getBackupsInfo()).toBeNull()
    expect(invoke).not.toHaveBeenCalled()
  })
})
