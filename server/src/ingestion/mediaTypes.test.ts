import { afterEach, describe, expect, it, vi } from 'vitest'
import { expandWithRuntimes } from './expansion.js'
import {
  createDefaultMediaTypes,
  createMediaTypeRegistry,
  DEFAULT_MEDIA_TYPES,
  toMediaTypeInfo,
  type MediaType,
} from './mediaTypes.js'

describe('media type registry', () => {
  it('ships the agreed phase-1 categories, in display order', () => {
    // Locked deliberately: users cannot add categories, so this set is the
    // wall people hit (docs/design/README.md).
    expect(createMediaTypeRegistry().keys()).toEqual([
      'movie',
      'tv',
      'animation',
      'documentary',
      'wrestling',
      'mma',
      'game',
      'comic',
      'book',
      'music',
      'youtube',
      'mega',
    ])
  })

  it('gives every category a fallback duration, so durations are never null', () => {
    for (const mediaType of DEFAULT_MEDIA_TYPES) {
      expect(mediaType.defaultDurationMinutes).toBeGreaterThan(0)
    }
  })

  it('uses the agreed fallback durations', () => {
    // Locked deliberately. These are the project owner's numbers, and they
    // decide what Quickie ranks on before any real duration is known — for
    // wrestling and MMA, which have no usable API, they are all it will ever
    // have to go on.
    //
    // `mega` is the exception: it postdates that list and the number is a
    // stand-in. It fires rarely — every entry in a franchise list carries a
    // real runtime from TMDB — so it has not been worth asking about.
    expect(
      Object.fromEntries(
        DEFAULT_MEDIA_TYPES.map((mediaType) => [mediaType.key, mediaType.defaultDurationMinutes]),
      ),
    ).toEqual({
      movie: 120,
      tv: 50,
      animation: 25,
      documentary: 90,
      wrestling: 180,
      mma: 180,
      game: 600,
      comic: 15,
      book: 240,
      music: 45,
      youtube: 20,
      mega: 120,
    })
  })

  it('gives search only to categories with a usable source', () => {
    const searchable = DEFAULT_MEDIA_TYPES.filter((mediaType) => mediaType.adapter).map(
      (mediaType) => mediaType.key,
    )

    // A category is listed here because an adapter is *registered*; whether it
    // is usable depends on credentials, which isAvailable() decides.
    //
    // Wrestling and MMA were expected to stay out — neither has a usable API —
    // but Wikipedia's maintained event tables turned out to cover both.
    expect(searchable).toEqual([
      'movie',
      'tv',
      'animation',
      'documentary',
      'wrestling',
      'mma',
      'game',
      'comic',
      'book',
      'music',
      'youtube',
      'mega',
    ])

    // Every category now has a source.
  })

  it('orders by sortOrder rather than declaration order', () => {
    const registry = createMediaTypeRegistry([
      { key: 'last', label: 'Last', sortOrder: 99, defaultDurationMinutes: 10 },
      { key: 'first', label: 'First', sortOrder: 1, defaultDurationMinutes: 10 },
    ])

    expect(registry.keys()).toEqual(['first', 'last'])
  })

  it('refuses duplicate keys', () => {
    const duplicate: MediaType = { key: 'movie', label: 'Dup', sortOrder: 1, defaultDurationMinutes: 1 }

    expect(() => createMediaTypeRegistry([...DEFAULT_MEDIA_TYPES, duplicate])).toThrow(
      /duplicate/i,
    )
  })

  it('does not leak registry mutations to callers', () => {
    const registry = createMediaTypeRegistry()
    registry.list().push({ key: 'sneaky', label: 'Sneaky', sortOrder: 1, defaultDurationMinutes: 1 })

    expect(registry.has('sneaky')).toBe(false)
  })
})

