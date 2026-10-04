import { describe, expect, it, vi } from 'vitest'
import { MAX_LIST_ITEMS } from '../../catalog/limits.js'
import { ListTooLargeError } from '../expandSource.js'
import { IngestionError, USER_AGENT, type FetchLike } from '../http.js'
import { createRateLimiter, type RateLimiter } from '../rateLimiter.js'
import { createMusicBrainzAdapter } from './musicbrainz.js'

const noWait = vi.fn<(ms: number) => Promise<void>>(async () => {})

/**
 * Fixtures are trimmed from real MusicBrainz responses (verified live against
 * the Cannibal Corpse artist id), so the shapes being mapped are the shapes the
 * service actually returns rather than what the docs imply.
 */

function respondWith(body: unknown, status = 200): FetchLike {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  )
}

type Group = (typeof RELEASE_GROUPS)['release-groups'][number]

/**
 * A MusicBrainz that answers the two ways the adapter asks for release groups, as the real one does (checked
 * live): a **search** (`?query=`) that applies the Lucene query's filters, answers `count`, and refuses to page
 * past offset 500 with a 400; and a **browse** (`?artist=&type=`) that filters by primary type only and answers
 * `release-group-count`. A fixture that ignored the URL would let a test believe the adapter asked for one thing
 * and got another. The search side reads which facets were asked for out of the query text, so a test that gets
 * the wrong facets into the query fails.
 */
function musicBrainz(all: readonly Group[]) {
  const calls: URL[] = []

  const fetchImpl: FetchLike = vi.fn(async (url: string) => {
    const parsed = new URL(url)
    calls.push(parsed)
    const params = parsed.searchParams
    const limit = Number(params.get('limit'))
    const offset = Number(params.get('offset') ?? 0)
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

    if (parsed.pathname.endsWith('/artist')) return json(ARTIST_SEARCH)

    const query = params.get('query')
    if (query !== null) {
      if (offset >= 500) return json({ error: 'offset too large' }, 400)

      const has = (token: string) => query.includes(token)
      const primaries = new Set(['album', ...(has('primarytype:ep') ? ['ep'] : []), ...(has('primarytype:single') ? ['single'] : [])])
      const matches = all.filter((group) => {
        const primary = (group['primary-type'] ?? '').toLowerCase()
        const secondary = ((group as { 'secondary-types'?: string[] })['secondary-types'] ?? []).map((type) => type.toLowerCase())

        return (
          (primary === 'album' && secondary.length === 0) ||
          (has('primarytype:ep') && primary === 'ep') ||
          (has('primarytype:single') && primary === 'single') ||
          (has('secondarytype:live') && secondary.includes('live') && primaries.has(primary)) ||
          (has('secondarytype:compilation') && secondary.includes('compilation') && primaries.has(primary))
        )
      })

      return json({ count: matches.length, offset, 'release-groups': matches.slice(offset, offset + limit) })
    }

    const requested = new Set((params.get('type') ?? '').split('|'))
    const groups = all.filter((group) => requested.has((group['primary-type'] ?? '').toLowerCase()))

    return json({ 'release-group-count': groups.length, 'release-groups': groups.slice(offset, offset + limit) })
  })

  return { calls, fetchImpl }
}

/** `n` studio albums, one a year from 1900, titled by their number. */
function studioAlbums(n: number, firstId = 0): Group[] {
  return Array.from({ length: n }, (_, index) => ({
    id: `rg-${firstId + index}`,
    title: `Album ${firstId + index}`,
    'first-release-date': String(1900 + ((firstId + index) % 100)),
    'primary-type': 'Album',
    'secondary-types': [] as string[],
  }))
}

/** `n` live albums, dated 2000 and after. */
function liveAlbums(n: number): Group[] {
  return Array.from({ length: n }, (_, index) => ({
    id: `live-${index}`,
    title: `Live ${index}`,
    'first-release-date': `2000-01-${String((index % 28) + 1).padStart(2, '0')}`,
    'primary-type': 'Album',
    'secondary-types': ['Live'],
  }))
}

