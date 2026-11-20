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
 * The stored eX-Zed skin. With **nothing stored** (a first launch, or the first switch to the theme: this is read at every start, so it is the start that
 * comes first) it picks uniformly at random from all six, Lotus included, and stores the pick at once, so it is never drawn again (H-030, `DESIGN.md` section 5
 * rule 3). Anything else (an unknown or old key, a store that cannot be read or written) is Lode, `exzed-1d`, and an unknown value is **left as it is**, in
 * case it came from a newer build that knows more skins.
 */
export async function resolveExzedSkin(store: PreferencesStore, random: () => number = Math.random): Promise<ExzedSkin> {
  try {
    const stored = await store.get(EXZED_SKIN_KEY)
    if (isExzedSkin(stored)) return stored
    if (stored !== undefined) return DEFAULT_EXZED_SKIN

    const picked = EXZED_SKINS[Math.floor(random() * EXZED_SKINS.length)]!
    await store.set(EXZED_SKIN_KEY, picked)
    return picked
  } catch {
    return DEFAULT_EXZED_SKIN
  }
}

export async function setExzedSkin(store: PreferencesStore, skin: ExzedSkin): Promise<void> {
  await store.set(EXZED_SKIN_KEY, skin)
}
