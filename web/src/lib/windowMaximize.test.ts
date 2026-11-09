// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { getWindowMaximize, maximizeWindow, type WindowMaximize } from './windowMaximize.js'

/**
 * Maximising the desktop window (Phase 49.11): the narrow-window warning’s button fills the screen, and a window-state plugin restores a maximised window on the
 * next start. Only that call: no size, no position, no centre, no un-maximise (the permission is `core:window:allow-maximize` and nothing else, pinned by the
 * capability guard). A fake control stands in for the native window, which no browser test can drive.
 */
describe('maximizeWindow', () => {
  it('maximises the window once, and says it did', async () => {
    const control: WindowMaximize = { maximize: vi.fn(async () => {}) }

    expect(await maximizeWindow(control)).toBe(true)
    expect(control.maximize).toHaveBeenCalledTimes(1)
  })

  it('says it did not when the window refuses, and never throws: the warning stays, and the person can switch back', async () => {
    const control: WindowMaximize = { maximize: vi.fn(async () => Promise.reject(new Error('not allowed'))) }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(await maximizeWindow(control)).toBe(false)

    // Never silent: a button that does nothing has to leave a reason in the console (the isolation hook\u2019s refusal says its own; this says the call failed).
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.join(' '))).toContain('not allowed')
    warn.mockRestore()
  })

  it('does nothing where there is no desktop window (the browser build): false, and no error', async () => {
    expect(await maximizeWindow(undefined)).toBe(false)
  })
})

describe('getWindowMaximize', () => {
  it('is the desktop window’s control only inside the desktop app; a browser has none', () => {
    // jsdom is not the desktop app: no `__TAURI_INTERNALS__`.
    expect(getWindowMaximize()).toBeUndefined()
  })
})

