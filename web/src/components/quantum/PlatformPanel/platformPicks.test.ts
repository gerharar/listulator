import { describe, expect, it } from 'vitest'
import { panelContent, platformDraft, togglePlatform } from './platformPicks.js'

// The table's first ten by its file order (the handoff's rank): WIN MAC NSW LIN IOS AND PS4 XONE WEB PS5.

describe('panelContent, nothing typed (U5)', () => {
  it('offers the ten most common, A–Z, when the list has no platforms yet', () => {
    expect(panelContent('', [])).toEqual({
      sections: [{ key: 'common', codes: ['AND', 'IOS', 'LIN', 'MAC', 'NSW', 'PS4', 'PS5', 'WEB', 'WIN', 'XONE'] }],
      hidden: 0,
      noMatch: false,
    })
  })

  it('puts what the list already uses first, A–Z, read as today’s codes; unknown tags (a bare multi too) are not platforms', () => {
    const content = panelContent('', ['X360', 'pc', 'PS3', 'MULTI', 'NOPE', 'ps3'])
    expect(content.sections).toEqual([
      { key: 'inList', codes: ['PS3', 'WIN', 'X360'] },
      // Six once another section shows: the most common not already offered, A–Z.
      { key: 'common', codes: ['AND', 'IOS', 'LIN', 'MAC', 'NSW', 'PS4'] },
    ])
  })
})

describe('panelContent, searching (U5)', () => {
  const matches = (query: string) => panelContent(query, []).sections[0]?.codes ?? []

  it('ranks the code itself, then codes starting with it, then names, ties A–Z', () => {
    expect(matches('gb').slice(0, 3)).toEqual(['GB', 'GBA', 'GBC'])
    expect(matches('  Gb ').slice(0, 3)).toEqual(['GB', 'GBA', 'GBC'])
  })

  it('finds a word inside a name', () => {
    expect(matches('boy').slice(0, 3)).toEqual(['GB', 'GBA', 'GBC'])
  })

  it('ranks a name starting with the text above one where it only starts a later word', () => {
    // "Neo Geo …" names start with it; "Hyper Neo Geo 64" (HNG64) sorts first A–Z but only has it as a word.
    const found = matches('neo')
    expect(found.at(-1)).toBe('HNG64')
    expect(found[0]).toBe('AES')
  })

  it('finds a name by its start before a name that only contains the text', () => {
    const found = matches('playstation')
    expect(found[0]).toBe('PS1')
    expect(found).toContain('PS4')
  })

  it('shows thirty and counts the rest', () => {
    const content = panelContent('a', [])
    expect(content.sections[0]!.codes).toHaveLength(30)
    expect(content.sections[0]!.total).toBeGreaterThan(30)
    expect(content.hidden).toBe(content.sections[0]!.total! - 30)
  })

  it('says so when nothing matches', () => {
    expect(panelContent('zzzz', [])).toEqual({ sections: [], hidden: 0, noMatch: true })
  })
})

describe('togglePlatform (U5)', () => {
  it('adds and removes a platform, keeping the table’s order whatever the click order', () => {
    expect(togglePlatform([], 'PS4')).toEqual(['PS4'])
    expect(togglePlatform(['PS4'], 'WIN')).toEqual(['WIN', 'PS4'])
    expect(togglePlatform(['WIN', 'PS4'], 'PS4')).toEqual(['WIN'])
  })

  it('keeps a tag the table does not know when toggling another', () => {
    expect(togglePlatform(['MULTI'], 'PS4')).toEqual(['PS4', 'MULTI'])
  })
})

describe('platformDraft (U5)', () => {
  it('reads an item’s tags as today’s codes in the table’s order, once each', () => {
    expect(platformDraft(['nds', 'PS4', 'pc', 'win'])).toEqual(['WIN', 'PS4', 'DS'])
    // No claim behind a bare multi (owner, U5): an unknown tag, kept.
    expect(platformDraft(['multi', 'PS4'])).toEqual(['PS4', 'MULTI'])
    expect(platformDraft(null)).toEqual([])
  })

  it('keeps a tag the table does not know, after the known ones, so saving never loses it', () => {
    expect(platformDraft(['FOO', 'PS4'])).toEqual(['PS4', 'FOO'])
  })
})
