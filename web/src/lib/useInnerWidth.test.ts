// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useInnerWidth } from './useInnerWidth.js'

const original = window.innerWidth

afterEach(() => {
  window.innerWidth = original
})

/** The window’s inner width, the value the layers use, followed while it is resized (Phase 49.12: the warning goes at 1128px without a reload). */
describe('useInnerWidth', () => {
  it('starts as the window is', () => {
    window.innerWidth = 1127

    expect(renderHook(() => useInnerWidth()).result.current).toBe(1127)
  })

  it('follows a resize, both ways', () => {
    window.innerWidth = 1127
    const { result } = renderHook(() => useInnerWidth())

    act(() => {
      window.innerWidth = 1128
      window.dispatchEvent(new Event('resize'))
    })
    expect(result.current).toBe(1128)

    act(() => {
      window.innerWidth = 900
      window.dispatchEvent(new Event('resize'))
    })
    expect(result.current).toBe(900)
  })

  it('stops listening when it unmounts', () => {
    window.innerWidth = 1127
    const { result, unmount } = renderHook(() => useInnerWidth())
    unmount()

    window.innerWidth = 1300
    window.dispatchEvent(new Event('resize'))

    expect(result.current).toBe(1127)
  })
})
