import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { VERSION_SOURCES, isReleaseVersion, versionProblems, type RepoFiles } from './tools/versionSources.js'

/**
 * The app has one version (Phase 20, task 20.3, docs/DECISIONS.md). The updater compares the version a build carries
 * with the one a release offers, and the About page shows it: a copy that lags behind makes an installed build say
 * something other than what it is. Edit the root `package.json` through `npm run version:set -w @listulator/server --
 * <version>`, never one copy by hand; this fails when one disagrees.
 */

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))

function repoFiles(): RepoFiles {
  const files: RepoFiles = {}
  for (const file of new Set(VERSION_SOURCES.map((source) => source.file))) {
    files[file] = readFileSync(`${REPO_ROOT}${file}`, 'utf8')
  }
  return files
}

describe('the app version', () => {
  it('is the same in every file that carries it', () => {
    expect(versionProblems(repoFiles())).toEqual([])
  })

  it('is a version Cargo, npm and the updater all read: major.minor.patch with an optional -rc.N', () => {
    const files = repoFiles()
    const version = VERSION_SOURCES[0]!.read(files['package.json']!)

    expect(isReleaseVersion(version)).toBe(true)
  })

  it('is a number in tauri.conf.json, not a path (Tauri resolves a path against the directory it runs from)', () => {
    const config = JSON.parse(repoFiles()['apps/desktop/src-tauri/tauri.conf.json']!) as { version: string }

    expect(isReleaseVersion(config.version)).toBe(true)
  })
})
