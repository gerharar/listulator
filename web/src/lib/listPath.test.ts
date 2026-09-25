import { describe, expect, it } from 'vitest'
import { listPath, wantsUpdate } from './listPath.js'

describe('listPath', () => {
  it('is the list’s own path when nothing more is known', () => {
    expect(listPath('abc')).toBe('/lists/abc')
  })

  it('carries "an update is available" as a query the list layer reads back', () => {
    const path = listPath('abc', { update: true })

    expect(path).toBe('/lists/abc?update=1')
    expect(wantsUpdate(new URLSearchParams(path.split('?')[1]))).toBe(true)
  })

  it('reads a plain path as no update', () => {
    expect(wantsUpdate(new URLSearchParams(''))).toBe(false)
    expect(wantsUpdate(new URLSearchParams('update=0'))).toBe(false)
  })
})
