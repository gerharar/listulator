import type { ListSource, RuntimeLookup, SearchAdapter } from '../mediaTypes.js'

/**
 * Presents several sources as one, so a category is not limited to a single
 * shape of search.
 *
 * Animation is the case that forced this: Naruto is a series and Studio Ghibli
 * is a studio of films, and both are unarguably animation. The alternatives
 * were worse — splitting the category in two, or filing Naruto under TV and
 * Ghibli under Movies, which would leave documentaries with no reason to exist
 * separately either.
 *
 * The category still chooses its sources; there is no cross-cutting "TMDB" or
 * "Wikipedia" category. See docs/DECISIONS.md.
 */

export interface CompositeSource {
  /**
   * Ref prefixes this source owns, used to route `expand`. Explicit rather
   * than probing each source in turn, which would fire requests at services
   * that were never going to answer.
   */
  prefixes: string[]
  /**
   * Ref prefixes of the *items* this source can enrich (`movie` for a source of
   * films), used to route `enrich`. Not the same set as `prefixes`: a studio's
   * source is expanded by a `company:` ref but its items are `movie:` refs.
   */
  enrichPrefixes?: string[]
  adapter: SearchAdapter
  /**
   * Added to the `tags` of every item this source expands. The source is the
   * only thing that knows what an item is: Animation holds Ghost in the Shell
   * the film (from a studio) and the series (from a show), and a facet can only
   * tell them apart if the item says so. Set per category, never by the
   * adapter itself, so a plain Movies list does not grow a tag column.
   */
  tag?: string
}

const withTag = (tags: readonly string[] | undefined, tag: string): string[] =>
  tags?.some((entry) => entry.toLowerCase() === tag.toLowerCase()) ? [...tags] : [...(tags ?? []), tag]

export function createCompositeAdapter(sources: readonly CompositeSource[]): SearchAdapter {
  const usable = () => sources.filter((source) => source.adapter.isAvailable())

  return {
    isAvailable: () => usable().length > 0,

    async search(query) {
      // One source failing should not lose the others — a missing TMDB key
      // should still leave Wikipedia results, and vice versa.
      const settled = await Promise.allSettled(
        usable().map((source) => source.adapter.search(query)),
      )

      const results: ListSource[] = []
      const failures: unknown[] = []

      for (const outcome of settled) {
        if (outcome.status === 'fulfilled') results.push(...outcome.value)
        else failures.push(outcome.reason)
      }

      // Only when nothing at all came back is the failure worth surfacing;
      // otherwise a partial answer is more useful than an error.
      if (results.length === 0 && failures.length > 0) throw failures[0]

      return results
    },

    async expand(externalRef, options) {
      const prefix = externalRef.split(':')[0] ?? ''
      const owner = usable().find((source) => source.prefixes.includes(prefix))

      if (!owner) return { items: [] }

      const expansion = await owner.adapter.expand(externalRef, options)
      const { tag } = owner

      return tag
        ? { ...expansion, items: expansion.items.map((item) => ({ ...item, tags: withTag(item.tags, tag) })) }
        : expansion
    },

    // What a runner finds pending: the kinds of ref an available source claims and can enrich.
    get enrichPrefixes() {
      return [
        ...new Set(
          usable()
            .filter((source) => source.adapter.enrich)
            .flatMap((source) => source.enrichPrefixes ?? []),
        ),
      ]
    },

    async enrich(refs) {
      // Each ref goes to the first available source that claims its prefix and can enrich; a ref
      // nobody claims is simply not answered.
      const groups = new Map<CompositeSource, string[]>()

      for (const ref of refs) {
        const prefix = ref.split(':')[0] ?? ''
        const owner = usable().find(
          (source) => source.enrichPrefixes?.includes(prefix) && source.adapter.enrich,
        )
        if (owner) groups.set(owner, [...(groups.get(owner) ?? []), ref])
      }

      const answers = await Promise.all(
        [...groups].map(([owner, group]) => owner.adapter.enrich!(group)),
      )

      const merged = new Map<string, RuntimeLookup>()
      for (const answer of answers) for (const [ref, lookup] of answer) merged.set(ref, lookup)

      return merged
    },
  }
}
