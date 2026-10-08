import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isRunDirectly } from './runDirectly.js'
import { VERSION_SOURCES, versionProblems, withVersion, type RepoFiles } from './versionSources.js'

/**
 * Sets the app's version everywhere it is written (Phase 20, task 20.3):
 * `npm run version:set -w @listulator/server -- 1.0.0-rc.2`. Writes nothing unless the version is valid, and checks
 * the result before saying so.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

if (isRunDirectly(import.meta.url)) {
  const version = process.argv[2]
  if (!version) {
    console.error('Usage: npm run version:set -w @listulator/server -- <version>   (e.g. 1.0.0-rc.2)')
    process.exit(1)
  }

  const before: RepoFiles = {}
  for (const file of new Set(VERSION_SOURCES.map((source) => source.file))) {
    before[file] = readFileSync(`${REPO_ROOT}${file}`, 'utf8')
  }

  const after = withVersion(before, version)
  const problems = versionProblems(after)
  if (problems.length > 0) {
    console.error(problems.join('\n'))
    process.exit(1)
  }

  for (const [file, text] of Object.entries(after)) {
    if (text !== before[file]) writeFileSync(`${REPO_ROOT}${file}`, text)
  }
  console.log(`Version is ${version} in ${Object.keys(after).length} files.`)
}
