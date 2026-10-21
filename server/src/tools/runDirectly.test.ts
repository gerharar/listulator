import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { isRunDirectly } from './runDirectly.js'

/**
 * Phase 17, first Windows run: every script compared `import.meta.url` with `file://${process.argv[1]}`. On Windows
 * argv[1] is `D:\a\…\generateTokens.ts` and the URL `file:///D:/a/…`, so they never matched and the script silently
 * did nothing (the build then failed on the missing tokens.css, far from the cause).
 */
describe('isRunDirectly', () => {
  it('matches a POSIX path to its file URL', () => {
    expect(isRunDirectly('file:///Users/me/repo/web/scripts/gen.ts', '/Users/me/repo/web/scripts/gen.ts', { windows: false })).toBe(true)
  })

  it('matches a Windows path, with its drive letter and backslashes, to its file URL', () => {
    expect(isRunDirectly('file:///D:/a/listulator/web/scripts/gen.ts', 'D:\\a\\listulator\\web\\scripts\\gen.ts', { windows: true })).toBe(true)
  })

  it('matches a path with a space, which the URL encodes', () => {
    expect(isRunDirectly('file:///Users/me/My%20Repo/gen.ts', '/Users/me/My Repo/gen.ts', { windows: false })).toBe(true)
  })

  it('is false for another file, or when there is no script path (imported from a test or the REPL)', () => {
    expect(isRunDirectly('file:///Users/me/repo/gen.ts', '/Users/me/repo/other.ts', { windows: false })).toBe(false)
    expect(isRunDirectly('file:///Users/me/repo/gen.ts', undefined)).toBe(false)
  })

  describe('a script started by a path that goes through a symbolic link', () => {
    // macOS's temporary folder is one (/var is /private/var): Node gives import.meta.url the REAL path and argv[1] the path as it was
    // given, so the script silently did nothing and exited 0 (found by running release:ship's rehearsal on a real worktree, 31.5).
    let root: string
    afterEach(() => rmSync(root, { recursive: true, force: true }))

    function layout() {
      root = realpathSync(mkdtempSync(join(tmpdir(), 'run-directly-')))
      mkdirSync(join(root, 'real'))
      writeFileSync(join(root, 'real', 'gen.ts'), '')
      writeFileSync(join(root, 'real', 'other.ts'), '')
      symlinkSync(join(root, 'real'), join(root, 'link'))

      return { moduleUrl: pathToFileURL(join(root, 'real', 'gen.ts')).href, viaLink: join(root, 'link', 'gen.ts') }
    }

    it('still matches: the symbolic link is followed to the real file', () => {
      const { moduleUrl, viaLink } = layout()

      expect(isRunDirectly(moduleUrl, viaLink)).toBe(true)
    })

    it('does not match another file in the same folder, or a path that does not exist (and does not throw)', () => {
      const { moduleUrl } = layout()

      expect(isRunDirectly(moduleUrl, join(root, 'link', 'other.ts'))).toBe(false)
      expect(isRunDirectly(moduleUrl, join(root, 'link', 'missing.ts'))).toBe(false)
    })
  })
})
