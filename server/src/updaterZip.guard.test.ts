import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compareVersions } from './tools/updateManifest.js'

/**
 * The updater plugin's zip floor (Phase 43, release 1.2.2). `tauri-plugin-updater` unpacks a zip-wrapped Windows update with the `zip` crate,
 * only if the update bytes are a zip and after the signature check; our Windows update is the signed .exe, so the code is not reached by our
 * own updates (DECISIONS, BL-117). The 4.x line still carries known advisories (RUSTSEC-2026-0367 to 0369 and Dependabot alerts 41 to 43,
 * the critical one fixed in 9.0.5), and `tauri-plugin-updater` 2.14.1 is the release that moved to zip 9. Nothing below these versions may be
 * locked again. Revisit: raise the floors with the plugin; never lower them.
 */
const ROOT = join(import.meta.dirname, '..', '..')
const UPDATER_FLOOR = '2.14.1'
const ZIP_FLOOR = '9.0.5'

/** Every version of a crate in `Cargo.lock` (a crate can be locked more than once). */
function lockedVersions(name: string): string[] {
  const lock = readFileSync(join(ROOT, 'apps/desktop/src-tauri/Cargo.lock'), 'utf8')

  return lock
    .split('[[package]]')
    .filter((entry) => entry.trimStart().startsWith(`name = "${name}"\n`))
    .flatMap((entry) => entry.match(/^version = "([^"]+)"$/m)?.[1] ?? [])
}

describe('the updater plugin and its zip (alerts 41 to 43)', () => {
  it(`locks tauri-plugin-updater at ${UPDATER_FLOOR} or later`, () => {
    const versions = lockedVersions('tauri-plugin-updater')

    expect(versions, 'tauri-plugin-updater is not in Cargo.lock').toHaveLength(1)
    expect(compareVersions(versions[0]!, UPDATER_FLOOR), `tauri-plugin-updater ${versions[0]} is below ${UPDATER_FLOOR}: it still brings zip 4`).toBeGreaterThanOrEqual(0)
  })

  it(`locks no zip below ${ZIP_FLOOR}: not one version, in Cargo.lock`, () => {
    const versions = lockedVersions('zip')

    expect(versions.length, 'zip is not in Cargo.lock').toBeGreaterThan(0)
    for (const version of versions) {
      expect(compareVersions(version, ZIP_FLOOR), `zip ${version} is below ${ZIP_FLOOR}: open Dependabot alerts 41 to 43 and RUSTSEC-2026-0367 to 0369`).toBeGreaterThanOrEqual(0)
    }
  })

  it('keeps the store plugin floor too (BL-116): the two plugins are raised on purpose, one at a time', () => {
    const [store] = lockedVersions('tauri-plugin-store')

    expect(compareVersions(store ?? '0.0.0', '2.4.5')).toBeGreaterThanOrEqual(0)
  })
})
