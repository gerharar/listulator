// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { ThemeContext } from '../../components/quantum/DocumentTheme/ThemeContext.js'
import type { Theme } from '../../lib/preferences/theme.js'
import { useListHeights } from './useListHeights.js'

/**
 * The list's row heights follow the theme (Phase 49.7). `listHeights()` reads the page when it is called, and a list screen builds its row model in a
 * `useMemo`: the heights it was built with would stay for good once the theme changes under an open list (46px rows in a page that draws 32px ones).
 * The theme is the key of that memo. The page's tokens are set here the way the class sets them, on `<html>`.
 */
const html = document.documentElement
let theme: Theme = 'quantum'

function wrapper({ children }: { children: ReactNode }) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
}

afterEach(() => {
  theme = 'quantum'
  html.style.removeProperty('--row-h')
  html.style.removeProperty('--group-h')
})

describe('useListHeights', () => {
  it('is the page’s heights now: Quantum’s 46 and 47 where it sets none', () => {
    const { result } = renderHook(() => useListHeights(), { wrapper })

    expect(result.current).toEqual({ itemHeight: 46, groupHeight: 47 })
  })

  it('is read again when the theme changes, so an open list is laid out at the new theme’s rows', () => {
    const { result, rerender } = renderHook(() => useListHeights(), { wrapper })
    expect(result.current.itemHeight).toBe(46)

    html.style.setProperty('--row-h', '32px')
    html.style.setProperty('--group-h', '32px')
    theme = 'exzed'
    rerender()

    expect(result.current).toEqual({ itemHeight: 32, groupHeight: 32 })
  })

  it('and back: eX-Zed’s 32 and 32 to Quantum’s 46 and 47', () => {
    html.style.setProperty('--row-h', '32px')
    html.style.setProperty('--group-h', '32px')
    theme = 'exzed'
    const { result, rerender } = renderHook(() => useListHeights(), { wrapper })
    expect(result.current.itemHeight).toBe(32)

    html.style.removeProperty('--row-h')
    html.style.removeProperty('--group-h')
    theme = 'quantum'
    rerender()

    expect(result.current).toEqual({ itemHeight: 46, groupHeight: 47 })
  })

  it('stays the same object while the theme stays, so a row model built from it is not rebuilt for nothing', () => {
    const { result, rerender } = renderHook(() => useListHeights(), { wrapper })
    const first = result.current

    rerender()
    rerender()

    expect(result.current).toBe(first)
  })
})