const ARTIST_SEARCH = {
  artists: [
    {
      id: 'af8e4cc5-ef54-458d-a194-7b210acf638f',
      name: 'Cannibal Corpse',
      type: 'Group',
      country: 'US',
      disambiguation: 'American death metal',
    },
    { id: '2ded9132-ec61-4b79-9275-b3e0e534a5d5', name: 'Corpsegrinder', type: 'Person' },
  ],
}

const RELEASE_GROUPS = {
  'release-group-count': 6,
  'release-groups': [
    {
      id: 'rg-compilation',
      title: 'Dead Human Collection',
      'first-release-date': '2013-03-29',
      'primary-type': 'Album',
      'secondary-types': ['Compilation'],
    },
    {
      id: 'rg-live',
      title: 'Global Evisceration',
      'first-release-date': '2011-03-15',
      'primary-type': 'Album',
      'secondary-types': ['Live'],
    },
    {
      id: 'rg-bloodthirst',
      title: 'Bloodthirst',
      'first-release-date': '1999-10-06',
      'primary-type': 'Album',
      'secondary-types': [],
    },
    {
      id: 'rg-eaten',
      title: 'Eaten Back to Life',
      'first-release-date': '1990-08-16',
      'primary-type': 'Album',
    },
    {
      id: 'rg-bleeding',
      // Partial dates are common upstream.
      title: 'The Bleeding',
      'first-release-date': '1994-03',
      'primary-type': 'Album',
      'secondary-types': [],
    },
    {
      id: 'rg-single',
      title: 'Hammer Smashed Face',
      'first-release-date': '1993-01-01',
      'primary-type': 'Single',
    },
    {
      id: 'rg-ep',
      title: 'Worm Infested',
      'first-release-date': '2002-11-05',
      'primary-type': 'EP',
    },
    {
      id: 'rg-live-ep',
      title: 'Live Cannibalism (Sampler)',
      'first-release-date': '2000-08-01',
      'primary-type': 'EP',
      'secondary-types': ['Live'],
    },
  ],
}

