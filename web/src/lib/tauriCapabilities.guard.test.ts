import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
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
      // The window's own full-screen state is followed through its resize events (`windowFullscreen.ts`), which is a
      // listen and an unlisten; nothing else of `core:default` is called by the app (19.12.4, SR-007).
      'core:event:allow-listen',
      'core:event:allow-unlisten',
      'core:window:allow-set-fullscreen',
      'core:window:allow-is-fullscreen',
      'core:window:allow-close',
      'sql:allow-load',
      'sql:allow-execute',
      'sql:allow-select',
      'store:default',
      'http:default',
      'opener:allow-open-url',
      // The updater's two calls the client makes (20.10a, SR-066); never `updater:default`, which adds `download` and `install`.
      'updater:allow-check',
      'updater:allow-download-and-install',
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
    // page turn off certificate checks on the requests the plugin makes; `unsafe-headers` would let it send the headers
    // the fetch standard forbids (Host, Cookie, Origin, Referer, Sec-*) and drop the Origin the plugin sets (SR-006: the
    // app's one header of interest, User-Agent, is not on that list).
    const cargo = read('Cargo.toml').replace(/^\s*#.*$/gm, '')

    expect(cargo).not.toMatch(/devtools|dangerous-settings|unsafe-headers/)
  })

  it('never grants the whole core permission set, only the calls the app makes', () => {
    const identifiers = capability.permissions.map((permission) => (typeof permission === 'string' ? permission : permission.identifier))

    expect(identifiers.filter((identifier) => /^core:[a-z]+:default$|^core:default$/.test(identifier))).toEqual([])
  })
})

