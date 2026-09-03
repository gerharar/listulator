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

interface CrewEntry extends CreditEntry {
  job?: string
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

/** Auth, requests and throttling, shared by the film and television adapters. */
export function createTmdbClient(credentials: TmdbCredentialSource, fetchImpl?: FetchLike) {
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

  const isConfigured = (): boolean => {
    const { apiKey, readAccessToken } = resolve()

    return Boolean(apiKey ?? readAccessToken)
  }

  return { request, mapLimited, isConfigured }
}

export type TmdbClient = ReturnType<typeof createTmdbClient>

/**
 * Fills in each film's runtime, a few at a time.
 *
 * A credits or discover list carries no runtime, so this is one request per
 * film — worth it because Quickie ranks purely on time remaining, and a whole
 * filmography sharing one guessed duration would tell it nothing. A failed
 * lookup costs that film its runtime and nothing else.
 */
export async function withRuntimes(
  client: TmdbClient,
  films: { id: number; title: string }[],
): Promise<MediaTypeCandidate[]> {
  return client.mapLimited(films, RUNTIME_CONCURRENCY, async (film) => {
    const runtime = await client
      .request<{ runtime?: number | null }>(`/movie/${film.id}`)
      .then((detail) => detail.runtime)
      .catch(() => null)

    return {
      title: film.title,
      externalRef: `movie:${film.id}`,
      ...(runtime ? { timeToConsumeMinutes: runtime } : {}),
    }
  })
}

export interface TmdbFilmOptions {
  /**
   * How to treat documentaries in a filmography.
   *
   * Excluded by default: a person's credits otherwise fill with documentaries
   * *about* them. The documentaries category inverts it, since a director's
   * documentaries are exactly what it wants.
   */
  documentaries?: 'exclude' | 'only'
  /**
   * Also count films the person directed, not only ones they appeared in.
   *
   * Off by default, because an actor's list should be the films they are in.
   * On for documentaries: Ken Burns directs rather than appears, so reading
   * only the cast credits found 12 of his 59 documentaries.
   */
  includeDirecting?: boolean
}

export function createTmdbAdapter(
  credentials: TmdbCredentialSource,
  { documentaries = 'exclude', includeDirecting = false }: TmdbFilmOptions = {},
  fetchImpl?: FetchLike,
): SearchAdapter {
  const client = createTmdbClient(credentials, fetchImpl)
  const { request, isConfigured } = client


  /** Released, oldest first — the order you watch a career in. */
  function usableCredits(entries: CreditEntry[], today: string) {
    return entries
      .filter((entry) => entry.title && entry.release_date && entry.release_date <= today)
      .filter((entry) => {
        const isDocumentary = (entry.genre_ids ?? []).includes(DOCUMENTARY_GENRE)

        return documentaries === 'only' ? isDocumentary : !isDocumentary
      })
      .sort((a, b) => (a.release_date ?? '').localeCompare(b.release_date ?? ''))
      .slice(0, MAX_ITEMS)
      .map((entry) => ({ id: entry.id, title: entry.title! }))
  }

  return {
    isAvailable: isConfigured,

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

        return withRuntimes(client, usableCredits(collection.parts ?? [], today))
      }

      if (kind === 'person') {
        const credits = await request<{ cast?: CreditEntry[]; crew?: CrewEntry[] }>(
          `/person/${id}/movie_credits`,
        )

        const directed = includeDirecting
          ? (credits.crew ?? []).filter((entry) => entry.job === 'Director')
          : []

        // A person can be credited twice on one film; keep the first.
        const byFilm = new Map<number, CreditEntry>()
        for (const entry of [...(credits.cast ?? []), ...directed]) {
          if (!byFilm.has(entry.id)) byFilm.set(entry.id, entry)
        }

        return withRuntimes(client, usableCredits([...byFilm.values()], today))
      }

      return []
    },
  }
}
