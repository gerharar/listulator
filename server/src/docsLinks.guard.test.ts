import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { brokenLinks } from './tools/docLinks.js'

/**
 * Every link in the documents a visitor reads on GitHub leads to a file that is public (Phase 20, task 20.2, BL-012).
 * `SPEC.md`, `tasks/`, `docs/` and the like exist only on the owner's computer, so a link to one is dead for everyone
 * else; this checks against what git tracks, not what is on disk. Web addresses are not fetched.
 */

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const PUBLIC_DOCUMENTS = ['README.md', 'CHANGELOG.md', 'SECURITY.md', 'CONTRIBUTING.md', 'NOTICE.md']

describe('the public documents', () => {
  const tracked = new Set(
    execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' }).split('\n').filter(Boolean),
  )

  it.each(PUBLIC_DOCUMENTS)('%s links only to files a visitor can open', (file) => {
    expect(tracked.has(file), `${file} is tracked`).toBe(true)

    expect(brokenLinks(file, readFileSync(`${REPO_ROOT}${file}`, 'utf8'), tracked)).toEqual([])
  })
})
