import { Channel, invoke } from '@tauri-apps/api/core'
import { InstallStuckError, type AppUpdateChecker, type UpdatePhase, type UpdateResult } from './appUpdate.js'
import { createUpdateTrace } from './updateTrace.js'

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

/** What the plugin's progress channel sends while it downloads: the end of it moves the screen on; the sizes only feed the trace. */
interface DownloadEvent {
  event: 'Started' | 'Progress' | 'Finished'
  data?: { contentLength?: number; chunkLength?: number }
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

/**
 * How long an install may take, from the end of the download, before the screen gives up on it (BL-116). The installer is normally started and
 * the app ended within a few seconds; the slowest start measured was 8 s (BL-092), so a minute is several times that, and a false alarm costs
 * only a message on a window that is about to close anyway.
 */
export const INSTALL_STUCK_AFTER_MS = 60_000

export interface TauriCheckerOptions {
  /**
   * macOS: the plugin replaces the app and leaves it running, so this app restarts it. Windows: the installer
   * closes the app and starts it again itself, so a restart by hand would start a second copy.
   */
  relaunchAfterInstall: boolean
  /** Fails the install with `InstallStuckError` after this long without an answer. Unset: no limit (macOS, which replaces the app and returns). */
  installTimeoutMs?: number
}

export function createTauriChecker({ relaunchAfterInstall, installTimeoutMs }: TauriCheckerOptions): AppUpdateChecker {
  // The update the last check offered. A download is for that one only: the version on screen has to be the version
  // that installs, and a new check replaces it.
  let offer: FoundUpdate | undefined
  // The marks of an update's timing (BL-092, temporary): never blocks or fails an update.
  const trace = createUpdateTrace()

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

      void trace.record('pressed', version)
      onPhase('downloading')
      let total = 0
      let received = 0
      let nearEnd = false
      // The limit starts when the download ends: a slow download is not a stuck install.
      let stuckTimer: ReturnType<typeof setTimeout> | undefined
      let giveUp: (cause: InstallStuckError) => void = () => undefined
      const stuck = new Promise<never>((_resolve, reject) => (giveUp = reject))
      const progress = new Channel<DownloadEvent>((event) => {
        if (event.event === 'Started') {
          total = event.data?.contentLength ?? 0
          void trace.record('download-started', total > 0 ? String(total) : undefined)
        } else if (event.event === 'Progress') {
          received += event.data?.chunkLength ?? 0
          // On Windows the installer ends the app right after the download: the last mark that can still be written is near the end.
          if (!nearEnd && total > 0 && received >= total * 0.9) {
            nearEnd = true
            void trace.record('download-90%')
          }
        } else if (event.event === 'Finished') {
          void trace.record('download-finished')
          onPhase('installing')
          if (installTimeoutMs !== undefined) {
            stuckTimer = setTimeout(() => {
              void trace.record('install-timed-out')
              giveUp(new InstallStuckError())
            }, installTimeoutMs)
          }
        }
      })
      const installing = invoke('plugin:updater|download_and_install', { onEvent: progress, rid: offer.rid })
      // A call that is given up on may still answer, or fail, long after: that is no longer anyone's to handle.
      installing.catch(() => undefined)

      try {
        await Promise.race([installing, stuck])
      } finally {
        clearTimeout(stuckTimer)
      }

      void trace.record('install-returned')
      onPhase('restarting')
      if (relaunchAfterInstall) {
        void trace.record('relaunch-called')
        await invoke('relaunch', {})
      }
    },
  }
}
