import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { LibraryEntry } from '../../../server/src/ingestion/customLists.js'
import { DEFAULT_SAMPLE_PATH, pickSample, readSampleSetting } from './onboardingConfig.js'

/** The first-run sample list is named in `config/onboarding.json` (H-018; owner 2026-10-22 and 2026-10-24). */

const entry = (path: string, category = 'mega'): LibraryEntry => ({ externalRef: `canonical:${path}`, title: path, category, itemCount: 10 })
const LIBRARY = [entry('lists/tv/a.yaml', 'tv'), entry('lists/mega/mcu-extended.yaml'), entry('lists/movie/b.yaml', 'movie')]

describe('readSampleSetting', () => {
  it('reads a library path', () => {
    expect(readSampleSetting({ sampleList: 'lists/tv/a.yaml' })).toEqual({ kind: 'path', path: 'lists/tv/a.yaml' })
  })

  it('reads "random"', () => {
    expect(readSampleSetting({ sampleList: 'random' })).toEqual({ kind: 'random' })
  })

  it('falls back to the default MCU list for anything malformed: not an object, no value, not text, empty text', () => {
    const fallback = { kind: 'path', path: DEFAULT_SAMPLE_PATH }
    for (const bad of [null, undefined, 7, 'text', [], {}, { sampleList: 3 }, { sampleList: '' }, { sampleList: '   ' }, { sampleList: null }]) {
      expect(readSampleSetting(bad)).toEqual(fallback)
    }
  })

  it('names the extended MCU list as the default', () => {
    expect(DEFAULT_SAMPLE_PATH).toBe('lists/mega/mcu-extended.yaml')
  })
})

describe('pickSample', () => {
  it('takes the list the path names', () => {
    expect(pickSample({ kind: 'path', path: 'lists/tv/a.yaml' }, LIBRARY, () => 0.99)).toBe(LIBRARY[0])
  })

  it('takes a random list for "random", by the random source', () => {
    expect(pickSample({ kind: 'random' }, LIBRARY, () => 0)).toBe(LIBRARY[0])
    expect(pickSample({ kind: 'random' }, LIBRARY, () => 0.99)).toBe(LIBRARY[2])
  })

  it('takes a random list when the path is not in the library (renamed, removed): never an error on the first screen', () => {
    expect(pickSample({ kind: 'path', path: 'lists/gone.yaml' }, LIBRARY, () => 0.5)).toBe(LIBRARY[1])
  })

  it('takes a random list when the default itself is missing from the library', () => {
    const without = LIBRARY.filter((candidate) => !candidate.externalRef.includes('mcu-extended'))

    expect(without).toHaveLength(2)
    expect(pickSample(readSampleSetting(undefined), without, () => 0)).toBe(without[0])
  })

  it('has nothing to give from an empty library', () => {
    expect(pickSample({ kind: 'random' }, [], () => 0)).toBeNull()
    expect(pickSample({ kind: 'path', path: 'x' }, [], () => 0)).toBeNull()
  })
})

describe('the file in the repository', () => {
  it('is valid JSON, names a list that exists in lists/, and is read by the app as that path', async () => {
    const file = fileURLToPath(new URL('../../../config/onboarding.json', import.meta.url))
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { sampleList: string }
    expect(readSampleSetting(parsed)).toEqual({ kind: 'path', path: parsed.sampleList })

    const library = fileURLToPath(new URL(`../../../${parsed.sampleList}`, import.meta.url))
    expect(readFileSync(library, 'utf8').length).toBeGreaterThan(0)
  })
})
