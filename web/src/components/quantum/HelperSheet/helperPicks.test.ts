import { describe, expect, it } from 'vitest'
import type { MediaType, SuggestionPick } from '../../../lib/api.js'
import { pickKey, pickSource, reroll, whyFinalizer, whyJustOneFix, whyTired } from './helperPicks.js'

const pick = (
  id: string,
  over: {
    item?: string | null
    factors?: Record<string, number>
    percent?: number
    left?: number
    status?: 'complete' | 'ongoing' | null
    minutes?: number
  } = {},
): SuggestionPick =>
  ({
    list: {
      id,
      title: id,
      status: over.status ?? null,
      stats: { completionPercent: over.percent ?? 45.4, timeRemainingMinutes: over.left ?? 120 },
    },
    nextItem: over.item === null ? null : { id: over.item ?? `${id}-next`, title: 'Next', timeToConsumeMinutes: over.minutes ?? 30 },
    score: 1,
    factors: over.factors ?? { neglect_time: 1, completion_percent: 1 },
  }) as SuggestionPick

describe('pickKey', () => {
  it('names a pick by its list and its next item, so a reroll can turn exactly that one down', () => {
    expect(pickKey(pick('a', { item: 'x' }))).toBe('a|x')
    expect(pickKey(pick('a', { item: null }))).toBe('a|')
  })
})

describe('reroll (Not That)', () => {
  const picks = [pick('a'), pick('b'), pick('c')]

  it('drops what was turned down and moves the rest up', () => {
    expect(reroll(picks, [pickKey(picks[0]!)]).shown.map((entry) => entry.list.id)).toEqual(['b', 'c'])
    expect(reroll(picks, [pickKey(picks[0]!), pickKey(picks[1]!)]).shown.map((entry) => entry.list.id)).toEqual(['c'])
  })

  it('is not exhausted while anything is left', () => {
    expect(reroll(picks, [pickKey(picks[0]!)]).exhausted).toBe(false)
  })

  it('lapses back to the strongest pick once everything has been turned down', () => {
    const outcome = reroll(picks, picks.map(pickKey))

    expect(outcome.exhausted).toBe(true)
    expect(outcome.shown.map((entry) => entry.list.id)).toEqual(['a', 'b', 'c'])
  })

  it('shows everything when nothing has been turned down', () => {
    expect(reroll(picks, []).shown).toEqual(picks)
  })
})

describe('whyTired', () => {
  it('says the medium differs, that it has been ignored, and how far along it is', () => {
    expect(whyTired(pick('a'))).toBe('Different medium, and you haven\'t touched it in a while. 45% done, 2h left.')
  })

  it('leaves out being ignored when the list has been touched recently', () => {
    expect(whyTired(pick('a', { factors: { neglect_time: 0.1, completion_percent: 0.9 } }))).toBe(
      'Different medium. 45% done, 2h left.',
    )
  })

  it('leaves out the progress when it is not what made the pick', () => {
    expect(whyTired(pick('a', { factors: { neglect_time: 0.9, completion_percent: 0.2 } }))).toBe(
      'Different medium, and you haven\'t touched it in a while.',
    )
  })

  it('still says something when neither factor stands out', () => {
    expect(whyTired(pick('a', { factors: { neglect_time: 0.2, completion_percent: 0.3 } }))).toBe(
      'Different medium: the best match among what\'s left.',
    )
  })
})

describe('whyFinalizer', () => {
  it('says how close it is', () => {
    expect(whyFinalizer(pick('a', { percent: 94.4, left: 90 }))).toBe('Closest to the finish line: 94% done, 1h 30m left.')
  })

  it('adds that a complete list stays finished', () => {
    expect(whyFinalizer(pick('a', { status: 'complete' }))).toBe(
      'Closest to the finish line: 45% done, 2h left. This list is Complete, so there will be no Round 2',
    )
  })

  it('says so when even the best is an ongoing list, so nothing finishable is closer', () => {
    expect(whyFinalizer(pick('a', { status: 'ongoing' }))).toBe(
      'Closest to the finish line: 45% done, 2h left. This list is still Ongoing, but nothing finishable is closer.',
    )
  })
})

describe('whyJustOneFix', () => {
  it('names the length of the item and promises it is done after', () => {
    expect(whyJustOneFix(pick('a', { minutes: 7 }))).toBe('Shortest unfinished item you have -- 7m and it\'s done.')
  })

  it('reads hours and minutes', () => {
    expect(whyJustOneFix(pick('a', { minutes: 95 }))).toBe('Shortest unfinished item you have -- 1h 35m and it\'s done.')
  })
})

describe('pickSource', () => {
  const types = [
    { key: 'youtube', sourceName: 'YouTube' },
    { key: 'movie', sourceName: 'TMDB' },
    { key: 'mega' },
  ] as MediaType[]
  const listPick = (source: string, mediaType: string) =>
    ({ ...pick('a'), list: { ...pick('a').list, source, mediaType } }) as unknown as SuggestionPick

  it('names the source a list arrived from, so a pick never shows its content without it (YouTube\u2019s rule)', () => {
    expect(pickSource(listPick('api', 'youtube'), types)).toBe('YouTube')
    expect(pickSource(listPick('api', 'movie'), types)).toBe('TMDB')
  })

  it('names nothing for a list that did not arrive from a source', () => {
    for (const source of ['manual', 'file', 'canonical', 'llm']) {
      expect(pickSource(listPick(source, 'youtube'), types), source).toBeUndefined()
    }
  })

  it('names nothing for a category with no source of its own, an unknown category, or no categories at all', () => {
    expect(pickSource(listPick('api', 'mega'), types)).toBeUndefined()
    expect(pickSource(listPick('api', 'podcast'), types)).toBeUndefined()
    expect(pickSource(listPick('api', 'youtube'), undefined)).toBeUndefined()
  })
})
