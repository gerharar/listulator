import { describe, expect, it } from 'vitest'
import { keyRowOverflows } from './keyRowFit.js'

/**
 * D63 (57.10b): when an API-key row is wider than its column (Russian and German at the narrowest windows) the status chip wraps under [Test]. Whether it is wider is the sum of the parts' widths and the gaps
 * between them against the column's width: not what the browser laid out, which depends on the wrapping this decides.
 */
describe('keyRowOverflows', () => {
  it('is false when the parts and their gaps fit the column exactly, and true by a pixel more', () => {
    expect(keyRowOverflows([200, 320, 92, 228, 184], 8, 1056)).toBe(false)
    expect(keyRowOverflows([200, 320, 92, 228, 184], 8, 1055)).toBe(true)
  })

  it('counts a gap between every two parts, none after the last', () => {
    expect(keyRowOverflows([100, 100], 8, 208)).toBe(false)
    expect(keyRowOverflows([100, 100], 8, 207)).toBe(true)
    expect(keyRowOverflows([100], 8, 100)).toBe(false)
  })

  it('forgives half a pixel (a width measured at a fractional scale)', () => {
    expect(keyRowOverflows([100, 100], 8, 207.5)).toBe(false)
  })

  it('is false for a row with nothing in it', () => {
    expect(keyRowOverflows([], 8, 0)).toBe(false)
  })
})
