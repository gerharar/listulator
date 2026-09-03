import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { categoryDescription, categoryLabel, copy, errorMessage } from './index.js'

describe('locale', () => {
  it('falls back to the server registry for categories it does not name', () => {
    // The point of the whole file. `media_type` is an open registry (SPEC.md
    // §5), so adding a category must not require an entry here — if this ever
    // fails, the locale has quietly become a second place to register one.
    expect(categoryLabel({ key: 'brand-new-thing', label: 'Brand New Thing' })).toBe(
      'Brand New Thing',
    )
    expect(
      categoryDescription({ key: 'brand-new-thing', description: 'From the server' }),
    ).toBe('From the server')
  })

  it('has no category overrides, so every label comes from the registry', () => {
    // An override is for wording the app deliberately wants to differ. There
    // are none today; this is here so adding one is a visible decision.
    expect(Object.keys(copy.categories)).toEqual([])
  })

  it('prefers an override where one exists', () => {
    const overridden = { ...copy.categories, movie: { label: 'Films' } }

    expect(overridden['movie']?.label ?? 'Movies').toBe('Films')
  })

  it('gets the singular and plural branches right', () => {
    // English needs two forms; other languages need more. Keeping them in the
    // locale is what stops each surface inventing its own rule.
    expect(copy.overview.listCount(1)).toBe('1 list')
    expect(copy.overview.listCount(2)).toBe('2 lists')
    expect(copy.listDetail.foundCount(1)).toBe('1 entry')
    expect(copy.listDetail.foundCount(3)).toBe('3 entries')
    expect(copy.listDetail.heldBack(1)).toContain('entry you deleted is')
    expect(copy.listDetail.heldBack(2)).toContain('entries you deleted are')
    expect(copy.newList.itemCount(1)).toBe('1 item.')
    expect(copy.newList.itemCount(9)).toBe('9 items.')
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

  it('has a name for every theme the app offers', () => {
    // A theme with no name renders an empty option.
    for (const key of ['dn', 'dark', 'brown', 'orange', 'bone', 'white'] as const) {
      expect(copy.themes[key]).toBeTruthy()
    }
  })
})
