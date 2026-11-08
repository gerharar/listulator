import type { PreferencesStore } from './store.js'
import { DEFAULT_EXZED_SKIN, EXZED_SKINS, type ExzedSkin } from './exzedSkins.js'

/**
 * eX-Zed's skin (X-003): its own key, `exzedSkin`, so Quantum's `skin` (and its random first-run pick) is never read or written here, each theme
 * remembers its own last skin when the user switches, and a build that only knows `skin` never meets an eX-Zed value.
 */
const EXZED_SKIN_KEY = 'exzedSkin'

export function isExzedSkin(value: unknown): value is ExzedSkin {
  return EXZED_SKINS.some((skin) => skin === value)
}

/**
 * The stored eX-Zed skin; anything else (nothing stored, an unknown or old key, a store that cannot be read) is Lode, `exzed-1d`, and **nothing is
 * written**: an unknown value is left as it is, in case it came from a newer build that knows more skins.
 */
export async function resolveExzedSkin(store: PreferencesStore): Promise<ExzedSkin> {
  try {
    const stored = await store.get(EXZED_SKIN_KEY)
    return isExzedSkin(stored) ? stored : DEFAULT_EXZED_SKIN
  } catch {
    return DEFAULT_EXZED_SKIN
  }
}

export async function setExzedSkin(store: PreferencesStore, skin: ExzedSkin): Promise<void> {
  await store.set(EXZED_SKIN_KEY, skin)
}
