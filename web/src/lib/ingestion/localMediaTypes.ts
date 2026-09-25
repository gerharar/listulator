// The standalone app's real media-type registry (task 5.7) — the counterpart
// to server/src/ingestion/mediaTypes.ts's DEFAULT_MEDIA_TYPES, built from
// Tauri-stored settings instead of `.env` and routing three providers
// through the Tauri HTTP plugin per task 5.3's CORS findings.
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { createDefaultMediaTypes, type MediaType } from '../../../../server/src/ingestion/mediaTypes.js'
import { getLocalSettings } from '../config/localConfig.js'
import { credentialsFor, type KeyFetchers } from '../config/keyTest.js'

/**
 * Async-refresh-then-sync-read: settings are read from the Tauri store once,
 * on the first call, and the resulting registry (with credential functions
 * closing over that one snapshot) is cached for the app's lifetime after
 * that — until Settings saves a key and calls `resetLocalMediaTypes()`, which
 * drops the cache so the next call reads the new keys (task 10.31; task 5.7
 * had accepted "next launch" only because no settings UI existed yet).
 */
let cached: readonly MediaType[] | undefined
let pending: Promise<readonly MediaType[]> | undefined

async function build(): Promise<readonly MediaType[]> {
  const settings = await getLocalSettings()

  return createDefaultMediaTypes({ credentials: credentialsFor(settings), fetchImpl: LOCAL_FETCHERS })
}

export const LOCAL_FETCHERS: KeyFetchers = {
  // Blocked outright by CORS with no allow-origin header at all (task
  // 5.3) — the webview's own `fetch` can never reach these two.
  igdb: tauriFetch,
  comicVine: tauriFetch,
  // CORS is open here, but MusicBrainz's terms require a real
  // `User-Agent`, which browsers refuse to let `fetch` override; only
  // the Rust-side plugin client can send it (task 5.3's open caveat).
  musicbrainz: tauriFetch,
}

/** Forget the cached registry so the next `getLocalMediaTypes()` reads the keys as they are now. */
export function resetLocalMediaTypes(): void {
  cached = undefined
  pending = undefined
}

/**
 * Returns the standalone app's media-type registry, ready to search and
 * expand. Always await this before calling `.isAvailable()`/`.search()` on
 * an entry's adapter — an unpopulated settings cache would otherwise make
 * every provider look unavailable.
 */
export async function getLocalMediaTypes(): Promise<readonly MediaType[]> {
  if (cached) return cached

  pending ??= build()
  cached = await pending
  return cached
}
