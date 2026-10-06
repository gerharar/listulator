import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { fetchCanonicalManifest } from './ingestion/customLists.js'
import type { FetchLike } from './ingestion/http.js'

/**
 * Which GitHub account every copy of the app trusts (security review, Phase 19, task 19.7; docs/security-review.md
 * SR-020, SR-034). The owner renamed the account on 2026-10-01; the same day, another account took the old name, and
 * until then the code fetched its list library from that name. A copy that still carries the old name reads lists
 * from whoever owns it now. So the current name is pinned here, and the old one may not come back into a tracked file.
 * A rename is a decision: change this test in the same commit and read SR-020 first.
 */

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const OWNER = 'gerharar'
/** Written in two halves so this file does not contain the name it forbids. */
const OLD_HANDLE = ['neuro', 'shaoh'].join('')

describe('the GitHub account the app trusts', () => {
  it('is the one the library is fetched from', async () => {
    const urls: string[] = []
    const fake: FetchLike = async (input) => {
      urls.push(String(input))
      return new Response('[]', { status: 200 })
    }

    await fetchCanonicalManifest(fake)

    expect(urls).toEqual([`https://raw.githubusercontent.com/${OWNER}/listulator/main/lists/index.json`])
  })

  it('is the one the desktop app may open links to', () => {
    const capability = readFileSync(`${REPO_ROOT}apps/desktop/src-tauri/capabilities/default.json`, 'utf8')

    expect(capability).toContain(`https://github.com/${OWNER}/listulator`)
  })

  it('is the only account named by a tracked file: the previous handle is in none', () => {
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf8' }).split('\0').filter(Boolean)
    const mentions = tracked.filter((path) => {
      try {
        return readFileSync(`${REPO_ROOT}${path}`, 'utf8').toLowerCase().includes(OLD_HANDLE)
      } catch {
        return false
      }
    })

    expect(mentions).toEqual([])
  })
})
