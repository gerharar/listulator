import { useLayoutEffect, type ReactNode } from 'react'
import type { Theme } from '../../../lib/preferences/theme.js'
import { useMotion } from '../Motion/MotionContext.js'
import { ThemeContext } from './ThemeContext.js'

export interface DocumentThemeProps {
  /** The active skin — becomes `data-theme`, which every generated token block keys off. */
  skin: string
  /** The theme: eX-Zed puts `theme-exzed` on `<html>`; Quantum, the default, puts nothing, so its CSS never meets a rule of the other. */
  theme?: Theme
  children: ReactNode
}

/** The class a theme sets on `<html>`; Quantum has none. */
const THEME_CLASS = 'theme-exzed'

/**
 * Puts the theme's class on `<html>` (and takes the other's off). `App` calls it as soon as the stored theme is read, before the first render: what is
 * laid out in TypeScript from the theme's sizes (the list's row model, the rail's margins) reads them while it renders, and a class that arrived in an
 * effect after that would leave it laid out for Quantum.
 */
export function applyThemeClass(theme: Theme): void {
  document.documentElement.classList.toggle(THEME_CLASS, theme === 'exzed')
}

/**
 * Puts the skin's key on `<html>` as `data-theme`, as `applyThemeClass` does the class, and for the same reason: what is read from the page's tokens while the shell
 * renders (the layers' tops, which a skin's separator can move: Ikigai's ledge shift, 50.4) must already be the skin's, and `DocumentTheme`'s effect writes the attribute only
 * after that render. Called first, in the handlers and at boot, before the state that makes the render.
 */
export function applyDocumentSkin(skin: string): void {
  document.documentElement.setAttribute('data-theme', skin)
}

/**
 * Writes the look onto `<html>` (task 10.32): `data-theme` for the skin, the theme class and `data-reduced` when animation is cut.
 * The tokens are scoped to `html`, so a popover portaled to `body`
 * resolves `var(--card)` like everything else — the trap the old `.q-root`
 * wrapper and its portal context existed to avoid. A layout effect, so the
 * skin is on the document before the first frame is painted.
 */
export function DocumentTheme({ skin, theme = 'quantum', children }: DocumentThemeProps) {
  const { reduced } = useMotion()

  useLayoutEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', skin)
    if (reduced) root.setAttribute('data-reduced', '')
    else root.removeAttribute('data-reduced')
  }, [skin, reduced])

  // Only the class this component owns: others on <html> (a test's, a browser extension's) are not its to touch.
  useLayoutEffect(() => {
    applyThemeClass(theme)
  }, [theme])

  useLayoutEffect(
    () => () => {
      const root = document.documentElement
      for (const name of ['data-theme', 'data-reduced']) root.removeAttribute(name)
      root.classList.remove(THEME_CLASS)
    },
    [],
  )

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
}
