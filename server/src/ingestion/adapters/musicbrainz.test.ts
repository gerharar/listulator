import { describe, expect, it, vi } from 'vitest'
import { IngestionError, USER_AGENT, type FetchLike } from '../http.js'
import { createMusicBrainzAdapter } from './musicbrainz.js'

/**
 * Fixtures are trimmed from real MusicBrainz responses (verified live against
 * the Cannibal Corpse artist id), so the shapes being mapped are the shapes the
 * service actually returns rather than what the docs imply.
 */

function respondWith(body: unknown, status = 200): FetchLike {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  )
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
        title: 'Cannibal Corpse',
        detail: 'Group · US · American death metal',
      },
      { externalRef: '2ded9132-ec61-4b79-9275-b3e0e534a5d5', title: 'Corpsegrinder', detail: 'Person' },
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

    expect((await adapter.expand('af8e4cc5')).map((item) => item.title)).toEqual([
      'Eaten Back to Life',
      'The Bleeding',
      'Bloodthirst',
    ])
  })

  it('populates year from first-release-date, including a partial date', async () => {
    const adapter = createMusicBrainzAdapter(respondWith(RELEASE_GROUPS))

    expect((await adapter.expand('af8e4cc5')).map((item) => [item.title, item.year])).toEqual([
      ['Eaten Back to Life', 1990],
      // 'first-release-date': '1994-03' — a partial date still yields a year.
      ['The Bleeding', 1994],
      ['Bloodthirst', 1999],
    ])
  })

  it('leaves durations unset so the category default applies', async () => {
    // Album length would cost one request per album against a one-per-second
    // limit. Every item comes back without a duration and is filled in as an
    // estimate downstream.
    const adapter = createMusicBrainzAdapter(respondWith(RELEASE_GROUPS))

    for (const item of await adapter.expand('af8e4cc5')) {
      expect(item.timeToConsumeMinutes).toBeUndefined()
      expect(item.externalRef).toBeTruthy()
    }
  })

  it('handles an artist with no releases', async () => {
    const adapter = createMusicBrainzAdapter(respondWith({ 'release-groups': [] }))

    expect(await adapter.expand('nobody')).toEqual([])
  })

  it('survives a response missing the fields entirely', async () => {
    const adapter = createMusicBrainzAdapter(respondWith({}))

    expect(await adapter.search('x')).toEqual([])
    expect(await adapter.expand('x')).toEqual([])
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
