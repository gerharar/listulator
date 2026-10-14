import { describe, expect, it } from 'vitest'
import { itemLinkFor, withItemLinks, type ItemLinkInput } from './itemLink.js'
import { createMediaTypeRegistry } from './mediaTypes.js'

const registry = createMediaTypeRegistry()

const link = (mediaType: string, item: Partial<ItemLinkInput>, listExternalRef: string | null = null) =>
  itemLinkFor(registry.get(mediaType), { externalRef: null, title: 'Anything', source: 'import', ...item }, listExternalRef)

describe('the link from an item to its page at its source (H-002, BL-087)', () => {
  describe('TMDB films', () => {
    it('opens the film from its stored id', () => {
      expect(link('movie', { externalRef: 'movie:603', title: 'The Matrix' })).toEqual({
        url: 'https://www.themoviedb.org/movie/603',
        source: 'TMDB',
      })
    })

    it('does the same in the categories that mix films with series', () => {
      for (const key of ['animation', 'documentary']) {
        expect(link(key, { externalRef: 'movie:862' })?.url).toBe('https://www.themoviedb.org/movie/862')
      }
    })

    it.each(['movie:', 'movie:abc', 'movie:603/../x', 'movie:603?next=https://evil.example', 'movie:603 ', 'movie:-1', 'show:603', '603'])(
      'builds nothing from the ref %j',
      (externalRef) => {
        expect(link('movie', { externalRef })).toBeNull()
      },
    )
  })

  describe('TMDB episodes, derived from the list and the title', () => {
    const episode = { externalRef: null, title: 'S01E02 Cat’s in the Bag...' }

    it('opens the episode of the show the list was made from', () => {
      expect(link('tv', episode, 'show:1396')).toEqual({
        url: 'https://www.themoviedb.org/tv/1396/season/1/episode/2',
        source: 'TMDB',
      })
    })

    it('reads a season of two or more digits and a special (season 0)', () => {
      expect(link('tv', { ...episode, title: 'S12E104 Long runner' }, 'show:1')?.url).toBe(
        'https://www.themoviedb.org/tv/1/season/12/episode/104',
      )
      expect(link('tv', { ...episode, title: 'S00E03 Behind the scenes' }, 'show:1396')?.url).toBe(
        'https://www.themoviedb.org/tv/1396/season/0/episode/3',
      )
    })

    it('also works inside Animation and Documentary', () => {
      expect(link('animation', episode, 'show:30984')?.url).toBe('https://www.themoviedb.org/tv/30984/season/1/episode/2')
      expect(link('documentary', episode, 'show:30984')?.url).toBe('https://www.themoviedb.org/tv/30984/season/1/episode/2')
    })

    it('offers none once the title no longer starts with the episode label', () => {
      expect(link('tv', { ...episode, title: 'Cat’s in the Bag' }, 'show:1396')).toBeNull()
      expect(link('tv', { ...episode, title: 'Not S01E02 at the start' }, 'show:1396')).toBeNull()
      expect(link('tv', { ...episode, title: 'S01E02x' }, 'show:1396')).toBeNull()
    })

    it.each([null, 'show:', 'show:abc', 'show:1396:extra', 'company:5', 'canonical:tv/x.yaml'])(
      'offers none when the list ref is %j',
      (listRef) => {
        expect(link('tv', episode, listRef)).toBeNull()
      },
    )

    it('offers none for an episode typed in by hand', () => {
      expect(link('tv', { ...episode, source: 'manual' }, 'show:1396')).toBeNull()
    })
  })

  describe('MusicBrainz release groups', () => {
    const mbid = 'f5093c06-23e3-404f-aeaa-40f72885ee3a'

    it('opens the release group from its id', () => {
      expect(link('music', { externalRef: mbid })).toEqual({
        url: `https://musicbrainz.org/release-group/${mbid}`,
        source: 'MusicBrainz',
      })
    })

    it.each(['', 'not-a-uuid', `${mbid}/../x`, `${mbid}?a=b`, `${mbid}:ep`, 'artist:123'])('builds nothing from %j', (externalRef) => {
      expect(link('music', { externalRef })).toBeNull()
    })
  })

  describe('YouTube videos', () => {
    it('opens the video from its id', () => {
      expect(link('youtube', { externalRef: 'video:dQw4w9WgXcQ' })).toEqual({
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        source: 'YouTube',
      })
    })

    it.each(['video:', 'video:short', 'video:dQw4w9WgXcQ&list=x', 'video:dQw4w9WgXc/', 'playlist:PLabcdefghijkl', 'channel:UC123'])(
      'builds nothing from %j',
      (externalRef) => {
        expect(link('youtube', { externalRef })).toBeNull()
      },
    )
  })

  describe('Comic Vine issues', () => {
    it('opens the issue from its id', () => {
      expect(link('comic', { externalRef: 'issue:1196700' })).toEqual({
        url: 'https://comicvine.gamespot.com/issue/4000-1196700/',
        source: 'Comic Vine',
      })
    })

    it.each(['issue:', 'issue:abc', 'issue:12/../x', 'volume:4050', '4000-1'])('builds nothing from %j', (externalRef) => {
      expect(link('comic', { externalRef })).toBeNull()
    })
  })

  describe('IGDB games, from the slug the background lookup cached', () => {
    it('opens the game from its ref and its slug', () => {
      expect(link('game', { externalRef: 'game:1942', slug: 'the-witcher-3-wild-hunt' })).toEqual({
        url: 'https://www.igdb.com/games/the-witcher-3-wild-hunt',
        source: 'IGDB',
      })
    })

    it('has none while the slug is unknown, or known to be missing', () => {
      expect(link('game', { externalRef: 'game:1942' })).toBeNull()
      expect(link('game', { externalRef: 'game:1942', slug: null })).toBeNull()
    })

    it.each(['', '../x', 'a/b', 'a?b=c', 'a b', 'A-Upper', '-leading', 'javascript:alert(1)', 'a'.repeat(300) + '/'])(
      'builds nothing from the slug %j',
      (slug) => {
        expect(link('game', { externalRef: 'game:1942', slug })).toBeNull()
      },
    )

    it.each(['game:', 'game:abc', 'game:1/../x', 'movie:1942', 'franchise:3'])('builds nothing from the ref %j, whatever the slug', (externalRef) => {
      expect(link('game', { externalRef, slug: 'fine-slug' })).toBeNull()
    })

    it('offers none in any other category, even with a slug', () => {
      expect(link('movie', { externalRef: 'game:1942', slug: 'fine-slug' })).toBeNull()
    })
  })

  describe('withItemLinks', () => {
    const items: ItemLinkInput[] = [
      { externalRef: 'game:1', title: 'One', source: 'import' },
      { externalRef: 'game:2', title: 'Two', source: 'import' },
      { externalRef: 'game:3', title: 'Three', source: 'import' },
    ]

    it('gives each item the slug held for its ref', () => {
      const linked = withItemLinks(registry.get('game'), 'franchise:5', items, new Map([['game:1', 'one'], ['game:2', null]]))

      expect(linked.map((item) => item.link?.url ?? null)).toEqual(['https://www.igdb.com/games/one', null, null])
    })

    it('works with no slugs given, for a category that needs none', () => {
      const linked = withItemLinks(registry.get('movie'), null, [{ externalRef: 'movie:603', title: 'The Matrix', source: 'import' }])

      expect(linked[0]!.link?.url).toBe('https://www.themoviedb.org/movie/603')
    })
  })

  describe('where there is no page to open', () => {
    it('has none for an item typed in by hand, even one carrying a ref', () => {
      expect(link('movie', { externalRef: 'movie:603', source: 'manual' })).toBeNull()
    })

    it('has none for an item with no ref', () => {
      expect(link('movie', { externalRef: null })).toBeNull()
    })

    it.each(['book', 'wrestling', 'mma', 'mega'])('has none in %s, whatever the ref looks like', (key) => {
      expect(link(key, { externalRef: 'movie:603' }, 'show:1396')).toBeNull()
      expect(link(key, { externalRef: 'issue:1' })).toBeNull()
    })

    it('has none in a category the registry does not know', () => {
      expect(itemLinkFor(undefined, { externalRef: 'movie:603', title: 'x', source: 'import' }, null)).toBeNull()
    })

    it('has none from another category’s adapter: a film ref in a game list is not a page', () => {
      expect(link('game', { externalRef: 'movie:603' })).toBeNull()
      expect(link('music', { externalRef: 'movie:603' })).toBeNull()
    })
  })

  describe('whatever an adapter says', () => {
    const entry = (itemUrl: () => string | undefined) =>
      ({
        key: 'x',
        label: 'X',
        sortOrder: 1,
        defaultDurationMinutes: 1,
        sourceName: 'Somewhere',
        adapter: { isAvailable: () => true, search: async () => [], expand: async () => ({ items: [] }), itemUrl },
      }) as never

    const given = { externalRef: 'a:1', title: 'x', source: 'import' as const }

    it('is passed on when it is an https address', () => {
      expect(itemLinkFor(entry(() => 'https://example.org/a/1'), given, null)).toEqual({ url: 'https://example.org/a/1', source: 'Somewhere' })
    })

    it.each(['http://example.org/a', 'javascript:alert(1)', 'file:///etc/passwd', '//example.org/a', 'https://user:pw@example.org/', 'not a url'])(
      'is dropped when it is %j',
      (url) => {
        expect(itemLinkFor(entry(() => url), given, null)).toBeNull()
      },
    )

    it('gives no link, and no error, when the adapter throws', () => {
      expect(
        itemLinkFor(
          entry(() => {
            throw new Error('boom')
          }),
          given,
          null,
        ),
      ).toBeNull()
    })

    it('gives none for a category that names no source', () => {
      const unnamed = { ...(entry(() => 'https://example.org/a') as object), sourceName: undefined } as never
      expect(itemLinkFor(unnamed, given, null)).toBeNull()
    })
  })
})
