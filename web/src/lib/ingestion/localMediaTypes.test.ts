import { beforeEach, describe, expect, it, vi } from 'vitest'

let saved: { tmdbApiKey?: string } = {}

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }))
vi.mock('../config/localConfig.js', () => ({ getLocalSettings: vi.fn(async () => saved) }))

import { getLocalMediaTypes, resetLocalMediaTypes } from './localMediaTypes.js'

const movieAvailable = async () =>
  (await getLocalMediaTypes()).find((entry) => entry.key === 'movie')?.adapter?.isAvailable() ?? false

beforeEach(() => {
  saved = {}
  resetLocalMediaTypes()
})

describe('local media types', () => {
  it('reads the keys once and keeps that registry for the session', async () => {
    expect(await movieAvailable()).toBe(false)

    saved = { tmdbApiKey: 'abc123' }

    expect(await movieAvailable()).toBe(false)
  })

  it('after a reset, reads the keys as they are now — a key saved in Settings works at once', async () => {
    expect(await movieAvailable()).toBe(false)

    saved = { tmdbApiKey: 'abc123' }
    resetLocalMediaTypes()

    expect(await movieAvailable()).toBe(true)
  })
})
