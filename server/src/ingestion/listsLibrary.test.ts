import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateListsIndex } from '../tools/generateListsIndex.js'
import { createMediaTypeRegistry } from './mediaTypes.js'

/**
 * Validates the real, committed `lists/` library (task 10.2d) — not a
 * fixture. `generateListsIndex.test.ts` already proves the generator itself
 * catches a malformed file (a temp-dir fixture); this file's job is to run
 * that same real parser against what's actually tracked in the repo, so a
 * list PR that breaks the format fails `npm run test`, not just a manual
 * "did anyone run the generator" check.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const LISTS_DIR = `${REPO_ROOT}lists`
const VALID_CATEGORIES = new Set(createMediaTypeRegistry().keys())

/**
 * Copies every git-tracked `lists/**\/*.yaml` file into a clean temp
 * directory, so validation only ever sees what's actually tracked. An
 * in-progress, not-yet-committed draft (this project's own curation
 * workflow: generators draft, the owner reviews before it's finalized)
 * must not fail this check just by sitting on disk.
 */
function trackedListsCopy(): string {
  const tracked = execFileSync('git', ['ls-files', '--', 'lists/'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter((path) => path.endsWith('.yaml') || path.endsWith('.yml'))

  const dir = mkdtempSync(join(tmpdir(), 'listulator-tracked-lists-'))
  for (const relativePath of tracked) {
    const withoutPrefix = relativePath.replace(/^lists\//, '')
    const destination = join(dir, withoutPrefix)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, readFileSync(join(REPO_ROOT, relativePath)))
  }
  return dir
}

describe('the committed lists/ library', () => {
  let dir: string

  beforeEach(() => {
    dir = trackedListsCopy()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('every tracked file parses cleanly through the real parser', () => {
    // generateListsIndex re-parses every file and throws, naming the
    // offending one, on the first that doesn't validate.
    expect(() => generateListsIndex(dir, VALID_CATEGORIES)).not.toThrow()
  })

  it('lists/index.json matches what the tracked files produce — no drift', () => {
    const generated = generateListsIndex(dir, VALID_CATEGORIES)
    const committed = JSON.parse(readFileSync(`${LISTS_DIR}/index.json`, 'utf8')) as unknown

    expect(generated).toEqual(committed)
  })
})
