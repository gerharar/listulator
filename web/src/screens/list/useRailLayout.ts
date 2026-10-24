import { cardMargin, RAIL_AIR, shownRailWidth } from './railPlacement.js'
import { useRailPlacement } from './RailPlacementContext.js'

/**
 * What the list screen and the Preview both work out from where the jump rail sits (H-019): whether it is drawn at all, how wide it may be
 * outside the card, the width it is drawn at, and what a resize does to the carry. `entryCount` is the groups it lists, `active` whether
 * this is the top layer.
 */
export function useRailLayout(entryCount: number, active: boolean) {
  const where = useRailPlacement()
  const outside = where.placement === 'outside'

  return {
    outside,
    // Outside the card the rail belongs to the active layer alone: a covered layer's veil is inside the card and would not reach it.
    show: entryCount > 1 && (active || !outside),
    /** The widest it may be outside: the window's room beside the card, less 16px. The cap is never stored. */
    maxWidth: cardMargin(where.windowWidth) - RAIL_AIR,
    shownWidth: (stored: number) => shownRailWidth(stored, where),
    /** The rail's `onResize`: the reader has set a width, which ends the carry before the width is passed on. */
    resizing: (set: (width: number) => void) => (width: number) => {
      where.release?.()
      set(width)
    },
  }
}
