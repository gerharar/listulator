import { describe, expect, it } from 'vitest'
import {
  isBookLanguageCode,
  persistBookLanguage,
  resolveInitialBookLanguage,
} from './bookLanguage.js'

const throwingStorage = {
  getItem: () => {
    throw new Error('site data blocked')
  },
  setItem: () => {
    throw new Error('site data blocked')
  },
}

describe('book search language', () => {
  it('prefers a remembered choice over the default', () => {
    const storage = { getItem: () => 'fre' }

    expect(resolveInitialBookLanguage(storage)).toBe('fre')
  })

  it('defaults to English when nothing is remembered', () => {
    const storage = { getItem: () => null }

    expect(resolveInitialBookLanguage(storage)).toBe('eng')
  })

  it('remembers "all" as a real choice, not a missing one', () => {
    const storage = { getItem: () => 'all' }

    expect(resolveInitialBookLanguage(storage)).toBe('all')
  })

  it('ignores a stored value that is not a real option', () => {
    const storage = { getItem: () => 'klingon' }

    expect(resolveInitialBookLanguage(storage)).toBe('eng')
  })

  it('survives storage being unavailable', () => {
    expect(() => resolveInitialBookLanguage(throwingStorage)).not.toThrow()
    expect(resolveInitialBookLanguage(throwingStorage)).toBe('eng')
    expect(() => persistBookLanguage(throwingStorage, 'jpn')).not.toThrow()
    expect(() => resolveInitialBookLanguage(undefined)).not.toThrow()
  })

  it('recognises exactly the shipped languages, plus "all"', () => {
    expect(isBookLanguageCode('eng')).toBe(true)
    expect(isBookLanguageCode('all')).toBe(true)
    expect(isBookLanguageCode('nope')).toBe(false)
    expect(isBookLanguageCode(null)).toBe(false)
  })
})
