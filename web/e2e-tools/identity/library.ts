import type { LibraryBrowserEntry } from '../../../server/src/ingestion/customLists.js'

/**
 * The community library the identity tool answers the List Vault with (BL-182). The Vault reads `/api/library`, the live index, whose counts change whenever a list
 * reaches it; a capture and a compare weeks apart then differ on the Vault with no code changed. This set never changes: edit it only with a reason, and capture
 * a fresh baseline after (an older baseline's Vault slots hold the live library of their day).
 */
const entry = (category: string, name: string, extra: Partial<LibraryBrowserEntry> = {}): LibraryBrowserEntry => ({
  externalRef: `canonical:lists/${category}/${name}.yaml`,
  title: name.replace(/-/g, ' ').replace(/^./, (letter) => letter.toUpperCase()),
  category,
  status: 'complete',
  itemCount: 8,
  totalMinutes: 960,
  minutesEstimated: false,
  tracked: false,
  ...extra,
})

export const LIBRARY: { entries: LibraryBrowserEntry[]; reachable: true } = {
  reachable: true,
  entries: [
    entry('movie', 'comfort-rewatches', { itemCount: 12, totalMinutes: 1320, tracked: true, trackedListId: 'identity-tracked-list' }),
    entry('movie', 'space-operas', { status: 'ongoing', itemCount: 9, totalMinutes: 1260 }),
    entry('movie', 'heist-films', { itemCount: 6, totalMinutes: 720, minutesEstimated: true }),
    entry('movie', 'animated-classics', { itemCount: 15, totalMinutes: 1350 }),
    entry('tv', 'sitcom-greats', { status: 'ongoing', itemCount: 5, totalMinutes: 6600 }),
    entry('tv', 'short-miniseries', { itemCount: 4, totalMinutes: 1500, minutesEstimated: true }),
    entry('tv', 'crime-dramas', { itemCount: 7, totalMinutes: 9000 }),
    entry('game', 'cosy-games', { itemCount: 10, totalMinutes: 3000, minutesEstimated: true }),
    entry('game', 'one-sitting-games', { itemCount: 8, totalMinutes: 960 }),
    entry('book', 'short-novels', { itemCount: 11, totalMinutes: 3960, minutesEstimated: true }),
  ],
}
