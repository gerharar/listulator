import type { ListSource, SearchAdapter } from '../mediaTypes.js'

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
  adapter: SearchAdapter
}

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

    async expand(externalRef) {
      const prefix = externalRef.split(':')[0] ?? ''
      const owner = usable().find((source) => source.prefixes.includes(prefix))

      return owner ? owner.adapter.expand(externalRef) : []
    },
  }
}
