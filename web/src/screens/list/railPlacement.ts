/**
 * Where the jump rail sits (H-019). Inside the card is today's layout; outside it
 * is the card's left margin, used only when the window already has the room, so
 * the card never changes width. The rule reads the window and the card only,
 * never the rail's width: the rail is resizable, and a rule tied to its width
 * would throw a widened rail back inside.
 *
 * The card and the stage's gap are the page's own numbers (Phase 48.4): the list card's cap (`--layer-max-list`) and the stage's side gap
 * (`--stage-gap`), which the CSS draws the card with, so a theme with a wider card or gap changes the rule with it and the two cannot disagree.
 * Every function takes the geometry as its last argument, read from the page when it is not given; the tests give it.
 */

import { tokenPx } from '../../lib/themeSizes.js'
import { RAIL_WIDTH_MIN } from './railLimits.js'

export type RailPlacement = 'inside' | 'outside'

/** The card's width cap, and the stage's inset on each side of the window. */
export interface RailGeometry {
  cardMax: number
  inset: number
}

/** Quantum's: the fallbacks of the tokens `--layer-max-list` and `--stage-gap` (`styles/theme/contract.css`, which a test holds equal to these). */
export const QUANTUM_GEOMETRY: RailGeometry = { cardMax: 1080, inset: 20 }

/** The card and the gap as the page has them now. */
export function railGeometry(): RailGeometry {
  return { cardMax: tokenPx('--layer-max-list', QUANTUM_GEOMETRY.cardMax), inset: tokenPx('--stage-gap', QUANTUM_GEOMETRY.inset) }
}

/** The default 200px rail plus 16px of air. */
const OUT_AT = 216
/** 16px of hysteresis, so a window dragged near the line does not flicker. */
const IN_BELOW = 200
/** What the rail leaves free before the window's edge. */
export const RAIL_AIR = 16

function room(windowWidth: number, geometry: RailGeometry): number {
  return windowWidth - 2 * geometry.inset
}

/** The room beside the card on each side: the window minus its inset, minus the card, halved. */
export function cardMargin(windowWidth: number, geometry: RailGeometry = railGeometry()): number {
  return Math.max(0, (room(windowWidth, geometry) - Math.min(geometry.cardMax, room(windowWidth, geometry))) / 2)
}

export function railPlacement(windowWidth: number, current: RailPlacement, geometry: RailGeometry = railGeometry()): RailPlacement {
  const margin = cardMargin(windowWidth, geometry)

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
export function carriedRailWidth(stored: number, windowWidth: number, geometry: RailGeometry = railGeometry()): number {
  const virtualMargin = (room(windowWidth, geometry) - geometry.cardMax) / 2

  return Math.min(stored, Math.max(RAIL_WIDTH_MIN, virtualMargin - RAIL_AIR))
}

/** At this window width, and below it, the carried rail is at its 160px minimum: a narrower window changes nothing that is drawn. */
export function carryFloorWidth(geometry: RailGeometry = railGeometry()): number {
  return 2 * (RAIL_WIDTH_MIN + RAIL_AIR) + geometry.cardMax + 2 * geometry.inset
}

/** The same for Quantum's card and gap. */
export const CARRY_FLOOR_WIDTH = carryFloorWidth(QUANTUM_GEOMETRY)

/** The width the rail is drawn at: the stored one, capped outside by the margin, or following the window while it is carried inside. */
export function shownRailWidth(
  stored: number,
  where: { placement: RailPlacement; windowWidth: number; carried?: boolean },
  geometry: RailGeometry = railGeometry(),
): number {
  if (where.placement === 'outside') return outsideRailWidth(stored, cardMargin(where.windowWidth, geometry))

  return where.carried ? carriedRailWidth(stored, where.windowWidth, geometry) : stored
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
export function listCardWidth(windowWidth: number, geometry: RailGeometry = railGeometry()): number | null {
  const { cardMax } = geometry
  if (room(windowWidth, geometry) < cardMax) return null

  return (room(windowWidth, geometry) - cardMax) % 2 === 0 ? cardMax : cardMax - 1
}
