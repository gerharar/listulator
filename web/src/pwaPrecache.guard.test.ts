import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
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

/**
 * eX-Zed's art (Phase 50, X-006) is **not** in the precache: it is decoration, the layout and the text work without it, and a Quantum user would otherwise download about
 * 530 KB of pictures for a theme they never pick. The owner’s answer (2026-11-10, “Runtime cache is OK”): a **runtime cache** for the art, `CacheFirst`, filled the first time a
 * skin is used (and the list header, the picker and the vault the first time each is drawn); an offline first start in a skin that was never used online draws without its art.
 * The art is every picture under `/assets/` (the build puts the app’s icons in the root, not there). Vite never inlines the art into the stylesheet (50.9), so each is a request.
 */
describe('the art’s runtime cache (vite.config.ts)', () => {
  const pattern = /urlPattern:\s*(\/[^\n]+\/),/.exec(config)?.[1]
  const art = pattern ? new RegExp(pattern.slice(1, -1)) : null

  it('has a rule for the art folder’s pictures, CacheFirst, in a cache of its own with an expiry', () => {
    expect(pattern, 'the rule’s urlPattern is read').toBeDefined()
    expect(config).toMatch(/runtimeCaching:\s*\[/)
    expect(config).toMatch(/handler:\s*'CacheFirst'/)
    expect(config).toMatch(/cacheName:\s*'listulator-art'/)
    expect(config).toMatch(/expiration:\s*{[^}]*maxEntries:\s*\d+[^}]*maxAgeSeconds:\s*\d+/)
    expect(config).toMatch(/cacheableResponse:\s*{\s*statuses:\s*\[200\]\s*}/)
  })

  it('matches a built art picture and nothing else the app fetches: not the code, the icons, the font, the manifest or the API', () => {
    for (const hit of ['http://127.0.0.1:4173/assets/movies-AbC_12-3.png', 'https://listulator.example/assets/side-stripes--it6Zmfo.png']) expect(art!.test(hit), hit).toBe(true)
    for (const miss of ['/assets/index-CGLahyjB.js', '/assets/index-Cyr7wBDe.css', '/assets/ZXSpectrum-x1.ttf', '/icon-192.png', '/apple-touch-icon.png', '/api/lists/1.png', '/assets/movies.png.map', '/manifest.webmanifest']) {
      expect(art!.test(`http://127.0.0.1:4173${miss}`), miss).toBe(false)
    }
  })

  it('leaves the precache without a picture: the patterns name no png', () => {
    const precached = /globPatterns:\s*\['\*\*\/\*\.\{([^}]+)\}'\]/.exec(config)?.[1]?.split(',')

    expect(precached).toBeDefined()
    expect(precached).not.toContain('png')
  })
})

describe('the built service worker holds the art rule and no picture (dist/sw.js, after `npm run build`)', () => {
  const worker = join(ROOT, 'dist', 'sw.js')

  it.skipIf(!existsSync(worker))('precaches no picture under assets/, and routes the art through the listulator-art cache', () => {
    const source = readFileSync(worker, 'utf8')
    const manifest = [...source.matchAll(/\{url:"([^"]+)"/g)].map((match) => match[1]!)

    expect(manifest.filter((url) => /\.png$/.test(url) && url.startsWith('assets/'))).toEqual([])
    expect(source).toContain('listulator-art')
    expect(source).toMatch(/CacheFirst/)
  })
})

/**
 * A size guard for the art folder: no single picture over 256 KiB. The two stone walls (185 and 218 KB, one-bit, drawn 1:1) are the largest and fit; a bigger one is a decision,
 * not an accident. The limit is **my proposal** (2026-11-11), for the owner to name or change; a lossless, pixel-identical recompress is his call and is never done silently.
 */
const ART_LIMIT_BYTES = 256 * 1024

describe('the art folder’s size', () => {
  const folder = join(ROOT, 'src', 'styles', 'theme', 'art')
  const files = readdirSync(folder).filter((name) => name.endsWith('.png'))

  it('holds the pictures (a guard over an empty folder guards nothing)', () => {
    expect(files.length).toBeGreaterThanOrEqual(30)
  })

  it.each(files)('%s is under 256 KiB', (name) => {
    expect(statSync(join(folder, name)).size, `${name} is over the limit`).toBeLessThanOrEqual(ART_LIMIT_BYTES)
  })
})
