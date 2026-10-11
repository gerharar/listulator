import { quitPlatform } from './appQuit.js'
import { APP_VERSION } from './appVersion.js'
import { isDesktop } from './platform.js'
import { createTauriChecker } from './tauriUpdater.js'

/**
 * What a check for a new version of the app found. `unavailable` is not a failure: there is nothing to ask
 * (the app has no updater yet), so it says so rather than claim anything.
 */
export type UpdateResult = { kind: 'latest' } | { kind: 'available'; version: string } | { kind: 'unavailable' }

/**
 * The steps of an update the person asked for, after the press (task 20.11; owner: text only, no percentage).
 * `restarting` is also where a Windows install ends: the installer closes the app and starts it again itself.
 */
export type UpdatePhase = 'downloading' | 'installing' | 'restarting'

/**
 * What the About screen shows (the update block's states). `installError` is a download, a signature check or
 * an install that failed after a check had succeeded: `error` ("couldn't check") would be untrue there.
 */
export type UpdateCheckState = 'checking' | 'latest' | 'available' | 'error' | 'unavailable' | 'installError' | UpdatePhase

/**
 * Where the About screen gets its answer. The desktop app's is `createTauriChecker` (task 20.11); every other
 * build ships `unavailableChecker`. A check that fails rejects; a checker that can report `available` also
 * implements `download`.
 */
export interface AppUpdateChecker {
  check(): Promise<UpdateResult>
  /**
   * Downloads, installs and restarts for the version a check offered, reporting each step as it begins. Rejects
   * when any step fails; on a successful update the app is replaced, so it may never resolve.
   */
  download?(version: string, onPhase: (phase: UpdatePhase) => void): Promise<void> | void
}

/**
 * The checker of a build that has no updater to ask (the browser build and a self-hosted server: a server's
 * app is updated by deploying it): it never claims "up to date" and offers nothing to download.
 */
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
 * Lets a developer see each state of the update block: `?aboutUpdate=latest|available|installError|error|slow`. Fake
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
  if (wanted === 'available' || wanted === 'installError') {
    return {
      check: async () => (await wait(600), { kind: 'available', version: nextMinor(current) }),
      // Walks the phases the real update goes through. `available` ends in the last one, as the real one does when
      // the app is replaced; `installError` fails while installing.
      download: async (_version, onPhase) => {
        onPhase('downloading')
        await wait(1500)
        onPhase('installing')
        await wait(1500)
        if (wanted === 'installError') throw new Error('Simulated failure (?aboutUpdate=installError)')
        onPhase('restarting')
      },
    }
  }

  return undefined
}

/**
 * The checker the app uses: in a development build the one the URL asked for; otherwise the plugin-backed one inside
 * the desktop shell, and the shipped one everywhere else. Building it sends nothing: a check runs only when the
 * About screen asks (`useUpdateCheck`).
 */
export function appUpdateChecker(): AppUpdateChecker {
  if (import.meta.env.DEV) {
    const dev = devChecker(window.location.search)
    if (dev) return dev
  }

  if (isDesktop()) return createTauriChecker({ relaunchAfterInstall: quitPlatform(navigator.userAgent) === 'mac' })

  return unavailableChecker
}
