/**
 * Where the jump rail sits (H-019). Inside the card is today's layout; outside it
 * is the card's left margin, used only when the window already has the room, so
 * the card never changes width. The rule reads the window and the card only,
 * never the rail's width: the rail is resizable, and a rule tied to its width
 * would throw a widened rail back inside.
 */

import { RAIL_WIDTH_MIN } from './collapse.js'

export type RailPlacement = 'inside' | 'outside'

/** The card's width cap (`.q-layer`), and the stage's inset on each side (`.q-stage .q-layer`). */
const CARD_MAX = 1080
const STAGE_INSET = 20
/** The default 200px rail plus 16px of air. */
const OUT_AT = 216
/** 16px of hysteresis, so a window dragged near the line does not flicker. */
const IN_BELOW = 200
/** What the rail leaves free before the window's edge. */
export const RAIL_AIR = 16

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
  return Math.min(stored, margin - RAIL_AIR)
}

/**
 * The rail's width inside, after the window narrowed through the switch (owner, 2026-10-24: it jumped wide again and stopped following the window).
 * The outside cap (margin minus 16px) carries on as if the margin did: it is 184px at the switch and falls by half a pixel per pixel of window
 * down to the 160px minimum. Pure in the window and the stored width, so it is the same just before and just after the switch. It is the shown
 * width only: the reader's own width stays stored, comes back in a wider window, and is what the reader sets by resizing (which ends the carry).
 */
export function carriedRailWidth(stored: number, windowWidth: number): number {
  const virtualMargin = (room(windowWidth) - CARD_MAX) / 2

  return Math.min(stored, Math.max(RAIL_WIDTH_MIN, virtualMargin - RAIL_AIR))
}

/** At this window width, and below it, the carried rail is at its 160px minimum: a narrower window changes nothing that is drawn. */
export const CARRY_FLOOR_WIDTH = 2 * (RAIL_WIDTH_MIN + RAIL_AIR) + CARD_MAX + 2 * STAGE_INSET

/** The width the rail is drawn at: the stored one, capped outside by the margin, or following the window while it is carried inside. */
export function shownRailWidth(stored: number, where: { placement: RailPlacement; windowWidth: number; carried?: boolean }): number {
  if (where.placement === 'outside') return outsideRailWidth(stored, cardMargin(where.windowWidth))

  return where.carried ? carriedRailWidth(stored, where.windowWidth) : stored
}

/**
 * The width of the card's 2px border that the browser really draws, in CSS px. A border is drawn as a whole number of device pixels, rounded down
 * (2px is 2 device pixels at 100% and 200%, but 1.6px at 125%), while a length is not: a rail offset by a plain 2px then stands half a device pixel
 * past the card's edge and its line lies a pixel lower (the owner's Windows screen at 125%, 2026-10-24). The card and the rail both take this
 * width, so the two edges are the same number. The extra thousandth of a device pixel keeps the browser's rounding down from taking a pixel off.
 */
export function layerBorderWidth(devicePixelRatio: number): number {
  if (!(devicePixelRatio > 0)) return 2

  return (Math.max(1, Math.floor(2 * devicePixelRatio)) + 0.001) / devicePixelRatio
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
