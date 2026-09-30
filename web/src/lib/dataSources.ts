/**
 * The data sources' facts that are not copy (task 11.21): names, sites, and
 * whether a list screen links back to them; plus the author and repository
 * for the About page. Names and hosts are the same in every language, so they
 * stay out of the locale files; what each source is used for is copy
 * (`copy.quantum.about.powers`).
 */
export interface AboutSource {
  /** Key into `copy.quantum.about.powers`. */
  key: 'igdb' | 'musicbrainz' | 'openLibrary' | 'comicVine' | 'youtube' | 'wikipedia' | 'tmdb'
  name: string
  url: string
  host: string
  /**
   * A list that arrived from this source says so under its add band, with a link (owner,
   * 2026-09-30: costs nothing, helps them, reminds the reader what Reset goes back to).
   * `name` matches the category's `sourceName`.
   */
  linkBack: boolean
}

/** Fixed order from the design: TMDB last, so its attribution closes the list. */
export const ABOUT_SOURCES: readonly AboutSource[] = [
  { key: 'igdb', name: 'IGDB', url: 'https://www.igdb.com/', host: 'igdb.com', linkBack: true },
  { key: 'musicbrainz', name: 'MusicBrainz', url: 'https://musicbrainz.org/', host: 'musicbrainz.org', linkBack: true },
  { key: 'openLibrary', name: 'Open Library', url: 'https://openlibrary.org/', host: 'openlibrary.org', linkBack: true },
  { key: 'comicVine', name: 'Comic Vine', url: 'https://comicvine.gamespot.com/', host: 'comicvine.gamespot.com', linkBack: true },
  { key: 'youtube', name: 'YouTube', url: 'https://www.youtube.com/', host: 'youtube.com', linkBack: false },
  { key: 'wikipedia', name: 'Wikipedia', url: 'https://www.wikipedia.org/', host: 'wikipedia.org', linkBack: true },
  { key: 'tmdb', name: 'TMDB', url: 'https://www.themoviedb.org/', host: 'themoviedb.org', linkBack: true },
]

/**
 * TMDB's required notice, from its API terms of use (section 3, last updated
 * 2023-10-20). English in every language: it is TMDB's text, not ours.
 */
export const TMDB_NOTICE =
  'This application uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.'

export const AUTHOR = {
  handle: 'gerharar',
  repoUrl: 'https://github.com/neuroshaoh/listulator',
  repoLabel: 'github.com/neuroshaoh/listulator',
} as const

/** The source a list screen links back to, by the category's `sourceName`; none for YouTube or a category without one. */
export function linkBackSource(sourceName: string | undefined): AboutSource | undefined {
  return ABOUT_SOURCES.find((source) => source.linkBack && source.name === sourceName)
}
