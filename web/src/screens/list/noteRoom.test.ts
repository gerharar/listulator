import { describe, expect, it } from 'vitest'
import { de } from '../../locale/de.js'
import { en } from '../../locale/en.js'
import { ru } from '../../locale/ru.js'
import { noteRoomFor } from './noteRoom.js'

/** H-019 revision: the count note sits in a slot as many characters wide as the longest form it takes, so it moves nothing beside it. */
describe('noteRoomFor', () => {
  it.each([
    ['en', en.quantum.list.filter],
    ['ru', ru.quantum.list.filter],
    ['de', de.quantum.list.filter],
  ])('is the "n of n shown" form in %s, the longest the note can be while filtering', (_language, filter) => {
    expect(noteRoomFor(598, filter)).toBe(filter.shown(598, 598))
  })

  it('grows with the digits of the total, so a list of a thousand items has the room for four', () => {
    const { filter } = en.quantum.list

    expect(noteRoomFor(1000, filter).length).toBe(noteRoomFor(100, filter).length + 2)
  })

  it('is the plain form when a language writes that one longer, and the first on a tie', () => {
    const forms = { shown: (a: number, b: number) => `${a}/${b}`, total: (n: number) => `${n} items in all` }

    expect(noteRoomFor(7, forms)).toBe('7 items in all')
    expect(noteRoomFor(7, { shown: () => 'abc', total: () => 'xyz' })).toBe('abc')
  })
})
