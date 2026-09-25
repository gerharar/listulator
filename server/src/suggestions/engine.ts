import type { ListWithStats } from '../catalog/repository.js'
import type { ListItem } from '../db/schema.js'
import { FACTORS, type FactorType, type Strategy } from './strategy.js'

export interface Suggestion {
  list: ListWithStats
  /** The specific thing to consume next — "what do I do now" needs an answer. */
  nextItem: ListItem | null
  /** 0–1. Comparable within one response, not across strategies. */
  score: number
  /**
   * Each factor's normalised contribution, so tuning a strategy file can be
   * done by looking at why something won rather than by guessing.
   */
  factors: Record<string, number>
}

export interface RankOptions {
  strategy: Strategy
  candidates: ListWithStats[]
  /** Unconsumed items by list id, in order; the first is the next thing to do. */
  nextItems: Map<string, ListItem | undefined>
  /** Excluded for the `other_lists*` scopes — the list the user is tired of. */
  currentListId?: string
  now?: Date
}

/**
 * A list is only worth suggesting if there is something left to consume in it.
 *
 * This filter is load-bearing rather than tidy-minded: without it "Quickie",
 * which ranks on the least time remaining, would always answer with a finished
 * list, since a finished list has zero minutes left. Empty lists go too —
 * suggesting one leaves the user with nothing to do.
 */
export function isSuggestable(list: ListWithStats): boolean {
  return list.stats.totalItems > 0 && list.stats.consumedItems < list.stats.totalItems
}

/**
 * Scales raw values into 0–1 across the candidates.
 *
 * A spread narrower than the factor's noise floor is treated as no signal at
 * all: every candidate gets 0.5. Without that, min–max scaling stretches a
 * meaningless gap over the whole range — three lists last touched within
 * minutes of each other would have those minutes amplified into a decisive
 * factor, letting noise outvote something that actually differs. It also
 * covers the all-identical case, which would otherwise divide by zero.
 */
function normalize(values: number[], noiseFloor: number): number[] {
  const lowest = Math.min(...values)
  const highest = Math.max(...values)
  const spread = highest - lowest

  if (spread < noiseFloor) return values.map(() => 0.5)

  return values.map((value) => (value - lowest) / spread)
}

export function rank({
  strategy,
  candidates,
  nextItems,
  currentListId,
  now = new Date(),
}: RankOptions): Suggestion[] {
  // Looked up among *all* candidates, before the suggestable filter: a finished list still has a medium.
  const named = currentListId ? candidates.find((list) => list.id === currentListId) : undefined

  const eligible = candidates.filter(isSuggestable).filter((list) => {
    if (strategy.scope === 'all_lists') return true
    if (list.id === currentListId) return false

    return !(strategy.scope === 'other_lists_and_media' && named && list.mediaType === named.mediaType)
  })

  if (eligible.length === 0) return []

  const totalWeight = strategy.factors.reduce((sum, factor) => sum + factor.weight, 0)

  // Per factor: raw values for every candidate, normalised together, then
  // flipped if the strategy favours the low end.
  const contributions = new Map<FactorType, number[]>()

  for (const factor of strategy.factors) {
    const definition = FACTORS[factor.type]
    const raw = eligible.map((list) => definition.compute(list, { now }))
    const scaled = normalize(raw, definition.noiseFloor)

    contributions.set(
      factor.type,
      scaled.map((value) => (factor.direction === 'favor_lowest' ? 1 - value : value)),
    )
  }

  const suggestions = eligible.map((list, index) => {
    const factors: Record<string, number> = {}
    let score = 0

    for (const factor of strategy.factors) {
      const contribution = contributions.get(factor.type)?.[index] ?? 0
      factors[factor.type] = Number(contribution.toFixed(4))
      score += contribution * factor.weight
    }

    return {
      list,
      nextItem: nextItems.get(list.id) ?? null,
      score: Number((score / totalWeight).toFixed(4)),
      factors,
    }
  })

  // Ties broken by id so a repeated request cannot silently reshuffle.
  return suggestions.sort((a, b) => b.score - a.score || a.list.id.localeCompare(b.list.id))
}
