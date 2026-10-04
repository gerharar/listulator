import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The desktop window's Content-Security-Policy (review 2026-10-04, `tauri.conf.json`). The webview may call only
 * the hosts it names, so an adapter that starts calling a new host would fail in the desktop app alone, with
 * nothing but a console line to say why. Every upstream an adapter calls is reached either by the webview's own
 * `fetch` (then the CSP's `connect-src` must name it) or by the HTTP plugin (then its allowlist in
 * `capabilities/default.json` must, and the request goes over IPC, which the CSP allows).
 */

const REPO = join(import.meta.dirname, '../..')
const TAURI = join(REPO, 'apps/desktop/src-tauri')

const csp = (JSON.parse(readFileSync(join(TAURI, 'tauri.conf.json'), 'utf8')) as {
  app: { security: { csp: Record<string, string> } }
}).app.security.csp

const sources = (directive: string): string[] => (csp[directive] ?? '').split(/\s+/).filter(Boolean)

const pluginOrigins = (
  JSON.parse(readFileSync(join(TAURI, 'capabilities/default.json'), 'utf8')) as {
    permissions: (string | { identifier: string; allow?: { url: string }[] })[]
  }
).permissions
  .flatMap((permission) => (typeof permission === 'object' && permission.identifier === 'http:default' ? (permission.allow ?? []) : []))
  .map(({ url }) => new URL(url.replace(/\*$/, '')).origin)

/** Every `https://` origin written in the ingestion code (adapters and the library fetch), tests left out. */
function upstreamOrigins(): string[] {
  const dir = join(REPO, 'server/src/ingestion')
  const files = [
    ...readdirSync(join(dir, 'adapters')).map((name) => join(dir, 'adapters', name)),
    join(dir, 'customLists.ts'),
  ].filter((path) => path.endsWith('.ts') && !path.endsWith('.test.ts'))

  const origins = files.flatMap((path) =>
    [...readFileSync(path, 'utf8').matchAll(/https:\/\/[a-z0-9.-]+/gi)].map((match) => new URL(match[0]).origin),
  )

  return [...new Set(origins)].sort()
}

describe('the desktop window’s Content-Security-Policy', () => {
  it('lets the window reach every upstream an adapter calls, by its own fetch or through the HTTP plugin', () => {
    const allowed = new Set([...sources('connect-src'), ...pluginOrigins])

    expect(upstreamOrigins().length).toBeGreaterThan(5)
    expect(upstreamOrigins().filter((origin) => !allowed.has(origin))).toEqual([])
  })

  it('runs only the app’s own scripts and styles: nothing inline, nothing evaluated, no plugins', () => {
    for (const directive of ['script-src', 'style-src']) {
      expect(sources(directive)).toEqual(["'self'"])
    }
    expect(sources('object-src')).toEqual(["'none'"])
  })

  it('names no wildcard anywhere', () => {
    expect(Object.values(csp).join(' ')).not.toMatch(/(^|\s)(\*|https:|http:)(\s|$)/)
  })
})
