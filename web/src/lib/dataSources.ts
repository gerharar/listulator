/**
 * The data sources' facts that are not copy (task 11.21): names and sites
 * (the About page and the list screens' link-backs); plus the author and repository
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
}

/** Fixed order from the design: TMDB last, so its attribution closes the list. */
export const ABOUT_SOURCES: readonly AboutSource[] = [
  { key: 'igdb', name: 'IGDB', url: 'https://www.igdb.com/', host: 'igdb.com' },
  { key: 'musicbrainz', name: 'MusicBrainz', url: 'https://musicbrainz.org/', host: 'musicbrainz.org' },
  { key: 'openLibrary', name: 'Open Library', url: 'https://openlibrary.org/', host: 'openlibrary.org' },
  { key: 'comicVine', name: 'Comic Vine', url: 'https://comicvine.gamespot.com/', host: 'comicvine.gamespot.com' },
  { key: 'youtube', name: 'YouTube', url: 'https://www.youtube.com/', host: 'youtube.com' },
  { key: 'wikipedia', name: 'Wikipedia', url: 'https://www.wikipedia.org/', host: 'wikipedia.org' },
  { key: 'tmdb', name: 'TMDB', url: 'https://www.themoviedb.org/', host: 'themoviedb.org' },
]

/**
 * TMDB's required notice, from its API terms of use (section 3, last updated
 * 2023-10-20). English in every language: it is TMDB's text, not ours.
 */
export const TMDB_NOTICE =
  'This application uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.'

export const AUTHOR = {
  handle: 'gerharar',
  repoUrl: 'https://github.com/gerharar/listulator',
  repoLabel: 'github.com/gerharar/listulator',
} as const

/**
 * The source a fetched list links back to under its add band, by the category's `sourceName`
 * (owner, 2026-09-30: costs nothing, helps them, reminds the reader what Reset goes back to).
 * None for a category without one.
 */
export function linkBackSource(sourceName: string | undefined): AboutSource | undefined {
  return ABOUT_SOURCES.find((source) => source.name === sourceName)
}
