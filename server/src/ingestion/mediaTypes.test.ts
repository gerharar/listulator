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
      'documentary',
      'wrestling',
      'mma',
      'game',
      'comic',
      'book',
      'music',
      'youtube',
    ])
  })

  it('gives every category a fallback duration, so durations are never null', () => {
    for (const mediaType of DEFAULT_MEDIA_TYPES) {
      expect(mediaType.defaultDurationMinutes).toBeGreaterThan(0)
    }
  })

  it('uses the agreed fallback durations', () => {
    // Locked deliberately. These are the project owner's numbers, and they
    // decide what Quickie ranks on before any real duration is known — for
    // wrestling and MMA, which have no usable API, they are all it will ever
    // have to go on.
    expect(
      Object.fromEntries(
        DEFAULT_MEDIA_TYPES.map((mediaType) => [mediaType.key, mediaType.defaultDurationMinutes]),
      ),
    ).toEqual({
      movie: 120,
      tv: 50,
      animation: 25,
      documentary: 90,
      wrestling: 180,
      mma: 180,
      game: 600,
      comic: 15,
      book: 240,
      music: 45,
      youtube: 20,
    })
  })

  it('gives search only to categories with a usable source', () => {
    const searchable = DEFAULT_MEDIA_TYPES.filter((mediaType) => mediaType.adapter).map(
      (mediaType) => mediaType.key,
    )

    // A category is listed here because an adapter is *registered*; whether it
    // is usable depends on credentials, which isAvailable() decides.
    //
    // Wrestling and MMA were expected to stay out — neither has a usable API —
    // but Wikipedia's maintained event tables turned out to cover both.
    expect(searchable).toEqual([
      'movie',
      'tv',
      'animation',
      'documentary',
      'wrestling',
      'mma',
      'game',
      'comic',
      'book',
      'music',
      'youtube',
    ])

    // Every category now has a source.
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
