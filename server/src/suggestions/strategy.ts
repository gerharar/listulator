import type { ListWithStats } from '../catalog/repository.js'
import type { ListItem } from '../db/schema.js'

/**
 * A strategy is a declarative description of how one button ranks lists.
 *
 * Config vs. code boundary (SPEC.md §6): weights, directions and which known
 * factors a strategy uses are config — edit the JSON, no rebuild. A new *kind*
 * of factor is a code change here, because it is a new shaping function rather
 * than a new number.
 */

export const FACTOR_TYPES = [
  'neglect_time',
  'completion_percent',
  'time_remaining_minutes',
  'distance_from_middle',
  'status_band',
] as const

export type FactorType = (typeof FACTOR_TYPES)[number]

/**
 * What a strategy ranks. Most rank whole lists; `item` ranks single unconsumed
 * items across every list (Just One Fix, 10.28). A strategy names its unit in
 * its JSON, and its factors must be of that unit: a list factor cannot score an
 * item and the other way round.
 */
export const UNITS = ['list', 'item'] as const

export type Unit = (typeof UNITS)[number]

export const ITEM_FACTOR_TYPES = ['item_minutes'] as const

export type ItemFactorType = (typeof ITEM_FACTOR_TYPES)[number]

export const DIRECTIONS = ['favor_highest', 'favor_lowest'] as const

export type Direction = (typeof DIRECTIONS)[number]

/**
 * Which lists a strategy may offer. `other_lists` leaves out the one you named;
 * `other_lists_and_media` also leaves out every list of that list's `media_type`
 * ("tired of TV, so nothing else on TV either" — I'm Tired, Boss, 10.26).
 */
export const SCOPES = ['all_lists', 'other_lists', 'other_lists_and_media'] as const

export type Scope = (typeof SCOPES)[number]

export interface StrategyFactor {
  type: FactorType | ItemFactorType
  direction: Direction
  weight: number
}

export interface Strategy {
  name: string
  description?: string
  /** What is ranked: whole lists (the default) or single items. */
  unit: Unit
  scope: Scope
  factors: StrategyFactor[]
}

export interface FactorContext {
  now: Date
}

/**
 * Raw value for a list, before normalisation. Higher or lower being "better"
 * is the strategy's business, expressed through `direction`.
 */
export type FactorFn = (list: ListWithStats, context: FactorContext) => number

export interface FactorDefinition {
  compute: FactorFn
  /**
   * Smallest spread across candidates that counts as a real difference.
   *
   * Scores are normalised against the range the candidates actually span, so
   * without this a trivial gap gets stretched to the full 0–1 scale: three
   * lists all last touched "about five months ago" would have their
   * millisecond differences amplified into a decisive factor, letting noise
   * outvote something that genuinely matters. Below this floor the factor
   * reports every candidate as neutral instead.
   */
  noiseFloor: number
}

const MINUTE = 60 * 1000

/** See `distance_from_middle`. Below 1 so the fresh end always wins outright. */
const HIGH_END_RECOVERY = 0.6

export const FACTORS: Record<FactorType, FactorDefinition> = {
  /**
   * How long the list has been sitting untouched.
   *
   * A list that has never been touched is measured from when it was created,
   * not treated as infinitely neglected. Two never-started lists are not
   * equally neglected — one added six months ago has been ignored for six
   * months, one added yesterday has not. The literal "never-consumed is
   * maximally neglected" reading would rank a list you created yesterday above
   * one you were actively watching three months ago, which is the opposite of
   * what "I've been ignoring this" means.
   */
  neglect_time: {
    compute: (list, { now }) =>
      now.getTime() - (list.stats.lastConsumedAt ?? list.createdAt).getTime(),
    // An hour's difference in "when did I last touch this" is not a signal.
    noiseFloor: 60 * MINUTE,
  },

  completion_percent: {
    compute: (list) => list.stats.completionPercent,
    noiseFloor: 1,
  },

  time_remaining_minutes: {
    compute: (list) => list.stats.timeRemainingMinutes,
    noiseFloor: 5,
  },

  /**
   * "Anything but stuck in the middle" — a U over completion, tilted hard
   * toward the fresh end.
   *
   * Scores highest at 0%, bottoms out around two-thirds through, then recovers
   * as a list approaches finished. Both ends beat the middle, which is what
   * "avoid lists stuck in the middle" asks for; the tilt is what keeps a
   * barely-started list winning outright, so this button stays distinct from
   * "I'm tired, boss" rather than duplicating it.
   *
   * `HIGH_END_RECOVERY` is how much of the fresh end's score a nearly-finished
   * list claws back. At 1 the curve would be symmetric and near-done would tie
   * with untouched; at 0 it collapses to the earlier monotonic version where
   * the middle was merely mediocre and near-done was worst.
   */
  /**
   * Whether the thing the list is about can be finished at all: complete (2),
   * unknown (1), ongoing (0). An ongoing list keeps growing upstream, so a
   * nearly-done one is not closer to finished than a wrapped one that is less
   * far along. Finalizer weights this far above `completion_percent` in config,
   * so the band decides in practice; this is a weighted sum, not tiered ranking,
   * and a rare misordering is accepted (10.27).
   */
  status_band: {
    compute: (list) => (list.status === 'complete' ? 2 : list.status === 'ongoing' ? 0 : 1),
    // Bands are whole numbers: any spread at all is a real difference.
    noiseFloor: 1,
  },

  distance_from_middle: {
    compute: (list) => {
      const progress = list.stats.completionPercent / 100

      return (1 - progress) ** 2 + HIGH_END_RECOVERY * progress ** 2
    },
    noiseFloor: 0.01,
  },
}

