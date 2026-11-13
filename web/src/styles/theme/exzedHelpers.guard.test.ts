import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { read } from './cssGuard.js'

/**
 * eX-Zed's helper text (D21a, X-007), `styles/theme/exzed-helpers.css` and the italic face: under `html.theme-exzed` only, in the skin's roles only, every Quantum italic covered, and the font
 * file the one design made (its size and sha256 are design's: a different file is a different font), declared as the italic of the same family.
 */
const FILE = 'styles/theme/exzed-helpers.css'
const exists = existsSync(join(import.meta.dirname, 'exzed-helpers.css'))
const css = exists ? read(FILE) : ''
const rules = (): [string, string][] => [...css.matchAll(/([^{}]+){([^{}]*)}/g)].map((m) => [m[1]!.trim(), m[2]!])
const SRC = join(import.meta.dirname, '..', '..')

describe('eX-Zed’s helper text', () => {
  it('is a stylesheet main.tsx imports after the tags', () => {
    expect(exists).toBe(true)
    const main = readFileSync(join(SRC, 'main.tsx'), 'utf8')
    expect(main).toMatch(/import '\.\/styles\/theme\/exzed-helpers\.css'/)
    expect(main.indexOf('exzed-helpers.css')).toBeGreaterThan(main.indexOf('exzed-tags.css'))
  })

  it('applies to eX-Zed only', () => {
    const selectors = rules().flatMap(([list]) => list.split(',').map((s) => s.trim()))
    expect(selectors.length).toBeGreaterThan(5)
    for (const selector of selectors) expect(selector, selector).toMatch(/^html\.theme-exzed\b/)
  })

  it('covers every place Quantum sets in italics, as the `helper` style: italic, 16px, regular, ink2', () => {
    const helper = /font-style:\s*italic;\s*font-size:\s*16px;\s*font-weight:\s*400;[^}]*color:\s*var\(--zx-ink2\);/
    for (const selector of ['input::placeholder', 'textarea::placeholder', '.q-input::placeholder', '.q-platfield-value.empty', '.q-tagchoice-value.empty', '.q-add-plat-value.empty', '.q-platcard-note']) {
      const rule = rules().find(([list]) => list.split(',').some((part) => part.trim() === `html.theme-exzed ${selector}`))
      expect(rule, selector).toBeDefined()
      expect(rule![1], selector).toMatch(helper)
    }
  })

  it('leaves no italic of Quantum’s uncovered (a new one is a new helper, to be listed here)', () => {
    const found: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry)
        if (statSync(path).isDirectory()) walk(path)
        else if (path.endsWith('.css') && !path.includes(join('styles', 'theme')) && /italic/.test(readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''))) found.push(path.slice(SRC.length + 1))
      }
    }
    walk(SRC)
    expect(found.sort()).toEqual([
      'components/quantum/Field/Field.css',
      'components/quantum/PlatformChip/PlatformCard.css',
      'screens/list/AddItemForm.css',
      'screens/list/ItemEditPopover.css',
      'styles/quantum/base.css',
    ])
  })

  it('has no shadow, alpha, radius, opacity, filter or literal colour, and only the 16px of the type scale', () => {
    expect(css).not.toMatch(/box-shadow|border-radius|opacity\s*:|[;{\s]filter\s*:|rgba?\(|hsla?\(|color-mix|#[0-9a-f]{3,8}\b/i)
    for (const [, size] of css.matchAll(/(\d+)px/g)) expect(['16']).toContain(size)
  })
})

describe('the italic face', () => {
  const file = join(SRC, 'styles', 'theme', 'fonts', 'ZXSpectrum-Italic.ttf')

  it('is the file design made: 81,644 bytes, sha256 53d68b1e…8825361', () => {
    expect(statSync(file).size).toBe(81_644)
    expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe('53d68b1e48f533b497c09124901bb2740c79a7e5b7c61c10bfc599bd88825361')
  })

  it('is declared in fonts.css as the italic of the same family, regular weight, beside the regular face', () => {
    const faces = [...read('styles/theme/fonts.css').matchAll(/@font-face\s*{([^}]*)}/g)].map((m) => m[1]!)
    const italic = faces.find((face) => face.includes('ZXSpectrum-Italic.ttf'))
    expect(faces).toHaveLength(2)
    expect(italic).toMatch(/font-family:\s*'ZX Spectrum';/)
    expect(italic).toMatch(/font-weight:\s*400;\s*font-style:\s*italic;/)
  })

  it('is named in NOTICE.md beside the regular face', () => {
    expect(readFileSync(join(SRC, '..', '..', 'NOTICE.md'), 'utf8')).toContain('web/src/styles/theme/fonts/ZXSpectrum-Italic.ttf')
  })
})
