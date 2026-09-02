import { getJson, type FetchLike } from '../http.js'
import type { ListSource, MediaTypeCandidate, SearchAdapter } from '../mediaTypes.js'

/**
 * TMDB: search a person or a collection, expand to their films.
 *
 * Two kinds of source, because both are things people actually want as a list:
 * "all Jackie Chan movies" is a person's filmography, "all James Bond films"
 * is a collection. The kind is encoded in the ref so `expand` knows which it
 * is being handed.
 */

const BASE = 'https://api.themoviedb.org/3'
const DOCUMENTARY_GENRE = 99
/** Bounds a prolific filmography; Jackie Chan alone has 200+ credits. */
const MAX_ITEMS = 300
/** Runtime needs one request per film. Polite, and still only seconds. */
const RUNTIME_CONCURRENCY = 8

interface PersonResult {
  id: number
  name: string
  known_for_department?: string
  known_for?: { title?: string; name?: string }[]
}

interface CollectionResult {
  id: number
  name: string
}

interface CreditEntry {
  id: number
  title?: string
  release_date?: string
  genre_ids?: number[]
}

interface CollectionDetail {
  parts?: { id: number; title?: string; release_date?: string }[]
}

export interface TmdbCredentials {
  /** v3 key, sent as a query parameter. */
  apiKey?: string | undefined
  /** v4 token, sent as a bearer header. Preferred when both are present. */
  readAccessToken?: string | undefined
}

/**
 * Credentials are resolved per call, not captured at construction.
 *
 * The registry is built while modules are being imported, which happens before
 * the entry point gets to load `.env` — so reading the key eagerly meant a
 * configured key looked missing and the category silently had no search. Only
 * a live run surfaced it; every mocked test passed, because they inject
 * credentials directly.
 */
export type TmdbCredentialSource = TmdbCredentials | (() => TmdbCredentials)

export function createTmdbAdapter(
  credentials: TmdbCredentialSource,
  fetchImpl?: FetchLike,
): SearchAdapter {
  const resolve = (): TmdbCredentials =>
    typeof credentials === 'function' ? credentials() : credentials

  function request<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const { apiKey, readAccessToken } = resolve()
    const search = new URLSearchParams(params)
    // TMDB accepts either scheme on v3 endpoints; the bearer token is their
    // current recommendation, the key is what most people are handed first.
    if (!readAccessToken && apiKey) search.set('api_key', apiKey)

    return getJson<T>(`${BASE}${path}?${search.toString()}`, {
      source: 'TMDB',
      ...(readAccessToken ? { headers: { authorization: `Bearer ${readAccessToken}` } } : {}),
      ...(fetchImpl ? { fetchImpl } : {}),
    })
  }

  /** Runs `work` over `items` a few at a time rather than all at once. */
  async function mapLimited<In, Out>(
    items: In[],
    limit: number,
    work: (item: In) => Promise<Out>,
  ): Promise<Out[]> {
    const results: Out[] = new Array(items.length)
    let next = 0

    await Promise.all(
      Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
          const index = next++
          results[index] = await work(items[index]!)
        }
      }),
    )

    return results
  }

  async function withRuntimes(
    films: { id: number; title: string }[],
  ): Promise<MediaTypeCandidate[]> {
    return mapLimited(films, RUNTIME_CONCURRENCY, async (film) => {
      // One film failing should not lose the other 162; it just falls back to
      // the category default like any unknown duration.
      const runtime = await request<{ runtime?: number | null }>(`/movie/${film.id}`)
        .then((detail) => detail.runtime)
        .catch(() => null)

      return {
        title: film.title,
        externalRef: `movie:${film.id}`,
        ...(runtime ? { timeToConsumeMinutes: runtime } : {}),
      }
    })
  }

  /** Released, non-documentary, oldest first — the order you watch a career in. */
  function usableCredits(entries: CreditEntry[], today: string) {
    return entries
      .filter((entry) => entry.title && entry.release_date && entry.release_date <= today)
      .filter((entry) => !(entry.genre_ids ?? []).includes(DOCUMENTARY_GENRE))
      .sort((a, b) => (a.release_date ?? '').localeCompare(b.release_date ?? ''))
      .slice(0, MAX_ITEMS)
      .map((entry) => ({ id: entry.id, title: entry.title! }))
  }

  return {
    isAvailable: () => {
      const { apiKey, readAccessToken } = resolve()

      return Boolean(apiKey ?? readAccessToken)
    },

    async search(query) {
      const [people, collections] = await Promise.all([
        request<{ results?: PersonResult[] }>('/search/person', { query }),
        request<{ results?: CollectionResult[] }>('/search/collection', { query }),
      ])

      const asPeople = (people.results ?? []).slice(0, 6).map((person): ListSource => {
        // Names repeat — three people called Jackie Chan came back in testing.
        // Their best-known films are what tells them apart.
        const bestKnown = (person.known_for ?? [])
          .map((work) => work.title ?? work.name)
          .filter(Boolean)
          .slice(0, 3)
          .join(', ')

        const detail = [person.known_for_department, bestKnown].filter(Boolean).join(' · ')

        return {
          externalRef: `person:${person.id}`,
          title: `${person.name} — filmography`,
          ...(detail ? { detail } : {}),
        }
      })

      const asCollections = (collections.results ?? []).slice(0, 4).map(
        (collection): ListSource => ({
          externalRef: `collection:${collection.id}`,
          title: collection.name,
          detail: 'Collection',
        }),
      )

      return [...asCollections, ...asPeople]
    },

    async expand(externalRef) {
      const [kind, id] = externalRef.split(':')
      const today = new Date().toISOString().slice(0, 10)

      if (kind === 'collection') {
        const collection = await request<CollectionDetail>(`/collection/${id}`)

        return withRuntimes(usableCredits(collection.parts ?? [], today))
      }

      if (kind === 'person') {
        const credits = await request<{ cast?: CreditEntry[] }>(`/person/${id}/movie_credits`)

        return withRuntimes(usableCredits(credits.cast ?? [], today))
      }

      return []
    },
  }
}
