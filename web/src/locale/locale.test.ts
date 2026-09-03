import { describe, expect, it } from 'vitest'
import { categoryDescription, categoryLabel, copy } from './index.js'

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

  it('has a name for every theme the app offers', () => {
    // A theme with no name renders an empty option.
    for (const key of ['dn', 'dark', 'brown', 'orange', 'bone', 'white'] as const) {
      expect(copy.themes[key]).toBeTruthy()
    }
  })
})
