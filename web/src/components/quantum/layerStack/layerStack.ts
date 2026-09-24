/**
 * The app is a stack of layers, not routes (design-system/components/LayerCard):
 * pure, in-memory state (D1) — no URL sync, no deep links, no `history`
 * integration. Ported from the prototype's `push`/`pop` (`Component.push`/
 * `Component.pop`, `Listulator UX - sci-fi.dc.html` ~L1486-1496).
 *
 * `content` is intentionally opaque here — this module knows nothing about
 * React. The App shell decides what a layer actually renders.
 */
export interface LayerDescriptor<T = unknown> {
  /** Stable per-instance identity — two layers can share a `kind` (two 'list' layers for different lists). */
  id: string
  kind: string
  /** What a LayerTab shows for this layer once something covers it. */
  tabLabel: string
  content: T
}

export const MAX_DEPTH = 3
export const MAX_DEPTH_WITH_PREVIEW = 4
/** Only this many layers below the top ever peek — everything deeper is still in the stack, just not rendered. */
export const PEEK_DEPTH = 2

/**
 * Pushes a layer on top. At the cap, drops from just above Home (index 1)
 * rather than the top or the bottom — Home (index 0) never drops, and the
 * layer being pushed is always kept.
 */
export function pushLayer<T>(
  stack: readonly LayerDescriptor<T>[],
  layer: LayerDescriptor<T>,
): LayerDescriptor<T>[] {
  const cap = layer.kind === 'preview' ? MAX_DEPTH_WITH_PREVIEW : MAX_DEPTH
  const next = [...stack]
  if (next.length >= cap) {
    next.splice(1, next.length - cap + 1)
  }
  next.push(layer)
  return next
}

/** Removes the top layer. A no-op at depth 1 — Home can never be popped. */
export function popLayer<T>(stack: readonly LayerDescriptor<T>[]): LayerDescriptor<T>[] {
  if (stack.length <= 1) return [...stack]
  return stack.slice(0, -1)
}

/** A LayerTab's back target: pop straight to a given depth, not one step at a time. */
export function popToIndex<T>(
  stack: readonly LayerDescriptor<T>[],
  index: number,
): LayerDescriptor<T>[] {
  if (index < 0 || index >= stack.length - 1) return [...stack]
  return stack.slice(0, index + 1)
}

/** Swaps the top layer in place — depth and everything below stay untouched. */
export function replaceTopLayer<T>(
  stack: readonly LayerDescriptor<T>[],
  layer: LayerDescriptor<T>,
): LayerDescriptor<T>[] {
  if (stack.length === 0) return [layer]
  return [...stack.slice(0, -1), layer]
}

/** The active layer plus up to `PEEK_DEPTH` covered ones behind it — anything deeper stays in the stack but isn't rendered. */
export function visibleLayers<T>(
  stack: readonly LayerDescriptor<T>[],
): readonly LayerDescriptor<T>[] {
  return stack.slice(Math.max(0, stack.length - 1 - PEEK_DEPTH))
}
