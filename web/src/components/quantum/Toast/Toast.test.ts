import { describe, expect, it } from 'vitest'
import { toastDuration } from './Toast.js'

describe('toastDuration', () => {
  it('is 3.2s for a plain toast', () => {
    expect(toastDuration(false)).toBe(3200)
  })

  it('is 8s when there is an Undo (or other) action to give time for', () => {
    expect(toastDuration(true)).toBe(8000)
  })
})
