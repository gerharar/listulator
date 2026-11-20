import type { PreferencesStore } from './store.js'

export const SKINS = ['dark-orange', 'dark-green', 'dark-blue', 'dark-violet', 'light-bone'] as const

export type Skin = (typeof SKINS)[number]

const SKIN_KEY = 'skin'

export function isSkin(value: unknown): value is Skin {
  return SKINS.some((skin) => skin === value)
}

/**
 * On first run — and identically on any upgrade from the old six-theme
 * system, since a legacy `listulator:theme` value is simply never read
 * here — picks uniformly at random from all five skins, the light one
 * included (H-030, `DESIGN.md` section 5 rule 3), persists the pick
 * immediately, and never re-randomizes. It was the four dark skins until
 * 2.0 (Q10). A previously chosen skin is returned as-is.
 */
export async function resolveSkin(store: PreferencesStore, random: () => number = Math.random): Promise<Skin> {
  const stored = await store.get(SKIN_KEY)
  if (isSkin(stored)) return stored

  const picked = SKINS[Math.floor(random() * SKINS.length)]!
  await store.set(SKIN_KEY, picked)
  return picked
}

export async function setSkin(store: PreferencesStore, skin: Skin): Promise<void> {
  await store.set(SKIN_KEY, skin)
}
