import { tokenPx } from './themeSizes.js'

/**
 * eX-Zed’s minimum window (Phase 49.12, design’s answers 7 and 8): a layer’s minimum plus the two gaps the stage keeps beside it, 1080 + 2 x 24 = 1128px. Read from the
 * page’s tokens (`--layer-min`, `--stage-gap-min`, set under `html.theme-exzed`), so the number is the one the layers use and cannot drift from them. Meaningful only
 * while eX-Zed is the theme drawn.
 */
export function narrowWindowMin(): number {
  return tokenPx('--layer-min', 1080) + 2 * tokenPx('--stage-gap-min', 24)
}

/** What the warning offers: the button that maximises, the line alone (nothing to maximise to), or the line that asks to widen the browser window. */
export type NarrowMode = 'embiggen' | 'screen' | 'browser'

/**
 * Where the app runs and what the screen can hold decide it (the owner’s decision, 2026-11-08). In the desktop app, a screen that holds the minimum gets the
 * button that maximises, once: if the window is still narrow after it was pressed, the button goes and the line stays, so the warning never offers what did not work.
 * A screen that does not hold the minimum gets the line alone. A browser or an installed web app cannot be resized from the page: the line asks the person to.
 */
export function narrowMode(where: { desktop: boolean; screenWidth: number; min: number; embiggened: boolean }): NarrowMode {
  if (!where.desktop) return 'browser'

  return where.screenWidth >= where.min && !where.embiggened ? 'embiggen' : 'screen'
}
