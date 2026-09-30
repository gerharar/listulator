import { describe, expect, it } from 'vitest'
import type { MediaList, MediaType } from './api.js'
import { buildBuckets, findOrphanedLists, listMark } from './buckets.js'

function mediaType(key: string, sortOrder: number): MediaType {
  return { key, label: key.toUpperCase(), sortOrder, defaultDurationMinutes: 30, searchAvailable: false, previewable: false }
}

function list(
  id: string,
  mediaTypeKey: string,
  source: MediaList['source'] = 'manual',
): MediaList {
  return {
    id,
    title: `List ${id}`,
    description: null,
    mediaType: mediaTypeKey,
    source,
    externalRef: null,
    status: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    stats: {
      totalItems: 0,
      consumedItems: 0,
      newItems: 0,
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
    expect(layout.unused.map((entry) => entry.key)).toEqual(['comic', 'game'])
  })

  it('puts buckets A–Z by category name, not in the order lists were made', () => {
    const layout = buildBuckets([list('a', 'movie'), list('b', 'comic')], CATEGORIES)

    expect(layout.used.map((bucket) => bucket.mediaType.key)).toEqual(['comic', 'movie'])
  })

  it('has nothing to collapse once every category is in use', () => {
    const layout = buildBuckets(
      [list('a', 'movie'), list('b', 'game'), list('c', 'comic')],
      CATEGORIES,
    )

    expect(layout.unused).toEqual([])
  })

  it('sorts the collapsed categories A–Z too, whatever sortOrder and order the server sent', () => {
    const layout = buildBuckets([], [mediaType('z', 1), mediaType('a', 99), mediaType('m', 50)])

    expect(layout.unused.map((entry) => entry.key)).toEqual(['a', 'm', 'z'])
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

describe('listMark', () => {
  it('marks a canonical list as curated', () => {
    expect(listMark(list('a', 'movie', 'canonical'))).toBe('curated')
  })

  it('marks a manual list as by-hand', () => {
    expect(listMark(list('a', 'movie', 'manual'))).toBe('byHand')
  })

  it('marks an api/llm/file-synced list as neither', () => {
    expect(listMark(list('a', 'movie', 'api'))).toBeNull()
    expect(listMark(list('a', 'movie', 'llm'))).toBeNull()
    expect(listMark(list('a', 'movie', 'file'))).toBeNull()
  })
})
