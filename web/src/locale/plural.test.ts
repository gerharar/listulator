import { describe, expect, it } from 'vitest'
import { selectPlural } from './plural.js'

describe('selectPlural', () => {
  it('en: "one" only at exactly 1, "other" everywhere else, including 0', () => {
    const forms = { one: 'list', other: 'lists' }
    expect(selectPlural(0, 'en', forms)).toBe('lists')
    expect(selectPlural(1, 'en', forms)).toBe('list')
    expect(selectPlural(2, 'en', forms)).toBe('lists')
    expect(selectPlural(9, 'en', forms)).toBe('lists')
  })

  it('de: the same one/other split as en', () => {
    const forms = { one: 'Liste', other: 'Listen' }
    expect(selectPlural(1, 'de', forms)).toBe('Liste')
    expect(selectPlural(2, 'de', forms)).toBe('Listen')
  })

  it('ru: one/few/many across 1, 2, 5, 11, 21 — the CLDR categories, not a guess', () => {
    // 1 → one, 2 → few, 5 → many, 11 → many (the "teens" exception), 21 → one.
    const forms = { one: 'one', few: 'few', many: 'many', other: 'other' }
    expect(selectPlural(1, 'ru', forms)).toBe('one')
    expect(selectPlural(2, 'ru', forms)).toBe('few')
    expect(selectPlural(5, 'ru', forms)).toBe('many')
    expect(selectPlural(11, 'ru', forms)).toBe('many')
    expect(selectPlural(21, 'ru', forms)).toBe('one')
  })

  it('falls back to "other" when a language selects a category the caller did not supply a form for', () => {
    // English has no "few"/"many" branch, so a minimal {other} form must still work everywhere.
    expect(selectPlural(1, 'en', { other: 'NEW' })).toBe('NEW')
    expect(selectPlural(5, 'en', { other: 'NEW' })).toBe('NEW')
  })
})
