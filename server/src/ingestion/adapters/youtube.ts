import { MAX_LIST_ITEMS } from '../../catalog/limits.js'
import { delay, getJson, withRetries, type FetchLike } from '../http.js'
import type { ListSource, MediaTypeCandidate, SearchAdapter } from '../mediaTypes.js'
import { itemsOnly } from '../expansion.js'

/**
 * YouTube: a playlist, or everything a channel has uploaded.
 *
 * Three ways in, because one alone is not usable: paste a link, type an
 * `@handle`, or search by name. The first two cost about one quota unit; a
 * name search is the scarce call, which is why they are tried in that order:
 * Google's current quota page gives `search.list` a bucket of its own, 100 calls
 * a day at 1 unit each (older documentation said 100 units of the 10,000, the
 * same hundred a day). Not observable from the API; check the key's quotas in the Cloud Console.
 *
 * The keyless RSS feeds were checked first and are no good — truncated to 15
 * entries and carrying no durations at all.
 */

const API = 'https://www.googleapis.com/youtube/v3'
/** The API's own ceiling for `maxResults` on playlist items, and for the ids one `videos` call takes. */
const PAGE_SIZE = 50
/**
 * A channel's playlists offered in a search: two pages. Listing is one unit a page, so the cost that matters is the
 * count each row then asks for (one unit apiece): a hundred rows are about 1% of the day's 10,000, and a channel
 * past that (rare) loses its tail, so refine by pasting the playlist's own link. BL-058; DECISIONS 2026-10-04.
 */
const MAX_CHANNEL_PLAYLISTS = 100
/**
 * A name search is one of the day's 100 `search.list` calls however many results it asks for, and 50 is the most a
 * call gives, so it asks for all of them. A second page would spend another of the hundred: not offered.
 */
const NAME_SEARCH_RESULTS = 50
/**
 * Lengths are asked for this many batches at a time: a channel of 10,000 uploads is 200 batches, about a minute
 * one after another. YouTube publishes a daily quota (10,000 units, a batch is one) and no rate per second, so
 * there is no pacer here, only a modest overlap.
 */
const DURATION_BATCHES_AT_ONCE = 5

interface PlaylistResource {
  id?: string
  snippet?: { title?: string; channelTitle?: string; publishedAt?: string }
  contentDetails?: { itemCount?: number }
}

interface PlaylistsResponse {
  nextPageToken?: string
  items?: PlaylistResource[]
}

interface ChannelResource {
  id?: string
  snippet?: { title?: string; customUrl?: string }
  contentDetails?: { relatedPlaylists?: { uploads?: string } }
}

interface SearchResource {
  id?: { kind?: string; channelId?: string; playlistId?: string }
  snippet?: { title?: string; channelTitle?: string }
}

interface PlaylistItemsResponse {
  nextPageToken?: string
  /** `totalResults` is the playlist's whole length, whatever the page size. */
  pageInfo?: { totalResults?: number }
  items?: {
    snippet?: { title?: string; resourceId?: { videoId?: string } }
  }[]
}

interface VideosResponse {
  items?: { id?: string; contentDetails?: { duration?: string } }[]
}

/** `PT1H2M13S` → minutes, rounded up so nothing reads as zero. */
export function parseIsoDuration(value: string | undefined): number | undefined {
  if (!value) return undefined

  const match = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value)
  if (!match) return undefined

  const [, days, hours, minutes, seconds] = match
  const total =
    Number(days ?? 0) * 1440 + Number(hours ?? 0) * 60 + Number(minutes ?? 0) + Number(seconds ?? 0) / 60

  // Live streams come back as P0D; treat that as unknown rather than zero.
  return total > 0 ? Math.max(1, Math.round(total)) : undefined
}

/** Pulls a playlist id, channel id or handle out of whatever was typed. */
export function parseYouTubeInput(
  raw: string,
): { kind: 'playlist' | 'channel' | 'handle' | 'query'; value: string } {
  const input = raw.trim()

  if (/^https?:\/\//i.test(input)) {
    try {
      const url = new URL(input)
      const list = url.searchParams.get('list')
      if (list) return { kind: 'playlist', value: list }

      const path = url.pathname
      const channel = /^\/channel\/(UC[\w-]+)/.exec(path)
      if (channel) return { kind: 'channel', value: channel[1]! }

      const handle = /^\/@([\w.-]+)/.exec(path)
      if (handle) return { kind: 'handle', value: `@${handle[1]}` }

      // /c/name and /user/name are legacy forms with no direct lookup; the
      // name is still the best search term available.
      const legacy = /^\/(?:c|user)\/([\w.-]+)/.exec(path)
      if (legacy) return { kind: 'query', value: legacy[1]! }
    } catch {
      // Not a usable URL; fall through and treat it as a search.
    }
  }

  if (input.startsWith('@')) return { kind: 'handle', value: input }
  if (/^PL[\w-]{10,}$/.test(input)) return { kind: 'playlist', value: input }
  if (/^UC[\w-]{20,}$/.test(input)) return { kind: 'channel', value: input }

  return { kind: 'query', value: input }
}

