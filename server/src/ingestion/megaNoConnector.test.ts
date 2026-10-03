import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createList } from '../catalog/repository.js'
import { users } from '../db/schema.js'
import { createTestApp, type TestApp } from '../testing/harness.js'
import { createDefaultMediaTypes, DEFAULT_MEDIA_TYPES, toMediaTypeInfo } from './mediaTypes.js'

/**
 * Mega takes curated (community-library) lists only and never uses TMDB or any connector (owner ruling
 * 2026-09-26, repeated 2026-10-03). It has no adapter at all, so no code path, user-facing or not, can make
 * it look anything up: the leftover TMDB franchise adapter is gone.
 */
describe('the Mega category has no connector', () => {
  let harness: TestApp
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    // Anything that went to the network would be seen here: a library fetch goes to GitHub, never TMDB.
    // A key is set, as on the owner's machine: the refusals below are structural, not "no key".
    vi.stubEnv('TMDB_API_KEY', 'a-key-that-works')
    fetchMock = vi.fn(async () => new Response('{"results":[],"seasons":[]}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    harness = createTestApp()
    await harness.app.ready()
  })

  afterEach(async () => {
    await harness.cleanup()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  const requestedHosts = () => fetchMock.mock.calls.map(([url]) => new URL(String(url)).host)

  it('has no adapter and no source name, even with every key set', () => {
    const mega = createDefaultMediaTypes({ credentials: { tmdb: () => ({ apiKey: 'k', readAccessToken: undefined }) } }).find((entry) => entry.key === 'mega')!

    expect(mega.adapter).toBeUndefined()
    expect(mega.sourceName).toBeUndefined()
    expect(DEFAULT_MEDIA_TYPES.find((entry) => entry.key === 'mega')?.adapter).toBeUndefined()
  })

  it('still searches and previews the library, which needs no key', () => {
    const info = toMediaTypeInfo(DEFAULT_MEDIA_TYPES.find((entry) => entry.key === 'mega')!)

    expect(info).toMatchObject({ searchAvailable: true, previewable: true, searchScope: 'library' })
    expect(info).not.toHaveProperty('sourceName')
  })

  it('refuses to build a list from a TMDB franchise ref, and asks nobody', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/lists/from-source',
      payload: { mediaType: 'mega', externalRef: 'franchise:180547', title: 'Marvel' },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().code).toBe('search.unavailable')
    expect(requestedHosts().filter((host) => host.includes('themoviedb'))).toEqual([])
  })

  it('refuses to count or preview one', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/api/media-types/mega/expansion?externalRef=franchise:180547&items=true' })

    expect(response.statusCode).toBe(409)
    expect(response.json().code).toBe('search.unavailable')
    expect(requestedHosts().filter((host) => host.includes('themoviedb'))).toEqual([])
  })

  it('refuses to check a fetched Mega list that somehow exists, and to reset it', async () => {
    const userId = harness.db.select().from(users).get()!.id
    const list = await createList(harness.db, userId, { title: 'Old', mediaType: 'mega', source: 'api', externalRef: 'franchise:180547' })

    const check = await harness.app.inject({ method: 'POST', url: `/api/lists/${list.id}/refresh`, payload: {} })
    const reset = await harness.app.inject({ method: 'POST', url: `/api/lists/${list.id}/reset` })

    expect(check.statusCode).toBe(409)
    expect(check.json().code).toBe('refresh.searchUnavailable')
    expect(reset.statusCode).toBe(409)
    expect(requestedHosts().filter((host) => host.includes('themoviedb'))).toEqual([])
  })
})
