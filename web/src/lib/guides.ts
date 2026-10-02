import type { KeySource } from './config/keyTest.js'

/**
 * Where the step-by-step guides live: `guides/` in the repo, read on GitHub
 * (rendered Markdown, screenshots inline). English only. The desktop app's
 * opener capability allows `https://github.com/gerharar/listulator/*`, so no
 * capability change is needed for a new guide.
 *
 * A file's name is part of every released app's links: renaming one breaks
 * the "How?" button in the versions already installed.
 */
export const GUIDES_URL = 'https://github.com/gerharar/listulator/blob/main/guides/'

const KEY_GUIDES: Record<KeySource, string> = {
  tmdb: 'tmdb-key.md',
  igdb: 'igdb-key.md',
  comicVine: 'comic-vine-key.md',
  youtube: 'youtube-key.md',
}

/** The guide for getting one source's API key. */
export function keyGuideUrl(source: KeySource): string {
  return `${GUIDES_URL}${KEY_GUIDES[source]}`
}
