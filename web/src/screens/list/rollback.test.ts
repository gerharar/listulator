import { describe, expect, it } from 'vitest'
import { putBack } from './rollback.js'

const rows = (...ids: string[]) => ids.map((id) => ({ id }))
const ids = (list: readonly { id: string }[]) => list.map((row) => row.id)

describe('putBack', () => {
  it('puts a removed row back after the row that preceded it', () => {
    const before = rows('a', 'b', 'c')

    expect(ids(putBack(rows('a', 'c'), before, [before[1]!]))).toEqual(['a', 'b', 'c'])
  })

  it('puts a removed first row back at the start', () => {
    const before = rows('a', 'b')

    expect(ids(putBack(rows('b'), before, [before[0]!]))).toEqual(['a', 'b'])
  })

  it('keeps what changed meanwhile: a row removed since stays removed, a row added since stays', () => {
    const before = rows('a', 'b', 'c', 'd')
    const current = rows('a', 'c', 'x') // b was the one refused; d was removed and x added since the click

    expect(ids(putBack(current, before, [before[1]!]))).toEqual(['a', 'b', 'c', 'x'])
  })

  it('anchors on the nearest row that is still there when the preceding one is gone', () => {
    const before = rows('a', 'b', 'c')

    expect(ids(putBack(rows('a'), before, [before[2]!]))).toEqual(['a', 'c'])
  })

  it('puts several removed rows back in their old order, each after the one before it', () => {
    const before = rows('a', 'b', 'c', 'd')

    expect(ids(putBack(rows('a', 'd'), before, [before[1]!, before[2]!]))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('does not duplicate a row that is already back (a refresh brought it)', () => {
    const before = rows('a', 'b')

    expect(ids(putBack(rows('a', 'b'), before, [before[1]!]))).toEqual(['a', 'b'])
  })

  it('returns the current rows unchanged when nothing was removed', () => {
    const current = rows('a')

    expect(putBack(current, rows('a'), [])).toEqual(current)
  })
})
