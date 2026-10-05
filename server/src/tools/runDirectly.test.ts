import { describe, expect, it } from 'vitest'
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
})
