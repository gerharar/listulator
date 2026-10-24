// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useWindowRailPlacement } from './RailPlacementContext.js'

/** The window's rail placement follows the window on resize only, with the rule's hysteresis. */

const original = window.innerWidth

function resizeTo(width: number) {
  act(() => {
    window.innerWidth = width
    window.dispatchEvent(new Event('resize'))
  })
}

afterEach(() => {
  window.innerWidth = original
})

describe('useWindowRailPlacement', () => {
  it('starts from the window it opens in', () => {
    window.innerWidth = 1728
    expect(renderHook(() => useWindowRailPlacement()).result.current).toEqual({ placement: 'outside', windowWidth: 1728 })

    window.innerWidth = 1440
    expect(renderHook(() => useWindowRailPlacement()).result.current).toEqual({ placement: 'inside', windowWidth: 1440 })
  })

  it('switches when the window is resized across the line, and back with 16px of hysteresis', () => {
    window.innerWidth = 1440
    const { result } = renderHook(() => useWindowRailPlacement())

    resizeTo(1552)
    expect(result.current.placement).toBe('outside')
    resizeTo(1530)
    expect(result.current.placement).toBe('outside')
    resizeTo(1519)
    expect(result.current.placement).toBe('inside')
    resizeTo(1530)
    expect(result.current.placement).toBe('inside')
  })

  it('stops listening when it unmounts', () => {
    window.innerWidth = 1440
    const { result, unmount } = renderHook(() => useWindowRailPlacement())
    unmount()
    resizeTo(1920)
    expect(result.current.placement).toBe('inside')
  })
})
