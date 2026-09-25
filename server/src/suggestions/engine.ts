import type { ListWithStats } from '../catalog/repository.js'
import type { ListItem } from '../db/schema.js'
import {
  FACTORS,
  ITEM_FACTORS,
  StrategyError,
  type FactorType,
  type ItemFactorType,
  type Strategy,
} from './strategy.js'

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
  /**
   * Every unconsumed item by list id, in order. Only an item strategy (Just One
   * Fix) reads it, and it must be given one: the next item alone cannot say which
   * item is shortest.
   */
  unconsumed?: Map<string, ListItem[]>
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

/**
 * Ranks what the strategy's unit says: whole lists, or — for `unit: item` —
 * single unconsumed items, each list offered by its own best one. Either way a
 * suggestion names a list and the item to start on, so callers show both alike.
 */
export function rank(options: RankOptions): Suggestion[] {
  return options.strategy.unit === 'item' ? rankItems(options) : rankLists(options)
}

/** Which lists a strategy may offer, by its scope. `named` is looked up among *all* candidates. */
function inScope(strategy: Strategy, candidates: ListWithStats[], currentListId: string | undefined) {
  const named = currentListId ? candidates.find((list) => list.id === currentListId) : undefined

  return (list: ListWithStats): boolean => {
    if (strategy.scope === 'all_lists') return true
    if (list.id === currentListId) return false

    return !(strategy.scope === 'other_lists_and_media' && named && list.mediaType === named.mediaType)
  }
}

/**
 * Item-level ranking (Just One Fix): every unconsumed item of every in-scope
 * list is a candidate, scored by the strategy's item factors like lists are
 * (normalised across all candidates), and each list is then offered once, by
 * its best item, because the sheet opens lists.
 */
function rankItems({ strategy, candidates, unconsumed, currentListId }: RankOptions): Suggestion[] {
  if (!unconsumed) {
    throw new StrategyError(
      `Strategy "${strategy.name}" ranks items, so the engine needs every unconsumed item, not just the next ones.`,
    )
  }

  const allowed = inScope(strategy, candidates, currentListId)
  const entries = candidates
    .filter(allowed)
    .flatMap((list) => (unconsumed.get(list.id) ?? []).map((item) => ({ list, item })))

  if (entries.length === 0) return []

  const totalWeight = strategy.factors.reduce((sum, factor) => sum + factor.weight, 0)
  const contributions = new Map<string, number[]>()

  for (const factor of strategy.factors) {
    const definition = ITEM_FACTORS[factor.type as ItemFactorType]
    const scaled = normalize(
      entries.map(({ item }) => definition.compute(item)),
      definition.noiseFloor,
    )

    contributions.set(
      factor.type,
      scaled.map((value) => (factor.direction === 'favor_lowest' ? 1 - value : value)),
    )
  }

  const scored = entries.map(({ list, item }, index) => {
    const factors: Record<string, number> = {}
    let score = 0

    for (const factor of strategy.factors) {
      const contribution = contributions.get(factor.type)?.[index] ?? 0
      factors[factor.type] = Number(contribution.toFixed(4))
      score += contribution * factor.weight
    }

    return { list, nextItem: item, score: Number((score / totalWeight).toFixed(4)), factors }
  })

  // Best first; ties by list id, then by position in the list, so a repeat cannot reshuffle.
  scored.sort(
    (a, b) =>
      b.score - a.score || a.list.id.localeCompare(b.list.id) || a.nextItem.orderIndex - b.nextItem.orderIndex,
  )

  const seen = new Set<string>()

  return scored.filter((entry) => !seen.has(entry.list.id) && seen.add(entry.list.id))
}

function rankLists({
  strategy,
  candidates,
  nextItems,
  currentListId,
  now = new Date(),
}: RankOptions): Suggestion[] {
  // Looked up among *all* candidates, before the suggestable filter: a finished list still has a medium.
  const eligible = candidates.filter(isSuggestable).filter(inScope(strategy, candidates, currentListId))

  if (eligible.length === 0) return []

  const totalWeight = strategy.factors.reduce((sum, factor) => sum + factor.weight, 0)

  // Per factor: raw values for every candidate, normalised together, then
  // flipped if the strategy favours the low end.
  const contributions = new Map<string, number[]>()

  for (const factor of strategy.factors) {
    const definition = FACTORS[factor.type as FactorType]
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
