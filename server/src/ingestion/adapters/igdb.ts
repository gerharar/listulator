import { getJson, UnauthorizedError, type FetchLike } from '../http.js'
import type { ListSource, MediaTypeCandidate, SearchAdapter } from '../mediaTypes.js'

/**
 * IGDB: search a franchise or series, expand to its games.
 *
 * Authentication is Twitch's: the client id and secret buy an app access token
 * that lasts about two months, which this fetches on demand and refreshes when
 * it is rejected.
 */

const BASE = 'https://api.igdb.com/v4'
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token'
const MAX_ITEMS = 300

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

export function createIgdbAdapter(
  credentials: IgdbCredentialSource,
  fetchImpl?: FetchLike,
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

    const granted = await getJson<{ access_token?: string; expires_in?: number }>(
      `${TOKEN_URL}?client_id=${encodeURIComponent(clientId)}` +
        `&client_secret=${encodeURIComponent(clientSecret)}&grant_type=client_credentials`,
      { source: 'Twitch', method: 'POST', ...(fetchImpl ? { fetchImpl } : {}) },
    )

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

  /** IGDB takes an Apicalypse query as the POST body. */
  async function query<T>(endpoint: string, apicalypse: string, retrying = false): Promise<T[]> {
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

        return query<T>(endpoint, apicalypse, true)
      }

      throw cause
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

    async expand(externalRef) {
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

      const games = await query<GameResult>(
        'games',
        `fields name,first_release_date,game_type;` +
          ` where ${where} & game_type = ${MAIN_GAME} & first_release_date != null` +
          ` & first_release_date <= ${releasedBy};` +
          ` sort first_release_date asc; limit ${MAX_ITEMS};`,
      )

      const usable = games
        .filter((game) => game.name && !looksLikeAnEdition(game.name))
        .slice(0, MAX_ITEMS)

      if (usable.length === 0) return []

      // One request covers every game, unlike TMDB's runtime-per-film.
      const times = await query<TimeToBeatResult>(
        'game_time_to_beats',
        `fields game_id,${TIME_TO_BEAT}; where game_id = (${usable.map((game) => game.id).join(',')});` +
          ` limit ${MAX_ITEMS};`,
      )

      const minutesByGame = new Map(
        times
          .filter((entry) => entry[TIME_TO_BEAT])
          .map((entry) => [entry.game_id, Math.round(entry[TIME_TO_BEAT]! / 60)]),
      )

      return usable.map((game): MediaTypeCandidate => {
        const minutes = minutesByGame.get(game.id)

        return {
          title: game.name!,
          externalRef: `game:${game.id}`,
          // Not every game has been timed by anyone; those fall back to the
          // category default.
          ...(minutes ? { timeToConsumeMinutes: minutes } : {}),
        }
      })
    },
  }
}
