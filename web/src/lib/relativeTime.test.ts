import { describe, expect, it } from 'vitest'
import { formatTimeAgo } from './relativeTime.js'

const NOW = new Date('2026-06-01T12:00:00Z')

function daysBefore(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
}

describe('formatTimeAgo', () => {
  it('says so when a list has never been touched', () => {
    expect(formatTimeAgo(null, NOW)).toBe('never touched')
  })

  it('phrases the recent past in days', () => {
    expect(formatTimeAgo(daysBefore(0), NOW)).toBe('today')
    expect(formatTimeAgo(daysBefore(1), NOW)).toBe('yesterday')
    expect(formatTimeAgo(daysBefore(12), NOW)).toBe('12 days ago')
  })

  it('rolls up to months and years once precision stops helping', () => {
    expect(formatTimeAgo(daysBefore(30), NOW)).toBe('a month ago')
    expect(formatTimeAgo(daysBefore(90), NOW)).toBe('3 months ago')
    expect(formatTimeAgo(daysBefore(400), NOW)).toBe('a year ago')
    expect(formatTimeAgo(daysBefore(900), NOW)).toBe('2 years ago')
  })
})
