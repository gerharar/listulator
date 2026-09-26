import type { PreferencesStore } from './store.js'

const REDUCED_KEY = 'reducedMotion'

/**
 * `undefined` means the user never touched the checkbox, so the system's own
 * "reduce motion" setting decides. An explicit `false` is different: it keeps
 * motion on for someone whose system asks for less.
 */
export async function resolveReducedMotionSetting(store: PreferencesStore): Promise<boolean | undefined> {
  const stored = await store.get(REDUCED_KEY)
  if (stored === 'true') return true
  if (stored === 'false') return false
  return undefined
}

export async function setReducedMotionSetting(store: PreferencesStore, reduced: boolean): Promise<void> {
  await store.set(REDUCED_KEY, String(reduced))
}
