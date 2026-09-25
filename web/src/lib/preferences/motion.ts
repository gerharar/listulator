import type { PreferencesStore } from './store.js'

/** The drum carousel (380ms) and the fast push (210ms) — the prototype's two, no others (`deck`/`shuffle` were dropped). */
export const MOTIONS = ['drum', 'push'] as const

export type Motion = (typeof MOTIONS)[number]

const MOTION_KEY = 'motion'
const REDUCED_KEY = 'reducedMotion'

export function isMotion(value: unknown): value is Motion {
  return MOTIONS.some((motion) => motion === value)
}

export async function resolveMotion(store: PreferencesStore): Promise<Motion> {
  const stored = await store.get(MOTION_KEY)
  return isMotion(stored) ? stored : 'drum'
}

export async function setMotion(store: PreferencesStore, motion: Motion): Promise<void> {
  await store.set(MOTION_KEY, motion)
}

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
