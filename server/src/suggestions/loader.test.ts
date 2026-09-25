import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadStrategy, strategiesDir } from './loader.js'
import { StrategyError } from './strategy.js'

describe('strategy loading', () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'listulator-strategies-'))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  function write(name: string, contents: unknown) {
    writeFileSync(
      join(directory, `${name}.json`),
      typeof contents === 'string' ? contents : JSON.stringify(contents),
    )
  }

  const valid = {
    name: 'test',
    scope: 'all_lists',
    factors: [{ type: 'neglect_time', direction: 'favor_highest', weight: 1 }],
  }

  it('reads a strategy from disk', () => {
    write('test', valid)

    expect(loadStrategy('test', directory)).toMatchObject({
      name: 'test',
      scope: 'all_lists',
      factors: [{ type: 'neglect_time', direction: 'favor_highest', weight: 1 }],
    })
  })

  it('picks up an edit without a restart', () => {
    // The whole point of these files: change a weight, see it take effect.
    write('test', valid)
    expect(loadStrategy('test', directory).factors[0]?.weight).toBe(1)

    write('test', { ...valid, factors: [{ ...valid.factors[0], weight: 0.25 }] })
    expect(loadStrategy('test', directory).factors[0]?.weight).toBe(0.25)
  })

  it('defaults scope to all lists when omitted', () => {
    write('test', { name: 'test', factors: valid.factors })

    expect(loadStrategy('test', directory).scope).toBe('all_lists')
  })

  it('says which file is missing rather than failing obscurely', () => {
    expect(() => loadStrategy('absent', directory)).toThrow(StrategyError)
    expect(() => loadStrategy('absent', directory)).toThrow(/absent\.json/)
  })

  it('reports malformed JSON with the file name', () => {
    write('broken', '{ "name": "broken", ')

    expect(() => loadStrategy('broken', directory)).toThrow(/broken\.json is not valid JSON/)
  })

  it('names the known factors when one is not recognised', () => {
    // A self-hoster inventing a factor gets told it is a code change, not a
    // silent zero-weight no-op.
    write('bad', { ...valid, factors: [{ type: 'vibes', direction: 'favor_highest', weight: 1 }] })

    expect(() => loadStrategy('bad', directory)).toThrow(/not a known factor/)
    expect(() => loadStrategy('bad', directory)).toThrow(/neglect_time/)
  })

  it('rejects an unusable direction', () => {
    write('bad', { ...valid, factors: [{ type: 'neglect_time', direction: 'sideways', weight: 1 }] })

    expect(() => loadStrategy('bad', directory)).toThrow(/direction must be one of/)
  })

  it('rejects negative and non-numeric weights', () => {
    write('bad', { ...valid, factors: [{ type: 'neglect_time', direction: 'favor_highest', weight: -1 }] })
    expect(() => loadStrategy('bad', directory)).toThrow(/weight must be a number/)

    write('bad2', { ...valid, factors: [{ type: 'neglect_time', direction: 'favor_highest', weight: 'heavy' }] })
    expect(() => loadStrategy('bad2', directory)).toThrow(/weight must be a number/)
  })

  it('rejects a strategy where every weight is zero', () => {
    // It would load fine and then rank nothing — better to say so.
    write('bad', { ...valid, factors: [{ type: 'neglect_time', direction: 'favor_highest', weight: 0 }] })

    expect(() => loadStrategy('bad', directory)).toThrow(/at least one factor needs a weight/)
  })

  it('rejects an empty factor list', () => {
    write('bad', { name: 'bad', factors: [] })

    expect(() => loadStrategy('bad', directory)).toThrow(/non-empty array/)
  })
})

describe('the shipped strategy files', () => {
  it('all load and match the buttons they drive', () => {
    // Guards the actual config/strategies/*.json, not fixtures — a typo there
    // breaks the app for everyone, and would otherwise only show up at runtime.
    const tiredBoss = loadStrategy('tired-boss')
    // A different list *and* a different medium than the one named (10.26).
    expect(tiredBoss.scope).toBe('other_lists_and_media')
    expect(tiredBoss.factors.map((factor) => factor.type)).toEqual([
      'neglect_time',
      'completion_percent',
    ])

    const suggest = loadStrategy('suggest')
    expect(suggest.factors.map((factor) => factor.type)).toContain('distance_from_middle')
    // Nearly-done lists are tired-boss's job; suggest must not chase completion.
    expect(suggest.factors.map((factor) => factor.type)).not.toContain('completion_percent')

    const quickie = loadStrategy('quickie')
    expect(quickie.factors).toEqual([
      { type: 'time_remaining_minutes', direction: 'favor_lowest', weight: 1 },
    ])
  })

  it('honours STRATEGIES_DIR for keeping tuning outside the repo', () => {
    expect(strategiesDir({ STRATEGIES_DIR: '/elsewhere' })).toBe('/elsewhere')
    expect(strategiesDir({})).toMatch(/config\/strategies$/)
  })
})
