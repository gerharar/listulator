import { useLayoutEffect, type ReactNode } from 'react'
import { useMotion } from '../Motion/MotionContext.js'

export interface DocumentThemeProps {
  /** The active skin — becomes `data-theme`, which every generated token block keys off. */
  skin: string
  children: ReactNode
}

/**
 * Writes the look onto `<html>` (task 10.32): `data-theme` for the skin,
 * `data-motion` for the motion mode and `data-reduced` when animation is
 * cut. The tokens are scoped to `html`, so a popover portaled to `body`
 * resolves `var(--card)` like everything else — the trap the old `.q-root`
 * wrapper and its portal context existed to avoid. A layout effect, so the
 * skin is on the document before the first frame is painted.
 */
export function DocumentTheme({ skin, children }: DocumentThemeProps) {
  const { motion, reduced } = useMotion()

  useLayoutEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', skin)
    root.setAttribute('data-motion', motion)
    if (reduced) root.setAttribute('data-reduced', '')
    else root.removeAttribute('data-reduced')
  }, [skin, motion, reduced])

  useLayoutEffect(
    () => () => {
      const root = document.documentElement
      for (const name of ['data-theme', 'data-motion', 'data-reduced']) root.removeAttribute(name)
    },
    [],
  )

  return <>{children}</>
}
