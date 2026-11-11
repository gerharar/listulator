import { tokenNumber, tokenPx } from '../../../lib/themeSizes.js'
import { PEEK_DEPTH } from './layerStack.js'

/**
 * The drum carousel's peek cascade (design-system/components/LayerCard,
 * "Motion": drum carousel). Sheets hang off an invisible horizontal-axis
 * cylinder: each step back rises and recedes, scale standing in for
 * perspective (a real `perspective` here would re-root `Popover`'s
 * fixed-position `FloatingPortal`, the same trap the old `.q-root` portal
 * context was built to avoid). Only `PEEK_DEPTH` steps ever peek.
 *
 * The rise amounts are **not** the prototype's own `DY` (`[0, 27, 52]`) —
 * verified live in a real browser (task 10.9c), those clipped ~9px off the
 * bottom of every `.q-layer-tab` (`top: 2px` + `height: 34px` = a 36px
 * clearance once its own `scale` is applied). The prototype's numbers were
 * tuned against a differently-sized experimental tab (`DY[1] + 2` = 29px),
 * not this design system's fixed 34px one — jsdom can't catch this, it
 * never lays out real pixels. `37`/`74` are the smallest steps (past each
 * depth's own `scale`) that let a real 34px tab clear the layer in front of
 * it; they happen to match 10.9's pre-drum linear placeholder (`index * 37`)
 * for exactly that reason — that placeholder was already tuned against the
 * same real tab, just without the recede/animation this task adds.
 *
 * The cascade's numbers are the page's (Phase 48.4c, design's answer 4): what a step back rises by (`--peek-rise`: the 37px above, so 74px two back,
 * in Quantum; 40px in eX-Zed, where the board puts the tab tops 40 and 80px above the window), the scale each step recedes to (`--peek-scale-1` and
 * `-2`: .959 and .921 in Quantum, 1 in eX-Zed, which must not put pixels between pixels) and how far a layer is inset on each side (`--peek-inset-1`
 * and `-2`: none in Quantum, 0 and 32px in eX-Zed, where the inset replaces the recede). There is no clearance rule, as there was in 48.4 (the rise as the
 * tab's height plus 3px): the board decides what is visible, and the window's rings cover the lower part of a 48px tab by design.
 */
const QUANTUM = { top: 15, rise: 37, scale: [1, 0.959, 0.921] as const, inset: [0, 0, 0] as const }

/** Where the front layer starts under the header: alone, or with layers covered behind it (the stage's offsets, 50.1a), plus the ledge's shift. */
function stageTop(visibleCount: number): number {
  const base = visibleCount > 1 ? tokenPx('--stage-top-stacked', QUANTUM.top) : tokenPx('--stage-top', QUANTUM.top)

  return base + tokenPx('--ledge-shift', 0)
}

function drumRise(step: number): number {
  return Math.min(step, PEEK_DEPTH) * tokenPx('--peek-rise', QUANTUM.rise)
}

function drumScale(step: number): number {
  const deepest = Math.min(step, PEEK_DEPTH)
  if (deepest === 0) return 1

  return tokenNumber(`--peek-scale-${deepest}`, QUANTUM.scale[deepest] ?? 1)
}

/** How far a layer this many steps back is inset on each side; `undefined` for none, so a theme without an inset adds nothing to the layer. */
function drumInset(step: number): number | undefined {
  const deepest = Math.min(step, PEEK_DEPTH)
  if (deepest === 0) return undefined
  const inset = tokenPx(`--peek-inset-${deepest}`, QUANTUM.inset[deepest] ?? 0)

  return inset > 0 ? inset : undefined
}

export interface LayerGeometry {
  /** Identical for every visible layer — depth is expressed through `transform`, not `top`. */
  top: number
  /** `undefined` for the active layer (depth 0) — nothing to rise or recede from. */
  transform: string | undefined
  /** Pixels of inset on each side (`--peek-inset`, which the stage's CSS reads); `undefined` when there is none. */
  inset?: number | undefined
}

/**
 * `visibleCount` is how many layers are currently rendered (1 to
 * `PEEK_DEPTH + 1`); `depth` is how many layers sit above this one within
 * that visible set (0 = active). The active layer's baseline sinks as more
 * layers stack up behind it, leaving room for their tabs to peek above.
 */
export function layerGeometry(visibleCount: number, depth: number): LayerGeometry {
  const baselineStep = Math.min(visibleCount - 1, PEEK_DEPTH)
  const inset = drumInset(depth)

  return {
    top: stageTop(visibleCount) + drumRise(baselineStep),
    transform: depth === 0 ? undefined : `translateY(-${drumRise(depth)}px) scale(${drumScale(depth)})`,
    ...(inset !== undefined && { inset }),
  }
}
