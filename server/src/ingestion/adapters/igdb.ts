import { delay, getJson, UnauthorizedError, UpstreamError, type FetchLike } from '../http.js'
import type { ListSource, MediaTypeCandidate, SearchAdapter } from '../mediaTypes.js'
import { itemsOnly } from '../expansion.js'
import { MAX_LIST_ITEMS } from '../../catalog/limits.js'
import { createPacer, type RateLimiter } from '../rateLimiter.js'
import { MAX_ITEM_TAGS } from '../../catalog/facets.js'
import { igdbPlatformCode, PLATFORM_ORDER, platformKey } from '../../catalog/platforms.js'

/**
 * IGDB: search a franchise or series, expand to its games.
 *
 * Authentication is Twitch's: the client id and secret buy an app access token
 * that lasts about two months, which this fetches on demand and refreshes when
 * it is rejected.
 */

const BASE = 'https://api.igdb.com/v4'
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token'

/**
 * IGDB's own ceiling on one query (`limit`): asked for 501 it answers **403**, which this code would read as
 * rejected credentials (live, 2026-10-04). A franchise is listed in pages of this size; there is no cap of
 * ours (Disney has 400 released main games and Mario 319, and a cap of 300 dropped the newest).
 */
const PAGE_SIZE = 500

/**
 * IGDB publishes four requests a second. A burst of sixteen was not refused live, so this is the documented
 * budget kept, not a measured wall. One limiter for the whole process, spaced as a pacer (requests overlap,
 * only the starts are spaced), as TMDB's is (15.9).
 */
export const igdbRequestLimiter: RateLimiter = createPacer(250)

/** A request is tried this many times in all, as TMDB's is (15.1): a 429 or a 5xx passes, a 400 does not. */
const MAX_ATTEMPTS = 3
const BACKOFF_MS = 500
/** A `Retry-After` longer than this is not waited out: the request fails and says so. */
const MAX_RETRY_WAIT_MS = 10_000

/** IGDB's `game_type`. Main Game only — see the filtering note in `expand`. */
const MAIN_GAME = 0

/**
 * "Normally" is the main story plus a little else. `hastily` is a speedrun and
 * `completely` is 100% — and while this is a completionist tracker, what is
 * being completed is the *list*, not every optional collectible in every game.
 */
type TimeToBeatField = 'normally' | 'hastily' | 'completely'
const TIME_TO_BEAT: TimeToBeatField = 'normally'

interface NamedResult {
  id: number
  name: string
}

interface GameResult {
  id: number
  name?: string
  first_release_date?: number
  game_type?: number
  /** IGDB platform ids. */
  platforms?: number[]
}

interface TimeToBeatResult {
  game_id: number
  normally?: number
  hastily?: number
  completely?: number
}

export interface IgdbCredentials {
  clientId?: string | undefined
  clientSecret?: string | undefined
}

/** Resolved per call, so `.env` loading order cannot leave this holding stale values. */
export type IgdbCredentialSource = IgdbCredentials | (() => IgdbCredentials)

/**
 * Editions of a game are filed as separate main games — "Assassin's Creed II"
 * also appears as White, Black and Master Assassin's Edition, and Revelations
 * as "- Signature Edition". Dropping names that trail off into "… Edition"
 * after a colon or dash removes the obvious duplicates without touching titles
 * that merely contain the word.
 *
 * Deliberately narrow: an unwanted item is one click to delete, while a
 * wrongly-dropped one has to be noticed and typed back in by hand.
 */
function looksLikeAnEdition(name: string): boolean {
  return /[-:]\s.*\bedition\b\s*$/i.test(name)
}

/**
 * A game's `tags`: its platforms as the owner's codes (`config/platforms.csv`,
 * 10.24c), found by IGDB platform id, in the table's order. A platform the
 * table does not list (IGDB added it later) is left out, not guessed:
 * `npm run platforms:check -w server` reports it so the owner can add a row.
 * No tags at all when none is known — an untagged game is honest.
 */
export function platformTags(
  platforms: readonly number[] | undefined,
): string[] | undefined {
  const found = new Map<string, string>()

  for (const platform of platforms ?? []) {
    const code = igdbPlatformCode(platform)
    if (!code) continue
    const key = platformKey(code)
    if (!found.has(key)) found.set(key, code)
  }

  if (found.size === 0) return undefined

  const rank = (key: string) => {
    const index = PLATFORM_ORDER.indexOf(key)

    return index < 0 ? PLATFORM_ORDER.length : index
  }

  return [...found.entries()].sort(([a], [b]) => rank(a) - rank(b)).map(([, code]) => code).slice(0, MAX_ITEM_TAGS)
}

