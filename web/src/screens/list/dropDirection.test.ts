import { describe, expect, it } from 'vitest'
import { opensUp } from './dropDirection.js'

describe('opensUp', () => {
  it('opens down while the list fits below the field', () => {
    expect(opensUp({ top: 300, bottom: 337 }, 900)).toBe(false)
  })

  it('opens up when the list would run past the window’s bottom and there is more room above', () => {
    expect(opensUp({ top: 820, bottom: 857 }, 900)).toBe(true)
  })

  it('stays down when there is even less room above', () => {
    expect(opensUp({ top: 60, bottom: 97 }, 200)).toBe(false)
  })
})
