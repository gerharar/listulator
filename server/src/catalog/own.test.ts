import { describe, expect, it } from 'vitest'
import { own } from './own.js'

/** BL-152 / SR-119: a table keyed by text from a list file must answer only for the keys it holds, never for what every object inherits. */
describe('own', () => {
  const table: Readonly<Record<string, string>> = { ps5: 'PlayStation 5', empty: '' }

  it('answers a key the table holds, and a falsy value as it is, not as missing', () => {
    expect(own(table, 'ps5')).toBe('PlayStation 5')
    expect(own(table, 'empty')).toBe('')
  })

  it('answers undefined for a key it does not hold', () => {
    expect(own(table, 'xbox')).toBeUndefined()
  })

  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString'])(
    'answers undefined for %s, which every object inherits',
    (name) => {
      expect(own(table, name)).toBeUndefined()
    },
  )

  it('still answers a table that holds such a key itself', () => {
    expect(own(JSON.parse('{"constructor":"mine"}') as Record<string, string>, 'constructor')).toBe('mine')
  })
})
