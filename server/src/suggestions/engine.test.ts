import { describe, expect, it } from 'vitest'
import type { ListWithStats } from '../catalog/repository.js'
import type { ListItem } from '../db/schema.js'
import { isSuggestable, rank } from './engine.js'
import type { Strategy } from './strategy.js'

const NOW = new Date('2026-06-01T12:00:00Z')

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000)
}

interface ListSpec {
  id: string
  total: number
  consumed: number
  minutesLeft: number
  lastConsumed?: Date | null
  created?: Date
}

function list({
  id,
  total,
  consumed,
  minutesLeft,
  lastConsumed = null,
  created = daysAgo(30),
}: ListSpec): ListWithStats {
  return {
    id,
    userId: 'user',
    title: id,
    mediaType: 'movie',
    source: 'manual',
    externalRef: null,
    createdAt: created,
    updatedAt: created,
    stats: {
      totalItems: total,
      consumedItems: consumed,
      completionPercent: total === 0 ? 0 : Math.round((consumed / total) * 1000) / 10,
      timeRemainingMinutes: minutesLeft,
      lastConsumedAt: lastConsumed,
    },
  }
}

function nextItemsFor(lists: ListWithStats[]): Map<string, ListItem | undefined> {
  return new Map(
    lists.map((entry) => [
      entry.id,
      {
        id: `${entry.id}-next`,
        listId: entry.id,
        title: `Next in ${entry.id}`,
        orderIndex: 0,
        timeToConsumeMinutes: 10,
        timeToConsumeIsEstimated: true,
        consumedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]),
  )
}

function ranked(strategy: Strategy, lists: ListWithStats[], currentListId?: string): string[] {
  return rank({
    strategy,
    candidates: lists,
    nextItems: nextItemsFor(lists),
    now: NOW,
    ...(currentListId ? { currentListId } : {}),
  }).map((suggestion) => suggestion.list.id)
}

const singleFactor = (
  type: Strategy['factors'][number]['type'],
  direction: Strategy['factors'][number]['direction'],
): Strategy => ({ name: 'test', scope: 'all_lists', factors: [{ type, direction, weight: 1 }] })

describe('isSuggestable', () => {
  it('rejects finished lists, which have nothing left to consume', () => {
    expect(isSuggestable(list({ id: 'done', total: 3, consumed: 3, minutesLeft: 0 }))).toBe(false)
  })

  it('rejects empty lists', () => {
    expect(isSuggestable(list({ id: 'empty', total: 0, consumed: 0, minutesLeft: 0 }))).toBe(false)
  })

  it('accepts a list with anything left', () => {
    expect(isSuggestable(list({ id: 'partial', total: 3, consumed: 2, minutesLeft: 20 }))).toBe(true)
  })
})

describe('rank', () => {
  it('orders by a single factor, highest first', () => {
    const lists = [
      list({ id: 'low', total: 4, consumed: 1, minutesLeft: 100 }),
      list({ id: 'high', total: 4, consumed: 3, minutesLeft: 100 }),
      list({ id: 'mid', total: 4, consumed: 2, minutesLeft: 100 }),
    ]

    expect(ranked(singleFactor('completion_percent', 'favor_highest'), lists)).toEqual([
      'high',
      'mid',
      'low',
    ])
  })

  it('reverses when the strategy favours the low end', () => {
    const lists = [
      list({ id: 'long', total: 2, consumed: 0, minutesLeft: 600 }),
      list({ id: 'short', total: 2, consumed: 0, minutesLeft: 20 }),
      list({ id: 'medium', total: 2, consumed: 0, minutesLeft: 180 }),
    ]

    expect(ranked(singleFactor('time_remaining_minutes', 'favor_lowest'), lists)).toEqual([
      'short',
      'medium',
      'long',
    ])
  })

  it('never suggests a finished list, even when it would score best', () => {
    // The failure this prevents: "shortest time to finish" is trivially won by
    // a list with nothing left, so Quickie would always answer "the thing you
    // already finished".
    const lists = [
      list({ id: 'finished', total: 3, consumed: 3, minutesLeft: 0 }),
      list({ id: 'quick', total: 3, consumed: 2, minutesLeft: 20 }),
    ]

    expect(ranked(singleFactor('time_remaining_minutes', 'favor_lowest'), lists)).toEqual(['quick'])
  })

  it('measures neglect from the last time something was consumed', () => {
    const lists = [
      list({ id: 'recent', total: 4, consumed: 1, minutesLeft: 100, lastConsumed: daysAgo(2) }),
      list({ id: 'stale', total: 4, consumed: 1, minutesLeft: 100, lastConsumed: daysAgo(200) }),
      list({ id: 'middling', total: 4, consumed: 1, minutesLeft: 100, lastConsumed: daysAgo(40) }),
    ]

    expect(ranked(singleFactor('neglect_time', 'favor_highest'), lists)).toEqual([
      'stale',
      'middling',
      'recent',
    ])
  })

  it('measures a never-started list from when it was created', () => {
    // A list made yesterday has not been "ignored for ages" just because it has
    // never been touched — otherwise anything new outranks a list you were
    // genuinely watching months ago.
    const lists = [
      list({ id: 'new-untouched', total: 4, consumed: 0, minutesLeft: 400, created: daysAgo(1) }),
      list({ id: 'old-untouched', total: 4, consumed: 0, minutesLeft: 400, created: daysAgo(300) }),
      list({
        id: 'watched-a-while-ago',
        total: 4,
        consumed: 1,
        minutesLeft: 300,
        created: daysAgo(400),
        lastConsumed: daysAgo(90),
      }),
    ]

    expect(ranked(singleFactor('neglect_time', 'favor_highest'), lists)).toEqual([
      'old-untouched',
      'watched-a-while-ago',
      'new-untouched',
    ])
  })

  it('penalises mid-progress harder than a linear ranking would', () => {
    // distance_from_low_end is the "fresh, not stuck in the middle" shaping.
    const lists = [
      list({ id: 'barely-started', total: 10, consumed: 1, minutesLeft: 900 }),
      list({ id: 'half-done', total: 10, consumed: 5, minutesLeft: 500 }),
      list({ id: 'nearly-done', total: 10, consumed: 9, minutesLeft: 100 }),
    ]

    const suggestions = rank({
      strategy: singleFactor('distance_from_low_end', 'favor_highest'),
      candidates: lists,
      nextItems: nextItemsFor(lists),
      now: NOW,
    })

    expect(suggestions.map((entry) => entry.list.id)).toEqual([
      'barely-started',
      'half-done',
      'nearly-done',
    ])

    // Half-done sits well below the midpoint between the two extremes, which is
    // what "avoid the middle" means in practice.
    expect(suggestions[1]!.score).toBeLessThan(0.4)
  })

  it('combines factors by weight', () => {
    // `stale-but-fresh` wins on neglect, `recent-but-done` on completion.
    // Weighting completion at 90% should hand it to the latter.
    const lists = [
      list({ id: 'stale-but-fresh', total: 10, consumed: 1, minutesLeft: 900, lastConsumed: daysAgo(300) }),
      list({ id: 'recent-but-done', total: 10, consumed: 9, minutesLeft: 100, lastConsumed: daysAgo(1) }),
    ]

    const completionHeavy: Strategy = {
      name: 'test',
      scope: 'all_lists',
      factors: [
        { type: 'neglect_time', direction: 'favor_highest', weight: 0.1 },
        { type: 'completion_percent', direction: 'favor_highest', weight: 0.9 },
      ],
    }

    expect(ranked(completionHeavy, lists)[0]).toBe('recent-but-done')

    const neglectHeavy: Strategy = {
      ...completionHeavy,
      factors: [
        { type: 'neglect_time', direction: 'favor_highest', weight: 0.9 },
        { type: 'completion_percent', direction: 'favor_highest', weight: 0.1 },
      ],
    }

    expect(ranked(neglectHeavy, lists)[0]).toBe('stale-but-fresh')
  })

  it('excludes the current list when the strategy says other_lists', () => {
    const lists = [
      list({ id: 'tired-of-this', total: 4, consumed: 3, minutesLeft: 50 }),
      list({ id: 'something-else', total: 4, consumed: 1, minutesLeft: 300 }),
    ]

    const strategy: Strategy = {
      ...singleFactor('completion_percent', 'favor_highest'),
      scope: 'other_lists',
    }

    expect(ranked(strategy, lists, 'tired-of-this')).toEqual(['something-else'])
  })

  it('keeps the current list when the strategy scores all lists', () => {
    const lists = [
      list({ id: 'a', total: 4, consumed: 3, minutesLeft: 50 }),
      list({ id: 'b', total: 4, consumed: 1, minutesLeft: 300 }),
    ]

    expect(ranked(singleFactor('completion_percent', 'favor_highest'), lists, 'a')).toEqual([
      'a',
      'b',
    ])
  })

  it('treats a trivially small spread as no signal at all', () => {
    // Three lists last touched within seconds of each other are, for ranking
    // purposes, equally neglected. Min–max scaling on its own would stretch
    // those seconds across the full 0–1 range and let them decide the answer —
    // which made a test fail about half the time before the noise floor
    // existed.
    const base = daysAgo(150).getTime()
    const lists = [
      list({ id: 'a', total: 10, consumed: 1, minutesLeft: 100, lastConsumed: new Date(base) }),
      list({ id: 'b', total: 10, consumed: 1, minutesLeft: 100, lastConsumed: new Date(base + 3) }),
      list({ id: 'c', total: 10, consumed: 1, minutesLeft: 100, lastConsumed: new Date(base + 7) }),
    ]

    const suggestions = rank({
      strategy: singleFactor('neglect_time', 'favor_highest'),
      candidates: lists,
      nextItems: nextItemsFor(lists),
      now: NOW,
    })

    expect(suggestions.map((entry) => entry.score)).toEqual([0.5, 0.5, 0.5])
  })

  it('still separates lists once the gap is genuinely meaningful', () => {
    const lists = [
      list({ id: 'yesterday', total: 10, consumed: 1, minutesLeft: 100, lastConsumed: daysAgo(1) }),
      list({ id: 'last-year', total: 10, consumed: 1, minutesLeft: 100, lastConsumed: daysAgo(365) }),
    ]

    expect(ranked(singleFactor('neglect_time', 'favor_highest'), lists)).toEqual([
      'last-year',
      'yesterday',
    ])
  })

  it('scores identical lists neutrally instead of crowning one at random', () => {
    const lists = [
      list({ id: 'a', total: 4, consumed: 2, minutesLeft: 100, lastConsumed: daysAgo(5) }),
      list({ id: 'b', total: 4, consumed: 2, minutesLeft: 100, lastConsumed: daysAgo(5) }),
    ]

    const suggestions = rank({
      strategy: singleFactor('completion_percent', 'favor_highest'),
      candidates: lists,
      nextItems: nextItemsFor(lists),
      now: NOW,
    })

    expect(suggestions.map((entry) => entry.score)).toEqual([0.5, 0.5])
    // Tie broken by id, so repeating the request cannot reshuffle the answer.
    expect(suggestions.map((entry) => entry.list.id)).toEqual(['a', 'b'])
  })

  it('answers with nothing when no list has anything left', () => {
    const lists = [list({ id: 'done', total: 2, consumed: 2, minutesLeft: 0 })]

    expect(ranked(singleFactor('completion_percent', 'favor_highest'), lists)).toEqual([])
  })

  it('names the next thing to consume, not just the list', () => {
    const lists = [list({ id: 'a', total: 4, consumed: 1, minutesLeft: 100 })]

    const [suggestion] = rank({
      strategy: singleFactor('completion_percent', 'favor_highest'),
      candidates: lists,
      nextItems: nextItemsFor(lists),
      now: NOW,
    })

    expect(suggestion?.nextItem?.title).toBe('Next in a')
  })

  it('reports each factor contribution, so a strategy can be tuned by looking', () => {
    const lists = [
      list({ id: 'a', total: 10, consumed: 9, minutesLeft: 100, lastConsumed: daysAgo(1) }),
      list({ id: 'b', total: 10, consumed: 1, minutesLeft: 900, lastConsumed: daysAgo(100) }),
    ]

    const [top] = rank({
      strategy: {
        name: 'test',
        scope: 'all_lists',
        factors: [
          { type: 'neglect_time', direction: 'favor_highest', weight: 0.5 },
          { type: 'completion_percent', direction: 'favor_highest', weight: 0.5 },
        ],
      },
      candidates: lists,
      nextItems: nextItemsFor(lists),
      now: NOW,
    })

    expect(Object.keys(top!.factors).sort()).toEqual(['completion_percent', 'neglect_time'])
  })
})