export interface IgdbClientOptions {
  /** Injectable so the waits are testable without real waiting. */
  sleep?: (ms: number) => Promise<void>
  /**
   * Every request to IGDB's data, each retry included, goes through this. Default: the shared
   * `igdbRequestLimiter` for the real IGDB, none for a fake `fetch` (a test is not slowed by it).
   */
  limiter?: RateLimiter
}

export function createIgdbAdapter(
  credentials: IgdbCredentialSource,
  fetchImpl?: FetchLike,
  { sleep = delay, limiter = fetchImpl ? undefined : igdbRequestLimiter }: IgdbClientOptions = {},
): SearchAdapter {
  const resolve = (): IgdbCredentials =>
    typeof credentials === 'function' ? credentials() : credentials

  let token: string | undefined
  let tokenExpiresAt = 0
  /** Shared so concurrent callers join one fetch instead of racing. */
  let inFlight: Promise<string> | undefined

  async function fetchToken(): Promise<string> {
    const { clientId, clientSecret } = resolve()
    if (!clientId || !clientSecret) throw new UnauthorizedError('IGDB credentials are not set.')

    // The secret travels in the body, not the URL: a URL is what gets logged and kept (Twitch accepts both).
    const granted = await getJson<{ access_token?: string; expires_in?: number }>(TOKEN_URL, {
      source: 'Twitch',
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }).toString(),
      ...(fetchImpl ? { fetchImpl } : {}),
    })

    if (!granted.access_token) throw new UnauthorizedError('Twitch would not issue a token.')

    token = granted.access_token
    // A minute of margin, so a token cannot expire mid-request.
    tokenExpiresAt = Date.now() + Math.max(0, (granted.expires_in ?? 3600) - 60) * 1000

    return token
  }

  /**
   * A search fires two queries at once, so without sharing the in-flight
   * request each would fetch its own token — two on the first call, and two
   * more when an expired one is refreshed. Joining whichever fetch is already
   * running keeps it to one either way.
   */
  async function accessToken(force = false): Promise<string> {
    if (!force && token && Date.now() < tokenExpiresAt) return token
    if (inFlight) return inFlight

    inFlight = fetchToken().finally(() => {
      inFlight = undefined
    })

    return inFlight
  }

  /** IGDB takes an Apicalypse query as the POST body. One try, with the token refresh below. */
  async function queryOnce<T>(endpoint: string, apicalypse: string, retrying = false): Promise<T[]> {
    const { clientId } = resolve()

    try {
      return await getJson<T[]>(`${BASE}/${endpoint}`, {
        source: 'IGDB',
        method: 'POST',
        body: apicalypse,
        headers: {
          'client-id': clientId ?? '',
          authorization: `Bearer ${await accessToken()}`,
        },
        ...(fetchImpl ? { fetchImpl } : {}),
      })
    } catch (cause) {
      // Tokens last ~60 days, so expiry happens long after this process
      // started and looks exactly like broken credentials. Try once with a
      // fresh one before giving up.
      if (cause instanceof UnauthorizedError && !retrying) {
        await accessToken(true)

        return queryOnce<T>(endpoint, apicalypse, true)
      }

      throw cause
    }
  }

  /**
   * The upstream saying "slow down" or "I am broken" is worth another go; a 400 is an answer, and rejected
   * credentials or an unreachable network will not mend in a second. A listing that lost a page to one glitch
   * is worse than one that waited a second (15.1).
   */
  async function query<T>(endpoint: string, apicalypse: string): Promise<T[]> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await (limiter ? limiter.run(() => queryOnce<T>(endpoint, apicalypse)) : queryOnce<T>(endpoint, apicalypse))
      } catch (error) {
        const retryable = error instanceof UpstreamError && (error.status === 429 || error.status >= 500)
        if (!retryable || attempt >= MAX_ATTEMPTS) throw error

        const wait = error.retryAfterMs ?? BACKOFF_MS * 2 ** (attempt - 1)
        if (wait > MAX_RETRY_WAIT_MS) throw error

        await sleep(wait)
      }
    }
  }

  function escape(value: string): string {
    return value.replace(/["\\]/g, '')
  }

  return {
    isAvailable: () => {
      const { clientId, clientSecret } = resolve()

      return Boolean(clientId && clientSecret)
    },

    async search(rawQuery) {
      const term = escape(rawQuery)

      // Franchises are the unit that matches "all the X games". Series
      // (IGDB's "collections") are narrower and fragmented — "Assassin's
      // Creed II" is its own series — but they are how some sets are
      // grouped, so both are offered.
      const [franchises, series] = await Promise.all([
        query<NamedResult>('franchises', `fields name; where name ~ *"${term}"*; limit 6;`),
        query<NamedResult>('collections', `fields name; where name ~ *"${term}"*; limit 6;`),
      ])

      return [
        ...franchises.map(
          (entry): ListSource => ({
            externalRef: `franchise:${entry.id}`,
            title: `${entry.name} — games`,
            detail: 'Franchise',
          }),
        ),
        ...series.map(
          (entry): ListSource => ({
            externalRef: `collection:${entry.id}`,
            title: entry.name,
            detail: 'Series',
          }),
        ),
      ]
    },

    // No upstream signal for whether this is finished, so no `status` (BL-013).
    expand: itemsOnly(async (externalRef) => {
      const [kind, id] = externalRef.split(':')
      if (!id || !/^\d+$/.test(id)) return []

      const where =
        kind === 'franchise'
          ? `franchises = (${id})`
          : kind === 'collection'
            ? `collection = ${id}`
            : null

      if (!where) return []

      // Released games only. IGDB lists announced and cancelled titles —
      // Codename Hexe, Codename Invictus — and a list of things nobody can
      // play yet is not one that can be finished.
      const releasedBy = Math.floor(Date.now() / 1000)

      // Pages of IGDB's maximum, by id (unique), so a page never repeats or skips a game that shares a release
      // date; the list is put oldest first here. Past the ceiling it stops asking and hands back what it has:
      // the shared check refuses a list that large, loudly, rather than this cutting it short.
      const usable: GameResult[] = []
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const page = await query<GameResult>(
          'games',
          `fields name,first_release_date,game_type,platforms;` +
            ` where ${where} & game_type = ${MAIN_GAME} & first_release_date != null` +
            ` & first_release_date <= ${releasedBy};` +
            ` sort id asc; limit ${PAGE_SIZE}; offset ${offset};`,
        )

        usable.push(...page.filter((game) => game.name && !looksLikeAnEdition(game.name)))
        if (page.length < PAGE_SIZE || usable.length > MAX_LIST_ITEMS) break
      }

      // Oldest first; games sharing a day keep the id order the pages came in (the sort is stable).
      usable.sort((a, b) => (a.first_release_date ?? 0) - (b.first_release_date ?? 0))

      if (usable.length === 0) return []

      // Batched: one request covers up to a page of games, unlike TMDB's runtime-per-film, so there is nothing
      // to look up afterwards (no `enrich`): a listing here is its lengths too.
      const batches: GameResult[][] = []
      for (let start = 0; start < usable.length; start += PAGE_SIZE) batches.push(usable.slice(start, start + PAGE_SIZE))
      const times = (
        await Promise.all(
          batches.map((batch) =>
            query<TimeToBeatResult>(
              'game_time_to_beats',
              `fields game_id,${TIME_TO_BEAT}; where game_id = (${batch.map((game) => game.id).join(',')});` +
                ` limit ${PAGE_SIZE};`,
            ),
          ),
        )
      ).flat()

      const minutesByGame = new Map(
        times
          .filter((entry) => entry[TIME_TO_BEAT])
          .map((entry) => [entry.game_id, Math.round(entry[TIME_TO_BEAT]! / 60)]),
      )

      return usable.map((game): MediaTypeCandidate => {
        const minutes = minutesByGame.get(game.id)
        // Unix seconds, UTC — a Jan-1 release must not flip to the prior
        // year just because this process runs in a negative-offset zone.
        const year = game.first_release_date
          ? new Date(game.first_release_date * 1000).getUTCFullYear()
          : undefined

        const tags = platformTags(game.platforms)

        return {
          title: game.name!,
          externalRef: `game:${game.id}`,
          ...(tags ? { tags } : {}),
          // Not every game has been timed by anyone; those fall back to the
          // category default.
          ...(minutes ? { timeToConsumeMinutes: minutes } : {}),
          ...(year ? { year } : {}),
        }
      })
    }),
  }
}
