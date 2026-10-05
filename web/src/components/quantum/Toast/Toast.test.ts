import { describe, expect, it } from 'vitest'
import { toastDuration } from './Toast.js'

describe('toastDuration', () => {
  it('is 3s for a plain toast', () => {
    expect(toastDuration(false)).toBe(3000)
  })

  it('is 5s when there is an Undo (or other) action to give time for', () => {
    expect(toastDuration(true)).toBe(5000)
  })
})
