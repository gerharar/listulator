import { describe, expect, it } from 'vitest'
import { mergeLocale, missingKeys } from './mergeLocale.js'

describe('mergeLocale', () => {
  it('overrides a leaf value present in the partial', () => {
    expect(mergeLocale({ a: 1, b: 2 }, { a: 9 })).toEqual({ a: 9, b: 2 })
  })

  it('leaves a key untouched when the partial omits it entirely', () => {
    expect(mergeLocale({ a: 1, b: 2 }, {})).toEqual({ a: 1, b: 2 })
  })

  it('recurses into nested objects, merging key by key rather than replacing the whole section', () => {
    expect(mergeLocale({ app: { x: 1, y: 2 } }, { app: { x: 9 } })).toEqual({ app: { x: 9, y: 2 } })
  })

  it('a function leaf is replaced outright, not "merged" as if it were an object', () => {
    const baseFn = () => 'base'
    const overrideFn = () => 'override'

    const merged = mergeLocale({ greet: baseFn }, { greet: overrideFn })

    expect(merged.greet()).toBe('override')
  })

  it('an undefined partial (no translation attempted at all) returns the base unchanged', () => {
    const base = { a: 1 }
    expect(mergeLocale(base, undefined)).toEqual(base)
  })
})

describe('missingKeys', () => {
  it('finds nothing missing when a locale is diffed against itself', () => {
    const en = { app: { loading: 'Loading…' }, count: (n: number) => `${n}` }
    expect(missingKeys(en, en)).toEqual([])
  })

  it('reports a top-level key entirely missing', () => {
    expect(missingKeys({ a: 1, b: 2 }, { a: 1 })).toEqual(['b'])
  })

  it('recurses into nested objects, reporting the full dotted path', () => {
    expect(missingKeys({ app: { x: 1, y: 2 } }, { app: { x: 1 } })).toEqual(['app.y'])
  })

  it('reports every leaf under a section that is missing entirely', () => {
    expect(missingKeys({ app: { x: 1, y: 2 } }, {})).toEqual(['app.x', 'app.y'])
  })

  it('an undefined partial is missing every key', () => {
    expect(missingKeys({ a: 1, b: 2 }, undefined)).toEqual(['a', 'b'])
  })
})
