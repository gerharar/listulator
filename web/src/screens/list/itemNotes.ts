import type { Locale } from '../../locale/index.js'
import type { ListItem } from '../../lib/api.js'

type ItemActionsText = Locale['quantum']['list']['itemActions']

/** The two notes an item can carry, kept apart (SPEC §4): the curator's, read-only, and the user's own. `null` for none or blank. */
export interface ItemNotes {
  curator: string | null
  mine: string | null
}

const text = (note: string | null | undefined): string | null => note?.trim() || null

export function itemNotes(item: Partial<Pick<ListItem, 'notes' | 'userNote'>>): ItemNotes {
  return { curator: text(item.notes), mine: text(item.userNote) }
}

/** What the ⓘ is called, and what it says on hover: whose note, or Notes for both; `null` when there is none (no ⓘ then). */
export function notesLabel(notes: ItemNotes, copyText: Pick<ItemActionsText, 'curatorNote' | 'yourNote' | 'notes'>): string | null {
  if (notes.curator && notes.mine) return copyText.notes
  if (notes.curator) return copyText.curatorNote
  if (notes.mine) return copyText.yourNote
  return null
}
