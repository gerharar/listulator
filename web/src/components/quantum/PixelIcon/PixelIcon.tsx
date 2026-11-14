import type { ReactNode } from 'react'
import { useTheme } from '../DocumentTheme/ThemeContext.js'

/**
 * eX-Zed's pixel icons (the design system's `project/assets/Icons`): 8x8 cells drawn at 2px (16px), one ink (`currentColor`), sharp edges. The paths are design's own, one per icon the app draws with
 * Quantum's line icons in a place the owner found at his first look (51.13): the header's Settings, About and Quit, and the refresh that checks for updates.
 */
export const PIXEL_ICONS = {
  settings: 'M3 0h2v1H3zM1 1h6v1H1zM0 3h1v2H0zM7 3h1v2H7zM1 2h2v4H1zM5 2h2v4H5zM3 2h2v1H3zM3 5h2v1H3zM1 6h6v1H1zM3 7h2v1H3z',
  about: 'M2 0h4v1H2zM1 1h1v1H1zM6 1h1v1H6zM0 2h1v4H0zM7 2h1v4H7zM1 6h1v1H1zM6 6h1v1H6zM2 7h4v1H2zM3 2h2v1H3zM3 4h2v2H3z',
  quit: 'M3 0h2v4H3zM1 1h1v1H1zM6 1h1v1H6zM0 2h1v4H0zM7 2h1v4H7zM1 6h1v1H1zM6 6h1v1H6zM2 7h4v1H2z',
  refresh: 'M2 0h4v1H2zM1 1h1v1H1zM0 2h1v4H0zM7 0h1v3H7zM5 2h2v1H5zM1 6h1v1H1zM7 4h1v2H7zM6 6h1v1H6zM2 7h4v1H2z',
} as const

export type PixelIconName = keyof typeof PIXEL_ICONS

export interface PixelIconProps {
  name: PixelIconName
  className?: string
}

/** Hidden from assistive technology: the control keeps its own name. A class (`q-spin`) goes on the drawing, so it turns as Quantum's does. */
export function PixelIcon({ name, className }: PixelIconProps) {
  return (
    <svg
      className={className}
      data-pixel-icon={name}
      width={16}
      height={16}
      viewBox="0 0 8 8"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      <path fill="currentColor" d={PIXEL_ICONS[name]} />
    </svg>
  )
}

/** Design's pixel icon under eX-Zed, Quantum's own (`fallback`) under Quantum: the DOM differs only where the drawing does. */
export function ThemedIcon({ name, fallback, className }: PixelIconProps & { fallback: ReactNode }) {
  return useTheme() === 'exzed' ? <PixelIcon name={name} {...(className ? { className } : {})} /> : fallback
}
