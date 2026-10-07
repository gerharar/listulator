import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AUTHOR, LICENSING_URL } from './dataSources.js'

/**
 * The desktop app may only open the addresses its capability lists: an external link the screens
 * offer but the scope refuses does nothing when clicked, and nothing in a browser run or a unit
 * test would show it. Renaming the GitHub handle left the repo link on the old address while the
 * code moved on; this keeps the two together.
 */
const capabilities = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../apps/desktop/src-tauri/capabilities/default.json', import.meta.url)), 'utf8'),
) as { permissions: (string | { identifier: string; allow?: { url: string }[] })[] }

const openerAllows = capabilities.permissions
  .flatMap((permission) => (typeof permission === 'object' && permission.identifier === 'opener:allow-open-url' ? (permission.allow ?? []) : []))
  .map((entry) => entry.url)

/** Tauri's scope patterns: `*` stands for any run of characters. */
const allowed = (url: string): boolean =>
  openerAllows.some((pattern) => new RegExp(`^${pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(url))

describe('the desktop opener scope', () => {
  it('lets the About screen open the repository', () => {
    expect(allowed(AUTHOR.repoUrl)).toBe(true)
  })

  it('lets a link reach the repository’s own pages, such as its licensing and notices', () => {
    expect(allowed(`${AUTHOR.repoUrl}/blob/main/NOTICE.md`)).toBe(true)
  })

  it('lets the About screen open the licensing and notices page', () => {
    expect(allowed(LICENSING_URL)).toBe(true)
  })

  it('does not open other people’s repositories on the same host', () => {
    expect(allowed('https://github.com/someone-else/listulator')).toBe(false)
  })
})

/**
 * The shape of what the webview may ask the native side to do (security review, Phase 19, task 19.2; docs/security-review.md).
 * The webview holds raw SQL, the key store and the HTTP plugin, so a permission added here widens what an injected script
 * could reach. Adding one is a decision: change this list in the same commit and say why in docs/DECISIONS.md.
 */
const DESKTOP = fileURLToPath(new URL('../../../apps/desktop/src-tauri/', import.meta.url))
const read = (file: string): string => readFileSync(`${DESKTOP}${file}`, 'utf8')

interface RawCapability {
  windows: string[]
  local?: boolean
  remote?: unknown
  platforms?: unknown
  permissions: (string | { identifier: string; allow?: { url: string }[] })[]
}

const capability = JSON.parse(read('capabilities/default.json')) as RawCapability

describe('the desktop capability, as the security review left it', () => {
  it('grants exactly these permissions', () => {
    const identifiers = capability.permissions.map((permission) => (typeof permission === 'string' ? permission : permission.identifier))

    expect(identifiers).toEqual([
      'core:default',
      'core:window:allow-set-fullscreen',
      'core:window:allow-is-fullscreen',
      'core:window:allow-close',
      'sql:default',
      'sql:allow-load',
      'sql:allow-execute',
      'sql:allow-select',
      'sql:allow-close',
      'store:default',
      'http:default',
      'opener:allow-open-url',
    ])
  })

  it('belongs to the main window only and never to a remote page', () => {
    expect(capability.windows).toEqual(['main'])
    expect(capability.remote).toBeUndefined()
  })

  it('lets the HTTP plugin reach exactly these four hosts', () => {
    const http = capability.permissions.find((permission) => typeof permission === 'object' && permission.identifier === 'http:default')

    expect(typeof http === 'object' ? http.allow?.map((entry) => entry.url) : undefined).toEqual([
      'https://api.igdb.com/*',
      'https://id.twitch.tv/*',
      'https://comicvine.gamespot.com/*',
      'https://musicbrainz.org/*',
    ])
  })

  it('opens only https addresses on a named host, with no wildcard in the host', () => {
    // The scope is a string pattern: `*` stands for any text, so a wildcard in the host would admit any site.
    for (const pattern of openerAllows) expect(pattern).toMatch(/^https:\/\/[a-z0-9.-]+(\/|$)/)
  })
})

describe('the desktop app configuration, as the security review left it', () => {
  const config = JSON.parse(read('tauri.conf.json')) as { app: { withGlobalTauri?: boolean; security?: Record<string, unknown> } }

  it('keeps the content security policy and none of the switches that weaken it', () => {
    expect(typeof config.app.security?.csp).toBe('object')
    expect(config.app.withGlobalTauri ?? false).toBe(false)
    expect(config.app.security).not.toHaveProperty('dangerousDisableAssetCspModification')
    expect(config.app.security).not.toHaveProperty('devCsp')
    expect(config.app.security).not.toHaveProperty('assetProtocol')
  })

  it('compiles in neither the developer tools nor the HTTP plugin’s dangerous settings', () => {
    // `devtools` is compiled out of a release build unless this feature asks for it; `dangerous-settings` would let a
    // page turn off certificate checks on the requests the plugin makes.
    const cargo = read('Cargo.toml').replace(/^\s*#.*$/gm, '')

    expect(cargo).not.toMatch(/devtools|dangerous-settings/)
  })
})

describe('the desktop window’s navigation, as the security review left it (SR-015)', () => {
  // Rust code is not run here: the unit tests in `navigation.rs` check which addresses are allowed; this checks that
  // the hook is registered and that it asks that function, so deleting the line that installs it fails a test.
  const code = (file: string): string => read(`src/${file}`).replace(/^\s*\/\/.*$/gm, '')

  it('installs the navigation hook on the app', () => {
    expect(code('lib.rs')).toMatch(/\.plugin\(navigation::guard\(\)\)/)
    expect(code('lib.rs')).toMatch(/^mod navigation;$/m)
  })

  it('has the hook ask the allow function, and stay inside the app’s own origins', () => {
    const navigation = code('navigation.rs')

    expect(navigation).toMatch(/\.on_navigation\(\|_webview, url\| \{[^}]*allowed\(url, tauri::is_dev\(\)\)/)
    // The two origins of the packaged app, and the dev server under `tauri dev` only.
    expect(navigation).toContain('[("tauri", "localhost"), ("http", "tauri.localhost")]')
    expect(navigation).toContain('const DEV_ORIGIN: (&str, &str, u16) = ("http", "localhost", 5173);')
  })

  it('keeps the packaged app on the origins the hook allows (no https scheme for the window)', () => {
    // `useHttpsScheme` would serve the Windows app from https://tauri.localhost, which the hook refuses: the app would
    // block itself. Turning it on means changing the allow list and its tests in the same commit.
    expect(JSON.stringify(JSON.parse(read('tauri.conf.json')))).not.toContain('useHttpsScheme')
  })
})
