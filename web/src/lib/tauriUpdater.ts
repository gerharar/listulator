import { Channel, invoke } from '@tauri-apps/api/core'
import type { AppUpdateChecker, UpdatePhase, UpdateResult } from './appUpdate.js'

/**
 * The desktop app's updater (task 20.11): an `AppUpdateChecker` that talks to the Tauri updater plugin. It makes
 * exactly the three calls the isolation hook admits (`apps/desktop/isolation/hook.js`, SR-062): `check` with an
 * empty object, `download_and_install` with a progress channel and the resource id the check returned, and our
 * own `relaunch`. It uses `invoke` directly rather than `@tauri-apps/plugin-updater`: that package would add a
 * dependency to reach the same three calls, and its `Update.close()` sends `plugin:resources|close`, which the
 * hook refuses.
 *
 * Nothing the update server says reaches the screen except the version, and only if it looks like one: the plugin
 * has checked the signature by the time a download runs, but a check's answer is not authenticated yet.
 */

/** The plugin's answer to a check that found an update (`null` when there is none). */
interface FoundUpdate {
  rid: number
  version: string
}

/** What the plugin's progress channel sends while it downloads; only the end of the download matters here. */
interface DownloadEvent {
  event: 'Started' | 'Progress' | 'Finished'
}

/** "1.2.3" or "1.2.3-rc.1": numbers, and a short tag of letters, digits, dots and hyphens. No markup, no sentence. */
const VERSION = /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[0-9A-Za-z][0-9A-Za-z.-]{0,30})?$/

function foundUpdate(answer: unknown): FoundUpdate {
  const candidate = answer as { rid?: unknown; version?: unknown } | undefined
  const { rid, version } = candidate ?? {}
  if (typeof rid !== 'number' || !Number.isSafeInteger(rid) || rid < 0) throw new Error('The updater answered without a usable resource id')
  if (typeof version !== 'string' || !VERSION.test(version)) throw new Error('The updater offered something that is not a version')

  return { rid, version }
}

export interface TauriCheckerOptions {
  /**
   * macOS: the plugin replaces the app and leaves it running, so this app restarts it. Windows: the installer
   * closes the app and starts it again itself, so a restart by hand would start a second copy.
   */
  relaunchAfterInstall: boolean
}

export function createTauriChecker({ relaunchAfterInstall }: TauriCheckerOptions): AppUpdateChecker {
  // The update the last check offered. A download is for that one only: the version on screen has to be the version
  // that installs, and a new check replaces it.
  let offer: FoundUpdate | undefined

  return {
    async check(): Promise<UpdateResult> {
      offer = undefined
      // `null` is the plugin's "nothing newer"; anything else that is not a valid offer is a failure, never "latest".
      const answer = await invoke<unknown>('plugin:updater|check', {})
      if (answer === null) return { kind: 'latest' }

      offer = foundUpdate(answer)
      return { kind: 'available', version: offer.version }
    },

    async download(version: string, onPhase: (phase: UpdatePhase) => void): Promise<void> {
      if (offer === undefined || offer.version !== version) throw new Error('That version was not offered by the last check')

      onPhase('downloading')
      const progress = new Channel<DownloadEvent>((event) => {
        if (event.event === 'Finished') onPhase('installing')
      })
      await invoke('plugin:updater|download_and_install', { onEvent: progress, rid: offer.rid })

      onPhase('restarting')
      if (relaunchAfterInstall) await invoke('relaunch', {})
    },
  }
}
