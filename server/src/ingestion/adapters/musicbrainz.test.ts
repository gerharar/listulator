import { describe, expect, it, vi } from 'vitest'
import { IngestionError, USER_AGENT, type FetchLike } from '../http.js'
import { createRateLimiter, type RateLimiter } from '../rateLimiter.js'
import { createMusicBrainzAdapter } from './musicbrainz.js'

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

/**
 * Real MusicBrainz filters `release-group` by *primary* type server-side
 * (verified live — see the adapter's `expand` comment) — a plain
 * `respondWith` fixture ignores the request URL entirely, which would let a
 * test believe an EP came back from a `type=album`-only request when the
 * real service would never have sent it. This mock actually honors `type`,
 * the same way the real endpoint does, so facet tests exercise the real
 * two-stage filter (server-side by primary type, then client-side).
 */
function respondFilteredByType(all: (typeof RELEASE_GROUPS)['release-groups']): FetchLike {
  return vi.fn(async (url: string) => {
    const requested = new Set((new URL(url).searchParams.get('type') ?? '').split('|'))
    const groups = all.filter((group) => requested.has((group['primary-type'] ?? '').toLowerCase()))
    return new Response(
      JSON.stringify({ 'release-groups': groups, 'release-group-count': groups.length }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    )
  })
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
    const adapter = createMusicBrainzAdapter(respondWith(RELEASE_GROUPS))

    expect((await adapter.expand('af8e4cc5')).items.map((item) => item.title)).toEqual([
      'Eaten Back to Life',
      'The Bleeding',
      'Bloodthirst',
    ])
  })

  it('populates year from first-release-date, including a partial date', async () => {
    const adapter = createMusicBrainzAdapter(respondWith(RELEASE_GROUPS))

    expect((await adapter.expand('af8e4cc5')).items.map((item) => [item.title, item.year])).toEqual([
      ['Eaten Back to Life', 1990],
      // 'first-release-date': '1994-03' — a partial date still yields a year.
      ['The Bleeding', 1994],
      ['Bloodthirst', 1999],
    ])
  })

  it('tags every studio album ["Album"], not just the opted-in extras', async () => {
    const adapter = createMusicBrainzAdapter(respondWith(RELEASE_GROUPS))

    expect((await adapter.expand('af8e4cc5')).items.map((item) => item.tags)).toEqual([
      ['Album'],
      ['Album'],
      ['Album'],
    ])
  })

  it('tags an EP, a single, a live album, and a compilation distinctly', async () => {
    const adapter = createMusicBrainzAdapter(
      respondFilteredByType(RELEASE_GROUPS['release-groups']),
    )

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
    const adapter = createMusicBrainzAdapter(respondWith(RELEASE_GROUPS))

    for (const item of (await adapter.expand('af8e4cc5')).items) {
      expect(item.timeToConsumeMinutes).toBeUndefined()
      expect(item.externalRef).toBeTruthy()
    }
  })

  it('includes EPs when the ref opts in — both a plain EP and a live one, since a live EP is still an EP', async () => {
    const adapter = createMusicBrainzAdapter(
      respondFilteredByType(RELEASE_GROUPS['release-groups']),
    )

    expect((await adapter.expand('af8e4cc5:ep')).items.map((item) => item.title)).toEqual([
      'Eaten Back to Life',
      'The Bleeding',
      'Bloodthirst',
      'Live Cannibalism (Sampler)',
      'Worm Infested',
    ])
  })

  it('includes singles when the ref opts in', async () => {
    const adapter = createMusicBrainzAdapter(
      respondFilteredByType(RELEASE_GROUPS['release-groups']),
    )

    expect((await adapter.expand('af8e4cc5:single')).items.map((item) => item.title)).toContain(
      'Hammer Smashed Face',
    )
  })

  it('includes live albums when the ref opts in, but not a live EP when EPs were never even requested', async () => {
    // Real MusicBrainz filters `type` server-side, so a "live"-only ref
    // (which only asks for `type=album`) never gets the live EP back to
    // filter client-side in the first place — unlike the two "additive"
    // cases below, where the EP itself was actually fetched.
    const adapter = createMusicBrainzAdapter(
      respondFilteredByType(RELEASE_GROUPS['release-groups']),
    )

    const titles = (await adapter.expand('af8e4cc5:live')).items.map((item) => item.title)
    expect(titles).toContain('Global Evisceration')
    expect(titles).not.toContain('Live Cannibalism (Sampler)')
  })

  it('is additive across facets: opting into EPs alone already surfaces a live EP', async () => {
    const adapter = createMusicBrainzAdapter(
      respondFilteredByType(RELEASE_GROUPS['release-groups']),
    )

    expect((await adapter.expand('af8e4cc5:ep')).items.map((item) => item.title)).toContain(
      'Live Cannibalism (Sampler)',
    )
  })

  it('includes compilations when the ref opts in', async () => {
    const adapter = createMusicBrainzAdapter(
      respondFilteredByType(RELEASE_GROUPS['release-groups']),
    )

    expect((await adapter.expand('af8e4cc5:compilation')).items.map((item) => item.title)).toContain(
      'Dead Human Collection',
    )
  })

  it('requests only the primary types a facet needs, since MusicBrainz filters `type` server-side', async () => {
    const fetchImpl = respondWith(RELEASE_GROUPS)
    await createMusicBrainzAdapter(fetchImpl).expand('af8e4cc5:ep,single,live')

    const [url] = vi.mocked(fetchImpl).mock.calls[0]!
    expect(url).toContain(`type=${encodeURIComponent('album|ep|single')}`)
  })

  it('requests only the album type with no facets, unchanged from before this feature', async () => {
    const fetchImpl = respondWith(RELEASE_GROUPS)
    await createMusicBrainzAdapter(fetchImpl).expand('af8e4cc5')

    const [url] = vi.mocked(fetchImpl).mock.calls[0]!
    expect(url).toContain('type=album')
    expect(url).not.toContain('ep')
    expect(url).not.toContain('single')
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
    const adapter = createMusicBrainzAdapter(respondWith({}, 429))

    await expect(adapter.search('x')).rejects.toThrow(/rate-limiting/)
  })

  it('names the service when it fails', async () => {
    const adapter = createMusicBrainzAdapter(respondWith({}, 503))

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
    const adapter = createMusicBrainzAdapter(respondWith(RELEASE_GROUPS), limiter)

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

