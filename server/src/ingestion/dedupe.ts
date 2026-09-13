import type { MediaTypeCandidate } from './mediaTypes.js'

/**
 * Collapses candidates that share a normalized title (task 6.10) — the same
 * book listed under two editions is still one thing to read once, not two.
 *
 * Generic over `MediaTypeCandidate[]` and placed here rather than inside any
 * one adapter, even though only Open Library's bibliography needs it today
 * (task 6.10's scoping): the operation itself — "same title, pick one" — has
 * nothing Open-Library-specific about it.
 *
 * Tie-break: the earliest `year` wins, but only when *both* sides of the
 * pair being compared actually have one — matches task 6.3's "original
 * chronology" philosophy without inventing a signal one side doesn't have.
 * Every other case (neither has a year, or only one does) keeps whichever
 * candidate was seen first, so behavior stays deterministic and the winner
 * is never picked from thin air.
 *
 * The winner is kept whole, not merged from both — "using the earliest-year
 * edition's data" (the acceptance criterion) means exactly that record's own
 * fields, not a composite of two candidates' fields.
 */
export function dedupeByTitle(candidates: MediaTypeCandidate[]): MediaTypeCandidate[] {
  const byTitle = new Map<string, MediaTypeCandidate>()

  for (const candidate of candidates) {
    const key = normalizeTitle(candidate.title)
    const existing = byTitle.get(key)

    if (!existing || isEarlierEdition(candidate, existing)) {
      byTitle.set(key, candidate)
    }
  }

  return [...byTitle.values()]
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase()
}

function isEarlierEdition(candidate: MediaTypeCandidate, existing: MediaTypeCandidate): boolean {
  if (candidate.year === undefined || existing.year === undefined) return false
  return candidate.year < existing.year
}
