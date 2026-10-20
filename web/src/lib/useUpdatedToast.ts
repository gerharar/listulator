import { useEffect } from 'react'
import { useToast } from '../components/quantum/Toast/Toast.js'
import { copy } from '../locale/index.js'
import { APP_VERSION } from './appVersion.js'
import { isDesktop } from './platform.js'
import { isNewerVersion, previousRunVersion } from './runVersion.js'

/** Once per page load, whatever remounts: a second mount of the shell must not say it again. */
let shown = false

/**
 * "Updated to 1.1.1" on the first screen of a newer version (canvas H-017). Only in the desktop app, only when the last start
 * recorded an older version: not on a first install, not on the same version, not on a downgrade. A store that fails says nothing.
 */
export function useUpdatedToast(): void {
  const { showToast } = useToast()

  useEffect(() => {
    if (shown || !isDesktop()) return
    let cancelled = false
    previousRunVersion()
      .then((previous) => {
        if (cancelled || shown || previous === undefined || !isNewerVersion(APP_VERSION, previous)) return
        shown = true
        showToast({ text: copy.quantum.about.updatedTo(APP_VERSION) })
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [showToast])
}
