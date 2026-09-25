import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { categoryDescription, categoryLabel, copy, errorMessage } from './index.js'
import { en } from './en.js'
import { ru } from './ru.js'
import { de } from './de.js'
import { missingKeys } from './mergeLocale.js'

/**
 * Flips to `true` at task 10.32b, once `ru`/`de` are the full translation
 * rather than 10.8b's infrastructure-proving subset — the one line this
 * file's own key-parity check needs to change from reporting to failing.
 */
const STRICT_PARITY = false

describe('locale', () => {
  it('falls back to the server registry for categories it does not name', () => {
    // The point of the whole file. `media_type` is an open registry (SPEC.md
    // §5), so adding a category must not require an entry here — if this ever
    // fails, the locale has quietly become a second place to register one.
    expect(categoryLabel({ key: 'brand-new-thing', label: 'Brand New Thing' })).toBe(
      'Brand New Thing',
    )
    expect(categoryDescription({ key: 'brand-new-thing', description: 'From the server' })).toBe(
      'From the server',
    )
  })

  it("shows the design handoff's wording while the registry's own labels stay untouched", () => {
    // The registry says "TV Shows" and "Wrestling"; the design says "TV
    // Series" and "Pro Wrestling". Only the *displayed* label differs — the
    // registry's `label` and keys are never renamed (task 10.11, C1).
    expect(categoryLabel({ key: 'tv', label: 'TV Shows' })).toBe('TV Series')
    expect(categoryLabel({ key: 'wrestling', label: 'Wrestling' })).toBe('Pro Wrestling')
    expect(categoryLabel({ key: 'movie', label: 'Movies' })).toBe('Movies')
  })

  it('overrides only where the design deliberately words a category differently', () => {
    // An override is for wording the app deliberately wants to differ; this
    // pins the whole set so adding one is a visible decision.
    expect(Object.keys(copy.categories).sort()).toEqual(['tv', 'wrestling'])
  })

  it('prefers an override where one exists', () => {
    const overridden = { ...copy.categories, movie: { label: 'Films' } }

    expect(overridden['movie']?.label ?? 'Movies').toBe('Films')
  })

  it('gets the singular and plural branches right', () => {
    // English needs two forms; other languages need more. Keeping them in the
    // locale is what stops each surface inventing its own rule.
    expect(copy.quantum.home.listCount(1)).toBe('1 list')
    expect(copy.quantum.home.listCount(2)).toBe('2 lists')
    expect(copy.quantum.addByHand.count(1, 0)).toBe('1 item')
    expect(copy.quantum.addByHand.count(9, 1)).toBe('9 items in 1 group')
    expect(copy.quantum.addByHand.count(2, 3)).toBe('2 items in 3 groups')
  })

  it('has a sentence for every error code the server can send', () => {
    // Reads the server's union directly rather than restating it, so adding a
    // code there without wording it here fails on the next run. A test-only
    // read of the file — nothing links the two workspaces at build time.
    const source = readFileSync(
      fileURLToPath(new URL('../../../server/src/apiErrors.ts', import.meta.url)),
      'utf8',
    )

    const union = /export type ApiErrorCode =([\s\S]*?)\n\n/.exec(source)?.[1] ?? ''
    const codes = [...union.matchAll(/'([^']+)'/g)].map((match) => match[1])

    // Guards the regex itself: a rename that breaks the parse would otherwise
    // make this pass by finding nothing at all.
    expect(codes.length).toBeGreaterThan(0)
    expect(Object.keys(copy.errors).sort()).toEqual([...codes].sort())
  })

  it('renders a server error with its values', () => {
    expect(errorMessage('search.unavailable', { category: 'Movies' })).toBe(
      'Search is not available for Movies. Add items by hand.',
    )
    expect(errorMessage('refresh.handMadeList')).toBe(
      'This list was made by hand, so there is nothing to check against.',
    )
  })

  it('gives nothing back for a code it does not know, rather than throwing', () => {
    // An older web against a newer server. The caller then falls through to
    // whatever the response carried.
    expect(errorMessage('something.invented')).toBeUndefined()
  })
})

describe('key parity: ru/de against en (task 10.8b)', () => {
  it('reports — or, once STRICT_PARITY flips at 10.32b, fails on — every key ru/de have not translated yet', () => {
    const missingRu = missingKeys(en, ru)
    const missingDe = missingKeys(en, de)

    if (STRICT_PARITY) {
      expect(missingRu).toEqual([])
      expect(missingDe).toEqual([])
      return
    }

    console.info(
      `[locale] ru is missing ${missingRu.length} key(s), falling back to en:`,
      missingRu,
    )
    console.info(
      `[locale] de is missing ${missingDe.length} key(s), falling back to en:`,
      missingDe,
    )

    // Sanity on the sanity check: if a future edit fully translates ru/de
    // without flipping STRICT_PARITY, this should fail and say so — not
    // pass silently on an assertion that never engages with the real data.
    expect(missingRu.length).toBeGreaterThan(0)
    expect(missingDe.length).toBeGreaterThan(0)
  })
})
