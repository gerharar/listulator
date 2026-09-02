import { describe, expect, it } from 'vitest'
import { createMediaTypeRegistry, DEFAULT_MEDIA_TYPES, type MediaType } from './mediaTypes.js'

describe('media type registry', () => {
  it('ships the agreed phase-1 categories, in display order', () => {
    // Locked deliberately: users cannot add categories, so this set is the
    // wall people hit (docs/design/README.md).
    expect(createMediaTypeRegistry().keys()).toEqual([
      'movie',
      'tv',
      'animation',
      'wrestling',
      'mma',
      'game',
      'comic',
      'book',
      'music',
    ])
  })

  it('gives every category a fallback duration, so durations are never null', () => {
    for (const mediaType of DEFAULT_MEDIA_TYPES) {
      expect(mediaType.defaultDurationMinutes).toBeGreaterThan(0)
    }
  })

  it('has no search adapters yet — manual entry is the baseline', () => {
    // Real adapters land in Phase 3a; wrestling and MMA may never get one.
    expect(DEFAULT_MEDIA_TYPES.filter((mediaType) => mediaType.adapter)).toEqual([])
  })

  it('orders by sortOrder rather than declaration order', () => {
    const registry = createMediaTypeRegistry([
      { key: 'last', label: 'Last', sortOrder: 99, defaultDurationMinutes: 10 },
      { key: 'first', label: 'First', sortOrder: 1, defaultDurationMinutes: 10 },
    ])

    expect(registry.keys()).toEqual(['first', 'last'])
  })

  it('refuses duplicate keys', () => {
    const duplicate: MediaType = { key: 'movie', label: 'Dup', sortOrder: 1, defaultDurationMinutes: 1 }

    expect(() => createMediaTypeRegistry([...DEFAULT_MEDIA_TYPES, duplicate])).toThrow(
      /duplicate/i,
    )
  })

  it('does not leak registry mutations to callers', () => {
    const registry = createMediaTypeRegistry()
    registry.list().push({ key: 'sneaky', label: 'Sneaky', sortOrder: 1, defaultDurationMinutes: 1 })

    expect(registry.has('sneaky')).toBe(false)
  })
})
