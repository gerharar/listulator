import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { GUIDES_URL, keyGuideUrl } from './guides.js'
import type { KeySource } from './config/keyTest.js'

const SOURCES: readonly KeySource[] = ['tmdb', 'igdb', 'comicVine', 'youtube']

describe('the key guides', () => {
  it('live in the repo the desktop capability lets the app open', () => {
    expect(GUIDES_URL.startsWith('https://github.com/gerharar/listulator/')).toBe(true)
  })

  it.each(SOURCES)('%s has its own guide, and the file is in guides/', (source) => {
    const url = keyGuideUrl(source)
    expect(url.startsWith(GUIDES_URL)).toBe(true)

    const file = url.slice(GUIDES_URL.length)
    expect(file).toMatch(/^[a-z-]+\.md$/)
    expect(existsSync(fileURLToPath(new URL(`../../../guides/${file}`, import.meta.url)))).toBe(true)
  })

  it('gives every source a different guide', () => {
    expect(new Set(SOURCES.map(keyGuideUrl)).size).toBe(SOURCES.length)
  })
})
