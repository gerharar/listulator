import type { ItemLinkInput } from './itemLink.js'

/**
 * Where an item lives on its source's website (H-002, BL-087): addresses the user's browser opens, never ones the
 * app fetches. Kept apart from the adapters on purpose: the Content-Security-Policy guard reads every `https://`
 * origin written in an adapter as an upstream the window must be allowed to call, and a page address is not that.
 * The desktop opener's own list is what lets these open (`tauriCapabilities.guard.test.ts` checks each one).
 *
 * Each builder takes the stored ref and returns an address built from a validated id on a fixed https host, or
 * undefined; none makes a request. An adapter wires its own as `itemUrl`, so a new category adds its builder here
 * and needs no change to `catalog` or `suggestions`.
 */

type Item = Pick<ItemLinkInput, 'externalRef'>

/** A film's page: from `movie:<id>`, the id all digits. Also the studio adapters' films. */
export function tmdbMovieUrl(item: Item): string | undefined {
  const id = /^movie:(\d+)$/.exec(item.externalRef ?? '')?.[1]
  return id ? `https://www.themoviedb.org/movie/${id}` : undefined
}

/**
 * An episode's page. Episodes carry no ref of their own, so it is derived from the list's own `show:<id>` and the
 * `S01E02` label every episode title starts with: no data change, and lists already imported have it. Rename the
 * item away from the label and the link goes: nothing is guessed.
 */
export function tmdbEpisodeUrl(item: Pick<ItemLinkInput, 'title'>, listExternalRef: string | null): string | undefined {
  const show = /^show:(\d+)$/.exec(listExternalRef ?? '')?.[1]
  const episode = /^S(\d{1,4})E(\d{1,4})(?:\s|$)/.exec(item.title)
  return show && episode ? `https://www.themoviedb.org/tv/${show}/season/${Number(episode[1])}/episode/${Number(episode[2])}` : undefined
}

/**
 * A game's page: IGDB's are `/games/<slug>` (an id is read as a slug: `/games/7346` finds nothing, and `/games/1942` the
 * game whose slug is "1942", checked in a browser 2026-10-14). The slug is the one IGDB gave, cached by ref, and is
 * accepted only as lower-case letters, digits and hyphens, which is the whole of what IGDB's slugs are made of.
 */
export function igdbGameUrl(item: Pick<ItemLinkInput, 'externalRef' | 'slug'>): string | undefined {
  const known = /^game:\d+$/.test(item.externalRef ?? '') && /^[a-z0-9][a-z0-9-]{0,199}$/.test(item.slug ?? '')
  return known ? `https://www.igdb.com/games/${item.slug}` : undefined
}

/** A release group's page: the item's ref is its bare MBID, so only a UUID is accepted. */
export function musicBrainzReleaseGroupUrl(item: Item): string | undefined {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.externalRef ?? '')
    ? `https://musicbrainz.org/release-group/${item.externalRef}`
    : undefined
}

/** A video's page: from `video:<id>`; a deleted or private entry has no ref and so no link. */
export function youTubeVideoUrl(item: Item): string | undefined {
  const id = /^video:([\w-]{11})$/.exec(item.externalRef ?? '')?.[1]
  return id ? `https://www.youtube.com/watch?v=${id}` : undefined
}

/**
 * An issue's page: `/issue/4000-<id>/` (4000 is Comic Vine's type number for an issue; the `/a/4000-<id>/` form
 * 404s, checked in a browser 2026-10-14).
 */
export function comicVineIssueUrl(item: Item): string | undefined {
  const id = /^issue:(\d+)$/.exec(item.externalRef ?? '')?.[1]
  return id ? `https://comicvine.gamespot.com/issue/4000-${id}/` : undefined
}
