import type { PortableDatabase } from '../db/client.js'
import { withItemLinks, type ItemLink, type ItemLinkInput } from '../ingestion/itemLink.js'
import type { MediaType } from '../ingestion/mediaTypes.js'
import { slugsForList, unansweredRefs } from './itemSlugs.js'
import type { SlugFiller } from './slugFill.js'

/**
 * What a list's own read adds to each item for the ↗ (H-002, BL-087), for the server and the desktop alike: its
 * `link`, and `linkPending` while a page slug it needs is still being looked up in the background.
 *
 * A category whose addresses need only the ref (`slugPrefixes` absent) does no database work and no lookup at all,
 * and its items get no `linkPending` field. One that does costs one query, joined on the list's own items, and a
 * lookup only for what has no answer yet (`slugFill.ts`).
 */
export async function withLinks<T extends ItemLinkInput>({
  db,
  filler,
  listId,
  mediaType,
  listExternalRef,
  items,
}: {
  db: PortableDatabase
  filler: SlugFiller
  listId: string
  mediaType: MediaType | undefined
  listExternalRef: string | null
  items: readonly T[]
}): Promise<(T & { link: ItemLink | null; linkPending?: true })[]> {
  const prefixes = mediaType?.adapter?.slugPrefixes
  if (!prefixes || prefixes.length === 0) return withItemLinks(mediaType, listExternalRef, items)

  const slugs = await slugsForList(db, listId)
  const unanswered = unansweredRefs(items, slugs, prefixes)
  const coming = unanswered.length > 0 && filler.start(listId, mediaType)
  const waiting = coming ? new Set(unanswered) : undefined

  return withItemLinks(mediaType, listExternalRef, items, slugs).map((item) =>
    waiting?.has(item.externalRef ?? '') ? { ...item, linkPending: true as const } : item,
  )
}
