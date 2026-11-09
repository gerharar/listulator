import { useMemo } from 'react'
import { useTheme } from '../../components/quantum/DocumentTheme/ThemeContext.js'
import { listHeights, type RowHeights } from './rowModel.js'

/**
 * The list's row heights as the page draws them, read again when the theme changes (Phase 49.7). `listHeights()` asks the page, and the page's rows
 * are the theme's (46px in Quantum, 32px in eX-Zed); a screen that builds its row model in a `useMemo` would otherwise keep the heights of the theme it
 * opened in. The theme is the memo's key, and the shell has put the new theme's class on `<html>` before the render that sees it.
 */
export function useListHeights(): RowHeights {
  const theme = useTheme()

  // `theme` is not read inside: it is what the page's answer depends on, so it is when to ask again.
  return useMemo(() => listHeights(), [theme])
}
