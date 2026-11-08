import { describe, expect, it } from 'vitest'
import { customProperties, plain, read } from './cssGuard.js'

/**
 * The contract files agree with the generated tokens (Phase 48.7, X-002). `styles/quantum/tokens.css` is generated from design's file and is never
 * edited; `styles/theme/contract.css` holds Quantum's value of every hook design's file does not have; `exzed.css` replaces hooks. Three things
 * follow, and each would otherwise be a silent drift:
 *  1. a token both files define has the same value in both (today none is: a hook lives in one of them);
 *  2. every token eX-Zed replaces has a Quantum value in one of them, so a misspelt or orphaned override is caught and Quantum is never left
 *     reading nothing;
 *  3. every token the contract adds is replaced by eX-Zed, so a theme cannot be left with a Quantum value by omission.
 */
const generated = customProperties(read('styles/quantum/tokens.css'))
const contract = customProperties(read('styles/theme/contract.css'))
const exzed = customProperties(read('styles/theme/exzed.css'))

describe('the contract and the generated tokens', () => {
  it('are both read: the generated file has dozens of tokens, the contract a score, eX-Zed about as many', () => {
    expect(generated.size).toBeGreaterThan(60)
    expect(contract.size).toBeGreaterThan(15)
    expect(exzed.size).toBeGreaterThan(25)
  })

  it('give a token they both define the same value, in every block of the generated file', () => {
    const disagreements: string[] = []
    for (const [token, values] of contract) {
      for (const generatedValue of generated.get(token) ?? []) {
        for (const value of values) if (plain(value) !== plain(generatedValue)) disagreements.push(`${token}: contract ${value} against tokens.css ${generatedValue}`)
      }
    }

    expect(disagreements).toEqual([])
  })

  it('give every token eX-Zed replaces a Quantum value', () => {
    const orphans = [...exzed.keys()].filter((token) => !generated.has(token) && !contract.has(token))

    expect(orphans).toEqual([])
  })

  it('are all replaced by eX-Zed where the contract adds a token', () => {
    const left = [...contract.keys()].filter((token) => !exzed.has(token))

    expect(left).toEqual([])
  })
})

describe('customProperties', () => {
  it('lists every value a custom property is given, in every block', () => {
    const found = customProperties('html { --a: 1px; --b: x } [data-theme=\'k\'] { --a: 2px }')

    expect(found.get('--a')).toEqual(['1px', '2px'])
    expect(found.get('--b')).toEqual(['x'])
  })
})
