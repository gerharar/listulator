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

/**
 * IGDB's `game_type`s a franchise lists: a main game, a remake, a remaster (owner, 2026-10-04: with Main Game only,
 * Final Fantasy VII Remake and Rebirth, the Pixel Remasters and more were missing, BL-056), then an expanded game,
 * a standalone expansion and DLC (owner, after reading the Final Fantasy types file: Zodiac Age and Royal Edition,
 * Episode Duscae, Echoes of the Fallen are things a completionist plays). Ports, bundles, updates, packs, seasons
 * and add-on expansions stay out: the same game again, or not a thing of its own. Every id is IGDB's (`/game_types`).
 */
const MAIN_GAME = 0
const DLC = 1
const STANDALONE_EXPANSION = 4
const REMAKE = 8
const REMASTER = 9
const EXPANDED_GAME = 10
const LISTED_TYPES = [MAIN_GAME, DLC, STANDALONE_EXPANSION, REMAKE, REMASTER, EXPANDED_GAME]
/**
 * What a DLC with no time-to-beat is counted as, in place of the Games default (10 hours, a whole game). Live,
 * 2026-10-04: the 157 of the 500 most-rated DLC that IGDB has a time for take 4 hours at the median (a quarter of
 * them 2 hours or less, a quarter 6 or more). Standalone expansions (median 6 hours) are left on the default.
 */
const DLC_ESTIMATE_MINUTES = 240
const TYPE_LABEL = new Map<number, string>([
  [DLC, 'DLC'],
  [STANDALONE_EXPANSION, 'Standalone Expansion'],
  [REMAKE, 'Remake'],
  [REMASTER, 'Remaster'],
  [EXPANDED_GAME, 'Expanded Game'],
])

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
  /** Every entry IGDB files under it, of every type (not unique games, not platforms). */
  games?: number[]
}

/**
 * A search asks for every record that has a fragment of the query in its name, in pages of IGDB's maximum, then
 * keeps the ones that match once accents, punctuation and "&" are folded away and shows the ten with most entries.
 * Live, 2026-10-04: a three-letter fragment is in at most about 1,100 franchises and series ("the"; "mar" 244,
 * "sta" 337), so four pages hold any fragment and the right record is never cut before the entries are counted.
 */
const SEARCH_CANDIDATE_PAGES = 4
const SEARCH_RESULTS = 10
/**
 * Letters asked for from a query word: its first and its last, so a hyphen near one end ("xmen" is X-Men) leaves the
 * other intact. Measured over the 133 franchises and series IGDB's literal match missed: the front alone finds all
 * but ten ("xmen", "fzero", "rtype", "xcom", "atrain"), front and back all but "yugioh" (Yu-Gi-Oh!).
 */
const FRAGMENT_LENGTH = 3
/** Query words asked for, longest first: a name has them all, so any one that is intact finds it. */
const FRAGMENT_WORDS = 2

interface GameResult {
  id: number
  name?: string
  first_release_date?: number
  game_type?: number
  /** The game a DLC or an expansion belongs to (IGDB game id). */
  parent_game?: number
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
 * A name or a query as plain lowercase words: accents taken off ("Pokémon" is "pokemon"), "&" and the rest of the
 * punctuation and spacing dropped. IGDB matches names literally, so "pokemon", "assassins creed", "pacman" and
 * "dungeons and dragons" find nothing for Pokémon, Assassin's Creed, Pac-Man and Dungeons & Dragons (BL-055).
 */
const foldWords = (text: string): string[] =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)

const releaseYear = (game: GameResult): number | undefined =>
  game.first_release_date ? new Date(game.first_release_date * 1000).getUTCFullYear() : undefined

/**
 * Titles to show. A remake, remaster or expanded game usually shares its name with the original ("Final Fantasy II"
 * is a main game, three remasters and an expanded game), and a list of identical rows looks like a bug. Only a
 * non-main entry whose name is shared by another listed entry gets its type after it ("Final Fantasy II
 * (Remaster)"); two of one type also get the year ("Final Fantasy (Remaster, 2021)"). A main game keeps its own
 * name, and a name no other listed entry has is left alone.
 */
