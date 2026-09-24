import { PEEK_DEPTH } from './layerStack.js'

/**
 * The drum carousel's peek cascade (design-system/components/LayerCard,
 * "Motion": drum carousel). Sheets hang off an invisible horizontal-axis
 * cylinder: each step back rises and recedes, scale standing in for
 * perspective (a real `perspective` here would re-root `Popover`'s
 * fixed-position `FloatingPortal`, the same trap `QRootContext` was built to
 * avoid). Only `PEEK_DEPTH` steps ever peek.
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
 */
const STAGE_TOP_PX = 15
const DRUM_RISE_PX = [0, 37, 74] as const
const DRUM_SCALE = [1, 0.959, 0.921] as const

const DEEPEST_RISE_PX = DRUM_RISE_PX[DRUM_RISE_PX.length - 1] ?? 0
const DEEPEST_SCALE = DRUM_SCALE[DRUM_SCALE.length - 1] ?? 1

function drumRise(step: number): number {
  return DRUM_RISE_PX[step] ?? DEEPEST_RISE_PX
}

function drumScale(step: number): number {
  return DRUM_SCALE[step] ?? DEEPEST_SCALE
}

export interface LayerGeometry {
  /** Identical for every visible layer — depth is expressed through `transform`, not `top`. */
  top: number
  /** `undefined` for the active layer (depth 0) — nothing to rise or recede from. */
  transform: string | undefined
}

/**
 * `visibleCount` is how many layers are currently rendered (1 to
 * `PEEK_DEPTH + 1`); `depth` is how many layers sit above this one within
 * that visible set (0 = active). The active layer's baseline sinks as more
 * layers stack up behind it, leaving room for their tabs to peek above.
 */
export function layerGeometry(visibleCount: number, depth: number): LayerGeometry {
  const baselineStep = Math.min(visibleCount - 1, PEEK_DEPTH)
  return {
    top: STAGE_TOP_PX + drumRise(baselineStep),
    transform: depth === 0 ? undefined : `translateY(-${drumRise(depth)}px) scale(${drumScale(depth)})`,
  }
}
