import { describe, expect, it, vi } from 'vitest'
import { handleEscape } from './escLadder.js'
import { createOverlayManager } from './overlayManager.js'

describe('handleEscape', () => {
  it('falls through to popping a layer when nothing is open', () => {
    const manager = createOverlayManager()
    const popLayer = vi.fn()

    handleEscape(manager, popLayer)

    expect(popLayer).toHaveBeenCalledOnce()
  })

  it('closes the topmost popover instead of popping a layer', () => {
    const manager = createOverlayManager()
    const closePopover = vi.fn()
    const popLayer = vi.fn()
    manager.register({ id: 'pop-1', kind: 'popover', close: closePopover })

    handleEscape(manager, popLayer)

    expect(closePopover).toHaveBeenCalledOnce()
    expect(popLayer).not.toHaveBeenCalled()
  })

  it('closes only the topmost overlay when a sheet and a popover are both open, not both', () => {
    const manager = createOverlayManager()
    const closeSheet = vi.fn()
    const closePopover = vi.fn()
    manager.register({ id: 'sheet-1', kind: 'sheet', close: closeSheet })
    manager.register({ id: 'pop-1', kind: 'popover', close: closePopover })

    handleEscape(manager, vi.fn())

    expect(closePopover).toHaveBeenCalledOnce()
    expect(closeSheet).not.toHaveBeenCalled()
  })

  it('falls back to the sheet once the popover on top of it has closed itself', () => {
    const manager = createOverlayManager()
    const closeSheet = vi.fn()
    manager.register({ id: 'sheet-1', kind: 'sheet', close: closeSheet })
    manager.register({ id: 'pop-1', kind: 'popover', close: () => manager.unregister('pop-1') })

    handleEscape(manager, vi.fn()) // closes the popover
    const popLayer = vi.fn()
    handleEscape(manager, popLayer) // now closes the sheet

    expect(closeSheet).toHaveBeenCalledOnce()
    expect(popLayer).not.toHaveBeenCalled()
  })
})
