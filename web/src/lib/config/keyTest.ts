import { createDefaultMediaTypes, type MediaTypeOverrides } from '../../../../server/src/ingestion/mediaTypes.js'
import { IngestionError, UnauthorizedError } from '../../../../server/src/ingestion/http.js'
import type { LocalSettings } from './localConfig.js'

export type KeySource = 'tmdb' | 'igdb' | 'comicVine' | 'youtube'

/**
 * What a test found. `rejected` is only ever the provider refusing the key;
 * a dead network or a provider having a bad day is not the key's fault.
 */
export type KeyTestResult = 'working' | 'rejected' | 'unreachable' | 'failed'

export type KeyFetchers = NonNullable<MediaTypeOverrides['fetchImpl']>

/** A TMDB v4 "read access token" is a JWT; the older v3 key is a short hex string. The settings field takes either. */
function looksLikeJwt(value: string): boolean {
  return /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(value)
}

/** The one place a saved setting becomes an adapter credential, shared by the registry and the Test button. */
export function credentialsFor(settings: LocalSettings): NonNullable<MediaTypeOverrides['credentials']> & {
  tmdb: () => { apiKey: string | undefined; readAccessToken: string | undefined }
  comicVine: () => { apiKey: string | undefined }
} {
  const value = (raw: string | undefined): string | undefined => raw?.trim() || undefined
  const tmdb = value(settings.tmdbApiKey)

  return {
    tmdb: () => ({
      apiKey: tmdb && !looksLikeJwt(tmdb) ? tmdb : undefined,
      readAccessToken: tmdb && looksLikeJwt(tmdb) ? tmdb : undefined,
    }),
    igdb: () => ({ clientId: value(settings.igdbClientId), clientSecret: value(settings.igdbClientSecret) }),
    comicVine: () => ({ apiKey: value(settings.comicVineApiKey) }),
    youtube: () => ({ apiKey: value(settings.youtubeApiKey) }),
  }
}

/**
 * One category per provider and the cheapest search that still needs the key.
 * YouTube: a handle costs about one quota unit, a name search is one of the day's hundred (its own bucket).
 */
const PROBES: Record<KeySource, { category: string; query: string }> = {
  tmdb: { category: 'movie', query: 'Alien' },
  igdb: { category: 'game', query: 'Portal' },
  comicVine: { category: 'comic', query: 'Batman' },
  youtube: { category: 'youtube', query: '@YouTube' },
}

const REFUSED = /(invalid|not valid|rejected|unauthori[sz]ed)/i

/**
 * Runs the provider's own search with the key as typed (not yet saved, and
 * never sent anywhere but to that provider). The answer is one word: the key
 * is never echoed back, and the error text that carried it is dropped here.
 */
export async function testKey(
  source: KeySource,
  values: LocalSettings,
  fetchImpl: KeyFetchers = {},
): Promise<KeyTestResult> {
  const probe = PROBES[source]
  const entry = createDefaultMediaTypes({ credentials: credentialsFor(values), fetchImpl }).find(
    (candidate) => candidate.key === probe.category,
  )
  const adapter = entry?.adapter
  if (!adapter?.isAvailable()) return 'rejected'

  try {
    await adapter.search(probe.query, {})
    return 'working'
  } catch (cause) {
    if (cause instanceof UnauthorizedError) return 'rejected'
    const message = cause instanceof Error ? cause.message : ''
    if (cause instanceof IngestionError && message.startsWith('Could not reach')) return 'unreachable'
    if (REFUSED.test(message)) return 'rejected'
    return 'failed'
  }
}
