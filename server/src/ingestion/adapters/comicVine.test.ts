import { describe, expect, it, vi } from 'vitest'
import type { FetchLike } from '../http.js'
import { createComicVineAdapter } from './comicVine.js'

/**
 * Fixtures are trimmed from real Comic Vine responses (verified live against
 * volume 2045, Fantastic Four 1961).
 */

const credentials = { apiKey: 'test-key' }

function respondWith(body: unknown, status = 200): FetchLike {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }))
}

const VOLUMES = {
  status_code: 1,
  results: [
    {
      id: 2045,
      name: 'Fantastic Four',
      start_year: '1961',
      count_of_issues: 416,
      publisher: { name: 'Marvel' },
    },
    { id: 112685, name: 'Fantastic Four', start_year: '2018', count_of_issues: 48 },
  ],
}

/** Deliberately out of reading order, as their own sort returns them. */
const ISSUES = {
  status_code: 1,
  results: [
    { id: 3, issue_number: '10', name: 'The Return of Doctor Doom!', cover_date: '1963-01-01' },
    { id: 4, issue_number: '100', name: 'The Long Journey Home', cover_date: '1970-07-31' },
    { id: 1, issue_number: '1', name: 'The Fantastic Four!', cover_date: '1961-11-30' },
    { id: 2, issue_number: '2', cover_date: '1962-01-31' },
  ],
}

describe('Comic Vine adapter', () => {
  it('is unavailable without a key', () => {
    expect(createComicVineAdapter({ apiKey: undefined }).isAvailable()).toBe(false)
    expect(createComicVineAdapter({ apiKey: 'k' }).isAvailable()).toBe(true)
  })

  it('sees a key that appears after construction', () => {
    delete process.env['LISTULATOR_CV_TEST']
    const adapter = createComicVineAdapter(() => ({ apiKey: process.env['LISTULATOR_CV_TEST'] }))

    expect(adapter.isAvailable()).toBe(false)
    process.env['LISTULATOR_CV_TEST'] = 'later'
    expect(adapter.isAvailable()).toBe(true)

    delete process.env['LISTULATOR_CV_TEST']
  })

  it('finds volumes, told apart by year, length and publisher', async () => {
    // "Fantastic Four" alone matches five different runs.
    const adapter = createComicVineAdapter(credentials, respondWith(VOLUMES))

    expect(await adapter.search('fantastic four')).toEqual([
      {
        externalRef: 'volume:2045',
        title: 'Fantastic Four (1961)',
        detail: '1961 · 416 issues · Marvel',
      },
      { externalRef: 'volume:112685', title: 'Fantastic Four (2018)', detail: '2018 · 48 issues' },
    ])
  })

  it('puts issues in reading order, not lexical order', async () => {
    // Their sort=issue_number:asc returns #1, #10, #100 — the bug this fixes.
    const adapter = createComicVineAdapter(credentials, respondWith(ISSUES))

    expect((await adapter.expand('volume:2045')).map((item) => item.title)).toEqual([
      '#1 The Fantastic Four!',
      '#2',
      '#10 The Return of Doctor Doom!',
      '#100 The Long Journey Home',
    ])
  })

  it('sorts oddly-numbered issues last rather than dropping them', async () => {
    const adapter = createComicVineAdapter(
      credentials,
      respondWith({
        status_code: 1,
        results: [
          { id: 2, issue_number: 'Annual 1', name: 'Annual', cover_date: '1963-01-01' },
          { id: 1, issue_number: '1', name: 'First', cover_date: '1961-11-30' },
        ],
      }),
    )

    expect((await adapter.expand('volume:1')).map((item) => item.title)).toEqual([
      '#1 First',
      '#Annual 1 Annual',
    ])
  })

  it('leaves durations unset so the 15-minute category default applies', async () => {
    // A real page count would cost a request per issue, and their rate limit
    // is roughly 200 an hour.
    const adapter = createComicVineAdapter(credentials, respondWith(ISSUES))

    for (const item of await adapter.expand('volume:2045')) {
      expect(item.timeToConsumeMinutes).toBeUndefined()
    }
  })

  it('leaves year unset — cover_date is not a reliable publication year', async () => {
    // A comic's cover_date is deliberately offset months ahead of when it
    // actually shipped and routinely crosses a year boundary, so deriving
    // year from it would be a confidently wrong value, not a missing one.
    // Revisit if Comic Vine ever exposes a real publication-date field.
    const adapter = createComicVineAdapter(credentials, respondWith(ISSUES))

    for (const item of await adapter.expand('volume:2045')) {
      expect(item.year).toBeUndefined()
    }
  })

  it('treats an error in the body as an error, despite the 200 status', async () => {
    // Comic Vine answers 200 with a failure inside, including for a bad key.
    const adapter = createComicVineAdapter(
      credentials,
      respondWith({ status_code: 100, error: 'Invalid API Key' }),
    )

    await expect(adapter.search('x')).rejects.toThrow(/Invalid API Key/)
  })

  it('refuses refs that are not a numeric volume id', async () => {
    const adapter = createComicVineAdapter(credentials, respondWith(ISSUES))

    expect(await adapter.expand('volume:abc')).toEqual([])
    expect(await adapter.expand('issue:1')).toEqual([])
    expect(await adapter.expand('nonsense')).toEqual([])
  })

  it('stops paging once a run is exhausted', async () => {
    const fetchImpl = respondWith(ISSUES)
    await createComicVineAdapter(credentials, fetchImpl).expand('volume:2045')

    // A short page means the end; no reason to ask for more.
    expect(vi.mocked(fetchImpl).mock.calls).toHaveLength(1)
  })

  it('bounds a very long run', async () => {
    const fetchImpl: FetchLike = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status_code: 1,
            results: Array.from({ length: 100 }, (_, index) => ({
              id: index,
              issue_number: String(index),
            })),
          }),
        ),
    )

    const items = await createComicVineAdapter(credentials, fetchImpl).expand('volume:1')

    expect(items.length).toBeLessThanOrEqual(500)
    expect(vi.mocked(fetchImpl).mock.calls.length).toBeLessThanOrEqual(5)
  })
})
