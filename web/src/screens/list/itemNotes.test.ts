import { describe, expect, it } from 'vitest'
import { copy } from '../../locale/index.js'
import type { ListItem } from '../../lib/api.js'
import { itemNotes, notesLabel } from './itemNotes.js'

const text = copy.quantum.list.itemActions
const ITEM = { notes: null, userNote: null } as Pick<ListItem, 'notes' | 'userNote'>

describe('itemNotes (H-003): which notes an item has', () => {
  it('has none for an item with neither note, and for blank ones', () => {
    expect(itemNotes(ITEM)).toEqual({ curator: null, mine: null })
    expect(itemNotes({ notes: '   ', userNote: '\n ' })).toEqual({ curator: null, mine: null })
    expect(itemNotes({ notes: undefined as unknown as null })).toEqual({ curator: null, mine: null })
  })

  it('keeps the curator’s note and the user’s note apart, trimmed, line breaks kept', () => {
    expect(itemNotes({ notes: ' Read it last. ', userNote: 'One.\nTwo.' })).toEqual({ curator: 'Read it last.', mine: 'One.\nTwo.' })
    expect(itemNotes({ notes: 'Only the curator', userNote: null })).toEqual({ curator: 'Only the curator', mine: null })
    expect(itemNotes({ notes: null, userNote: 'Only mine' })).toEqual({ curator: null, mine: 'Only mine' })
  })
})

describe('notesLabel: what the ⓘ is called', () => {
  it('is Curator note, Your note, or Notes for both, and nothing when there is no note', () => {
    expect(notesLabel({ curator: 'a', mine: null }, text)).toBe('Curator note')
    expect(notesLabel({ curator: null, mine: 'b' }, text)).toBe('Your note')
    expect(notesLabel({ curator: 'a', mine: 'b' }, text)).toBe('Notes')
    expect(notesLabel({ curator: null, mine: null }, text)).toBeNull()
  })
})
