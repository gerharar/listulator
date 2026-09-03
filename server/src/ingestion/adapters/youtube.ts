import { getJson, type FetchLike } from '../http.js'
import type { ListSource, MediaTypeCandidate, SearchAdapter } from '../mediaTypes.js'

/**
 * YouTube: a playlist, or everything a channel has uploaded.
 *
 * Three ways in, because one alone is not usable: paste a link, type an
 * `@handle`, or search by name. The first two cost about one quota unit; a
 * name search costs a hundred, which is why they are tried in that order.
 *
 * The keyless RSS feeds were checked first and are no good — truncated to 15
 * entries and carrying no durations at all.
 */

const API = 'https://www.googleapis.com/youtube/v3'
const PAGE_SIZE = 50
/** A prolific channel has thousands of uploads; 20 pages is a fair ceiling. */
const MAX_PAGES = 20
const MAX_ITEMS = 1000

interface PlaylistResource {
  id?: string
  snippet?: { title?: string; channelTitle?: string; publishedAt?: string }
  contentDetails?: { itemCount?: number }
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

export function createYouTubeAdapter(
  credentials: YouTubeCredentialSource,
  fetchImpl?: FetchLike,
): SearchAdapter {
  const resolve = (): YouTubeCredentials =>
    typeof credentials === 'function' ? credentials() : credentials

  function request<T>(path: string, params: Record<string, string>): Promise<T> {
    const search = new URLSearchParams({ ...params, key: resolve().apiKey ?? '' })

    return getJson<T>(`${API}/${path}?${search.toString()}`, {
      source: 'YouTube',
      ...(fetchImpl ? { fetchImpl } : {}),
    })
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
    // usually the more useful answer.
    const playlists = await request<{ items?: PlaylistResource[] }>('playlists', {
      part: 'snippet,contentDetails',
      channelId: channel.id,
      maxResults: '10',
    }).catch(() => ({ items: [] }))

    for (const playlist of playlists.items ?? []) {
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

      // Costs 100 quota units against a daily 10,000, so it is the last
      // resort — one call covering both kinds rather than two.
      const response = await request<{ items?: SearchResource[] }>('search', {
        part: 'snippet',
        type: 'channel,playlist',
        maxResults: '10',
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

    async expand(externalRef) {
      const [kind, id] = externalRef.split(':')
      if (!id) return []

      let playlistId = id
      // A channel's uploads live in a playlist of their own, which the API
      // hands over rather than requiring the id be guessed from the channel's.
      let newestFirst = false

      if (kind === 'channel') {
        const response = await request<{ items?: ChannelResource[] }>('channels', {
          part: 'contentDetails',
          id,
        })

        const uploads = response.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
        if (!uploads) return []

        playlistId = uploads
        newestFirst = true
      } else if (kind !== 'playlist') {
        return []
      }

      const videos: { id: string | undefined; title: string }[] = []
      let pageToken: string | undefined

      for (let page = 0; page < MAX_PAGES; page += 1) {
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
        if (!pageToken || videos.length >= MAX_ITEMS) break
      }

      const ordered = newestFirst ? videos.reverse() : videos
      const capped = ordered.slice(0, MAX_ITEMS)

      // Durations need a second call, but fifty ids at a time for one unit.
      const durations = new Map<string, number>()
      const ids = capped.map((video) => video.id).filter((value): value is string => Boolean(value))

      for (let index = 0; index < ids.length; index += PAGE_SIZE) {
        const batch = ids.slice(index, index + PAGE_SIZE)
        const response = await request<VideosResponse>('videos', {
          part: 'contentDetails',
          id: batch.join(','),
        }).catch(() => ({ items: [] }))

        for (const video of response.items ?? []) {
          const minutes = parseIsoDuration(video.contentDetails?.duration)
          if (video.id && minutes) durations.set(video.id, minutes)
        }
      }

      return capped.map((video): MediaTypeCandidate => {
        const minutes = video.id ? durations.get(video.id) : undefined

        return {
          title: video.title,
          // Deleted and private videos have no id and no duration; they fall
          // back to the category default like anything else unknown.
          ...(video.id ? { externalRef: `video:${video.id}` } : {}),
          ...(minutes ? { timeToConsumeMinutes: minutes } : {}),
        }
      })
    },
  }
}
