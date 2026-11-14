import { describe, expect, it } from 'vitest'
import { declarations, stylesheets, read } from './cssGuard.js'

/**
 * The theme contract's sweep (Phase 48.7, X-002): no component stylesheet draws a shadow, a transparency, a fade or a brightening from a literal.
 * 48.2 to 48.4c routed each one the plan named through a token a theme can replace; this is what keeps the next one from slipping in. A shadow is
 * `none` or a `--e-…` token, an opacity a `--o-…` token, a filter `none` or a `--hover-filter…` token, and `rgba(`, `hsla(`, `blur(`, `brightness(`
 * and `drop-shadow(` appear in no declaration. Left alone, on purpose: a `@keyframes` (a motion is not a state; design keeps the app's), the two
 * Quantum-only art files (not rendered under eX-Zed, 48.6) and the entries below, each with its reason and the task that takes it.
 *
 * The tokens' own files (`styles/quantum/tokens.css`, `styles/theme/*`) hold the literals and are not swept.
 */
const NOT_SWEPT = ['styles/quantum/tokens.css', 'styles/theme/contract.css', 'styles/theme/exzed.css', 'styles/theme/fonts.css']

/** Quantum's own drawing, which eX-Zed does not render at all (`ThemeBackdrop`, `HeaderPlate`): free to use any colour and alpha it likes. */
const QUANTUM_ONLY = ['components/quantum/Atmosphere/Atmosphere.css', 'components/quantum/HeaderPlate/HeaderPlate.css']

interface Allowed {
  file: string
  selector: string
  property: string
  /** The value as written, so a changed value is a new decision and not a silent pass. */
  value: string
  why: string
}

/** None: the Vault's selected-row stripe, the last entry, is the `--e-vb-sel` token now (51.12), and the tab strip's went with 51.3. A new entry is a new decision, with its reason and the task that takes it. */
const ALLOWED: readonly Allowed[] = []

const files = stylesheets().filter((path) => !NOT_SWEPT.includes(path) && !QUANTUM_ONLY.includes(path))

const problem = (property: string, value: string): string | undefined => {
  if (/\b(?:rgba|hsla)\(/.test(value)) return 'a literal colour with alpha'
  if (/\b(?:blur|brightness|drop-shadow)\(/.test(value)) return 'a literal blur, brightness or drop shadow'
  if ((property === 'box-shadow' || property === 'text-shadow') && value !== 'none' && !/^var\(--e-[\w-]+\)$/.test(value)) return 'a shadow that is not a --e- token'
  if (property === 'opacity' && !/^var\(--o-[\w-]+\)$/.test(value)) return 'an opacity that is not a --o- token'
  if ((property === 'filter' || property === 'backdrop-filter') && value !== 'none' && !/^var\(--hover-filter[\w-]*\)$/.test(value)) return 'a filter that is not a --hover-filter token'
  return undefined
}

describe('the component stylesheets', () => {
  it('are found: the sweep covers the app’s stylesheets, not an empty list', () => {
    expect(files.length).toBeGreaterThan(50)
    expect(files).toContain('components/quantum/Button/Button.css')
    expect(files).toContain('screens/list/ListScreen.css')
    expect(files).not.toContain('styles/theme/exzed.css')
  })

  it('draw no shadow, alpha, fade or brightening from a literal, outside keyframes, the Quantum-only art and the allow-list', () => {
    const found: string[] = []
    for (const file of files) {
      for (const d of declarations(read(file))) {
        if (d.keyframes) continue
        const why = problem(d.property, d.value)
        if (!why) continue
        const allowed = ALLOWED.some((a) => a.file === file && a.selector === d.selector && a.property === d.property && a.value === d.value)
        if (!allowed) found.push(`${file}: ${d.selector} { ${d.property}: ${d.value} } is ${why}`)
      }
    }

    expect(found).toEqual([])
  })

  it.each(ALLOWED)('the allowance for $selector in $file is still needed: that rule still says exactly that', (allowed) => {
    const there = declarations(read(allowed.file)).some(
      (d) => !d.keyframes && d.selector === allowed.selector && d.property === allowed.property && d.value === allowed.value,
    )

    expect(there).toBe(true)
    expect(problem(allowed.property, allowed.value), 'an allowance for something that is not a problem').toBeDefined()
  })

  it('the two Quantum-only art files exist, so naming them is not a way to skip a typo', () => {
    for (const file of QUANTUM_ONLY) expect(read(file).length, file).toBeGreaterThan(0)
  })
})

describe('what the sweep leaves alone', () => {
  it('keyframes are the app’s motion and keep their literals', () => {
    const inKeyframes = stylesheets().flatMap((file) => declarations(read(file)).filter((d) => d.keyframes && problem(d.property, d.value)))

    expect(inKeyframes.length).toBeGreaterThan(0)
  })
})
