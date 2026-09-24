/**
 * The GUI options that shape *what a source expands to* — a book search's
 * language filter, a music search's discography types. Sent alongside the
 * chosen source, generically for any category (the route neither knows nor
 * cares which category reads them).
 */
export interface SourceOptions {
  /** Book-only: an ISO 639-2 code, or 'all'/absent for no filter. */
  language?: string
  /** Book-only: keep works with no language tag at all. Strict (excluded) by default. */
  includeUnknown?: boolean
  /** Music-only: EPs and singles are on by default, live and compilations off. */
  includeEp?: boolean
  includeSingle?: boolean
  includeLive?: boolean
  includeCompilation?: boolean
}

/**
 * The ref an adapter's `expand()` actually receives, which is also what a
 * list stores as its `externalRef` — so a later refresh replays the same
 * filter with no route or schema changes.
 *
 * One function for import *and* for the per-result count in the Search tab:
 * the number shown before "Add list" must be the number "Add list" produces.
 * The music toggles are gated on whether the GUI sent them at all, not on
 * the category — route tests reuse the `music` key as a generic category
 * with a fake adapter that doesn't read them.
 */
export function refForAdapter(externalRef: string, options: SourceOptions): string {
  const { language, includeUnknown, includeEp, includeSingle, includeLive, includeCompilation } =
    options

  if (language && language !== 'all') {
    return `${externalRef}:${language}${includeUnknown ? ':unknown' : ''}`
  }

  const musicSent =
    includeEp !== undefined ||
    includeSingle !== undefined ||
    includeLive !== undefined ||
    includeCompilation !== undefined

  if (!musicSent) return externalRef

  const facets = [
    // EPs and singles on by default, live and compilations off — confirmed
    // with the user.
    (includeEp ?? true) && 'ep',
    (includeSingle ?? true) && 'single',
    includeLive && 'live',
    includeCompilation && 'compilation',
  ].filter((facet): facet is string => typeof facet === 'string')

  return `${externalRef}:${facets.join(',')}`
}
