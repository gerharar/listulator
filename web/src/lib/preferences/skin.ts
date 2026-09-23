import type { PreferencesStore } from './store.js'

/** Never `light-bone` — that's the one light skin, excluded from the random pick (Q10). */
export const DARK_SKINS = ['dark-orange', 'dark-green', 'dark-blue', 'dark-violet'] as const

export const SKINS = [...DARK_SKINS, 'light-bone'] as const

export type Skin = (typeof SKINS)[number]

const SKIN_KEY = 'skin'

export function isSkin(value: unknown): value is Skin {
  return SKINS.some((skin) => skin === value)
}

/**
 * On first run — and identically on any upgrade from the old six-theme
 * system, since a legacy `listulator:theme` value is simply never read
 * here — picks uniformly at random from the four dark skins, persists the
 * pick immediately, and never re-randomizes (Q10). A previously chosen
 * skin (including a user-chosen `light-bone`) is returned as-is.
 */
export async function resolveSkin(store: PreferencesStore, random: () => number = Math.random): Promise<Skin> {
  const stored = await store.get(SKIN_KEY)
  if (isSkin(stored)) return stored

  const picked = DARK_SKINS[Math.floor(random() * DARK_SKINS.length)]!
  await store.set(SKIN_KEY, picked)
  return picked
}

export async function setSkin(store: PreferencesStore, skin: Skin): Promise<void> {
  await store.set(SKIN_KEY, skin)
}
