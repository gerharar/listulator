import { describe, expect, it } from 'vitest'
import type { MediaList, MediaType } from './api.js'
import { buildBuckets, findOrphanedLists } from './buckets.js'

function mediaType(key: string, sortOrder: number): MediaType {
  return { key, label: key.toUpperCase(), sortOrder, defaultDurationMinutes: 30, searchAvailable: false }
}

function list(id: string, mediaTypeKey: string): MediaList {
  return {
    id,
    title: `List ${id}`,
    description: null,
    mediaType: mediaTypeKey,
    source: 'manual',
    externalRef: null,
    status: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    stats: {
      totalItems: 0,
      consumedItems: 0,
      completionPercent: 0,
      timeRemainingMinutes: 0,
      lastConsumedAt: null,
    },
  }
}

const CATEGORIES = [mediaType('movie', 10), mediaType('game', 20), mediaType('comic', 30)]

describe('buildBuckets', () => {
  it('offers every category before anything exists, so the app explains itself', () => {
    const layout = buildBuckets([], CATEGORIES)

    expect(layout.isFirstRun).toBe(true)
    expect(layout.used).toEqual([])
    expect(layout.unused).toHaveLength(3)
  })

  it('gives categories in use a bucket and collapses the rest', () => {
    const layout = buildBuckets([list('a', 'movie'), list('b', 'movie')], CATEGORIES)

    expect(layout.isFirstRun).toBe(false)
    expect(layout.used).toHaveLength(1)
    expect(layout.used[0]?.mediaType.key).toBe('movie')
    expect(layout.used[0]?.lists.map((entry) => entry.id)).toEqual(['a', 'b'])
    expect(layout.unused.map((entry) => entry.key)).toEqual(['game', 'comic'])
  })

  it('keeps buckets in registry order, not the order lists were made', () => {
    const layout = buildBuckets([list('a', 'comic'), list('b', 'movie')], CATEGORIES)

    expect(layout.used.map((bucket) => bucket.mediaType.key)).toEqual(['movie', 'comic'])
  })

  it('has nothing to collapse once every category is in use', () => {
    const layout = buildBuckets(
      [list('a', 'movie'), list('b', 'game'), list('c', 'comic')],
      CATEGORIES,
    )

    expect(layout.unused).toEqual([])
  })

  it('sorts categories by sortOrder even if the server sent them jumbled', () => {
    const layout = buildBuckets([], [mediaType('z', 99), mediaType('a', 1)])

    expect(layout.unused.map((entry) => entry.key)).toEqual(['a', 'z'])
  })
})

describe('findOrphanedLists', () => {
  it('surfaces lists whose category has been removed from the registry', () => {
    // Otherwise the list still exists in the database but appears nowhere,
    // which reads as data loss.
    const orphans = findOrphanedLists([list('a', 'movie'), list('b', 'podcast')], CATEGORIES)

    expect(orphans.map((entry) => entry.id)).toEqual(['b'])
  })

  it('finds nothing when every category is known', () => {
    expect(findOrphanedLists([list('a', 'movie')], CATEGORIES)).toEqual([])
  })
})