describe('the desktop window’s navigation, as the security review left it (SR-015)', () => {
  // Rust code is not run here: the unit tests in `navigation.rs` check which addresses are allowed; this checks that
  // the hook is registered and that it asks that function, so deleting the line that installs it fails a test.
  const code = (file: string): string => read(`src/${file}`).replace(/^\s*\/\/.*$/gm, '')

  it('installs the navigation hook on the app', () => {
    expect(code('lib.rs')).toMatch(/\.plugin\(navigation::guard\(isolation_scheme\)\)/)
    expect(code('lib.rs')).toMatch(/^mod navigation;$/m)
  })

  it('has the hook ask the allow function, and stay inside the app’s own origins', () => {
    const navigation = code('navigation.rs')

    expect(navigation).toMatch(/\.on_navigation\(move \|_webview, url\| \{[^}]*allowed_with\(url, tauri::is_dev\(\), isolation_scheme\.as_deref\(\)\)/)
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

describe('the isolation hook is switched on, as the security review left it (SR-002 to SR-004, SR-008, SR-009; 19.12.3)', () => {
  const config = JSON.parse(read('tauri.conf.json')) as {
    app: { security: { pattern?: { use: string; options?: { dir: string } }; freezePrototype?: boolean; csp: Record<string, string> } }
  }

  it('runs the app under the isolation pattern, with its page in apps/desktop/isolation', () => {
    expect(config.app.security.pattern).toEqual({ use: 'isolation', options: { dir: '../isolation' } })
  })

  it('freezes the prototypes the page’s scripts share', () => {
    expect(config.app.security.freezePrototype).toBe(true)
  })

  // Found in the first built app (Windows run 1; DECISIONS "CORRECTION"): `tauri dev` does not enforce the CSP on the dev server's
  // pages, so a built app was the first place the isolation frame met it, and it stayed on "Loading…".
  it('does not write the isolation frame into the CSP: its scheme is made at compile time, so the app adds it at start-up', () => {
    // `isolation-<new id>` on every compile: no fixed `frame-src` can match it (and `isolation:` or `http://isolation.localhost` never did).
    expect(config.app.security.csp).not.toHaveProperty('frame-src')
    expect(config.app.security.csp).not.toHaveProperty('child-src')

    const lib = read('src/lib.rs').replace(/^\s*\/\/.*$/gm, '')
    expect(lib).toMatch(/let mut context = tauri::generate_context!\(\);/)
    expect(lib).toMatch(/isolation_csp::allow_isolation_frame\(&mut context\)/)
    expect(lib).toMatch(/\.build\(context\)/)
    expect(lib.indexOf('allow_isolation_frame')).toBeLessThan(lib.indexOf('.build(context)'))
  })

  it('allows the one inline style Tauri injects to hide the isolation frame, by its hash and by nothing broader', () => {
    // Tauri adds `<style>#__tauri_isolation__ { display: none !important }</style>` to the page; with `style-src 'self'` the browser
    // refuses it and the frame shows at the default size ("This content is blocked").
    const style = '#__tauri_isolation__ { display: none !important }'
    const hash = `'sha256-${createHash('sha256').update(style).digest('base64')}'`

    expect(config.app.security.csp['style-src']?.split(/\s+/)).toEqual(["'self'", hash])
    expect(config.app.security.csp['style-src']).not.toMatch(/unsafe-inline/)
  })

  // The text is Tauri's own (`IFRAME_STYLE` in tauri-utils): a release that changed it would change the hash. Checked where its source
  // is in cargo's registry (after the desktop app has been built on this machine); the version check of the lockfile is the gate elsewhere.
  const tauriUtils = (() => {
    const registry = `${homedir()}/.cargo/registry/src`
    const version = /\[\[package\]\]\nname = "tauri-utils"\nversion = "([^"]+)"/.exec(read('Cargo.lock'))?.[1]
    if (!version || !existsSync(registry)) return undefined

    return readdirSync(registry)
      .map((dir) => `${registry}/${dir}/tauri-utils-${version}/src/pattern/isolation.rs`)
      .find((file) => existsSync(file))
  })()

  it.skipIf(!tauriUtils)('hashes the text Tauri injects, in the locked version of its own source', () => {
    expect(readFileSync(tauriUtils as string, 'utf8')).toContain('pub const IFRAME_STYLE: &str = "#__tauri_isolation__ { display: none !important }";')
  })

  it('compiles the isolation feature into both `tauri` and `tauri-build` (the build refuses otherwise)', () => {
    const cargo = read('Cargo.toml').replace(/^\s*#.*$/gm, '')

    expect(cargo).toMatch(/^tauri = \{[^}]*features = \[[^\]]*"isolation"/m)
    expect(cargo).toMatch(/^tauri-build = \{[^}]*features = \[[^\]]*"isolation"/m)
  })

  it('serves a page that loads the hook and nothing else', () => {
    const page = readFileSync(`${DESKTOP}../isolation/index.html`, 'utf8')

    expect([...page.matchAll(/<script\b[^>]*>/g)].map((match) => match[0])).toEqual(['<script src="hook.js">'])
    expect(page).not.toMatch(/<(iframe|link|img|object|embed)\b/i)
  })

  it('has the hook set itself as the one hook Tauri calls, and refuse by rewriting the command, never by throwing', () => {
    const hook = readFileSync(`${DESKTOP}../isolation/hook.js`, 'utf8').replace(/^\s*\/\/.*$/gm, '')

    expect(hook).toMatch(/window\.__TAURI_ISOLATION_HOOK__ = function/)
    expect(hook).not.toMatch(/\bthrow\b/)
  })

  it('does not grant the commands that work without the hook (an empty request body is not encrypted: probe P7e)', () => {
    // `sql|close` with no database closes every pool and needs no arguments, so it would get past the hook; the app never
    // calls it. The window calls act on the window that asks and stay (close is how Exit works).
    const identifiers = capability.permissions.map((permission) => (typeof permission === 'string' ? permission : permission.identifier))

    expect(identifiers).not.toContain('sql:default')
    expect(identifiers).not.toContain('sql:allow-close')
  })
})

describe('the updater, as the design left it (task 20.10a; docs/security-review.md section 13, SR-063 to SR-067)', () => {
  const config = JSON.parse(read('tauri.conf.json')) as { plugins?: { updater?: Record<string, unknown> } }
  const updater = config.plugins?.updater ?? {}
  const code = (file: string): string => read(`src/${file}`).replace(/^\s*\/\/.*$/gm, '')
  const cargo = read('Cargo.toml').replace(/^\s*#.*$/gm, '')

  // The public half of the key made in 20.9c (DECISIONS "20.9c"); a different value here is a key rotation, not an edit.
  const PUBLIC_KEY_ID = '738FF42772526511'

  it('trusts the one public key made for releases, and no other', () => {
    const decoded = Buffer.from(String(updater.pubkey), 'base64').toString('utf8')

    expect(decoded).toContain(`untrusted comment: minisign public key: ${PUBLIC_KEY_ID}`)
  })

  it('asks one https address, the latest published release (a draft or pre-release is never "latest")', () => {
    expect(updater.endpoints).toEqual(['https://github.com/gerharar/listulator/releases/latest/download/latest.json'])
  })

  it('refuses an update whose signature does not name the version the manifest announces (SR-065)', () => {
    expect(updater.requireSignedVersion).toBe(true)
  })

  it('has no switch that weakens the check: nothing dangerous, no downgrades, no installer arguments', () => {
    expect(Object.keys(updater).filter((key) => /^dangerous/i.test(key))).toEqual([])
    expect(updater.allowDowngrades ?? false).toBe(false)
    expect(updater).not.toHaveProperty('windows')
    expect(Object.keys(updater).sort()).toEqual(['endpoints', 'pubkey', 'requireSignedVersion'])
  })

  it('compiles the updater into the desktop build only, and brings no process plugin (the app has its own relaunch)', () => {
    const desktopOnly = /\[target\.'cfg\(not\(any\(target_os = "android", target_os = "ios"\)\)\)'\.dependencies\]([\s\S]*)$/.exec(cargo)?.[1] ?? ''

    expect(desktopOnly).toMatch(/^tauri-plugin-updater\s*=/m)
    expect(cargo.split(desktopOnly)[0]).not.toMatch(/tauri-plugin-updater/)
    expect(cargo).not.toMatch(/tauri-plugin-process/)
  })

  it('registers the plugin and the relaunch command on the app', () => {
    const lib = code('lib.rs')

    expect(lib).toMatch(/\.plugin\(tauri_plugin_updater::Builder::new\(\)\.build\(\)\)/)
    expect(lib).toMatch(/\.invoke_handler\(tauri::generate_handler!\[relaunch\]\)/)
  })

  it('relaunches through the exit events, so the window and full-screen state are saved first (`restart()` skips them on the main thread)', () => {
    const body = /fn relaunch\([^)]*\)\s*\{([\s\S]*?)\n\}/.exec(code('lib.rs'))?.[1] ?? ''

    expect(body).toContain('request_restart()')
    expect(body).not.toMatch(/\.restart\(\)/)
    // Nothing the page sends can reach it: the only parameter is the app handle Tauri supplies.
    expect(/fn relaunch\(([^)]*)\)/.exec(code('lib.rs'))?.[1]?.trim()).toBe('app: tauri::AppHandle')
  })

  it('grants no more of the updater than the client calls (no `download`, no `install`, no default set)', () => {
    const identifiers = capability.permissions.map((permission) => (typeof permission === 'string' ? permission : permission.identifier))

    expect(identifiers.filter((identifier) => identifier.startsWith('updater:'))).toEqual(['updater:allow-check', 'updater:allow-download-and-install'])
  })

  // `tauri build` and `tauri dev` write the capability list they compiled into gen/schemas (not tracked); when it is there, it must
  // say what the source says. A permission that does not exist fails the build; this catches the other drift, a stale or edited copy.
  const generated = `${DESKTOP}gen/schemas/capabilities.json`

  it.skipIf(!existsSync(generated))('has the generated capability list equal to the source', () => {
    const built = JSON.parse(readFileSync(generated, 'utf8')) as { default?: { permissions: unknown[] } }

    expect(built.default?.permissions).toEqual(capability.permissions)
  })
})

describe('what `tauri dev` adds, and a release does not (19.12.4)', () => {
  // `tauri dev` merges tauri.dev.conf.json; `tauri build` never reads it. The inspector's keyboard shortcut calls a window
  // command that `core:default` used to grant; it is granted again for development only, so a release carries no trace of it.
  type CapabilityEntry = string | { identifier: string; windows: string[]; permissions: string[]; remote?: unknown }
  const release = JSON.parse(read('tauri.conf.json')) as { app: { security: { capabilities?: unknown } } }
  const dev = JSON.parse(read('tauri.dev.conf.json')) as { app?: { security?: { capabilities?: CapabilityEntry[] } } }

  it('has no capability list in the release configuration (every file in capabilities/ applies)', () => {
    expect(release.app.security.capabilities).toBeUndefined()
  })

  it('adds the inspector permission, to the main window and only for development, beside the default capability', () => {
    const entries = (dev.app?.security?.capabilities ?? []).map((entry) =>
      typeof entry === 'string' ? entry : { identifier: entry.identifier, windows: entry.windows, permissions: entry.permissions, remote: entry.remote },
    )

    expect(entries).toEqual([
      'default',
      { identifier: 'dev-tools', windows: ['main'], permissions: ['core:webview:allow-internal-toggle-devtools'], remote: undefined },
    ])
  })

  it('does not put that permission in any capability file a release reads', () => {
    expect(JSON.stringify(capability)).not.toContain('internal-toggle-devtools')
  })
})

describe('the HTTP plugin’s header filter, which the app relies on to send its User-Agent (SR-006, 19.12.4)', () => {
  // `unsafe-headers` is off, so the plugin drops the headers the fetch standard forbids. Our User-Agent (MusicBrainz asks for an
  // identifying one) gets through only because that list does not name it. A plugin update could change the list and the
  // plugin would then send its own default instead, with nothing failing but a connector's terms.

  /** The version of tauri-plugin-http whose filter was read and whose behaviour probe P8 showed (DECISIONS "Security review fix 19.12.4"). */
  const VERIFIED_VERSION = '2.6.0'

  const lockedVersion = (lock: string): string | undefined => /\[\[package\]\]\nname = "tauri-plugin-http"\nversion = "([^"]+)"/.exec(lock)?.[1]

  /** The text of the plugin's `is_unsafe_header`, the list of headers it drops. */
  const filterOf = (commandsSource: string): string | undefined => /fn is_unsafe_header[\s\S]*?\n\}\n/.exec(commandsSource)?.[0]

  it('is still the version whose filter was read; a new one needs probe P8 repeated first', () => {
    expect(
      lockedVersion(read('Cargo.lock')),
      [
        `tauri-plugin-http is no longer ${VERIFIED_VERSION}. Before updating VERIFIED_VERSION in this test, repeat probe P8`,
        '(docs/security-review.md, section 12: an echo host in the http:default scope, `tauri dev`, the P8 script) and read',
        '`is_unsafe_header` in the new version: our User-Agent must arrive and must not be on the plugin’s forbidden list.',
      ].join(' '),
    ).toBe(VERIFIED_VERSION)
  })

  it('finds the filter and the User-Agent in none of it (the check itself, on made-up sources)', () => {
    expect(filterOf('fn is_unsafe_header(h: &HeaderName) -> bool {\n    matches!(*h, header::COOKIE | header::HOST)\n}\n')).toBeDefined()
    expect(filterOf('fn is_unsafe_header(h: &HeaderName) -> bool {\n    matches!(*h, header::COOKIE | header::USER_AGENT)\n}\n')).toMatch(/USER_AGENT/)
    expect(filterOf('fn something_else() {}\n')).toBeUndefined()
  })

  // The plugin's source is in cargo's registry once the desktop app has been built on this machine; a fresh checkout has none, and
  // the version check above is then the only gate.
  const registry = `${homedir()}/.cargo/registry/src`
  const sourceFile = existsSync(registry)
    ? readdirSync(registry)
        .map((dir) => `${registry}/${dir}/tauri-plugin-http-${VERIFIED_VERSION}/src/commands.rs`)
        .find((file) => existsSync(file))
    : undefined

  it.skipIf(!sourceFile)('does not list user-agent among the headers it drops, in the verified version’s own source', () => {
    const filter = filterOf(readFileSync(sourceFile as string, 'utf8'))

    expect(filter).toBeDefined()
    expect(filter).toContain('header::COOKIE')
    expect(filter).not.toMatch(/user[-_]agent/i)
  })
})

