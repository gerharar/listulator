import { describe, expect, it } from 'vitest'
import { declarations } from './cssGuard.js'

/** The reader the sweep guard stands on: it must find a declaration where it is, and none where it is not. */
describe('declarations', () => {
  it('reads each declaration with the selector of its rule', () => {
    const found = declarations('.a, .b { color: red; box-shadow: 0 1px 2px rgba(0,0,0,.2) }\n.c { opacity: .5 }')

    expect(found).toEqual([
      { selector: '.a, .b', property: 'color', value: 'red', keyframes: false },
      { selector: '.a, .b', property: 'box-shadow', value: '0 1px 2px rgba(0,0,0,.2)', keyframes: false },
      { selector: '.c', property: 'opacity', value: '.5', keyframes: false },
    ])
  })

  it('finds declarations inside @media and @supports, with their own rule’s selector', () => {
    const found = declarations('@media (min-width: 10px) { .a { opacity: 1 } @supports (x: y) { .b { filter: blur(2px) } } }')

    expect(found.map((d) => [d.selector, d.property, d.keyframes])).toEqual([
      ['.a', 'opacity', false],
      ['.b', 'filter', false],
    ])
  })

  it('marks what is inside @keyframes, whatever the step is called', () => {
    const found = declarations('@keyframes k { 0%, 21% { opacity: 0 } to { box-shadow: 0 0 4px rgba(0,0,0,.3) } }\n.x { opacity: var(--o-disabled) }')

    expect(found.map((d) => [d.property, d.keyframes])).toEqual([
      ['opacity', true],
      ['box-shadow', true],
      ['opacity', false],
    ])
  })

  it('keeps a value with parentheses, commas, a semicolon-free last declaration and a url whole', () => {
    const found = declarations(".a { background: url('x;y.png') no-repeat; color: var(--a, var(--b)) }")

    expect(found.map((d) => d.value)).toEqual(["url('x;y.png') no-repeat", 'var(--a, var(--b))'])
  })

  it('ignores comments and a selector that merely contains the word', () => {
    const found = declarations('/* opacity: .3; */ .q-tired-picker .filter { color: red }')

    expect(found).toEqual([{ selector: '.q-tired-picker .filter', property: 'color', value: 'red', keyframes: false }])
  })
})
