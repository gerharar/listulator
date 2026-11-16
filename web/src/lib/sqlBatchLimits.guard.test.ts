import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The two locks on `sql_batch` (53.1, 53.2) must be the same lock. The isolation hook refuses a call over 2,000 statements or 64 MiB before it
 * leaves the frame; the native command refuses the same again (`Limits::DEFAULT`). A number changed on one side only would leave the other
 * either refusing what the first admits (a rewrite that fails after the page was told it passed) or admitting what the first refuses.
 * Reads both files, as `vacuumThresholds.guard.test.ts` does for the vacuum.
 */
const ROOT = join(import.meta.dirname, '../../..')
const rust = readFileSync(join(ROOT, 'apps/desktop/src-tauri/src/sql_batch.rs'), 'utf8')
const hook = readFileSync(join(ROOT, 'apps/desktop/isolation/hook.js'), 'utf8')

/** `64 * 1024 * 1024` or `2_000` or `2000` as a number. */
const product = (text: string): number =>
  text
    .split('*')
    .map((factor) => Number(factor.replace(/_/g, '').trim()))
    .reduce((all, factor) => all * factor, 1)

describe('the limits of one sql_batch call, in the hook and in the native command', () => {
  const native = /pub const DEFAULT: Limits = Limits \{ statements: ([\d_]+), bytes: ([\d_ *]+) \}/.exec(rust)
  const inHook = {
    statements: /var BATCH_MAX_STATEMENTS = ([\d_ *]+)\n/.exec(hook)?.[1],
    bytes: /var BATCH_MAX_BYTES = ([\d_ *]+)\n/.exec(hook)?.[1],
  }

  it('finds both (the check itself)', () => {
    expect(native).not.toBeNull()
    expect(inHook.statements).toBeDefined()
    expect(inHook.bytes).toBeDefined()
  })

  it('allows the same number of statements', () => {
    expect(product(inHook.statements ?? '')).toBe(product(native?.[1] ?? ''))
    expect(product(native?.[1] ?? '')).toBe(2000)
  })

  it('allows the same number of bytes', () => {
    expect(product(inHook.bytes ?? '')).toBe(product(native?.[2] ?? ''))
    expect(product(native?.[2] ?? '')).toBe(64 * 1024 * 1024)
  })

  it('counts a value the same way (text by its length, a number as 20, null as 4)', () => {
    expect(hook).toMatch(/if \(value === null\) return 4\s+if \(typeof value === 'string'\) return value\.length\s+if \(typeof value === 'number' && isFinite\(value\)\) return 20/)
    expect(rust).toMatch(/Value::String\(text\) => text\.len\(\),\s+Value::Number\(_\) => 20,\s+Value::Bool\(_\) => 5,\s+Value::Null => 4,/)
  })
})
