import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Writes `THIRD-PARTY-NOTICES.txt` at the repo root: the licence text of every
 * third-party package the app ships, which the permissive licences it uses
 * (MIT, BSD, ISC, Apache, OFL, ...) require to travel with it (owner,
 * 2026-09-30). Two parts:
 *
 * - **npm**: what the web build bundles, i.e. the web workspace's own
 *   dependencies and theirs (not dev tools, not the server's packages), plus
 *   the service-worker code the PWA plugin writes into the build. The same
 *   code ships inside the desktop app.
 * - **Rust**: every crate in the desktop app's `Cargo.lock`, for all
 *   platforms (a superset of any one build; run `cargo fetch` first so every
 *   crate's files are on disk).
 *
 * Each distinct licence text is printed once, under every package it covers.
 * Rerun after changing dependencies: `npx tsx server/src/tools/generateThirdPartyNotices.ts`.
 */

const REPO = fileURLToPath(new URL('../../../', import.meta.url))
const OUT = join(REPO, 'THIRD-PARTY-NOTICES.txt')
const CARGO_MANIFEST = join(REPO, 'apps/desktop/src-tauri/Cargo.toml')

export interface Notice {
  name: string
  version: string
  licence: string
  /** The package's own licence file(s), or null when it ships none. */
  text: string | null
}

/**
 * Which licence we take a package under. A choice (`A OR B`) is taken as MIT
 * where offered, else Apache-2.0, else its first option that is not copyleft;
 * an `AND` means every part applies, so it stays whole.
 */
export function chooseLicence(expression: string): string {
  const normalized = expression.replace(/\//g, ' OR ').replace(/\s+/g, ' ').trim()
  if (/\bAND\b/.test(normalized)) return normalized

  const options = normalized.replace(/^\((.*)\)$/, '$1').split(' OR ').map((option) => option.trim())
  return (
    options.find((option) => option === 'MIT') ??
    options.find((option) => option === 'Apache-2.0') ??
    options.find((option) => !/GPL/.test(option)) ??
    options[0]!
  )
}

interface LockPackage {
  version?: string
  license?: string
  dev?: boolean
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

export interface ShippedPackage {
  name: string
  version: string
  licence: string
  path: string
}

/**
 * The packages a workspace ships, from `package-lock.json`: its dependencies,
 * each resolved the way Node does (the nearest `node_modules` walking up), and
 * theirs in turn.
 */
export function npmShippedPackages(lock: { packages: Record<string, LockPackage> }, workspace: string): ShippedPackage[] {
  const packages = lock.packages
  const found = new Map<string, ShippedPackage>()

  function resolve(name: string, from: string): string | undefined {
    let base = from
    for (;;) {
      const candidate = base ? `${base}/node_modules/${name}` : `node_modules/${name}`
      if (packages[candidate]) return candidate
      if (!base) return undefined
      const up = base.lastIndexOf('/node_modules/')
      // One level up: out of a nested node_modules, or from a top-level package or workspace to the root.
      base = up === -1 ? '' : base.slice(0, up)
    }
  }

  function visit(from: string): void {
    const wanted = { ...(packages[from]?.dependencies ?? {}), ...(packages[from]?.optionalDependencies ?? {}) }
    for (const name of Object.keys(wanted)) {
      const path = resolve(name, from)
      if (!path || found.has(path)) continue
      const entry = packages[path]!
      if (entry.dev) continue
      found.set(path, { name, version: entry.version ?? '', licence: entry.license ?? 'UNKNOWN', path })
      visit(path)
    }
  }

  visit(workspace)
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
}

/** One section: each distinct licence text once, under the packages it covers. */
export function renderNotices(title: string, notices: readonly Notice[]): string {
  const groups = new Map<string, Notice[]>()
  for (const notice of notices) {
    const key = notice.text ?? `\u0000${notice.licence}`
    groups.set(key, [...(groups.get(key) ?? []), notice])
  }

  const blocks = [...groups.entries()]
    .map(([key, members]) => {
      const sorted = [...members].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
      const text = key.startsWith('\u0000')
        ? `No licence file ships with this package; its licence is ${sorted[0]!.licence}: https://spdx.org/licenses/${sorted[0]!.licence}.html`
        : key.trim()
      return { first: sorted[0]!.name, body: `${sorted.map((n) => `${n.name} ${n.version} (${n.licence})`).join('\n')}\n\n${text}\n` }
    })
    .sort((a, b) => a.first.localeCompare(b.first))

  const rule = '-'.repeat(78)
  return `${'='.repeat(78)}\n${title}\n${'='.repeat(78)}\n\n${blocks.map((block) => block.body).join(`\n${rule}\n\n`)}`
}

const LICENCE_FILE = /^(licen[cs]e|copying|notice)/i

/** Licence files in a package folder; a `LICENSES/` folder (the REUSE layout) counts file by file. */
function licenceFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => LICENCE_FILE.test(entry.name))
    .flatMap((entry) =>
      entry.isDirectory()
        ? readdirSync(join(dir, entry.name), { withFileTypes: true })
            .filter((inner) => inner.isFile())
            .map((inner) => join(entry.name, inner.name))
        : entry.isFile()
          ? [entry.name]
          : [],
    )
    .sort()
}

/** The licence file(s) that go with the licence chosen: LICENSE-MIT for MIT when a crate ships one per option. */
function licenceText(dir: string, licence: string): string | null {
  const files = licenceFiles(dir)
  if (files.length === 0) return null

  const tag = licence === 'MIT' ? /mit/i : licence === 'Apache-2.0' ? /apache/i : null
  const matching = tag ? files.filter((file) => tag.test(file)) : []
  return (matching.length > 0 ? matching : files).map((file) => readFileSync(join(dir, file), 'utf8').trim()).join('\n\n')
}

/**
 * Code the build writes into the output although no app file imports it: the PWA's service
 * worker (Workbox's runtime modules) and vite-plugin-pwa's registration script. Dev
 * dependencies, so the dependency walk above never reaches them.
 */
const BUILD_INJECTED = /^node_modules\/(workbox-(?!build\b|cli\b)[a-z-]+|vite-plugin-pwa)$/

function npmNotices(): Notice[] {
  const lock = JSON.parse(readFileSync(join(REPO, 'package-lock.json'), 'utf8')) as { packages: Record<string, LockPackage> }
  const injected = Object.entries(lock.packages)
    .filter(([path]) => BUILD_INJECTED.test(path))
    .map(([path, entry]) => ({ name: path.slice('node_modules/'.length), version: entry.version ?? '', licence: entry.license ?? 'UNKNOWN', path }))
  return [...npmShippedPackages(lock, 'web'), ...injected].map((pkg) => {
    const licence = chooseLicence(pkg.licence)
    return { name: pkg.name, version: pkg.version, licence, text: licenceText(join(REPO, pkg.path), licence) }
  })
}

interface CargoPackage {
  name: string
  version: string
  source: string | null
  license: string | null
  license_file: string | null
  manifest_path: string
}

function rustNotices(): Notice[] {
  const metadata = JSON.parse(
    execFileSync('cargo', ['metadata', '--format-version', '1', '--offline', '--manifest-path', CARGO_MANIFEST], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    }),
  ) as { packages: CargoPackage[] }

  return metadata.packages
    .filter((pkg) => pkg.source)
    .map((pkg) => {
      const dir = dirname(pkg.manifest_path)
      const licence = pkg.license ? chooseLicence(pkg.license) : 'SEE LICENSE FILE'
      const text = pkg.license_file
        ? readFileSync(join(dir, pkg.license_file), 'utf8').trim()
        : licenceText(dir, licence)
      return { name: pkg.name, version: pkg.version, licence, text }
    })
}

function main(): void {
  const npm = npmNotices()
  const rust = rustNotices()
  const header =
    'Third-party software in Listulator\n\n' +
    'Listulator itself is under the PolyForm Noncommercial License 1.0.0 (LICENSE). It includes the\n' +
    'third-party software below, each under its own licence, whose text follows its name. Where a\n' +
    'package offers a choice of licences, the one named is the one Listulator uses it under.\n' +
    'Generated by server/src/tools/generateThirdPartyNotices.ts; do not edit by hand.\n\n'

  writeFileSync(
    OUT,
    header +
      renderNotices(`Web app and desktop app: JavaScript packages (${npm.length})`, npm) +
      '\n' +
      renderNotices(`Desktop app: Rust crates, all platforms (${rust.length})`, rust),
  )

  const missing = [...npm, ...rust].filter((notice) => notice.text === null)
  console.log(`Wrote ${OUT}: ${npm.length} npm packages, ${rust.length} crates, ${missing.length} without a licence file.`)
  for (const notice of missing) console.log(`  no licence file: ${notice.name} ${notice.version} (${notice.licence})`)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
