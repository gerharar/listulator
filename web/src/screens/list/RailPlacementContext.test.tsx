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
    expect(renderHook(() => useWindowRailPlacement()).result.current).toEqual({ placement: 'outside', windowWidth: 1728, carried: false, release: expect.any(Function) })

    window.innerWidth = 1440
    expect(renderHook(() => useWindowRailPlacement()).result.current).toEqual({ placement: 'inside', windowWidth: 1440, carried: false, release: expect.any(Function) })
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

  it('does not change anything while it stays inside, so a window dragged narrow does not redraw the app on every pixel', () => {
    window.innerWidth = 1440
    const { result } = renderHook(() => useWindowRailPlacement())
    const first = result.current

    resizeTo(1400)
    resizeTo(1300)

    expect(result.current).toBe(first)
  })

  it('follows the width while it is outside: the card and the rail’s cap depend on it', () => {
    window.innerWidth = 1728
    const { result } = renderHook(() => useWindowRailPlacement())

    resizeTo(1801)

    expect(result.current).toEqual({ placement: 'outside', windowWidth: 1801, carried: false, release: expect.any(Function) })
  })

  it('stops listening when it unmounts', () => {
    window.innerWidth = 1440
    const { result, unmount } = renderHook(() => useWindowRailPlacement())
    unmount()
    resizeTo(1920)
    expect(result.current.placement).toBe('inside')
  })

  describe('the rail carried inside (the width follows the window after it left the card)', () => {
    it('is carried only when the window narrowed from outside to inside, and then follows the width', () => {
      window.innerWidth = 1728
      const { result } = renderHook(() => useWindowRailPlacement())

      resizeTo(1519)
      expect(result.current).toMatchObject({ placement: 'inside', carried: true, windowWidth: 1519 })
      resizeTo(1480)
      expect(result.current).toMatchObject({ placement: 'inside', carried: true, windowWidth: 1480 })
    })

    it('stops redrawing once the carried rail is at its minimum: a narrow window dragged narrower changes nothing', () => {
      window.innerWidth = 1728
      const { result } = renderHook(() => useWindowRailPlacement())
      resizeTo(1500)
      resizeTo(1400)
      // The step across the floor is the last one that is seen.
      expect(result.current).toMatchObject({ placement: 'inside', carried: true, windowWidth: 1400 })
      const atFloor = result.current

      resizeTo(1350)
      resizeTo(1200)

      expect(result.current).toBe(atFloor)

      resizeTo(1500)
      expect(result.current).toMatchObject({ carried: true, windowWidth: 1500 })
    })

    it('is not carried in a window that opened inside: the stored width is shown', () => {
      window.innerWidth = 1440
      const { result } = renderHook(() => useWindowRailPlacement())
      const first = result.current

      resizeTo(1300)

      expect(result.current).toBe(first)
      expect(result.current.carried).toBe(false)
    })

    it('ends when the reader resizes the rail (release), and stays ended while the window narrows', () => {
      window.innerWidth = 1728
      const { result } = renderHook(() => useWindowRailPlacement())
      resizeTo(1500)

      act(() => result.current.release())
      expect(result.current.carried).toBe(false)
      const released = result.current
      resizeTo(1400)
      expect(result.current).toBe(released)
    })

    it('ends when the window goes wide enough to put the rail outside again', () => {
      window.innerWidth = 1728
      const { result } = renderHook(() => useWindowRailPlacement())
      resizeTo(1500)

      resizeTo(1600)

      expect(result.current).toMatchObject({ placement: 'outside', carried: false })
    })
  })
})