function displayTitles(games: readonly GameResult[]): Map<number, string> {
  const sameName = new Map<string, GameResult[]>()
  for (const game of games) {
    const key = game.name!.toLowerCase()
    sameName.set(key, [...(sameName.get(key) ?? []), game])
  }

  const titles = new Map<number, string>()
  for (const group of sameName.values()) {
    if (group.length < 2) continue

    const typed = group.filter((game) => TYPE_LABEL.has(game.game_type ?? MAIN_GAME))
    for (const game of typed) {
      const label = TYPE_LABEL.get(game.game_type!)!
      const alike = typed.filter((other) => other.game_type === game.game_type)
      const year = releaseYear(game)

      titles.set(game.id, `${game.name} (${alike.length > 1 && year ? `${label}, ${year}` : label})`)
    }
  }

  return titles
}

/**
 * DLC and standalone expansions sit in a group named after the game they belong to, the game in it too, so the
 * group's count is the game plus its add-ons (owner, 2026-10-04). Only where the parent is itself in the list: a
 * DLC whose game is not listed (another franchise's, or a bundle) stays ungrouped. A remake, a remaster and an
 * expanded game are versions of a game, played and ticked apart, and are never grouped. The group follows the
 * parent's chain (a DLC of a standalone expansion goes under the game that has none above it), the add-ons come
 * straight after their game in release order, and two games of one name get their year (then their id) after it,
 * so two groups never merge.
 */
