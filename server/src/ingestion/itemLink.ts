import type { MediaType } from './mediaTypes.js'

/** What an adapter is told about an item when asked for its page at the source. */
export interface ItemLinkInput {
  /** The upstream id the item was imported with; null for an item with none. */
  externalRef: string | null
  title: string
  source: 'manual' | 'import'
  /**
   * The page slug the background lookup cached for this ref, for a source whose pages need one (IGDB). Absent or
   * null: not known (yet), or the source has none.
   */
  slug?: string | null
}

/** An item's page at its source, and the source's name for the tooltip ("Open on TMDB"). */
export interface ItemLink {
  url: string
  source: string
}

/**
 * The ↗ on an item row (H-002, BL-087): where the item lives at its source, or null.
 *
 * The media type's adapter builds the address (`itemUrl`), from the item's stored id and nothing it was sent from
 * outside: the open registry keeps source knowledge in the adapter, and a new category needs no change here. This
 * only refuses what must never become a link: an item typed in by hand, a category with no source name, and any
 * answer that is not a plain https address. A throwing adapter means no link, never a broken list.
 */
export function itemLinkFor(mediaType: MediaType | undefined, item: ItemLinkInput, listExternalRef: string | null): ItemLink | null {
  const source = mediaType?.sourceName
  const itemUrl = mediaType?.adapter?.itemUrl
  if (!source || !itemUrl || item.source === 'manual') return null

  let url: string | undefined
  try {
    url = itemUrl.call(mediaType.adapter, item, listExternalRef)
  } catch {
    return null
  }

  return url && isPlainHttps(url) ? { url, source } : null
}

function isPlainHttps(candidate: string): boolean {
  try {
    const parsed = new URL(candidate)
    return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === ''
  } catch {
    return false
  }
}

/**
 * A list's items, each with its `link` (or null): what the list's own read carries, so the screen needs no
 * registry. `slugs` are the cached answers by ref, for a category whose pages need one.
 */
export function withItemLinks<T extends ItemLinkInput>(
  mediaType: MediaType | undefined,
  listExternalRef: string | null,
  items: readonly T[],
  slugs?: ReadonlyMap<string, string | null>,
): (T & { link: ItemLink | null })[] {
  return items.map((item) => ({
    ...item,
    link: itemLinkFor(mediaType, { ...item, slug: (item.externalRef && slugs?.get(item.externalRef)) || null }, listExternalRef),
  }))
}
