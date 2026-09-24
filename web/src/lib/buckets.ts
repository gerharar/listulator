import type { MediaList, MediaType } from './api.js'

export interface CategoryBucket {
  mediaType: MediaType
  lists: MediaList[]
}

export interface BucketLayout {
  /** Categories with lists — shown as full buckets, in registry order. */
  used: CategoryBucket[]
  /** Categories with nothing yet — collapsed into the muted "also" strip. */
  unused: MediaType[]
  /** True before anything exists at all: every category is on offer instead. */
  isFirstRun: boolean
}

/**
 * Splits categories into full buckets and the collapsed strip.
 *
 * The rule from docs/design/README.md: with nothing yet, every category is on
 * offer so a new user sees what the app is for. Once anything exists, only
 * categories in use get a bucket and the rest shrink to one muted line —
 * otherwise a dozen empty prompts dominate the screen at month six.
 */
export function buildBuckets(lists: MediaList[], mediaTypes: MediaType[]): BucketLayout {
  const ordered = [...mediaTypes].sort((a, b) => a.sortOrder - b.sortOrder)

  const used: CategoryBucket[] = []
  const unused: MediaType[] = []

  for (const mediaType of ordered) {
    const inCategory = lists.filter((list) => list.mediaType === mediaType.key)

    if (inCategory.length > 0) {
      used.push({ mediaType, lists: inCategory })
    } else {
      unused.push(mediaType)
    }
  }

  return { used, unused, isFirstRun: lists.length === 0 }
}

/**
 * Lists whose category is no longer in the registry would otherwise vanish
 * from the UI while still existing in the database — silent data loss from the
 * user's point of view. Surfaced separately instead.
 */
export function findOrphanedLists(lists: MediaList[], mediaTypes: MediaType[]): MediaList[] {
  const known = new Set(mediaTypes.map((mediaType) => mediaType.key))

  return lists.filter((list) => !known.has(list.mediaType))
}

/**
 * A HomeRow's leading mark, derived from `source` — display-only, nothing
 * stored (tasks/plan.md's compatibility table: "Derivable from `lists.source`
 * (`canonical` / `manual`)"). `api`/`llm`/`file`-synced lists get neither
 * mark; only the community library (`canonical`) and a fully hand-typed list
 * (`manual`) are either kept by hand or made by hand.
 */
export function listMark(list: MediaList): 'curated' | 'byHand' | null {
  if (list.source === 'canonical') return 'curated'
  if (list.source === 'manual') return 'byHand'
  return null
}
