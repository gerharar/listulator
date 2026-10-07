import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Clearing a key field in Settings removes the key (security review, Phase 19, SR-030/031: the README tells people that is how to
 * remove one key, so it has to be true). The field saves an empty value, as it does for every edit; the old text is no longer in the
 * settings file, and every source that needed the key reads as unavailable. The plugin's store is replaced by a map that writes JSON
 * the way the real one does, so the test can read what the file would hold.
 */
const file = vi.hoisted(() => ({ entries: new Map<string, unknown>(), text: () => '' }))

vi.mock('@tauri-apps/plugin-store', () => ({
  load: vi.fn(async () => ({
    get: async (key: string) => file.entries.get(key),
    set: async (key: string, value: unknown) => void file.entries.set(key, value),
  })),
}))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }))

const KEYS = {
  tmdbApiKey: 'TMDBKEY1234567890',
  igdbClientId: 'IGDBID1234567890',
  igdbClientSecret: 'IGDBSECRET1234567890',
  comicVineApiKey: 'COMICKEY1234567890',
  youtubeApiKey: 'YOUTUBEKEY1234567890',
}

const fileText = (): string => JSON.stringify(Object.fromEntries(file.entries))

async function availability() {
  const { getLocalMediaTypes, resetLocalMediaTypes } = await import('../ingestion/localMediaTypes.js')
  resetLocalMediaTypes()
  const types = await getLocalMediaTypes()

  return Object.fromEntries(types.map((type) => [type.key, type.adapter?.isAvailable() ?? false]))
}

describe('the desktop settings file and a cleared key', () => {
  beforeEach(() => {
    file.entries.clear()
    vi.resetModules()
  })

  it('has the sources that need a key available while it is typed in', async () => {
    const { updateLocalSettings } = await import('./localConfig.js')
    await updateLocalSettings(KEYS)

    expect(await availability()).toMatchObject({ movie: true, game: true, comic: true, youtube: true })
  })

  it('leaves none of the old text in the file after each field is cleared, and every source that needed a key unavailable', async () => {
    const { updateLocalSettings, getLocalSettings } = await import('./localConfig.js')
    await updateLocalSettings(KEYS)
    for (const value of Object.values(KEYS)) expect(fileText()).toContain(value)

    // What the Settings field does when it is emptied: it saves an empty value for that field.
    await updateLocalSettings(Object.fromEntries(Object.keys(KEYS).map((field) => [field, ''])))

    for (const value of Object.values(KEYS)) expect(fileText()).not.toContain(value)
    expect(Object.values(await getLocalSettings()).every((value) => value === '')).toBe(true)
    expect(await availability()).toMatchObject({ movie: false, game: false, comic: false, youtube: false })
  })

  it('clears one key and leaves the others', async () => {
    const { updateLocalSettings } = await import('./localConfig.js')
    await updateLocalSettings(KEYS)
    await updateLocalSettings({ tmdbApiKey: '' })

    expect(fileText()).not.toContain(KEYS.tmdbApiKey)
    expect(fileText()).toContain(KEYS.youtubeApiKey)
    expect(await availability()).toMatchObject({ movie: false, youtube: true })
  })
})
