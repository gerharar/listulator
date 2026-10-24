/**
 * Where the jump rail sits (H-019). Inside the card is today's layout; outside it
 * is the card's left margin, used only when the window already has the room, so
 * the card never changes width. The rule reads the window and the card only,
 * never the rail's width: the rail is resizable, and a rule tied to its width
 * would throw a widened rail back inside.
 */

export type RailPlacement = 'inside' | 'outside'

/** The card's width cap (`.q-layer`), and the stage's inset on each side (`.q-stage .q-layer`). */
const CARD_MAX = 1080
const STAGE_INSET = 20
/** The default 200px rail plus 16px of air. */
const OUT_AT = 216
/** 16px of hysteresis, so a window dragged near the line does not flicker. */
const IN_BELOW = 200
const AIR = 16

function room(windowWidth: number): number {
  return windowWidth - 2 * STAGE_INSET
}

/** The room beside the card on each side: the window minus its inset, minus the card, halved. */
export function cardMargin(windowWidth: number): number {
  return Math.max(0, (room(windowWidth) - Math.min(CARD_MAX, room(windowWidth))) / 2)
}

export function railPlacement(windowWidth: number, current: RailPlacement): RailPlacement {
  const margin = cardMargin(windowWidth)

  return margin >= OUT_AT || (current === 'outside' && margin >= IN_BELOW) ? 'outside' : 'inside'
}

/** The stored width, capped so the rail keeps 16px of air before the window edge. The cap is never stored. */
export function outsideRailWidth(stored: number, margin: number): number {
  return Math.min(stored, margin - AIR)
}

/**
 * The card's width at a window that leaves it room to centre: 1px less when the
 * remainder is odd, so each margin is a whole pixel and the rail's border lies
 * exactly over the card's (owner's 800% check showed a 1px step). `null` while
 * the card fills the window and its own CSS sizes it.
 */
export function listCardWidth(windowWidth: number): number | null {
  if (room(windowWidth) < CARD_MAX) return null

  return (room(windowWidth) - CARD_MAX) % 2 === 0 ? CARD_MAX : CARD_MAX - 1
}
