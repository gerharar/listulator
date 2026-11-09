import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The installed web app (PWA) precaches its shell so it opens with no network; the Spectrum font is part of the shell now that eX-Zed can be chosen (Phase 49.13,
 * owner’s decision 2026-11-08, overriding the runtime cache I had recommended): about 94 KB on a 1.67 MB install, and an offline start in eX-Zed draws in the font from
 * the first start, not only after it has been seen once online. Closes the deferral of 48.1 (“.ttf not in the precache, revisit at X-003”).
 */
const ROOT = join(import.meta.dirname, '..')
const config = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8')

describe('the PWA’s precache patterns (vite.config.ts)', () => {
  const patterns = /globPatterns:\s*\['\*\*\/\*\.\{([^}]+)\}'\]/.exec(config)?.[1]?.split(',')

  it('are read', () => {
    expect(patterns).toBeDefined()
  })

  it('hold the shell’s files as before and now the Spectrum font’s .ttf', () => {
    expect(patterns).toEqual(['js', 'css', 'html', 'woff2', 'ttf'])
  })
})

describe('the built service worker (dist/sw.js, after `npm run build`)', () => {
  const worker = join(ROOT, 'dist', 'sw.js')

  it.skipIf(!existsSync(worker))('precaches the Spectrum font exactly once', () => {
    const manifest = [...readFileSync(worker, 'utf8').matchAll(/\{url:"([^"]+)"/g)].map((match) => match[1]!)

    expect(manifest.filter((url) => /^assets\/ZXSpectrum-[\w-]+\.ttf$/.test(url))).toHaveLength(1)
  })
})
