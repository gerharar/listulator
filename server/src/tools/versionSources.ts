/**
 * Every place the app's version is written (Phase 20, task 20.3). The root `package.json` is the one to edit by
 * hand, through `npm run version:set -- <version>`; that rewrites each copy below, and
 * `server/src/version.guard.test.ts` fails when a copy disagrees. The copies exist because each tool wants its
 * own: npm (four `package.json` files and the lock), Cargo (`Cargo.toml`, `Cargo.lock`), Tauri (`tauri.conf.json`).
 * The web app's About page reads the root `package.json` itself at build time (`web/vite.config.ts`).
 *
 * `tauri.conf.json` could point at the root `package.json` instead of carrying a number, but Tauri resolves that
 * path against the working directory of whatever runs it (the CLI, `build.rs` and a plain `cargo build` differ),
 * so it is a number here, kept in step by this file (docs/DECISIONS.md, 20.3).
 */

/** File path (from the repository root) to the file's text. */
export type RepoFiles = Record<string, string>

export interface VersionSource {
  file: string
  /** Names the copy in a message. */
  label: string
  /** The version this file carries; throws when there is none. */
  read(text: string): string
  /** The file with its version replaced and nothing else changed. */
  write(text: string, version: string): string
}

/** Semantic Versioning 2.0.0 with an optional pre-release (`1.0.0-rc.1`) and no build metadata (`+…`). */
const RELEASE_VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-(0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(\.(0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?$/

export function isReleaseVersion(version: string): boolean {
  return RELEASE_VERSION.test(version)
}

type Json = { [key: string]: Json | string | undefined }

/** A `"version"` inside a JSON file, found by the keys leading to it (e.g. `['packages', 'web']`). */
function jsonVersion(file: string, label: string, path: readonly string[]): VersionSource {
  const dig = (root: Json): Json => path.reduce<Json>((node, key) => (node[key] ?? {}) as Json, root)

  return {
    file,
    label,
    read(text) {
      const version = dig(JSON.parse(text) as Json)['version']
      if (typeof version !== 'string') throw new Error('no version found')
      return version
    },
    write(text, version) {
      const root = JSON.parse(text) as Json
      const node = dig(root)
      if (typeof node['version'] !== 'string') throw new Error('no version found')
      node['version'] = version
      return `${JSON.stringify(root, null, 2)}\n`
    },
  }
}

/** A version held in text by a pattern whose second group is the number (`before`, `version`, `after`). */
function patternVersion(file: string, label: string, pattern: RegExp): VersionSource {
  return {
    file,
    label,
    read(text) {
      const found = pattern.exec(text)?.[2]
      if (found === undefined) throw new Error('no version found')
      return found
    },
    write(text, version) {
      if (!pattern.test(text)) throw new Error('no version found')
      return text.replace(pattern, (_whole, before: string, _old: string, after: string) => `${before}${version}${after}`)
    },
  }
}

/** The first of these is the one edited by hand; all the others follow it. */
export const VERSION_SOURCES: readonly VersionSource[] = [
  jsonVersion('package.json', 'package.json', []),
  jsonVersion('server/package.json', 'server/package.json', []),
  jsonVersion('web/package.json', 'web/package.json', []),
  jsonVersion('apps/desktop/package.json', 'apps/desktop/package.json', []),
  jsonVersion('package-lock.json', 'package-lock.json (top)', []),
  jsonVersion('package-lock.json', 'package-lock.json (packages[""])', ['packages', '']),
  jsonVersion('package-lock.json', 'package-lock.json (packages["server"])', ['packages', 'server']),
  jsonVersion('package-lock.json', 'package-lock.json (packages["web"])', ['packages', 'web']),
  jsonVersion('package-lock.json', 'package-lock.json (packages["apps/desktop"])', ['packages', 'apps/desktop']),
  jsonVersion('apps/desktop/src-tauri/tauri.conf.json', 'apps/desktop/src-tauri/tauri.conf.json', []),
  // The [package] table only: the first `version =` after `[package]` and before the next table.
  patternVersion(
    'apps/desktop/src-tauri/Cargo.toml',
    'apps/desktop/src-tauri/Cargo.toml',
    /(^\[package\][^[]*?^version\s*=\s*")([^"]+)(")/m,
  ),
  patternVersion(
    'apps/desktop/src-tauri/Cargo.lock',
    'apps/desktop/src-tauri/Cargo.lock',
    /(name = "listulator-desktop"\r?\nversion = ")([^"]+)(")/,
  ),
]

/** Every disagreement, one message per copy; empty when the repository carries one version. */
export function versionProblems(files: RepoFiles): string[] {
  const [truth, ...copies] = VERSION_SOURCES
  const problems: string[] = []
  const read = (source: VersionSource): string | undefined => {
    try {
      return source.read(files[source.file] ?? '')
    } catch {
      problems.push(`${source.label}: no version found`)
      return undefined
    }
  }

  const expected = read(truth!)
  if (expected === undefined) return problems
  if (!isReleaseVersion(expected)) return [`${truth!.label}: "${expected}" is not a version (major.minor.patch, optionally -rc.1)`]

  for (const source of copies) {
    const found = read(source)
    if (found !== undefined && found !== expected) {
      problems.push(`${source.label} says ${found}, but ${truth!.label} says ${expected}`)
    }
  }
  return problems
}

/** The files with `version` written into every copy. Throws, changing nothing, when it is not a version. */
export function withVersion(files: RepoFiles, version: string): RepoFiles {
  if (!isReleaseVersion(version)) {
    throw new Error(`"${version}" is not a version (major.minor.patch, optionally -rc.1; no leading v, no +build)`)
  }
  const next: RepoFiles = { ...files }
  for (const source of VERSION_SOURCES) next[source.file] = source.write(next[source.file] ?? '', version)
  return next
}