describe('what the Animation and Movies shelves tag on import', () => {
  afterEach(() => vi.unstubAllGlobals())

  // A Ghost in the Shell film and its series are one Animation list; the source that
  // produced each item is what says which it is, and only Animation says it.
  function stubTmdb() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const path = new URL(url).pathname.replace('/3', '')
        const body: Record<string, unknown> = {
          '/tv/1': { seasons: [{ season_number: 1 }], status: 'Ended' },
          '/tv/1/season/1': {
            episodes: [{ season_number: 1, episode_number: 1, name: 'Pilot', air_date: '2000-01-01' }],
          },
          '/discover/movie': { results: [{ id: 5, title: 'Ghost in the Shell', release_date: '1995-11-18' }], total_pages: 1 },
          '/movie/5': { runtime: 83 },
          '/search/tv': { results: [] },
          '/search/company': { results: [] },
          '/search/collection': { results: [{ id: 9, name: 'Ghost in the Shell Collection' }] },
          '/collection/9': {
            parts: [
              { id: 5, title: 'Ghost in the Shell', release_date: '1995-11-18', genre_ids: [16] },
              { id: 6, title: 'A live-action remake', release_date: '2017-03-29', genre_ids: [28] },
            ],
          },
          '/person/7/movie_credits': {
            cast: [{ id: 5, title: 'Ghost in the Shell', release_date: '1995-11-18', genre_ids: [99] }],
          },
        }

        return new Response(JSON.stringify(body[path] ?? {}))
      }),
    )

    return createDefaultMediaTypes({ credentials: { tmdb: () => ({ apiKey: 'k', readAccessToken: undefined }) } })
  }

  it('tags Animation’s series episodes tv and its studio films movie', async () => {
    const animation = stubTmdb().find((entry) => entry.key === 'animation')!.adapter!

    expect((await animation.expand('show:1')).items.map((item) => item.tags)).toEqual([['tv']])
    expect((await animation.expand('company:2')).items.map((item) => item.tags)).toEqual([['movie']])
  })

  it('Animation offers a collection of animated films, tagged movie, and keeps only the animated ones (owner: everything animation-related is found in Animation)', async () => {
    const animation = stubTmdb().find((entry) => entry.key === 'animation')!.adapter!

    expect(await animation.search('ghost')).toEqual([
      { externalRef: 'collection:9', title: 'Ghost in the Shell Collection', detail: 'Collection' },
    ])
    const { items } = await animation.expand('collection:9')
    expect(items.map((item) => [item.title, item.tags])).toEqual([['Ghost in the Shell', ['movie']]])
  })

  it('Movies still offers both collections and people, unfiltered', async () => {
    const movies = stubTmdb().find((entry) => entry.key === 'movie')!.adapter!

    expect((await movies.expand('collection:9')).items.map((item) => item.title)).toEqual(['Ghost in the Shell', 'A live-action remake'])
  })

  it.each([
    ['movie', 'company:2'],
    ['animation', 'company:2'],
    ['animation', 'collection:9'],
    ['documentary', 'person:7'],
  ])('lists %s’s films without lengths and fills them in after, ending where a full expansion does (15.2)', async (key, ref) => {
    const adapter = stubTmdb().find((entry) => entry.key === key)!.adapter!

    expect((await adapter.expand(ref, { runtimes: 'skip' })).items[0]).not.toHaveProperty('timeToConsumeMinutes')

    const filled = await expandWithRuntimes(adapter, ref)

    expect(filled.items[0]?.timeToConsumeMinutes).toBe(83)
    expect(filled).toEqual(await adapter.expand(ref))
  })

  it('tags nothing on Movies or TV, which have no Type facet to feed', async () => {
    const types = stubTmdb()

    expect((await types.find((entry) => entry.key === 'tv')!.adapter!.expand('show:1')).items[0]).not.toHaveProperty('tags')
    expect((await types.find((entry) => entry.key === 'movie')!.adapter!.expand('company:2')).items[0]).not.toHaveProperty('tags')
  })
})

describe('how long a source copy may be kept (task 12.1)', () => {
  const limits = () =>
    Object.fromEntries(
      createMediaTypeRegistry()
        .list()
        .map((mediaType) => [mediaType.key, mediaType.sourceCopyMaxDays]),
    )

  it('limits YouTube to 30 days and the TMDB categories to 180', () => {
    expect(limits()).toMatchObject({
      youtube: 30,
      movie: 180,
      tv: 180,
      animation: 180,
      documentary: 180,
    })
  })

  it('sets no limit where the source does not ask for one', () => {
    // Mega is curated lists only (owner, 2026-09-30): nothing of it is a fetched, aged copy.
    for (const key of ['wrestling', 'mma', 'game', 'comic', 'book', 'music', 'mega']) {
      expect(limits()[key], key).toBeUndefined()
    }
  })

  it('is part of what a category tells the client', () => {
    const info = Object.fromEntries(
      createMediaTypeRegistry()
        .list()
        .map((mediaType) => [mediaType.key, toMediaTypeInfo(mediaType)]),
    )

    expect(info['youtube']?.sourceCopyMaxDays).toBe(30)
    expect(info['movie']?.sourceCopyMaxDays).toBe(180)
    expect(info['game']).not.toHaveProperty('sourceCopyMaxDays')
  })
})
