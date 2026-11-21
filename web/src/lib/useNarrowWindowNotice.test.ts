// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useNarrowWindowNotice } from './useNarrowWindowNotice.js'

/**
 * The state of the narrow-window warning (Phase 49.12), with every input given so each path can be driven, the desktop ones too (no browser test can press a
 * native window’s button). Under eX-Zed a window narrower than the minimum shows a banner, whatever made it narrow: the start, a resize, the switch in Settings (D49, 57.1: the
 * popover on the chip is gone). Dismiss lasts the session, a fresh switch to eX-Zed asks again; Embiggen is offered once.
 */
type Inputs = Parameters<typeof useNarrowWindowNotice>[0]

const base: Inputs = { exzed: true, width: 1127, min: 1128, desktop: false, screenWidth: 1920, maximize: async () => true }

function hook(overrides: Partial<Inputs> = {}) {
  return renderHook((props: Inputs) => useNarrowWindowNotice(props), { initialProps: { ...base, ...overrides } })
}

describe('when the app starts in eX-Zed', () => {
  it('shows the banner in a window one pixel under the minimum, and nothing at the minimum', () => {
    expect(hook({ width: 1127 }).result.current).toMatchObject({ narrow: true, banner: true })
    expect(hook({ width: 1128 }).result.current).toMatchObject({ narrow: false, banner: false })
  })

  it('shows nothing when eX-Zed is not the theme drawn (Quantum, or any touch-only device)', () => {
    expect(hook({ exzed: false, width: 600 }).result.current).toMatchObject({ narrow: false, banner: false })
  })

  it('goes when the window is widened to the minimum, and comes back if it is narrowed again', () => {
    const { result, rerender } = hook({ width: 1127 })
    expect(result.current.banner).toBe(true)

    rerender({ ...base, width: 1128 })
    expect(result.current.banner).toBe(false)

    rerender({ ...base, width: 1100 })
    expect(result.current.banner).toBe(true)
  })

  it('Dismiss hides it for this session, whatever the window does after', () => {
    const { result, rerender } = hook({ width: 1127 })

    act(() => result.current.dismiss())
    expect(result.current.banner).toBe(false)

    rerender({ ...base, width: 1300 })
    rerender({ ...base, width: 1000 })
    expect(result.current.banner).toBe(false)
  })
})

describe('when the person switches to eX-Zed in a window that is too narrow (D49)', () => {
  it('shows the same banner, and never a popover or an anchor', () => {
    const { result } = hook({ width: 1127 })

    act(() => result.current.reopen())

    expect(result.current).toMatchObject({ narrow: true, banner: true })
    expect(result.current).not.toHaveProperty('popover')
    expect(result.current).not.toHaveProperty('anchor')
  })

  it('shows nothing in a window wide enough', () => {
    const { result } = hook({ width: 1400 })

    act(() => result.current.reopen())

    expect(result.current).toMatchObject({ narrow: false, banner: false })
  })

  it('a fresh switch after a Dismiss shows the banner again: it is a new question', () => {
    const { result } = hook({ width: 1127 })
    act(() => result.current.dismiss())
    expect(result.current.banner).toBe(false)

    act(() => result.current.reopen())

    expect(result.current.banner).toBe(true)
  })

  it('Dismiss hides it, and it stays hidden through a widening and a narrowing', () => {
    const { result, rerender } = hook({ width: 1127 })
    act(() => result.current.reopen())

    act(() => result.current.dismiss())
    rerender({ ...base, width: 1300 })
    rerender({ ...base, width: 1000 })

    expect(result.current.banner).toBe(false)
  })

  it('goes when the window is widened, and comes back when it is narrowed again (after Embiggen and shrink)', () => {
    const { result, rerender } = hook({ width: 1127 })
    act(() => result.current.reopen())

    rerender({ ...base, width: 1200 })
    expect(result.current.banner).toBe(false)

    rerender({ ...base, width: 1127 })
    expect(result.current.banner).toBe(true)
  })
})

describe('what is offered', () => {
  it('in a browser: the line that asks to widen the window, whatever the screen', () => {
    expect(hook({ desktop: false, screenWidth: 800 }).result.current.mode).toBe('browser')
  })

  it('on the desktop with a screen that holds the minimum: Embiggen; on one that does not: the line alone', () => {
    expect(hook({ desktop: true, screenWidth: 1440 }).result.current.mode).toBe('embiggen')
    expect(hook({ desktop: true, screenWidth: 1093 }).result.current.mode).toBe('screen')
  })

  it('Embiggen maximises the window once; if it is still narrow afterwards the button goes and the line stays', async () => {
    const maximize = vi.fn(async () => true)
    const { result } = hook({ desktop: true, screenWidth: 1440, maximize })

    await act(async () => result.current.embiggen())

    expect(maximize).toHaveBeenCalledTimes(1)
    expect(result.current.mode).toBe('screen')
  })

  it('Embiggen refused by the window keeps the button: nothing happened, the person can try again', async () => {
    const { result } = hook({ desktop: true, screenWidth: 1440, maximize: async () => false })

    await act(async () => result.current.embiggen())

    expect(result.current.mode).toBe('embiggen')
  })

  it('after Embiggen worked and the window is wide, a later narrowing offers Embiggen again', async () => {
    const { result, rerender } = hook({ desktop: true, screenWidth: 1440 })
    await act(async () => result.current.embiggen())
    expect(result.current.mode).toBe('screen')

    rerender({ ...base, desktop: true, screenWidth: 1440, width: 1400 })
    rerender({ ...base, desktop: true, screenWidth: 1440, width: 1000 })

    expect(result.current.mode).toBe('embiggen')
  })
})
