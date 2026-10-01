import { api, type ListSourceResult } from '../../../lib/api.js'

/** One list in the library-scope category (Mega) that a search in another category also matches. */
export interface CrossHintList {
  externalRef: string
  title: string
  description?: string
  itemCount?: number
}

/** A list the community library ships: the curated star's meaning (a result row decides it the same way). */
export const isCanonical = (list: CrossHintList): boolean => list.externalRef.startsWith('canonical:')

/** What a search found one shelf over: every matching list, in the library's order, and what was searched. */
export interface CrossHint {
  /** The library-scope category's key. */
  category: string
  /** The query that found them, so Open can search it again over there. */
  query: string
  lists: CrossHintList[]
}

const toList = (source: ListSourceResult): CrossHintList => ({
  externalRef: source.externalRef,
  title: source.title,
  ...(source.description !== undefined ? { description: source.description } : {}),
  ...(source.itemCount !== undefined ? { itemCount: source.itemCount } : {}),
})

/**
 * Asks the library-scope category (Mega) the very search the user made, so Open shows exactly the lists the hint
 * promised. A hint is a courtesy: no match, an unreachable library or any failure is simply no hint, never an error.
 */
export async function lookupCrossHint(libraryCategory: { key: string }, query: string): Promise<CrossHint | null> {
  try {
    const { sources, libraryUnreachable } = await api.searchSources(libraryCategory.key, query)
    if (libraryUnreachable || sources.length === 0) return null

    return { category: libraryCategory.key, query, lists: sources.map(toList) }
  } catch {
    return null
  }
}
