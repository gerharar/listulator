import type { ListWithStats } from '../catalog/repository.js'

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
  'distance_from_low_end',
] as const

export type FactorType = (typeof FACTOR_TYPES)[number]

export const DIRECTIONS = ['favor_highest', 'favor_lowest'] as const

export type Direction = (typeof DIRECTIONS)[number]

export const SCOPES = ['all_lists', 'other_lists'] as const

export type Scope = (typeof SCOPES)[number]

export interface StrategyFactor {
  type: FactorType
  direction: Direction
  weight: number
}

export interface Strategy {
  name: string
  description?: string
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
   * "Fresh, and definitely not stuck in the middle."
   *
   * Falls off quadratically from 0% complete, so barely-started lists score far
   * above half-finished ones — a plain linear ranking would treat 50% as merely
   * average. It deliberately does not rise again near 100%: nearly-done lists
   * are what "I'm tired, boss" exists to surface.
   */
  distance_from_low_end: {
    compute: (list) => (1 - list.stats.completionPercent / 100) ** 2,
    noiseFloor: 0.01,
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

    if (!FACTOR_TYPES.includes(factor['type'] as FactorType)) {
      fail(
        file,
        `${where}.type "${String(factor['type'])}" is not a known factor. ` +
          `Known factors: ${FACTOR_TYPES.join(', ')}. Adding a new one is a code change.`,
      )
    }

    if (!DIRECTIONS.includes(factor['direction'] as Direction)) {
      fail(file, `${where}.direction must be one of ${DIRECTIONS.join(', ')}`)
    }

    const weight = factor['weight']
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0) {
      fail(file, `${where}.weight must be a number of zero or more`)
    }

    return { type: factor['type'] as FactorType, direction: factor['direction'] as Direction, weight }
  })

  if (factors.every((factor) => factor.weight === 0)) {
    fail(file, 'at least one factor needs a weight above zero, or nothing is ranked')
  }

  const description = candidate['description']

  return {
    name: candidate['name'],
    ...(typeof description === 'string' ? { description } : {}),
    scope: scope as Scope,
    factors,
  }
}