export interface YouTubeCredentials {
  apiKey?: string | undefined
}

export type YouTubeCredentialSource = YouTubeCredentials | (() => YouTubeCredentials)

export interface YouTubeClientOptions {
  /** Injectable so the waits are testable without real waiting. */
  sleep?: (ms: number) => Promise<void>
}

export function createYouTubeAdapter(
  credentials: YouTubeCredentialSource,
  fetchImpl?: FetchLike,
  { sleep = delay }: YouTubeClientOptions = {},
): SearchAdapter {
  const resolve = (): YouTubeCredentials =>
    typeof credentials === 'function' ? credentials() : credentials

  /**
   * The upstream saying "slow down" or "I am broken" is worth another go; a 400 (a bad key or request), rejected
   * credentials, an unreachable network and a spent daily quota (a 403) will not mend in a second. A listing that
   * lost a page to one glitch is worse than one that waited a second (15.1).
   */
  async function request<T>(path: string, params: Record<string, string>): Promise<T> {
    const search = new URLSearchParams({ ...params, key: resolve().apiKey ?? '' })

    return withRetries(
      () =>
        getJson<T>(`${API}/${path}?${search.toString()}`, {
          source: 'YouTube',
          ...(fetchImpl ? { fetchImpl } : {}),
        }),
      sleep,
    )
  }

  /** A channel, offered as its uploads plus whatever playlists it keeps. */
  async function sourcesForChannel(channel: ChannelResource): Promise<ListSource[]> {
    if (!channel.id) return []

    const name = channel.snippet?.title ?? channel.id
    const sources: ListSource[] = [
      {
        externalRef: `channel:${channel.id}`,
        title: `${name} — every upload`,
        detail: ['Channel', channel.snippet?.customUrl].filter(Boolean).join(' · '),
      },
    ]

    // Most channels meant to be watched through keep playlists, so these are
    // usually the more useful answer. A failure here (any page) fails the search: offering the uploads alone, or the
    // first fifty, would read as a channel with no more playlists.
    const playlists: PlaylistResource[] = []
    let pageToken: string | undefined

    do {
      const page: PlaylistsResponse = await request<PlaylistsResponse>('playlists', {
        part: 'snippet,contentDetails',
        channelId: channel.id,
        maxResults: String(PAGE_SIZE),
        ...(pageToken ? { pageToken } : {}),
      })

      playlists.push(...(page.items ?? []))
      pageToken = page.nextPageToken
    } while (pageToken && playlists.length < MAX_CHANNEL_PLAYLISTS)

    for (const playlist of playlists.slice(0, MAX_CHANNEL_PLAYLISTS)) {
      if (!playlist.id) continue
      sources.push({
        externalRef: `playlist:${playlist.id}`,
        title: playlist.snippet?.title ?? playlist.id,
        detail: ['Playlist', name, `${playlist.contentDetails?.itemCount ?? '?'} videos`]
          .filter(Boolean)
          .join(' · '),
      })
    }

    return sources
  }

  /**
   * The playlist a ref lists, and whether it arrives newest first. A channel's uploads live in a playlist of
   * their own, which the API hands over rather than requiring the id be guessed from the channel's.
   */
  async function playlistFor(externalRef: string): Promise<{ playlistId: string; newestFirst: boolean } | undefined> {
    const [kind, id] = externalRef.split(':')
    if (!id) return undefined

    if (kind === 'playlist') return { playlistId: id, newestFirst: false }
    if (kind !== 'channel') return undefined

    const response = await request<{ items?: ChannelResource[] }>('channels', {
      part: 'contentDetails',
      id,
    })

    const uploads = response.items?.[0]?.contentDetails?.relatedPlaylists?.uploads

    return uploads ? { playlistId: uploads, newestFirst: true } : undefined
  }

  return {
    isAvailable: () => Boolean(resolve().apiKey),

    async search(query) {
      const input = parseYouTubeInput(query)

      if (input.kind === 'playlist') {
        const response = await request<{ items?: PlaylistResource[] }>('playlists', {
          part: 'snippet,contentDetails',
          id: input.value,
        })

        return (response.items ?? []).map(
          (playlist): ListSource => ({
            externalRef: `playlist:${playlist.id}`,
            title: playlist.snippet?.title ?? input.value,
            detail: ['Playlist', playlist.snippet?.channelTitle, `${playlist.contentDetails?.itemCount ?? '?'} videos`]
              .filter(Boolean)
              .join(' · '),
          }),
        )
      }

      if (input.kind === 'channel' || input.kind === 'handle') {
        const response = await request<{ items?: ChannelResource[] }>('channels', {
          part: 'snippet,contentDetails',
          ...(input.kind === 'handle'
            ? { forHandle: input.value }
            : { id: input.value }),
        })

        const channel = response.items?.[0]

        return channel ? sourcesForChannel(channel) : []
      }

      // One of the day's 100 searches (its own quota bucket), so it is the last
      // resort — one call covering both kinds rather than two.
      const response = await request<{ items?: SearchResource[] }>('search', {
        part: 'snippet',
        type: 'channel,playlist',
        maxResults: String(NAME_SEARCH_RESULTS),
        q: input.value,
      })

      return (response.items ?? []).flatMap((result): ListSource[] => {
        if (result.id?.playlistId) {
          return [
            {
              externalRef: `playlist:${result.id.playlistId}`,
              title: result.snippet?.title ?? result.id.playlistId,
              detail: ['Playlist', result.snippet?.channelTitle].filter(Boolean).join(' · '),
            },
          ]
        }

        if (result.id?.channelId) {
          return [
            {
              externalRef: `channel:${result.id.channelId}`,
              title: `${result.snippet?.title ?? result.id.channelId} — every upload`,
              detail: 'Channel',
            },
          ]
        }

        return []
      })
    },

    // How many videos `expand` would list, from the playlist's own total: a request or two, where listing a
    // channel of 6,000 uploads is 250 (the Search tab counts every result it shows). `totalResults` equals what
    // the listing finds (6,184 and 6,184 live), deleted and private entries included, as the listing keeps them.
    count: async (externalRef) => {
      const source = await playlistFor(externalRef)
      if (!source) return undefined

      const response = await request<PlaylistItemsResponse>('playlistItems', {
        part: 'id',
        playlistId: source.playlistId,
        // A full page, not one entry: a mix (`RD...`) reports the size of the page it was asked for as its
        // total (1 asked, 1 counted; live), and a page costs the same one unit.
        maxResults: String(PAGE_SIZE),
      })

      return response.pageInfo?.totalResults
    },

    // No upstream signal for whether this is finished, so no `status` (BL-013).
    expand: itemsOnly(async (externalRef) => {
      const source = await playlistFor(externalRef)
      if (!source) return []

      const { playlistId, newestFirst } = source

      const videos: { id: string | undefined; title: string }[] = []
      let pageToken: string | undefined

      // No cap of ours: a channel's newest-first uploads are reversed below, so cutting early would drop the
      // oldest, the first thing a completionist wants. Paging stops at the end, or once past what a list can
      // hold, when the shared size check refuses the list and a longer one would only cost quota (a page is one unit).
      for (;;) {
        const response: PlaylistItemsResponse = await request('playlistItems', {
          part: 'snippet',
          playlistId,
          maxResults: String(PAGE_SIZE),
          ...(pageToken ? { pageToken } : {}),
        })

        for (const item of response.items ?? []) {
          // Deleted and private entries are kept deliberately: something was
          // there, which is worth seeing, and a private video may be published
          // later and picked up by a refresh.
          videos.push({
            id: item.snippet?.resourceId?.videoId,
            title: item.snippet?.title ?? 'Untitled',
          })
        }

        pageToken = response.nextPageToken
        if (!pageToken || videos.length > MAX_LIST_ITEMS) break
      }

      const ordered = newestFirst ? videos.reverse() : videos

      // Durations need a second call, but fifty ids at a time for one unit. A list past the ceiling is refused
      // by the caller, so its lengths are not worth the quota.
      const durations = new Map<string, number>()
      const ids = ordered.map((video) => video.id).filter((value): value is string => Boolean(value))
      const batches: string[][] = []

      if (ordered.length <= MAX_LIST_ITEMS) {
        for (let index = 0; index < ids.length; index += PAGE_SIZE) batches.push(ids.slice(index, index + PAGE_SIZE))
      }

      // A failed batch fails the listing: swallowed, it turned fifty videos into placeholder lengths unnoticed.
      for (let index = 0; index < batches.length; index += DURATION_BATCHES_AT_ONCE) {
        const answers = await Promise.all(
          batches.slice(index, index + DURATION_BATCHES_AT_ONCE).map((batch) =>
            request<VideosResponse>('videos', { part: 'contentDetails', id: batch.join(',') }),
          ),
        )

        for (const response of answers) {
          for (const video of response.items ?? []) {
            const minutes = parseIsoDuration(video.contentDetails?.duration)
            if (video.id && minutes) durations.set(video.id, minutes)
          }
        }
      }

      return ordered.map((video): MediaTypeCandidate => {
        const minutes = video.id ? durations.get(video.id) : undefined

        return {
          title: video.title,
          // Deleted and private videos have no id and no duration; they fall
          // back to the category default like anything else unknown.
          ...(video.id ? { externalRef: `video:${video.id}` } : {}),
          ...(minutes ? { timeToConsumeMinutes: minutes } : {}),
        }
      })
    }),
  }
}
