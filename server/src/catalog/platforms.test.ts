import { describe, expect, it } from 'vitest'
import fixture from '../ingestion/adapters/igdbPlatforms.fixture.json' with { type: 'json' }
import { igdbPlatformCode, LEGACY_PLATFORM_TAGS, PLATFORM_ORDER, platformCode, platformKey, platformName } from './platforms.js'

describe('the platform table (config/platforms.csv, 10.24c)', () => {
  it('follows the file’s order, with MULTI after every platform', () => {
    expect(PLATFORM_ORDER[0]).toBe('win')
    expect(PLATFORM_ORDER.at(-1)).toBe('multi')
    expect(new Set(PLATFORM_ORDER).size).toBe(PLATFORM_ORDER.length)
    // Number-like codes keep their place in the file, not an object's integer-first order.
    expect(PLATFORM_ORDER.indexOf('2600')).toBeGreaterThan(PLATFORM_ORDER.indexOf('win'))
  })

  it('maps every platform IGDB has (recorded 2026-09-27) to a code', () => {
    const unmapped = fixture.filter((platform) => igdbPlatformCode(platform.id) === undefined)

    expect(unmapped).toEqual([])
    expect(igdbPlatformCode(6)).toBe('WIN')
  })
})

describe('reading a tag', () => {
  it('matches a code whatever its case', () => {
    expect(platformKey('win')).toBe('win')
    expect(platformKey(' Win ')).toBe('win')
  })

  it('no old tag it translates is itself a code in the table', () => {
    expect(Object.keys(LEGACY_PLATFORM_TAGS).filter((tag) => PLATFORM_ORDER.includes(tag))).toEqual([])
  })

  it('reads the codes written before the table as today’s: PC is WIN, NDS is DS', () => {
    expect(platformKey('PC')).toBe('win')
    expect(platformKey('NDS')).toBe('ds')
    expect(platformKey('SWITCH')).toBe('nsw')
    expect(platformKey('GENESIS/MEGADRIVE')).toBe('gen')
    expect(platformName('PC')).toBe('Windows')
  })

  it('shows a code in the file’s capitals, MULTI for the claim, and an unknown tag in capitals', () => {
    expect(platformCode('pc')).toBe('WIN')
    expect(platformCode('firetv')).toBe('FIRETV')
    expect(platformCode('multi')).toBe('MULTI')
    expect(platformCode('Some Console')).toBe('SOME CONSOLE')
  })

  it('has a full name only for a known code', () => {
    expect(platformName('X360')).toBe('Xbox 360')
    expect(platformName('multi')).toBe('Multi-platform')
    expect(platformName('Some Console')).toBeNull()
  })
})
