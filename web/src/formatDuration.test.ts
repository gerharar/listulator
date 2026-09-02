import { describe, expect, it } from 'vitest'
import { formatDuration } from './formatDuration.js'

describe('formatDuration', () => {
  it('shows minutes under an hour', () => {
    expect(formatDuration(45)).toBe('45m')
  })

  it('drops the minutes when they are zero', () => {
    expect(formatDuration(120)).toBe('2h')
  })

  it('shows hours and minutes together', () => {
    expect(formatDuration(155)).toBe('2h 35m')
  })
})
