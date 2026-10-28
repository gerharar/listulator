import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MIN_FREE_BYTES, MIN_FREE_SHARE } from './reclaimSpace.js'

/**
 * The server and the desktop app both give a database file its free space back at start (BL-151), and must agree on when: a file the
 * desktop would rewrite but the server would not (or the reverse) is a number somebody changed in one place. The desktop's half is
 * Rust, so this reads its source.
 */
const rust = readFileSync(fileURLToPath(new URL('../../../apps/desktop/src-tauri/src/vacuum.rs', import.meta.url)), 'utf8')

describe('the vacuum thresholds', () => {
  it('are the same in the server (reclaimSpace.ts) and the desktop app (vacuum.rs)', () => {
    const bytes = /pub const MIN_FREE_BYTES: u64 = (\d+) \* 1024 \* 1024;/.exec(rust)
    const denominator = /pub const MIN_FREE_SHARE_DENOMINATOR: u64 = (\d+);/.exec(rust)

    expect(bytes, 'MIN_FREE_BYTES is written as `N * 1024 * 1024` in vacuum.rs').not.toBeNull()
    expect(denominator, 'MIN_FREE_SHARE_DENOMINATOR is a plain number in vacuum.rs').not.toBeNull()
    expect(Number(bytes![1]) * 1024 * 1024).toBe(MIN_FREE_BYTES)
    expect(1 / Number(denominator![1])).toBe(MIN_FREE_SHARE)
  })

  it('are applied in the desktop app from `setup`, where the page cannot reach the database yet (vacuum.rs says why)', () => {
    const lib = readFileSync(fileURLToPath(new URL('../../../apps/desktop/src-tauri/src/lib.rs', import.meta.url)), 'utf8')

    expect(lib).toContain('mod vacuum;')
    expect(lib).toMatch(/\.setup\(\|app\| \{[\s\S]*vacuum::reclaim\(/)
  })
})