export interface ItemFactorDefinition {
  compute: (item: ListItem) => number
  /** As for lists: a spread narrower than this is no signal and every candidate is neutral. */
  noiseFloor: number
}

export const ITEM_FACTORS: Record<ItemFactorType, ItemFactorDefinition> = {
  /** How long the item takes, in minutes. A strategy favours the low end to find the quick fix. */
  item_minutes: {
    compute: (item) => item.timeToConsumeMinutes,
    noiseFloor: 1,
  },
}

export class StrategyError extends Error {}

function fail(file: string, problem: string): never {
  // Self-hosters edit these by hand, so the message has to name the file and
  // say what would fix it.
  throw new StrategyError(`Invalid strategy in ${file}: ${problem}`)
}

export function parseStrategy(raw: unknown, file: string): Strategy {
  if (typeof raw !== 'object' || raw === null) fail(file, 'expected a JSON object')

  const candidate = raw as Record<string, unknown>

  if (typeof candidate['name'] !== 'string' || candidate['name'].length === 0) {
    fail(file, '"name" must be a non-empty string')
  }

  const unit = candidate['unit'] ?? 'list'
  if (!UNITS.includes(unit as Unit)) {
    fail(file, `"unit" must be one of ${UNITS.join(', ')}`)
  }
  const known: readonly string[] = unit === 'item' ? ITEM_FACTOR_TYPES : FACTOR_TYPES

  const scope = candidate['scope'] ?? 'all_lists'
  if (!SCOPES.includes(scope as Scope)) {
    fail(file, `"scope" must be one of ${SCOPES.join(', ')}`)
  }

  if (!Array.isArray(candidate['factors']) || candidate['factors'].length === 0) {
    fail(file, '"factors" must be a non-empty array')
  }

  const factors = (candidate['factors'] as unknown[]).map((entry, index) => {
    const where = `factors[${index}]`
    if (typeof entry !== 'object' || entry === null) fail(file, `${where} must be an object`)

    const factor = entry as Record<string, unknown>

    if (!known.includes(factor['type'] as string)) {
      fail(
        file,
        `${where}.type "${String(factor['type'])}" is not a known factor for a strategy whose unit is ` +
          `${String(unit)}. Known factors: ${known.join(', ')}. Adding a new one is a code change.`,
      )
    }

    if (!DIRECTIONS.includes(factor['direction'] as Direction)) {
      fail(file, `${where}.direction must be one of ${DIRECTIONS.join(', ')}`)
    }

    const weight = factor['weight']
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0) {
      fail(file, `${where}.weight must be a number of zero or more`)
    }

    return { type: factor['type'] as StrategyFactor['type'], direction: factor['direction'] as Direction, weight }
  })

  if (factors.every((factor) => factor.weight === 0)) {
    fail(file, 'at least one factor needs a weight above zero, or nothing is ranked')
  }

  const description = candidate['description']

  return {
    name: candidate['name'],
    ...(typeof description === 'string' ? { description } : {}),
    unit: unit as Unit,
    scope: scope as Scope,
    factors,
  }
}