function groupAddOns(games: readonly GameResult[], titles: ReadonlyMap<number, string>): { ordered: GameResult[]; groups: Map<number, string> } {
  const byId = new Map(games.map((game) => [game.id, game]))
  const isAddOn = (game: GameResult) => game.game_type === DLC || game.game_type === STANDALONE_EXPANSION

  // A parent chain is short. One that has not ended in five steps is an upstream loop: those games stay ungrouped.
  const rootOf = (game: GameResult): GameResult => {
    let root = game
    for (let hops = 0; hops < 5; hops += 1) {
      if (!isAddOn(root) || root.parent_game === undefined || !byId.has(root.parent_game)) return root
      root = byId.get(root.parent_game)!
    }

    return game
  }

  const addOns = new Map<number, GameResult[]>()
  for (const game of games) {
    const root = rootOf(game)
    if (root !== game) addOns.set(root.id, [...(addOns.get(root.id) ?? []), game])
  }

  const groups = new Map<number, string>()
  const taken = new Set<string>()
  const ordered: GameResult[] = []
  for (const game of games) {
    const children = addOns.get(game.id)
    if (rootOf(game) !== game) continue

    ordered.push(game)
    if (!children) continue

    const name = titles.get(game.id) ?? game.name!
    const year = releaseYear(game)
    const label = [name, year ? `${name} (${year})` : undefined, `${name} (${game.id})`].find((candidate) => candidate && !taken.has(candidate.toLowerCase()))!
    taken.add(label.toLowerCase())
    for (const member of [game, ...children]) groups.set(member.id, label)
    ordered.push(...children)
  }

  return { ordered, groups }
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

  return {
    isAvailable: () => {
      const { clientId, clientSecret } = resolve()

      return Boolean(clientId && clientSecret)
    },

    async search(rawQuery) {
      // "and" is left out of the query and of every name it is compared with: a name may spell it "&" or leave it
      // out of what people type ("ratchet clank" is Ratchet & Clank, "dungeons dragons" Dungeons & Dragons).
      const words = foldWords(rawQuery).filter((word) => word !== 'and')
      const key = words.join('')
      if (!key) return []

      // IGDB cannot match across an accent or a punctuation mark, so it is asked for the ends of the longest words
      // (any one fragment being intact is enough to find the name) and the match itself is made here, on folded
      // names.
      const longest = [...words].sort((a, b) => b.length - a.length).slice(0, FRAGMENT_WORDS)
      const fragments = new Set(
        longest.flatMap((word) => [word.slice(0, FRAGMENT_LENGTH), word.slice(-FRAGMENT_LENGTH)]),
      )
      const where = `(${[...fragments].map((fragment) => `name ~ *"${fragment}"*`).join(' | ')})`

      const candidates = async (endpoint: 'franchises' | 'collections'): Promise<NamedResult[]> => {
        const found: NamedResult[] = []
        for (let page = 0; page < SEARCH_CANDIDATE_PAGES; page += 1) {
          const batch = await query<NamedResult>(
            endpoint,
            `fields name,games; where ${where}; sort id asc; limit ${PAGE_SIZE}; offset ${page * PAGE_SIZE};`,
          )
          found.push(...batch)
          if (batch.length < PAGE_SIZE) break
        }

        return found.filter((entry) => foldWords(entry.name).filter((word) => word !== 'and').join('').includes(key))
      }

      // Franchises are the unit that matches "all the X games". Series
      // (IGDB's "collections") are narrower and fragmented — "Assassin's
      // Creed II" is its own series — but they are how some sets are
      // grouped, so both are offered.
      const [franchises, series] = await Promise.all([candidates('franchises'), candidates('collections')])

      // Most entries first, franchises and series together: the big, well-kept record is nearly always the one
      // wanted, and the fan games and single-title series that match the same words sink (BL-055: "assassin"
      // showed six others and not Assassin's Creed; "final fantasy" not Final Fantasy). A tie goes by name, so
      // the order never changes between searches; equal names keep franchise before series.
      const entries = (entry: NamedResult) => entry.games?.length ?? 0
      const found = [
        ...franchises.map((entry) => ({
          entry,
          source: { externalRef: `franchise:${entry.id}`, title: `${entry.name} — games`, detail: 'Franchise' } satisfies ListSource,
        })),
        ...series.map((entry) => ({
          entry,
          source: { externalRef: `collection:${entry.id}`, title: entry.name, detail: 'Series' } satisfies ListSource,
        })),
      ]

      return found
        .sort((a, b) => entries(b.entry) - entries(a.entry) || a.entry.name.localeCompare(b.entry.name))
        .slice(0, SEARCH_RESULTS)
        .map(({ source }): ListSource => source)
    },

    // No upstream signal for whether this is finished, so no `status` (BL-013).
    expand: itemsOnly(async (externalRef) => {
      const [kind, id] = externalRef.split(':')
      if (!id || !/^\d+$/.test(id)) return []

      const where =
        kind === 'franchise'
          ? `franchises = (${id})`
          : kind === 'collection'
            ? // `collections` (plural): IGDB retired the single `collection` field, which now finds no game for any series.
              `collections = (${id})`
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
          `fields name,first_release_date,game_type,parent_game,platforms;` +
            ` where ${where} & game_type = (${LISTED_TYPES.join(',')}) & first_release_date != null` +
            ` & first_release_date <= ${releasedBy};` +
            ` sort id asc; limit ${PAGE_SIZE}; offset ${offset};`,
        )

        // A deluxe or collector's edition filed as a main game is the duplicate the filter is for; a remake or
        // remaster whose name ends in "Edition" ("Pocket Edition", "20th Anniversary Edition") is not.
        usable.push(
          ...page.filter(
            (game) => game.name && !((game.game_type ?? MAIN_GAME) === MAIN_GAME && looksLikeAnEdition(game.name)),
          ),
        )
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

      const titles = displayTitles(usable)
      const { ordered, groups } = groupAddOns(usable, titles)

      return ordered.map((game): MediaTypeCandidate => {
        const minutes = minutesByGame.get(game.id)
        // Unix seconds, UTC — a Jan-1 release must not flip to the prior
        // year just because this process runs in a negative-offset zone.
        const year = game.first_release_date
          ? new Date(game.first_release_date * 1000).getUTCFullYear()
          : undefined

        const tags = platformTags(game.platforms)

        return {
          title: titles.get(game.id) ?? game.name!,
          externalRef: `game:${game.id}`,
          ...(groups.has(game.id) ? { group: groups.get(game.id)! } : {}),
          ...(tags ? { tags } : {}),
          // Not every game has been timed by anyone; those fall back to the
          // category default.
          ...(minutes ? { timeToConsumeMinutes: minutes } : {}),
          ...(!minutes && game.game_type === DLC ? { estimatedMinutes: DLC_ESTIMATE_MINUTES } : {}),
          ...(year ? { year } : {}),
        }
      })
    }),
  }
}