describe('MusicBrainz adapter', () => {
  it('needs no credentials, so it is always available', () => {
    expect(createMusicBrainzAdapter().isAvailable()).toBe(true)
  })

  it('finds artists that could become a discography', async () => {
    const adapter = createMusicBrainzAdapter(respondWith(ARTIST_SEARCH))

    expect(await adapter.search('cannibal corpse')).toEqual([
      {
        externalRef: 'af8e4cc5-ef54-458d-a194-7b210acf638f',
        title: 'Cannibal Corpse Discography',
        detail: 'Group · US · American death metal',
      },
      {
        externalRef: '2ded9132-ec61-4b79-9275-b3e0e534a5d5',
        title: 'Corpsegrinder Discography',
        detail: 'Person',
      },
    ])
  })

  it('identifies itself, because MusicBrainz refuses anonymous clients', async () => {
    const fetchImpl = respondWith(ARTIST_SEARCH)
    await createMusicBrainzAdapter(fetchImpl).search('anything')

    const [, init] = vi.mocked(fetchImpl).mock.calls[0]!
    expect((init?.headers as Record<string, string>)['user-agent']).toBe(USER_AGENT)
  })

  it('expands an artist to studio albums only, in chronological order', async () => {
    // The filtering is the point: compilations, live records and singles are
    // not what someone means by "the discography".
    const adapter = createMusicBrainzAdapter(musicBrainz(RELEASE_GROUPS['release-groups']).fetchImpl)

    expect((await adapter.expand('af8e4cc5')).items.map((item) => item.title)).toEqual([
      'Eaten Back to Life',
      'The Bleeding',
      'Bloodthirst',
    ])
  })

  it('populates year from first-release-date, including a partial date', async () => {
    const adapter = createMusicBrainzAdapter(musicBrainz(RELEASE_GROUPS['release-groups']).fetchImpl)

    expect((await adapter.expand('af8e4cc5')).items.map((item) => [item.title, item.year])).toEqual([
      ['Eaten Back to Life', 1990],
      // 'first-release-date': '1994-03' — a partial date still yields a year.
      ['The Bleeding', 1994],
      ['Bloodthirst', 1999],
    ])
  })

  it('tags every studio album ["Album"], not just the opted-in extras', async () => {
    const adapter = createMusicBrainzAdapter(musicBrainz(RELEASE_GROUPS['release-groups']).fetchImpl)

    expect((await adapter.expand('af8e4cc5')).items.map((item) => item.tags)).toEqual([
      ['Album'],
      ['Album'],
      ['Album'],
    ])
  })

  it('tags an EP, a single, a live album, and a compilation distinctly', async () => {
    const adapter = createMusicBrainzAdapter(musicBrainz(RELEASE_GROUPS['release-groups']).fetchImpl)

    const byTitle = new Map(
      (await adapter.expand('af8e4cc5:ep,single,live,compilation')).items.map((item) => [
        item.title,
        item.tags,
      ]),
    )

    expect(byTitle.get('Eaten Back to Life')).toEqual(['Album'])
    expect(byTitle.get('Worm Infested')).toEqual(['EP'])
    expect(byTitle.get('Hammer Smashed Face')).toEqual(['Single'])
    expect(byTitle.get('Global Evisceration')).toEqual(['Album', 'Live'])
    expect(byTitle.get('Dead Human Collection')).toEqual(['Album', 'Compilation'])
    expect(byTitle.get('Live Cannibalism (Sampler)')).toEqual(['EP', 'Live'])
  })

  it('leaves durations unset so the category default applies', async () => {
    // Album length would cost one request per album against a one-per-second
    // limit. Every item comes back without a duration and is filled in as an
    // estimate downstream.
    const adapter = createMusicBrainzAdapter(musicBrainz(RELEASE_GROUPS['release-groups']).fetchImpl)

    for (const item of (await adapter.expand('af8e4cc5')).items) {
      expect(item.timeToConsumeMinutes).toBeUndefined()
      expect(item.externalRef).toBeTruthy()
    }
  })

  it('includes EPs when the ref opts in — both a plain EP and a live one, since a live EP is still an EP', async () => {
    const adapter = createMusicBrainzAdapter(musicBrainz(RELEASE_GROUPS['release-groups']).fetchImpl)

    expect((await adapter.expand('af8e4cc5:ep')).items.map((item) => item.title)).toEqual([
      'Eaten Back to Life',
      'The Bleeding',
      'Bloodthirst',
      'Live Cannibalism (Sampler)',
      'Worm Infested',
    ])
  })

  it('includes singles when the ref opts in', async () => {
    const adapter = createMusicBrainzAdapter(musicBrainz(RELEASE_GROUPS['release-groups']).fetchImpl)

    expect((await adapter.expand('af8e4cc5:single')).items.map((item) => item.title)).toContain(
      'Hammer Smashed Face',
    )
  })

  it('includes live albums when the ref opts in, but not a live EP when EPs were never even requested', async () => {
    // Real MusicBrainz filters `type` server-side, so a "live"-only ref
    // (which only asks for `type=album`) never gets the live EP back to
    // filter client-side in the first place — unlike the two "additive"
    // cases below, where the EP itself was actually fetched.
    const adapter = createMusicBrainzAdapter(musicBrainz(RELEASE_GROUPS['release-groups']).fetchImpl)

    const titles = (await adapter.expand('af8e4cc5:live')).items.map((item) => item.title)
    expect(titles).toContain('Global Evisceration')
    expect(titles).not.toContain('Live Cannibalism (Sampler)')
  })

  it('is additive across facets: opting into EPs alone already surfaces a live EP', async () => {
    const adapter = createMusicBrainzAdapter(musicBrainz(RELEASE_GROUPS['release-groups']).fetchImpl)

    expect((await adapter.expand('af8e4cc5:ep')).items.map((item) => item.title)).toContain(
      'Live Cannibalism (Sampler)',
    )
  })

  it('includes compilations when the ref opts in', async () => {
    const adapter = createMusicBrainzAdapter(musicBrainz(RELEASE_GROUPS['release-groups']).fetchImpl)

    expect((await adapter.expand('af8e4cc5:compilation')).items.map((item) => item.title)).toContain(
      'Dead Human Collection',
    )
  })

  describe('the search it asks MusicBrainz', () => {
    const queryOf = (url: URL) => url.searchParams.get('query')

    it('asks for studio albums only with no facets, in one request', async () => {
      const { calls, fetchImpl } = musicBrainz(RELEASE_GROUPS['release-groups'])

      await createMusicBrainzAdapter(fetchImpl).expand('af8e4cc5')

      expect(calls).toHaveLength(1)
      expect(queryOf(calls[0]!)).toBe('arid:"af8e4cc5" AND ((primarytype:album AND NOT secondarytype:*))')
      expect(calls[0]!.searchParams.get('limit')).toBe('100')
      expect(calls[0]!.searchParams.get('offset')).toBe('0')
    })

    it('adds only what each facet opts into, a live or compilation release among the primary types asked for', async () => {
      const { calls, fetchImpl } = musicBrainz(RELEASE_GROUPS['release-groups'])
      const adapter = createMusicBrainzAdapter(fetchImpl)

      await adapter.expand('af8e4cc5:ep,single,live')
      await adapter.expand('af8e4cc5:compilation')

      expect(queryOf(calls[0]!)).toBe(
        'arid:"af8e4cc5" AND ((primarytype:album AND NOT secondarytype:*) OR primarytype:ep OR primarytype:single' +
          ' OR (primarytype:(album OR ep OR single) AND secondarytype:live))',
      )
      expect(queryOf(calls[1]!)).toBe(
        'arid:"af8e4cc5" AND ((primarytype:album AND NOT secondarytype:*) OR (primarytype:(album) AND secondarytype:compilation))',
      )
    })

    it('quotes the artist id, so whatever it holds is a value and not more query', async () => {
      const { calls, fetchImpl } = musicBrainz([])

      await createMusicBrainzAdapter(fetchImpl).expand('x" OR arid*\\')

      expect(queryOf(calls[0]!)).toBe(
        'arid:"x\\" OR arid*\\\\" AND ((primarytype:album AND NOT secondarytype:*))',
      )
    })

    it('still keeps only what the facets keep when the search hands over more', async () => {
      // The search is what asks for the right groups; the filter is what makes the list right whatever the
      // index says (a stale or odd row), as it was when every group was read.
      const stray = { id: 'rg-stray', title: 'Stray', 'first-release-date': '1990', 'primary-type': 'Single' }
      const fetchImpl: FetchLike = vi.fn(
        async () => new Response(JSON.stringify({ count: 2, 'release-groups': [studioAlbums(1)[0], stray] })),
      )

      const titles = (await createMusicBrainzAdapter(fetchImpl).expand('af8e4cc5')).items.map((item) => item.title)

      expect(titles).toEqual(['Album 0'])
    })
  })

  describe('a long discography', () => {
    const searchCalls = (calls: URL[]) => calls.filter((url) => url.searchParams.has('query'))
    const browseCalls = (calls: URL[]) => calls.filter((url) => url.searchParams.has('artist'))

    it('reads every page of the search, a hundred at a time', async () => {
      const { calls, fetchImpl } = musicBrainz(studioAlbums(250))

      const { items } = await createMusicBrainzAdapter(fetchImpl).expand('af8e4cc5')

      expect(items).toHaveLength(250)
      expect(searchCalls(calls).map((url) => url.searchParams.get('offset'))).toEqual(['0', '100', '200'])
      expect(browseCalls(calls)).toHaveLength(0)
    })

    it('reads a discography of five hundred, the most a search pages to, by search alone', async () => {
      const { calls, fetchImpl } = musicBrainz(studioAlbums(500))

      expect((await createMusicBrainzAdapter(fetchImpl).expand('af8e4cc5')).items).toHaveLength(500)
      expect(searchCalls(calls)).toHaveLength(5)
      expect(browseCalls(calls)).toHaveLength(0)
    })

    it('browses instead when more than five hundred match, since a search will not page past offset 500', async () => {
      // 700 live albums and 20 studio albums: the live facet keeps 720 groups.
      const { calls, fetchImpl } = musicBrainz([...studioAlbums(20), ...liveAlbums(700)])

      const { items } = await createMusicBrainzAdapter(fetchImpl).expand('af8e4cc5:live')

      expect(items).toHaveLength(720)
      expect(searchCalls(calls)).toHaveLength(1)
      expect(browseCalls(calls)).toHaveLength(8)
      expect(browseCalls(calls)[0]!.searchParams.get('type')).toBe('album')
      expect(browseCalls(calls)[0]!.searchParams.get('artist')).toBe('af8e4cc5')
    })

    it('browses the primary types a facet needs, and keeps only what the facets keep', async () => {
      const wanted = [...studioAlbums(10), ...liveAlbums(600)]
      const unwanted = [
        { id: 'rg-remix', title: 'Remixes', 'first-release-date': '2001', 'primary-type': 'Album', 'secondary-types': ['Remix'] },
        { id: 'rg-ep', title: 'An EP', 'first-release-date': '2002', 'primary-type': 'EP', 'secondary-types': [] as string[] },
      ]
      const { calls, fetchImpl } = musicBrainz([...wanted, ...unwanted])

      const { items } = await createMusicBrainzAdapter(fetchImpl).expand('af8e4cc5:live,ep')

      expect(browseCalls(calls)[0]!.searchParams.get('type')).toBe('album|ep')
      expect(items).toHaveLength(611)
      expect(items.map((item) => item.title)).toContain('An EP')
      expect(items.map((item) => item.title)).not.toContain('Remixes')
    })

    it('reads exactly the most a list holds: ten thousand groups, a hundred pages of browse', async () => {
      const { calls, fetchImpl } = musicBrainz(studioAlbums(MAX_LIST_ITEMS))

      const { items } = await createMusicBrainzAdapter(fetchImpl).expand('af8e4cc5')

      expect(items).toHaveLength(MAX_LIST_ITEMS)
      expect(browseCalls(calls)).toHaveLength(100)
    })

    it('stops browsing at the last page, with no extra request when the total is a whole number of pages', async () => {
      const { calls, fetchImpl } = musicBrainz(liveAlbums(600))

      expect((await createMusicBrainzAdapter(fetchImpl).expand('af8e4cc5:live')).items).toHaveLength(600)
      expect(browseCalls(calls)).toHaveLength(6)
    })

    it('stops browsing at a short page when the browse names no total', async () => {
      const fetchImpl: FetchLike = vi.fn(async (url: string) => {
        const parsed = new URL(url)
        if (parsed.searchParams.has('query')) return new Response(JSON.stringify({ count: 600, 'release-groups': liveAlbums(100) }))

        const offset = Number(parsed.searchParams.get('offset'))
        return new Response(JSON.stringify({ 'release-groups': liveAlbums(250).slice(offset, offset + 100) }))
      })

      expect((await createMusicBrainzAdapter(fetchImpl).expand('af8e4cc5:live')).items).toHaveLength(250)
      expect(fetchImpl).toHaveBeenCalledTimes(4)
    })

    it('stops paging a search that has run dry before its count, rather than asking on', async () => {
      const fetchImpl: FetchLike = vi.fn(async (url: string) =>
        new Response(
          JSON.stringify({
            count: 450,
            'release-groups': new URL(url).searchParams.get('offset') === '0' ? studioAlbums(100) : [],
          }),
        ),
      )

      expect((await createMusicBrainzAdapter(fetchImpl).expand('af8e4cc5')).items).toHaveLength(100)
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    })

    it('refuses a source with more matches than a list holds, after one request', async () => {
      const fetchImpl: FetchLike = vi.fn(
        async () => new Response(JSON.stringify({ count: MAX_LIST_ITEMS + 1, 'release-groups': studioAlbums(100) })),
      )

      const error = await createMusicBrainzAdapter(fetchImpl).expand('af8e4cc5').catch((cause: unknown) => cause)

      expect(error).toBeInstanceOf(ListTooLargeError)
      expect(error).toMatchObject({ count: MAX_LIST_ITEMS + 1 })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it('refuses a browse that would read more groups than it can, after a search and one page', async () => {
      // 600 matches (browse territory) among an artist's 10,001 groups: more than the browse will read.
      const fetchImpl: FetchLike = vi.fn(async (url: string) =>
        new URL(url).searchParams.has('query')
          ? new Response(JSON.stringify({ count: 600, 'release-groups': studioAlbums(100) }))
          : new Response(JSON.stringify({ 'release-group-count': MAX_LIST_ITEMS + 1, 'release-groups': studioAlbums(100) })),
      )

      const error = await createMusicBrainzAdapter(fetchImpl).expand('af8e4cc5').catch((cause: unknown) => cause)

      expect(error).toBeInstanceOf(IngestionError)
      expect((error as Error).message).toContain('10001 releases')
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    })
  })

  describe('a count', () => {
    it('is one request for the number of groups the facets keep, however many the artist has', async () => {
      const { calls, fetchImpl } = musicBrainz([...studioAlbums(16), ...liveAlbums(700)])
      const adapter = createMusicBrainzAdapter(fetchImpl)

      expect(await adapter.count?.('af8e4cc5')).toBe(16)
      expect(await adapter.count?.('af8e4cc5:live')).toBe(716)
      expect(calls).toHaveLength(2)
      expect(calls[0]!.searchParams.get('limit')).toBe('1')
    })

    it('has no answer when the search gives no count, so a listing decides', async () => {
      const adapter = createMusicBrainzAdapter(respondWith({}))

      expect(await adapter.count?.('af8e4cc5')).toBeUndefined()
    })

    it('fails when the request fails, rather than answering zero', async () => {
      const adapter = createMusicBrainzAdapter(respondWith({}, 400))

      await expect(adapter.count?.('af8e4cc5')).rejects.toBeInstanceOf(IngestionError)
    })
  })

  describe('when MusicBrainz is busy', () => {
    /** Answers the first `failures` requests with `status`, then an empty search. */
    function flaky(failures: number, status: number, headers: Record<string, string> = {}): FetchLike {
      let seen = 0

      return vi.fn(async () =>
        seen++ < failures
          ? new Response('{}', { status, headers })
          : new Response(JSON.stringify({ count: 0, 'release-groups': [] })),
      )
    }

    it('tries a 503 again, as its search does now and then inside the one-a-second rule', async () => {
      noWait.mockClear()
      const fetchImpl = flaky(2, 503)

      expect((await createMusicBrainzAdapter(fetchImpl, undefined, { sleep: noWait }).expand('a')).items).toEqual([])
      expect(fetchImpl).toHaveBeenCalledTimes(3)
      expect(noWait.mock.calls.map(([ms]) => ms)).toEqual([500, 1000])
    })

    it('waits as long as a 429 asks', async () => {
      noWait.mockClear()

      await createMusicBrainzAdapter(flaky(1, 429, { 'retry-after': '3' }), undefined, { sleep: noWait }).search('x')

      expect(noWait).toHaveBeenCalledWith(3000)
    })

    it('gives up after three tries with what MusicBrainz said', async () => {
      const fetchImpl = flaky(9, 503)

      await expect(createMusicBrainzAdapter(fetchImpl, undefined, { sleep: noWait }).search('x')).rejects.toThrow(
        /MusicBrainz returned 503/,
      )
      expect(fetchImpl).toHaveBeenCalledTimes(3)
    })

    it('does not try a 400 again', async () => {
      const fetchImpl = flaky(9, 400)

      await expect(createMusicBrainzAdapter(fetchImpl, undefined, { sleep: noWait }).search('x')).rejects.toThrow(
        IngestionError,
      )
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it('takes each try in the line, so a retry waits its turn behind the rest', async () => {
      let calls = 0
      const limiter: RateLimiter = {
        run: (fn) => {
          calls += 1
          return fn()
        },
      }

      await createMusicBrainzAdapter(flaky(1, 503), limiter, { sleep: noWait }).search('x')

      expect(calls).toBe(2)
    })

    it('fails the listing when a later page fails, rather than offering part of a discography', async () => {
      const all = studioAlbums(250)
      const answer = musicBrainz(all).fetchImpl
      const fetchImpl: FetchLike = vi.fn(async (url: string, init?: RequestInit) =>
        new URL(url).searchParams.get('offset') === '100' ? new Response('{}', { status: 400 }) : answer(url, init),
      )

      await expect(createMusicBrainzAdapter(fetchImpl, undefined, { sleep: noWait }).expand('af8e4cc5')).rejects.toBeInstanceOf(
        IngestionError,
      )
    })
  })
  it('handles an artist with no releases', async () => {
    const adapter = createMusicBrainzAdapter(respondWith({ 'release-groups': [] }))

    expect((await adapter.expand('nobody')).items).toEqual([])
  })

  it('survives a response missing the fields entirely', async () => {
    const adapter = createMusicBrainzAdapter(respondWith({}))

    expect(await adapter.search('x')).toEqual([])
    expect((await adapter.expand('x')).items).toEqual([])
  })

  it('reports rate limiting as something to retry, not a bug', async () => {
    const adapter = createMusicBrainzAdapter(respondWith({}, 429), undefined, { sleep: noWait })

    await expect(adapter.search('x')).rejects.toThrow(/rate-limiting/)
  })

  it('names the service when it fails', async () => {
    const adapter = createMusicBrainzAdapter(respondWith({}, 503), undefined, { sleep: noWait })

    await expect(adapter.search('x')).rejects.toThrow(IngestionError)
    await expect(adapter.search('x')).rejects.toThrow(/MusicBrainz returned 503/)
  })

  it('reports an unreachable service without leaking the exception', async () => {
    const adapter = createMusicBrainzAdapter(
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )

    await expect(adapter.search('x')).rejects.toThrow(/Could not reach MusicBrainz/)
  })
})

describe('MusicBrainz rate limiting (task 10.12, Q11)', () => {
  /** A limiter that records what went through it, without waiting. */
  function countingLimiter() {
    const state = { calls: 0 }
    const limiter: RateLimiter = {
      run: (fn) => {
        state.calls += 1
        return fn()
      },
    }

    return { state, limiter }
  }

  it('sends a search through the shared limiter', async () => {
    const { state, limiter } = countingLimiter()
    const adapter = createMusicBrainzAdapter(respondWith(ARTIST_SEARCH), limiter)

    await adapter.search('cannibal corpse')

    expect(state.calls).toBe(1)
  })

  it('sends every page of an expansion through the limiter, so a count fetch and an import share one line', async () => {
    const { state, limiter } = countingLimiter()
    const adapter = createMusicBrainzAdapter(musicBrainz(RELEASE_GROUPS['release-groups']).fetchImpl, limiter)

    await adapter.expand('af8e4cc5')

    expect(state.calls).toBeGreaterThanOrEqual(1)
  })

  it('does not fire two expansions at once: the second waits for the first', async () => {
    const started: number[] = []
    let time = 0
    const limiter = createRateLimiter(1000, {
      now: () => time,
      sleep: async (ms) => {
        time += ms
      },
    })
    const fetchImpl: FetchLike = async () => {
      started.push(time)
      return new Response(JSON.stringify({ 'release-groups': [] }), { status: 200 })
    }
    const adapter = createMusicBrainzAdapter(fetchImpl, limiter)

    await Promise.all([adapter.expand('a'), adapter.expand('b'), adapter.expand('c')])

    expect(started).toEqual([0, 1000, 2000])
  })
})


describe('MusicBrainz shared line', () => {
  it('is one line for every adapter in the process, since the desktop builds its adapters again for each request', async () => {
    vi.useFakeTimers()
    const started: number[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        started.push(Date.now())
        return new Response(JSON.stringify({ artists: [] }))
      }),
    )

    try {
      const searches = Promise.all([createMusicBrainzAdapter().search('a'), createMusicBrainzAdapter().search('b')])
      await vi.advanceTimersByTimeAsync(5000)
      await searches

      expect(started).toHaveLength(2)
      expect(started[1]! - started[0]!).toBeGreaterThanOrEqual(1100)
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })
})
