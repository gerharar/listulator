import { load, type Store } from '@tauri-apps/plugin-store'

/**
 * Settings for the standalone app, via Tauri's store plugin — never `.env`,
 * which doesn't exist in a packaged app. Mirrors the self-hosted server's
 * env-var-configured API keys (README's "API keys" table), but there is no
 * standalone equivalent of `SINGLE_USER_MODE`, `DATABASE_PATH`, `PORT`, or
 * `HOST`: the standalone app is always single-user and always local
 * storage, so those knobs don't apply here at all.
 *
 * Every key ships empty. There is no default/shared key for any provider —
 * each user supplies their own, per `docs/DECISIONS.md`'s "API keys are
 * always user-supplied" decision.
 */
export interface LocalSettings {
  tmdbApiKey?: string
  igdbClientId?: string
  igdbClientSecret?: string
  comicVineApiKey?: string
  youtubeApiKey?: string
}

const SETTINGS_KEYS = [
  'tmdbApiKey',
  'igdbClientId',
  'igdbClientSecret',
  'comicVineApiKey',
  'youtubeApiKey',
] as const satisfies readonly (keyof LocalSettings)[]

let store: Store | undefined

async function getStore(): Promise<Store> {
  // autoSave persists on every set() — settings changes are rare button
  // presses, not a hot path, so there's no reason to batch them.
  store ??= await load('settings.json', { autoSave: true })
  return store
}

export async function getLocalSettings(): Promise<LocalSettings> {
  const s = await getStore()
  const entries = await Promise.all(
    SETTINGS_KEYS.map(async (key) => [key, await s.get<string>(key)] as const),
  )

  return Object.fromEntries(entries.filter(([, value]) => value !== undefined)) as LocalSettings
}

/**
 * Merges into existing settings — a settings form submitting one changed
 * field must not blank out the others.
 */
export async function updateLocalSettings(patch: Partial<LocalSettings>): Promise<void> {
  const s = await getStore()

  for (const key of SETTINGS_KEYS) {
    if (key in patch) {
      await s.set(key, patch[key])
    }
  }
}
