import { APP_VERSION } from './appVersion.js'

/**
 * What a check for a new version of the app found. `unavailable` is not a failure: there is nothing to ask
 * (the app has no updater yet), so it says so rather than claim anything.
 */
export type UpdateResult = { kind: 'latest' } | { kind: 'available'; version: string } | { kind: 'unavailable' }

/** What the About screen shows (the update block's states). */
export type UpdateCheckState = 'checking' | 'latest' | 'available' | 'error' | 'unavailable'

/**
 * Where the About screen gets its answer. The real updater (endpoint, signing, download flow, one source of
 * truth for the version) is a later task and implements this; until then the shipped checker is
 * `unavailableChecker`. A check that fails rejects; a checker that can report `available` also implements
 * `download`.
 */
export interface AppUpdateChecker {
  check(): Promise<UpdateResult>
  /** Hands off to the app's update flow for the version a check offered. */
  download?(version: string): Promise<void> | void
}

/** The shipped checker: no updater exists yet, so it never claims "up to date" and offers nothing to download. */
export const unavailableChecker: AppUpdateChecker = {
  check: async () => ({ kind: 'unavailable' }),
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** The next minor version after `current` ("0.1.0" gives "0.2.0"), for a made-up update. */
function nextMinor(current: string): string {
  const [major = 0, minor = 0] = current.split('.').map(Number)
  return `${major}.${minor + 1}.0`
}

/**
 * Lets a developer see each state of the update block: `?aboutUpdate=latest|available|error|slow`. Fake
 * answers, so it exists only in a development build (`appUpdateChecker` below); a production build contains
 * neither the parameter nor these results.
 */
export function devChecker(search: string, current: string = APP_VERSION): AppUpdateChecker | undefined {
  const wanted = new URLSearchParams(search).get('aboutUpdate')

  if (wanted === 'latest') return { check: async () => (await wait(600), { kind: 'latest' }) }
  if (wanted === 'slow') return { check: async () => (await wait(5000), { kind: 'latest' }) }
  if (wanted === 'error') {
    return {
      check: async () => {
        await wait(600)
        throw new Error('Simulated failure (?aboutUpdate=error)')
      },
    }
  }
  if (wanted === 'available') {
    return {
      check: async () => (await wait(600), { kind: 'available', version: nextMinor(current) }),
      download: (version) => console.info(`[dev] Download Update ${version}: no updater yet`),
    }
  }

  return undefined
}

/** The checker the app uses: the shipped one, or in a development build the one the URL asked for. */
export function appUpdateChecker(): AppUpdateChecker {
  if (import.meta.env.DEV) {
    const dev = devChecker(window.location.search)
    if (dev) return dev
  }

  return unavailableChecker
}
