import { describe, expect, it, vi } from 'vitest'
import { createOverlayManager } from './overlayManager.js'

describe('createOverlayManager', () => {
  it('has no topmost overlay when nothing is registered', () => {
    const manager = createOverlayManager()
    expect(manager.topmost()).toBeUndefined()
  })

  it('reports the most recently registered overlay as topmost', () => {
    const manager = createOverlayManager()
    manager.register({ id: 'a', kind: 'sheet', close: vi.fn() })
    manager.register({ id: 'b', kind: 'popover', close: vi.fn() })

    expect(manager.topmost()?.id).toBe('b')
  })

  it('closes the previously open popover when a second popover registers — only one popover at a time', () => {
    const manager = createOverlayManager()
    const closeFirst = vi.fn()
    manager.register({ id: 'first', kind: 'popover', close: closeFirst })
    manager.register({ id: 'second', kind: 'popover', close: vi.fn() })

    expect(closeFirst).toHaveBeenCalledOnce()
    expect(manager.topmost()?.id).toBe('second')
  })

  it('does not close an open sheet when a popover registers — the one-at-a-time rule is popover-only', () => {
    const manager = createOverlayManager()
    const closeSheet = vi.fn()
    manager.register({ id: 'sheet-1', kind: 'sheet', close: closeSheet })
    manager.register({ id: 'pop-1', kind: 'popover', close: vi.fn() })

    expect(closeSheet).not.toHaveBeenCalled()
  })

  it('drops an overlay from the stack on unregister', () => {
    const manager = createOverlayManager()
    manager.register({ id: 'a', kind: 'sheet', close: vi.fn() })
    manager.register({ id: 'b', kind: 'popover', close: vi.fn() })

    manager.unregister('b')

    expect(manager.topmost()?.id).toBe('a')
  })

  it('re-registering the same id moves it to the top without closing itself', () => {
    const manager = createOverlayManager()
    const close = vi.fn()
    manager.register({ id: 'a', kind: 'popover', close })
    manager.register({ id: 'a', kind: 'popover', close })

    expect(close).not.toHaveBeenCalled()
    expect(manager.topmost()?.id).toBe('a')
  })
})
