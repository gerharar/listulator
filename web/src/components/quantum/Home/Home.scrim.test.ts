import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { declarations } from '../../../styles/theme/cssGuard.js'

// jsdom applies no stylesheet, so the rules are read from the files themselves (as `Home.layout.test.ts` does). What a browser makes of them (the box, the fade, the edges at
// 100%, 125% and 150%) is `e2e/helper-scrim.spec.ts`.
const read = (path: string) => readFileSync(join(import.meta.dirname, path), 'utf8')
const home = declarations(read('Home.css'))
const tokens = declarations(read('../../../styles/quantum/tokens.css'))
const exzed = declarations(read('../../../styles/theme/exzed-sheets.css'))

const of = (all: ReturnType<typeof declarations>, selector: string) => Object.fromEntries(all.filter((d) => d.selector === selector).map((d) => [d.property, d.value]))

/** H-028: a flat veil over Home's list while a helper sheet is open. */
describe('the sheet scrim (H-028), Quantum', () => {
  const scrim = of(home, '.q-scrim')

  it('is a flat `scrim` colour, no pattern, over the room under the help row: the sheet’s room and its 18px drop, across the anchor', () => {
    expect(scrim['position']).toBe('absolute')
    expect(scrim['background']).toBe('var(--scrim)')
    expect([scrim['top'], scrim['left'], scrim['right']]).toEqual(['0', '0', '0'])
    expect(scrim['height']).toBe('calc(var(--help-room, 420px) + 18px)')
  })

  it('takes the pointer (the owner, Checkpoint I): a press on the shaded list does not fall through to the row under it', () => {
    // Design's entry said `pointer-events: none`; the owner's rule is the opposite, so the default (`auto`) stands and nothing turns it off.
    expect(scrim['pointer-events']).not.toBe('none')
  })

  it('sits at 89, one under the sheet’s 90, inside the anchor that holds both', () => {
    expect(scrim['z-index']).toBe('var(--z-scrim)')
    expect(of(home, '.q-help-anchor')['z-index']).toBe('90')
    expect(of(declarations(read('../Sheet/Sheet.css')), '.q-sheet')['z-index']).toBe('90')
  })

  it('fades in over 140ms, linear, and not at all under reduced motion', () => {
    expect(scrim['animation']).toBe('q-scrim-in var(--d-scrim) linear')
    expect(of(home, 'html[data-reduced] .q-scrim')['animation']).toBe('none')
    expect(read('Home.css')).toMatch(/@keyframes q-scrim-in\s*\{\s*from\s*\{\s*opacity:\s*0;?\s*\}\s*to\s*\{\s*opacity:\s*1;?\s*\}\s*\}/)
  })

  it('is left to eX-Zed’s own checkerboard, which is drawn on the anchor itself, so the element is not drawn there too', () => {
    expect(of(exzed, 'html.theme-exzed .q-scrim')['display']).toBe('none')
    expect(of(exzed, 'html.theme-exzed .q-help-anchor::before')['background']).toBe('var(--zx-scrim)')
  })
})

describe('the `scrim` token in each skin (H-028)', () => {
  const blocks = (() => {
    // tokens.css holds one block per skin; read each one's `--bg`, `--ink` and `--scrim` in order.
    const found: Record<string, string>[] = []
    let current: Record<string, string> = {}
    for (const d of tokens) {
      if (d.property === '--bg' && 'bg' in current) {
        found.push(current)
        current = {}
      }
      if (['--bg', '--ink', '--scrim'].includes(d.property)) current[d.property.slice(2)] = d.value
    }
    found.push(current)

    return found.filter((block) => 'scrim' in block)
  })()

  const rgb = (value: string) => {
    const hex = /^#([0-9a-f]{6})$/i.exec(value)?.[1]
    if (hex) return [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16))
    const parts = /rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/.exec(value)

    return parts ? [Number(parts[1]), Number(parts[2]), Number(parts[3])] : []
  }
  const alpha = (value: string) => Number(/rgba\([^)]*,\s*([\d.]+)\)/.exec(value)?.[1])

  it('is the skin’s `bg` at .72 in the four dark skins, and its `ink` at .10 in Jouhou', () => {
    expect(blocks).toHaveLength(5)
    for (const [index, block] of blocks.entries()) {
      const light = index === 4
      const colour = light ? block['ink']! : block['bg']!
      expect(rgb(block['scrim']!), `skin ${index}`).toEqual(rgb(colour))
      expect(alpha(block['scrim']!), `skin ${index}`).toBeCloseTo(light ? 0.1 : 0.72, 2)
    }
  })
})
