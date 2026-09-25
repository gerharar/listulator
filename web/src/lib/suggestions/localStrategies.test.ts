import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadLocalStrategy } from './localStrategies.js'

describe('the desktop app’s bundled strategies', () => {
  // The desktop has no filesystem: strategies are static imports, so a file added to
  // config/strategies/ that is not registered there would only fail at runtime, on a button.
  const dir = join(__dirname, '../../../../config/strategies')
  const shipped = readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.replace(/\.json$/, ''))

  it('finds the shipped files', () => {
    expect(shipped).toContain('finalizer')
    expect(shipped.length).toBeGreaterThanOrEqual(4)
  })

  it.each(shipped)('bundles and parses %s', (name) => {
    expect(loadLocalStrategy(name).name).toBe(name)
  })
})
