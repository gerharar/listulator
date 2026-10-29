import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compareVersions } from './tools/updateManifest.js'

/**
 * The store plugin's floor (BL-116, Phase 42). `tauri-plugin-store` 2.4.4 locks up when it is dropped with an auto-save pending
 * (`apply_pending_auto_save` holds the debounce mutex and `save()` locks it again), and on Windows the updater drops the app's stores just
 * before it starts the installer: the update then hangs at "Installing" and no installer starts. Fixed upstream in 2.4.5 ("Fix
 * `apply_pending_auto_save` can deadlock the store"). Nothing below that version may be locked again, and the npm half of the plugin
 * moves with the crate. Revisit: never lower the floor; raise it with the plugin.
 */
const ROOT = join(import.meta.dirname, '..', '..')
const FLOOR = '2.4.5'

function lockedCrate(name: string): string | undefined {
  const lock = readFileSync(join(ROOT, 'apps/desktop/src-tauri/Cargo.lock'), 'utf8')
  const block = lock.split('[[package]]').find((entry) => entry.trimStart().startsWith(`name = "${name}"\n`))

  return block?.match(/^version = "([^"]+)"$/m)?.[1]
}

const npmPin = (JSON.parse(readFileSync(join(ROOT, 'web/package.json'), 'utf8')) as { dependencies?: Record<string, string> }).dependencies?.['@tauri-apps/plugin-store']

describe('the store plugin (BL-116: 2.4.4 deadlocks when the updater drops the store)', () => {
  it(`is locked at ${FLOOR} or later in Cargo.lock`, () => {
    const locked = lockedCrate('tauri-plugin-store')

    expect(locked, 'tauri-plugin-store is not in Cargo.lock').toBeDefined()
    expect(compareVersions(locked!, FLOOR), `tauri-plugin-store ${locked} is below ${FLOOR}: the Windows update can hang (BL-116)`).toBeGreaterThanOrEqual(0)
  })

  it('has its npm half pinned exactly, at the version of the crate', () => {
    expect(npmPin, '@tauri-apps/plugin-store is not a dependency of web').toBeDefined()
    expect(npmPin).toMatch(/^\d+\.\d+\.\d+$/)
    expect(npmPin).toBe(lockedCrate('tauri-plugin-store'))
  })

  it('does not drag the HTTP plugin (SR-006) into the same change: it keeps being read on its own', () => {
    expect(lockedCrate('tauri-plugin-http')).toBeDefined()
  })

  it('finds a version below the floor, a version equal to it and the 2.5 line (the comparison itself)', () => {
    expect(compareVersions('2.4.4', FLOOR)).toBeLessThan(0)
    expect(compareVersions('2.4.5', FLOOR)).toBe(0)
    expect(compareVersions('2.5.0', FLOOR)).toBeGreaterThan(0)
    expect(compareVersions('2.10.0', FLOOR)).toBeGreaterThan(0)
  })
})
