import { delay, getJson, UpstreamError, type FetchLike } from '../http.js'
import type { ListSource, MediaTypeCandidate, SearchAdapter } from '../mediaTypes.js'
import { itemsOnly } from '../expansion.js'

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

/** The show-level fields an episode with no runtime of its own can borrow a length from. */
export interface ShowRuntimeFields {
  episode_run_time?: number[]
  /** Populated where `episode_run_time` is not — see `episodeMinutes`. */
  last_episode_to_air?: { runtime?: number | null }
}

/**
 * How long one episode of a show runs.
 *
 * `episode_run_time` is the documented field and comes back **empty for every
 * modern show** — Agents of S.H.I.E.L.D., Loki, WandaVision, Moon Knight all
 * return `[]`. TMDB has effectively stopped populating it. Without the
 * fallback every season fell back to the category default, so a 22-episode
 * season read as two hours and Quickie would have offered it as a quick win.
 *
 * Shared by the television and franchise adapters (audit 2026-10-02: the television one had no fallback, so
 * Doctor Who lost 9 of 352 episodes' lengths and Smallville 10 of 254 to the category default).
 * Only the fallback for an episode with no runtime of its own (10.12b): a show
 * that changed format mid-run inherits its latest length for those, which is an
 * estimate but the right order of magnitude — far better than the category
 * default.
 */
export function episodeMinutes(detail: ShowRuntimeFields): number | undefined {
  return detail.episode_run_time?.[0] ?? detail.last_episode_to_air?.runtime ?? undefined
}

/**
 * A request is tried this many times in all. TMDB answers 429 when its limit
 * (about 40 requests a second) is hit and now and then a 5xx; both pass, and a
 * list built from an expansion that silently lost a season is worse than one
 * that waited a second (BL-046).
 */
const MAX_ATTEMPTS = 3
/** The wait before a retry when the upstream names none: this, then double. */
const BACKOFF_MS = 500
/** A `Retry-After` longer than this is not waited out: the request fails and says so. */
const MAX_RETRY_WAIT_MS = 10_000

export interface TmdbClientOptions {
  /** Injectable so the waits are testable without real waiting. */
  sleep?: (ms: number) => Promise<void>
}

/** Auth, requests and throttling, shared by the film and television adapters. */
export function createTmdbClient(
  credentials: TmdbCredentialSource,
  fetchImpl?: FetchLike,
  { sleep = delay }: TmdbClientOptions = {},
) {
  const resolve = (): TmdbCredentials =>
    typeof credentials === 'function' ? credentials() : credentials

  async function request<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const { apiKey, readAccessToken } = resolve()
    const search = new URLSearchParams(params)
    // TMDB accepts either scheme on v3 endpoints; the bearer token is their
    // current recommendation, the key is what most people are handed first.
    if (!readAccessToken && apiKey) search.set('api_key', apiKey)

    for (let attempt = 1; ; attempt += 1) {
      try {
        return await getJson<T>(`${BASE}${path}?${search.toString()}`, {
          source: 'TMDB',
          ...(readAccessToken ? { headers: { authorization: `Bearer ${readAccessToken}` } } : {}),
          ...(fetchImpl ? { fetchImpl } : {}),
        })
      } catch (error) {
        // Only the upstream saying "slow down" or "I am broken" is worth another go. A 404 is an
        // answer; rejected credentials and an unreachable network will not mend in a second.
        const retryable =
          error instanceof UpstreamError && (error.status === 429 || error.status >= 500)
        if (!retryable || attempt >= MAX_ATTEMPTS) throw error

        const wait = error.retryAfterMs ?? BACKOFF_MS * 2 ** (attempt - 1)
        if (wait > MAX_RETRY_WAIT_MS) throw error

        await sleep(wait)
      }
    }
  }

  /** Runs `work` over `items` a few at a time rather than all at once. */
  async function mapLimited<In, Out>(
    items: In[],
    limit: number,
    work: (item: In) => Promise<Out>,
  ): Promise<Out[]> {
    const results: Out[] = new Array(items.length)
    let next = 0
    let failed = false

    await Promise.all(
      Array.from({ length: Math.min(limit, items.length) }, async () => {
        // Once one item has failed the run is lost: the other workers finish what they hold and take
        // nothing new, rather than going on to ask TMDB for an answer nobody will read.
        while (!failed && next < items.length) {
          const index = next++
          try {
            results[index] = await work(items[index]!)
          } catch (error) {
            failed = true
            throw error
          }
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
 * `fallback` when TMDB answers 404 ("there is no such season or show"), and
 * the failure itself for anything else (BL-046). A 404 is a definitive answer
 * and costs only that season or show; a failure, once the client has retried,
 * means the expansion is short, and a short list believed to be whole is worse
 * than an error saying so.
 */
export async function orIfNotFound<T>(request: Promise<T>, fallback: T): Promise<T> {
  try {
    return await request
  } catch (error) {
    if (error instanceof UpstreamError && error.status === 404) return fallback

    throw error
  }
}

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
  films: { id: number; title: string; year?: number }[],
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
      ...(film.year ? { year: film.year } : {}),
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
      .map((entry) => ({
        id: entry.id,
        title: entry.title!,
        year: Number(entry.release_date!.slice(0, 4)),
      }))
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

    // No upstream signal for whether this is finished, so no `status` (BL-013).
    expand: itemsOnly(async (externalRef) => {
      const [kind, id] = externalRef.split(':')
      // The id goes straight into the request path: refuse anything but digits, as the other TMDB adapters do.
      if (!id || !/^\d+$/.test(id)) return []

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
    }),
  }
}
